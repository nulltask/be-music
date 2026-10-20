import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import type { JudgeWindowSetUs, RulesetConfig, RulesetWindowTables } from '../ruleset/definitions.ts';
import { judgeWindowEarlyReachUs, judgeWindowLateReachUs, selectJudgeWindowSet } from '../ruleset/judge.ts';
import { longNoteOwesTailMiss, noteLateReachUs } from '../ruleset/long-note.ts';
import type { GaugeJudgeIndex } from '../ruleset/gauge.ts';
import type { GrooveGaugeJudgeKind } from './groove-gauge.ts';
import { isLongPlayableNote, resolveRulesetLongNoteMode, type TimedManualJudge } from './judge-rules.ts';
import { applyJudgeToSummary, type JudgeKind } from './scoring.ts';
import {
  JUDGE_TIME_EPSILON_SECONDS,
  type JudgeCoreConfig,
  type JudgeCoreEffectSink,
  type JudgeCoreState,
  type JudgeCoreSummary,
} from './judge-core-types.ts';

/**
 * Judge-core scoring: the ruleset windows a judgment reads, and how a judgment moves the
 * score, gauge and combo.
 */

// ---- LR2 negative-BPM reversal --------------------------------------------------------------------------------

/**
 * The clock a press, a release or a long-note hold is judged on. Past an LR2 negative-BPM reversal R it is the
 * mirrored `t' = 2R - now` (OpenLR2 `LR2f.cpp:12624,12931`, LR2body.exe 0x42c25b / 0x42c788): notes around the
 * reversal stay hittable just after it, empty POORs keep firing while the lane's next note is within reach of t', and
 * a long note spanning the reversal BADs on release. t' never passes R, so nothing past it is ever reached. Pure in
 * the true chart time, so replays reproduce it.
 */
export function toJudgeClock(config: Pick<JudgeCoreConfig, 'reversalSeconds'>, seconds: number): number {
  const reversal = config.reversalSeconds;
  return reversal !== undefined && seconds > reversal ? 2 * reversal - seconds : seconds;
}

/**
 * Clamps a forward pump reference (misses, auto-scratch) strictly BELOW the reversal. The sweeps are inclusive at
 * their reference (some add {@link JUDGE_TIME_EPSILON_SECONDS} on top), while LR2 orders lane notes (op 10+) AFTER the
 * negative BPM (op 8) on the reversal tick, so a note exactly AT the reversal is frozen with the pump.
 */
export function clampToReversal(config: Pick<JudgeCoreConfig, 'reversalSeconds'>, seconds: number): number {
  const reversal = config.reversalSeconds;
  return reversal === undefined ? seconds : Math.min(seconds, reversal - 2 * JUDGE_TIME_EPSILON_SECONDS);
}

// ---- windows --------------------------------------------------------------------------------------------------

/**
 * Signed judge windows in force at a given chart time. The ruleset owns the whole table set — key vs scratch, note
 * vs long-note end, and (LR2 only) the `#EXRANKxx` timeline — so the core never derives a window itself.
 */
export function windowTablesAt(config: JudgeCoreConfig, seconds: number): RulesetWindowTables {
  return config.ruleset.windowsAt(Math.round(seconds * 1e6));
}

export function judgeWindowsFor(
  config: JudgeCoreConfig,
  channel: string,
  seconds: number,
  longNoteEnd = false,
): JudgeWindowSetUs {
  return selectJudgeWindowSet(windowTablesAt(config, seconds), {
    scratch: config.scratchChannels.has(channel),
    longNoteEnd,
  });
}

/**
 * Widest reach (seconds) any lane can have at `seconds`, used as the candidate search radius. Only a coarse bound:
 * the asymmetric legs are settled against each note's own window set.
 */
export function maxJudgeReachSeconds(config: Pick<JudgeCoreConfig, 'ruleset'>, seconds: number): number {
  const tables = config.ruleset.windowsAt(Math.round(seconds * 1e6));
  let reachUs = 0;
  for (const set of [tables.note, tables.scratch, tables.longNoteEnd, tables.longScratchEnd]) {
    reachUs = Math.max(reachUs, judgeWindowLateReachUs(set), judgeWindowEarlyReachUs(set));
  }
  return reachUs / 1e6;
}

/** How far ahead of a note its judgable window opens — when the lane's fallback keysound becomes that note's. */
export function maxJudgeEarlyReachSeconds(config: JudgeCoreConfig, seconds: number): number {
  const tables = windowTablesAt(config, seconds);
  let reachUs = 0;
  for (const set of [tables.note, tables.scratch]) {
    reachUs = Math.max(reachUs, judgeWindowEarlyReachUs(set));
  }
  return reachUs / 1e6;
}

/** The BAD gate of the opening key windows, in seconds — the horizon invisible notes are retired after. */
export function badWindowSeconds(config: JudgeCoreConfig): number {
  // Two divisions on purpose: the engine always derived it through the millisecond readout, and the expiry compare
  // must not move by a rounding step.
  return judgeWindowLateReachUs(config.ruleset.windows.note) / 1000 / 1000;
}

/**
 * How long past its own time a note stays reachable, in seconds. Resolved from the window set active at THAT NOTE's
 * time and on THAT NOTE's lane: a mid-chart `#EXRANKxx` must not retroactively move the deadline of notes that had
 * already scrolled past under the old rank. The play log simulator freezes the same per-note deadline.
 */
export function resolveMissDeadlineSeconds(config: JudgeCoreConfig, note: TimedPlayableNote): number {
  return resolveNoteLateReachUs(config, note) / 1e6;
}

function resolveNoteLateReachUs(config: JudgeCoreConfig, note: TimedPlayableNote): number {
  const { ruleset } = config;
  return noteLateReachUs(
    ruleset,
    judgeWindowsFor(config, note.channel, note.seconds),
    resolveRulesetLongNoteMode(ruleset.longNoteStyle, note),
  );
}

/**
 * A chart instant in whole microseconds, the play log's clock. Timed judgments (tails, misses, auto notes, mines) are
 * scheduled on it, so the engine and the play log simulator see the same instants and the same ties.
 */
export function toJudgeUs(seconds: number): number {
  return Math.round(seconds * 1e6);
}

/** The microsecond past which a note can no longer be pressed: it is missed once time has moved beyond it. */
export function resolveMissDeadlineUs(config: JudgeCoreConfig, note: TimedPlayableNote): number {
  return toJudgeUs(note.seconds) + resolveNoteLateReachUs(config, note);
}

/** Channel order, the tie-break for timed judgments that fall on the same microsecond. */
export function compareJudgeChannels(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---- score ----------------------------------------------------------------------------------------------------

export function applyGaugeJudge(
  state: JudgeCoreState,
  seconds: number,
  judge: GrooveGaugeJudgeKind,
  emit: JudgeCoreEffectSink,
  reason = 'judge',
): void {
  const previousGauge = state.summary.gauge?.current;
  state.applyGaugeJudge(judge);
  const nextGauge = state.summary.gauge?.current;
  emit({
    kind: 'gauge',
    seconds,
    reason,
    judge,
    delta: previousGauge !== undefined && nextGauge !== undefined ? nextGauge - previousGauge : undefined,
  });
}

export function applyGaugeDelta(
  state: JudgeCoreState,
  seconds: number,
  delta: number,
  reason: string,
  emit: JudgeCoreEffectSink,
): void {
  const previousGauge = state.summary.gauge?.current;
  state.applyGaugeDelta(delta);
  const nextGauge = state.summary.gauge?.current;
  if (previousGauge === nextGauge) {
    return;
  }
  emit({
    kind: 'gauge',
    seconds,
    reason,
    delta: previousGauge !== undefined && nextGauge !== undefined ? nextGauge - previousGauge : undefined,
  });
}

/**
 * One Hell Charge tick on the gauge (see `HCNTickCounter`): the ruleset's held tick while the lane gains, its released
 * tick while it loses (beatoraja: GREAT ×0.5 and BAD ×0.5 of the judge table).
 */
export function applyHCNGaugeTick(
  state: JudgeCoreState,
  seconds: number,
  gain: boolean,
  emit: JudgeCoreEffectSink,
): void {
  if (isJudgingClosed(state)) {
    return;
  }
  const tick = state.config.ruleset.hcnTick;
  const previousGauge = state.summary.gauge?.current;
  state.applyGaugeTick(
    (gain ? tick.heldJudge : tick.releasedJudge) as GaugeJudgeIndex,
    gain ? tick.heldRate : tick.releasedRate,
  );
  const nextGauge = state.summary.gauge?.current;
  if (previousGauge === nextGauge) {
    return;
  }
  emit({
    kind: 'gauge',
    seconds,
    reason: gain ? 'hold-gain' : 'hold-drain',
    delta: previousGauge !== undefined && nextGauge !== undefined ? nextGauge - previousGauge : undefined,
  });
}

export function setCombo(
  state: JudgeCoreState,
  seconds: number,
  value: number,
  reason: string,
  emit: JudgeCoreEffectSink,
  judge?: string,
  channel?: string,
): void {
  emit({ kind: 'combo', seconds, value, reason, judge, channel });
  state.combo = value;
}

function applyFastSlow(summary: JudgeCoreSummary, judge: JudgeKind, signedDeltaMs: number): void {
  if (judge === 'GREAT' || judge === 'GOOD') {
    if (signedDeltaMs < 0) {
      summary.fast += 1;
    } else if (signedDeltaMs > 0) {
      summary.slow += 1;
    }
  }
}

export function markScorableJudged(state: JudgeCoreState, note: TimedPlayableNote): boolean {
  if (note.judged) {
    return false;
  }
  note.judged = true;
  state.remainingScorableNotes -= 1;
  return true;
}

export function markLandmineJudged(state: JudgeCoreState, note: TimedLandmineNote): boolean {
  if (note.judged) {
    return false;
  }
  note.judged = true;
  state.remainingLandmineNotes -= 1;
  return true;
}

export function markInvisibleJudged(state: JudgeCoreState, note: TimedPlayableNote): boolean {
  if (note.judged) {
    return false;
  }
  note.judged = true;
  state.remainingInvisibleNotes -= 1;
  return true;
}

/**
 * True when a long note the player never held contributes a SECOND miss for its tail. Charge modes score head and
 * tail separately, so a note missed at the head owes two POORs — except under IIDX, where a broken head cancels the
 * tail outright (`headBadSkipsTail`).
 */
export function noteOwesTailMiss(ruleset: RulesetConfig, note: TimedPlayableNote): boolean {
  return longNoteOwesTailMiss(
    ruleset,
    isLongPlayableNote(note) ? resolveRulesetLongNoteMode(ruleset.longNoteStyle, note) : undefined,
  );
}

/**
 * True once judging has stopped: the survival gauge emptied in a play that ends on failure
 * (`JudgeCoreConfig.endOnFailure`). Nothing after the judgment that emptied it counts — no tally, combo, gauge or
 * fast / slow — as in the play log simulator, which checks the same at the same points.
 */
export function isJudgingClosed(state: JudgeCoreState): boolean {
  return state.config.endOnFailure && state.summary.gauge?.failedMidPlay === true;
}

export function applyResolvedManualJudge(
  state: JudgeCoreState,
  channel: string,
  judge: TimedManualJudge,
  atSeconds: number,
  emit: JudgeCoreEffectSink,
): void {
  if (isJudgingClosed(state)) {
    return;
  }
  const { summary } = state;
  const deltaMs = Math.abs(judge.signedDeltaMs);
  applyJudgeToSummary(summary, judge.kind, state.scoreTracker);
  applyGaugeJudge(state, atSeconds, judge.kind, emit);
  if (judge.kind === 'PERFECT' || judge.kind === 'GREAT' || judge.kind === 'GOOD') {
    applyFastSlow(summary, judge.kind, judge.signedDeltaMs);
    emit({ kind: 'poor-bga', action: 'clear', seconds: atSeconds });
    setCombo(state, atSeconds, state.combo + 1, 'judge', emit, judge.kind, channel);
    emit({
      kind: 'trace',
      name: 'judge',
      seconds: atSeconds,
      fields: [
        ['result', judge.kind],
        ['channel', channel],
        ['deltaMs', Math.round(deltaMs)],
      ],
    });
    emit({ kind: 'judge-combo', judge: judge.kind, combo: state.combo, channel, signedDeltaMs: judge.signedDeltaMs });
    emit({ kind: 'poor-trace', action: 'clear', seconds: atSeconds });
    return;
  }
  if (judge.kind === 'BAD') {
    setCombo(state, atSeconds, 0, 'judge', emit, 'BAD', channel);
    emit({
      kind: 'trace',
      name: 'judge',
      seconds: atSeconds,
      fields: [
        ['result', 'BAD'],
        ['channel', channel],
        ['deltaMs', Math.round(deltaMs)],
      ],
    });
    emit({ kind: 'judge-combo', judge: 'BAD', combo: state.combo, channel, signedDeltaMs: judge.signedDeltaMs });
    return;
  }
  emit({ kind: 'poor-bga', action: 'trigger', seconds: atSeconds });
  emit({ kind: 'poor-trace', action: 'trigger', seconds: atSeconds });
  setCombo(state, atSeconds, 0, 'judge', emit, 'POOR', channel);
  emit({
    kind: 'trace',
    name: 'judge',
    seconds: atSeconds,
    fields: [
      ['result', 'POOR'],
      ['channel', channel],
      ['deltaMs', Math.round(deltaMs)],
    ],
  });
  emit({ kind: 'judge-combo', judge: 'POOR', combo: state.combo, channel, signedDeltaMs: judge.signedDeltaMs });
}

/** Charges a POOR (gauge + tally) with no other cue — the second judgment a missed charge note owes. */
export function applyTailMissPoor(state: JudgeCoreState, seconds: number, emit: JudgeCoreEffectSink): void {
  if (isJudgingClosed(state)) {
    return;
  }
  applyJudgeToSummary(state.summary, 'POOR', state.scoreTracker);
  applyGaugeJudge(state, seconds, 'POOR', emit, 'miss');
}
