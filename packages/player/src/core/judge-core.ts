import { findFirstIndexNumberAtOrAfter } from '@be-music/utils/core';
import type { BeMusicEvent, BeMusicSourceFormat } from '@be-music/json';
import { findLaneSoundCandidate, lowerBoundBySeconds } from '../judging.ts';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import type { PlaylogInputEvent } from '../playlog/format.ts';
import type { JudgeWindowSetUs, RulesetConfig, RulesetWindowTables } from '../ruleset/definitions.ts';
import {
  classifyRulesetJudge,
  judgeWindowEarlyReachUs,
  judgeWindowLateReachUs,
  pgreatWindowReachUs,
  RULESET_JUDGE_NONE,
  selectJudgeWindowSet,
  type RulesetJudgeIndex,
} from '../ruleset/judge.ts';
import {
  ignoresLateLongNoteHeadBad,
  isChargeLongNoteMode,
  isMultiBadCollectorTarget,
  longNoteOwesTailMiss,
} from '../ruleset/long-note.ts';
import { preferJudgeCandidate, type JudgeSelectionCandidate } from '../ruleset/selection.ts';
import type { GrooveGaugeJudgeKind } from './groove-gauge.ts';
import {
  combineLongNoteJudges,
  insertPendingAutoLongNote,
  isLongPlayableNote,
  longNoteScoresTail,
  resolveLoggedLongNoteMode,
  resolveLongNoteEndSeconds,
  resolveManualTimedJudge,
  resolveRulesetLongNoteMode,
  toUiLongNoteMode,
  type PendingAutoLongNoteState,
  type TimedManualJudge,
} from './judge-rules.ts';
import { resolveLandmineGaugeEffect } from './landmine.ts';
import { applyJudgeToSummary, type JudgeKind, type ScoreSummary, type ScoreTracker } from './scoring.ts';
import type { PlayerGaugeSummary, PlayerUiCommand } from './ui-signal-bus.ts';

/**
 * The deterministic judge core of manual play.
 *
 * Everything that decides a judgment — note selection, the ruleset windows, long-note holds and tails, the HCN gauge
 * ticks, mines, auto-scratch, misses, combo, score and gauge — lives in a {@link JudgeCoreState} that only
 * {@link runJudgeCoreStep} changes. A step takes one {@link JudgeCoreInput} stamped with chart time (and the
 * millisecond domain the hold-grace windows run in) and reports what happened as {@link JudgeCoreEffect}s, in order.
 * The core never reads a clock, never touches audio, the UI or the log, and never schedules anything: the same
 * state and the same inputs always produce the same effects. Drivers own the rest:
 *
 * - live play (`manualPlay`) steps it from the playback clock once per frame and on every key event;
 * - a replay steps it on a fixed chart-time grid merged with the recorded inputs ({@link advanceJudgeCoreReplay}),
 *   so its judgments do not depend on tick timing or `speed`.
 *
 * Effects are delivered synchronously through a sink, so a driver that reads the shared {@link JudgeCoreState.summary}
 * while handling one (the no-TUI state logger does) sees it exactly as it was when the effect was produced.
 */

/** How long a fresh long-note press counts as held without further key events (terminal key repeat warm-up). */
export const LONG_NOTE_INITIAL_HOLD_GRACE_MS = 380;
/** How long each further key event (or a held kitty key) keeps a long note held. */
export const LONG_NOTE_REPEAT_HOLD_GRACE_MS = 120;
/** Chart-time grid a replay advances its judge state on, between and alongside the replayed inputs. */
export const REPLAY_JUDGE_STEP_SECONDS = 0.001;
/**
 * Per-second gauge drain while a Hell-Charge LN (mode 3) is NOT held during its body. Upstream
 * `JudgeManager.java:324-340` integrates 0.5 % per 200 ms tick = 2.5 %/s; the core integrates the same rate
 * continuously, which gives the same total over the same elapsed time.
 */
export const HELL_CHARGE_GAUGE_DRAIN_PER_SECOND = 2.5;
/**
 * Per-second gauge GAIN while a Hell-Charge LN (mode 3) is held cleanly. Upstream `JudgeManager.java:324-329` calls
 * `gauge.update(1, 0.5f)` per 200 ms tick = 2.5 %/s.
 */
export const HELL_CHARGE_GAUGE_GAIN_PER_SECOND = 2.5;
/** Slack added to "has chart time reached X" checks so float noise never holds an event back by one step. */
export const JUDGE_TIME_EPSILON_SECONDS = 1e-6;
/** `#WAV00` — the sample a mine explosion plays, when the chart defines one. */
export const LANDMINE_EXPLOSION_SAMPLE_KEY = '00';

/** Everything about the play that stays fixed while it runs. */
export interface JudgeCoreConfig {
  ruleset: RulesetConfig;
  /** Judged notes, sorted by time. The core marks them `judged` (and sets `visibleUntilBeat` on long notes). */
  scorableNotes: TimedPlayableNote[];
  landmineNotes: TimedLandmineNote[];
  invisibleNotes: TimedPlayableNote[];
  /** Notes whose keysound a note-less press plays (LR2 lane-sound hold). */
  laneSoundNotes: readonly TimedPlayableNote[];
  /** FREE ZONE channels: a note-less press there plays its keysound and never charges an empty POOR. */
  freeZoneChannels: ReadonlySet<string>;
  /** Scratch lanes (`16` / `26` and their mapped equivalents) — they read the scratch window tables. */
  scratchChannels: ReadonlySet<string>;
  /** AUTO SCRATCH: the core plays the scratch lanes itself and ignores input on them. */
  autoScratch: boolean;
  /**
   * Scale of the millisecond domain (`nowMs`, hold-grace deadlines, last-press stamps) per chart second. Live play
   * runs it on the playback clock (`1000 / speed`, wall-clock milliseconds); a replay runs it on chart time (`1000`).
   */
  judgeMsPerChartSecond: number;
  /** `#WAVxx` table, for the mine explosion sample. */
  wavResources: Readonly<Record<string, string>>;
  /** Object-id radix, for reading mine damage values. */
  idBase: 36 | 62;
  sourceFormat: BeMusicSourceFormat;
}

/** The play's running result — the same shape as the engine's public `PlayerSummary`. */
export interface JudgeCoreSummary extends ScoreSummary {
  fast: number;
  slow: number;
  gauge?: PlayerGaugeSummary;
}

/** The score side of the state: the summary the host shows, and the gauge it is updated through. */
export interface JudgeCoreScore {
  summary: JudgeCoreSummary;
  scoreTracker: ScoreTracker;
  applyGaugeJudge: (judge: GrooveGaugeJudgeKind) => void;
  applyGaugeDelta: (delta: number) => void;
}

/** A long note whose head was hit and whose tail is not resolved yet. */
export interface ActiveLongNoteState {
  endSeconds: number;
  note: TimedPlayableNote;
  mode: 1 | 2 | 3;
  headJudge: TimedManualJudge;
  /** Last chart second the HCN gain / drain integration has accounted for (mode 3 only). */
  gaugeDrainCursorSeconds: number;
  audioStopped: boolean;
  /**
   * True when `headJudge` has ALREADY been applied to the score (charge modes judge the head on the press). The
   * tail then stands alone; LN mode instead defers, and resolves head and tail into one combined judgment.
   */
  headScored: boolean;
}

/** The judge state of one manual play. Owned by the core: drivers read it, only {@link runJudgeCoreStep} writes it. */
export interface JudgeCoreState {
  readonly config: JudgeCoreConfig;
  readonly summary: JudgeCoreScore['summary'];
  readonly scoreTracker: ScoreTracker;
  readonly applyGaugeJudge: (judge: GrooveGaugeJudgeKind) => void;
  readonly applyGaugeDelta: (delta: number) => void;
  combo: number;
  /** Lanes whose key is down (kitty key-state input and replays; plain terminals only send presses). */
  readonly heldChannels: Set<string>;
  readonly activeLongNotes: Map<string, ActiveLongNoteState>;
  /** Millisecond deadline up to which each active long note counts as held. */
  readonly longHoldUntilMs: Map<string, number>;
  /** Chart second each held long note was released at — its tail is judged against the release, not the tick. */
  readonly longHoldReleaseSeconds: Map<string, number>;
  /** Until this chart second, a note-less press on the lane is part of a long note just played, not a phantom. */
  readonly longNoteSuppressUntilSeconds: Map<string, number>;
  readonly lastLanePressMs: Map<string, number>;
  readonly pendingAutoScratchLongNotes: PendingAutoLongNoteState[];
  readonly autoScratchNotes: readonly TimedPlayableNote[];
  /** Per-lane sorted note times — the reference notes a phantom press is measured against for an empty POOR. */
  readonly scorableNoteSecondsByChannel: ReadonlyMap<string, number[]>;
  autoScratchCursor: number;
  scorableMissCursor: number;
  landmineExpireCursor: number;
  invisibleExpireCursor: number;
  remainingScorableNotes: number;
  remainingLandmineNotes: number;
  remainingInvisibleNotes: number;
}

/** One thing that happens to the judge state, stamped with chart seconds (and the millisecond domain). */
export type JudgeCoreInput =
  /** Time passes: long-note holds and tails, HCN ticks, auto-scratch, misses, mines and invisible notes resolve. */
  | { kind: 'advance'; nowSec: number; nowMs: number }
  /** A lane press on `channels` (already mapped from key tokens; `tokens` are only recorded). */
  | { kind: 'press'; channels: ReadonlySet<string>; tokens: readonly string[]; nowSec: number; nowMs: number }
  /** Keys went down and stay down (key-state input): the lanes count as held until released. */
  | { kind: 'hold'; channels: ReadonlySet<string> }
  /** Keys came up. `recordSec` is the instant the play log records for the release. */
  | {
      kind: 'release';
      channels: ReadonlySet<string>;
      tokens: readonly string[];
      nowSec: number;
      nowMs: number;
      recordSec: number;
    }
  /** The play ended: anything still unjudged is charged as POOR at `totalSeconds`. */
  | { kind: 'finish'; totalSeconds: number };

/** A `name value` field of a no-TUI trace line (the time field is added from the effect's `seconds`). */
export type JudgeTraceField = readonly [key: string, value: string | number | boolean | undefined];

/** Where a keysound the core triggered came from. */
export type JudgeSoundSource = 'auto-scratch' | 'manual-note' | 'lane-fallback' | 'mine-hit';

/** What a step produced, in order. Drivers map these onto audio, the UI buses, the play log and the no-TUI trace. */
export type JudgeCoreEffect =
  /** Record a raw input in the play log (before it is judged). `channels` is only valid during dispatch. */
  | {
      kind: 'record-input';
      action: PlaylogInputEvent['action'];
      seconds: number;
      tokens: readonly string[];
      channels: ReadonlySet<string>;
    }
  /** Count an empty POOR in the play log's native result. */
  | { kind: 'record-empty-poor' }
  /** An input is about to be judged at `seconds` (replay): flush time-scheduled trace output up to it first. */
  | { kind: 'input-time'; seconds: number }
  /** Play a keysound / explosion sample. */
  | { kind: 'sound'; source: JudgeSoundSource; event: BeMusicEvent; seconds: number; channel: string }
  /** Cut a lane's sounding keysound (a long note released or broken). */
  | {
      kind: 'stop-sound';
      channel: string;
      seconds: number;
      reason: 'long-note-release' | 'long-note-break';
      event: BeMusicEvent;
    }
  /** The gauge moved (`judge` absent for raw deltas). `delta` is the applied change, after clamping. */
  | { kind: 'gauge'; seconds: number; reason: string; judge?: GrooveGaugeJudgeKind; delta?: number }
  /** The combo was set to `value`. */
  | { kind: 'combo'; seconds: number; value: number; reason: string; judge?: string; channel?: string }
  /** A long note changed state. */
  | {
      kind: 'long-note';
      seconds: number;
      channel: string;
      state: 'start' | 'release' | 'break' | 'complete';
      mode: 1 | 2 | 3;
      event: BeMusicEvent;
      endSeconds: number;
    }
  /** A presentation cue for the gameplay UI (lane flashes, holds, long-note bars). */
  | { kind: 'ui'; command: PlayerUiCommand }
  /** The POOR BGA was triggered / cleared — delivered to every host, UI or not. */
  | { kind: 'poor-bga'; action: 'trigger' | 'clear'; seconds: number }
  /** The no-TUI trace's POOR BGA marker at this point of the output. */
  | { kind: 'poor-trace'; action: 'trigger' | 'clear'; seconds: number }
  /** The judge readout: what the UI's judge / combo display shows. */
  | { kind: 'judge-combo'; judge: string; combo: number; channel?: string; signedDeltaMs?: number }
  /** A no-TUI trace line. */
  | { kind: 'trace'; name: string; seconds: number; fields: readonly JudgeTraceField[] }
  /** The play state changed outside a frame tick: republish the frame (at `beat`, or the beat of `seconds`). */
  | { kind: 'frame'; seconds: number; beat?: number };

export type JudgeCoreEffectSink = (effect: JudgeCoreEffect) => void;

/** Builds the initial judge state of a play. */
export function createJudgeCoreState(config: JudgeCoreConfig, score: JudgeCoreScore): JudgeCoreState {
  const scorableNoteSecondsByChannel = new Map<string, number[]>();
  for (const note of config.scorableNotes) {
    const noteTimes = scorableNoteSecondsByChannel.get(note.channel);
    if (noteTimes) {
      noteTimes.push(note.seconds);
    } else {
      scorableNoteSecondsByChannel.set(note.channel, [note.seconds]);
    }
  }
  return {
    config,
    summary: score.summary,
    scoreTracker: score.scoreTracker,
    applyGaugeJudge: score.applyGaugeJudge,
    applyGaugeDelta: score.applyGaugeDelta,
    combo: 0,
    heldChannels: new Set(),
    activeLongNotes: new Map(),
    longHoldUntilMs: new Map(),
    longHoldReleaseSeconds: new Map(),
    longNoteSuppressUntilSeconds: new Map(),
    lastLanePressMs: new Map(),
    pendingAutoScratchLongNotes: [],
    autoScratchNotes: config.autoScratch
      ? config.scorableNotes.filter((note) => config.scratchChannels.has(note.channel))
      : [],
    scorableNoteSecondsByChannel,
    autoScratchCursor: 0,
    scorableMissCursor: 0,
    landmineExpireCursor: 0,
    invisibleExpireCursor: 0,
    remainingScorableNotes: config.scorableNotes.length,
    remainingLandmineNotes: config.landmineNotes.length,
    remainingInvisibleNotes: config.invisibleNotes.length,
  };
}

/** Applies one input to the state, delivering the effects to `emit` in the order they happen. */
export function runJudgeCoreStep(state: JudgeCoreState, input: JudgeCoreInput, emit: JudgeCoreEffectSink): void {
  switch (input.kind) {
    case 'advance':
      advanceJudgeState(state, input.nowSec, input.nowMs, emit);
      return;
    case 'press':
      handleLanePress(state, input.channels, input.tokens, input.nowMs, input.nowSec, emit);
      return;
    case 'hold':
      for (const channel of input.channels) {
        state.heldChannels.add(channel);
        emit({ kind: 'ui', command: { kind: 'press-lane', channel } });
      }
      return;
    case 'release':
      handleLaneRelease(state, input, emit);
      return;
    case 'finish':
      finishJudgeState(state, input.totalSeconds, emit);
      return;
  }
}

/** {@link runJudgeCoreStep} collecting the effects into an array — `step(state, input) → effects`. */
export function stepJudgeCore(state: JudgeCoreState, input: JudgeCoreInput): JudgeCoreEffect[] {
  const effects: JudgeCoreEffect[] = [];
  runJudgeCoreStep(state, input, (effect) => {
    effects.push(effect);
  });
  return effects;
}

/** True once nothing is left to judge: every note resolved and no long note or auto-scratch tail outstanding. */
export function isJudgeCoreSettled(state: JudgeCoreState): boolean {
  return (
    state.remainingScorableNotes === 0 &&
    state.remainingLandmineNotes === 0 &&
    state.remainingInvisibleNotes === 0 &&
    state.pendingAutoScratchLongNotes.length === 0 &&
    state.activeLongNotes.size === 0
  );
}

/**
 * Maps key tokens onto the lanes they press, dropping auto-played scratch lanes. Fills and returns `buffer`, which is
 * cleared first — the result is only valid until the next call with the same buffer.
 */
export function resolveJudgeInputChannels(
  config: Pick<JudgeCoreConfig, 'autoScratch' | 'scratchChannels'>,
  inputTokenToChannels: ReadonlyMap<string, readonly string[]>,
  buffer: Set<string>,
  tokens: readonly string[],
  additionalTokens?: readonly string[],
): Set<string> {
  buffer.clear();
  const collect = (list: readonly string[]): void => {
    for (const token of list) {
      const mapped = inputTokenToChannels.get(token);
      if (!mapped) {
        continue;
      }
      mapped.forEach((channel) => buffer.add(channel));
    }
  };
  collect(tokens);
  if (additionalTokens && additionalTokens.length > 0) {
    collect(additionalTokens);
  }
  if (config.autoScratch) {
    for (const channel of buffer) {
      if (config.scratchChannels.has(channel)) {
        buffer.delete(channel);
      }
    }
  }
  return buffer;
}

// ---- windows --------------------------------------------------------------------------------------------------

/**
 * Signed judge windows in force at a given chart time. The ruleset owns the whole table set — key vs scratch, note
 * vs long-note end, and (LR2 only) the `#EXRANKxx` timeline — so the core never derives a window itself.
 */
function windowTablesAt(config: JudgeCoreConfig, seconds: number): RulesetWindowTables {
  return config.ruleset.windowsAt(Math.round(seconds * 1e6));
}

function judgeWindowsFor(
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
function maxJudgeEarlyReachSeconds(config: JudgeCoreConfig, seconds: number): number {
  const tables = windowTablesAt(config, seconds);
  let reachUs = 0;
  for (const set of [tables.note, tables.scratch]) {
    reachUs = Math.max(reachUs, judgeWindowEarlyReachUs(set));
  }
  return reachUs / 1e6;
}

/** The BAD gate of the opening key windows, in seconds — the horizon invisible notes are retired after. */
function badWindowSeconds(config: JudgeCoreConfig): number {
  // Two divisions on purpose: the engine always derived it through the millisecond readout, and the expiry compare
  // must not move by a rounding step.
  return judgeWindowLateReachUs(config.ruleset.windows.note) / 1000 / 1000;
}

/**
 * How long past its own time a note stays reachable, in seconds. Resolved from the window set active at THAT NOTE's
 * time and on THAT NOTE's lane: a mid-chart `#EXRANKxx` must not retroactively move the deadline of notes that had
 * already scrolled past under the old rank. The play-log simulator freezes the same per-note deadline.
 */
function resolveMissDeadlineSeconds(config: JudgeCoreConfig, note: TimedPlayableNote): number {
  return judgeWindowLateReachUs(judgeWindowsFor(config, note.channel, note.seconds)) / 1e6;
}

// ---- score ----------------------------------------------------------------------------------------------------

function applyGaugeJudge(
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

function applyGaugeDelta(
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

function setCombo(
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

function markScorableJudged(state: JudgeCoreState, note: TimedPlayableNote): boolean {
  if (note.judged) {
    return false;
  }
  note.judged = true;
  state.remainingScorableNotes -= 1;
  return true;
}

function markLandmineJudged(state: JudgeCoreState, note: TimedLandmineNote): boolean {
  if (note.judged) {
    return false;
  }
  note.judged = true;
  state.remainingLandmineNotes -= 1;
  return true;
}

function markInvisibleJudged(state: JudgeCoreState, note: TimedPlayableNote): boolean {
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

function applyResolvedManualJudge(
  state: JudgeCoreState,
  channel: string,
  judge: TimedManualJudge,
  atSeconds: number,
  emit: JudgeCoreEffectSink,
): void {
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
function applyTailMissPoor(state: JudgeCoreState, seconds: number, emit: JudgeCoreEffectSink): void {
  applyJudgeToSummary(state.summary, 'POOR', state.scoreTracker);
  applyGaugeJudge(state, seconds, 'POOR', emit, 'miss');
}

// ---- mines ----------------------------------------------------------------------------------------------------

function isLandmineChannelHeld(state: JudgeCoreState, channel: string, nowMs: number): boolean {
  if (state.heldChannels.has(channel)) {
    return true;
  }
  // Non-kitty input carries no release events, so "held" is approximated with the same short grace window the LN
  // hold logic uses for terminal key repeat.
  const lastPressMs = state.lastLanePressMs.get(channel);
  return lastPressMs !== undefined && nowMs - lastPressMs <= LONG_NOTE_REPEAT_HOLD_GRACE_MS;
}

/** The explosion sample event of a mine, or `undefined` when the chart has no `#WAV00`. */
export function resolveLandmineExplosionEvent(
  landmineEvent: BeMusicEvent,
  resources: Readonly<Record<string, string>>,
): BeMusicEvent | undefined {
  const sourcePath = resources[LANDMINE_EXPLOSION_SAMPLE_KEY];
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
    return undefined;
  }
  return {
    ...landmineEvent,
    value: LANDMINE_EXPLOSION_SAMPLE_KEY,
  };
}

function detonateLandmine(
  state: JudgeCoreState,
  landmine: TimedLandmineNote,
  nowSec: number,
  emit: JudgeCoreEffectSink,
): void {
  if (!markLandmineJudged(state, landmine)) {
    return;
  }
  const { config } = state;
  const landmineGaugeEffect = resolveLandmineGaugeEffect(landmine.event, config.idBase, config.sourceFormat);
  const landmineExplosionEvent = resolveLandmineExplosionEvent(landmine.event, config.wavResources);
  if (landmineExplosionEvent) {
    emit({
      kind: 'sound',
      source: 'mine-hit',
      event: landmineExplosionEvent,
      seconds: nowSec,
      channel: landmine.channel,
    });
  }
  // LR2 — a mine hit drains the gauge and plays the explosion sample, nothing else: no verdict, no combo break, no
  // judge-counter change (beatoraja's JudgeManager likewise only calls `gauge.addValue`). The raw-delta path also
  // bypasses the HARD guts softening and #TOTAL damage multiplier, matching `GrooveGauge.addValue`.
  applyGaugeDelta(state, nowSec, landmineGaugeEffect.gaugeDelta, 'mine-hit', emit);
  emit({
    kind: 'trace',
    name: 'mine-hit',
    seconds: nowSec,
    fields: [
      ['channel', landmine.channel],
      ['value', landmineGaugeEffect.objectValue],
      ['damage', landmineGaugeEffect.damage],
    ],
  });
}

/**
 * LR2 mine model (LR2's own changelog, 080114 entry): a mine explodes when its lane's key is held as the mine crosses
 * the judge line ("キー押したまま地雷通過"), or on a press within the PGREAT window of the judge line ("ピカグレ範囲内で
 * キーを押す"). Mines that cross with the key up are retired silently once the PGREAT window closes behind them.
 * Runs on every advance and on every press.
 */
function processLandminePassage(state: JudgeCoreState, nowSec: number, nowMs: number, emit: JudgeCoreEffectSink): void {
  const { config } = state;
  const landmineNotes = config.landmineNotes;
  // Reach form keeps the early / late legs separate — nothing guarantees a ruleset's window table is symmetric.
  const [pgreatLateUs, pgreatEarlyUs] = pgreatWindowReachUs(windowTablesAt(config, nowSec).note);
  const pgreatLateSeconds = pgreatLateUs / 1e6;
  const pgreatEarlySeconds = pgreatEarlyUs / 1e6;
  while (state.landmineExpireCursor < landmineNotes.length) {
    const landmine = landmineNotes[state.landmineExpireCursor]!;
    if (landmine.judged) {
      state.landmineExpireCursor += 1;
      continue;
    }
    if (nowSec - landmine.seconds <= pgreatLateSeconds) {
      break;
    }
    // The PGREAT window can be narrower than a step, so a held-through mine may enter AND leave it between two
    // passage calls. The hold-through leg therefore anchors to the crossing itself: when the window closes behind a
    // mine, detonate if the lane was held at the moment the mine crossed the judge line — a kitty key that is still
    // down counts, as does a non-kitty press within the hold-grace window BEFORE the crossing. A press AFTER the
    // crossing never detonates here: that is the press leg, and it already missed PGREAT.
    const crossingMs = nowMs - (nowSec - landmine.seconds) * config.judgeMsPerChartSecond;
    const lastPressMs = state.lastLanePressMs.get(landmine.channel);
    const pressedBeforeCrossing = lastPressMs !== undefined && lastPressMs <= crossingMs;
    const heldAtCrossing = pressedBeforeCrossing
      ? crossingMs - lastPressMs <= LONG_NOTE_REPEAT_HOLD_GRACE_MS || state.heldChannels.has(landmine.channel)
      : lastPressMs === undefined && state.heldChannels.has(landmine.channel);
    if (heldAtCrossing) {
      detonateLandmine(state, landmine, nowSec, emit);
    } else {
      markLandmineJudged(state, landmine);
    }
    state.landmineExpireCursor += 1;
  }
  for (let index = state.landmineExpireCursor; index < landmineNotes.length; index += 1) {
    const landmine = landmineNotes[index]!;
    if (landmine.seconds - nowSec > pgreatEarlySeconds) {
      break;
    }
    if (landmine.judged) {
      continue;
    }
    if (!isLandmineChannelHeld(state, landmine.channel, nowMs)) {
      continue;
    }
    detonateLandmine(state, landmine, nowSec, emit);
  }
}

function markExpiredInvisibleNotes(state: JudgeCoreState, referenceSeconds: number): void {
  const invisibleNotes = state.config.invisibleNotes;
  const horizon = badWindowSeconds(state.config);
  while (state.invisibleExpireCursor < invisibleNotes.length) {
    const invisible = invisibleNotes[state.invisibleExpireCursor]!;
    if (invisible.judged) {
      state.invisibleExpireCursor += 1;
      continue;
    }
    if (referenceSeconds - invisible.seconds <= horizon) {
      break;
    }
    markInvisibleJudged(state, invisible);
    state.invisibleExpireCursor += 1;
  }
}

// ---- auto scratch ---------------------------------------------------------------------------------------------

function applyAutoScratchJudgements(state: JudgeCoreState, referenceSeconds: number, emit: JudgeCoreEffectSink): void {
  const { config } = state;
  if (!config.autoScratch) {
    return;
  }
  const autoScratchNotes = state.autoScratchNotes;
  while (state.autoScratchCursor < autoScratchNotes.length) {
    const note = autoScratchNotes[state.autoScratchCursor]!;
    if (note.judged) {
      state.autoScratchCursor += 1;
      continue;
    }
    if (referenceSeconds < note.seconds) {
      break;
    }
    state.autoScratchCursor += 1;
    if (!markScorableJudged(state, note)) {
      continue;
    }
    emit({ kind: 'sound', source: 'auto-scratch', event: note.event, seconds: note.seconds, channel: note.channel });
    const endSeconds = resolveLongNoteEndSeconds(note);
    emit({ kind: 'ui', command: { kind: 'flash-lane', channel: note.channel } });
    if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
      note.visibleUntilBeat = note.endBeat;
      emit({ kind: 'ui', command: { kind: 'hold-lane-until-beat', channel: note.channel, beat: note.endBeat } });
    }
    if (endSeconds !== undefined) {
      emit({
        kind: 'long-note',
        seconds: note.seconds,
        channel: note.channel,
        state: 'start',
        mode: resolveLoggedLongNoteMode(note),
        event: note.event,
        endSeconds,
      });
      insertPendingAutoLongNote(state.pendingAutoScratchLongNotes, note, endSeconds);
      emit({
        kind: 'ui',
        command: {
          kind: 'long-note-start',
          channel: note.channel,
          beat: note.beat,
          mode: toUiLongNoteMode(resolveRulesetLongNoteMode(config.ruleset.longNoteStyle, note) ?? 2),
        },
      });
      continue;
    }
    applyAutoPerfect(state, note.channel, referenceSeconds, emit);
    emit({ kind: 'poor-trace', action: 'clear', seconds: referenceSeconds });
  }
}

function applyAutoPerfect(state: JudgeCoreState, channel: string, seconds: number, emit: JudgeCoreEffectSink): void {
  applyJudgeToSummary(state.summary, 'PERFECT', state.scoreTracker);
  applyGaugeJudge(state, seconds, 'PERFECT', emit);
  emit({ kind: 'poor-bga', action: 'clear', seconds });
  setCombo(state, seconds, state.combo + 1, 'judge', emit, 'PERFECT', channel);
  emit({
    kind: 'trace',
    name: 'auto-judge',
    seconds,
    fields: [
      ['result', 'PERFECT'],
      ['channel', channel],
    ],
  });
  emit({ kind: 'judge-combo', judge: 'PERFECT', combo: state.combo, channel });
}

function drainPendingAutoScratchLongNotes(
  state: JudgeCoreState,
  referenceSeconds: number,
  emit: JudgeCoreEffectSink,
): void {
  const pendingNotes = state.pendingAutoScratchLongNotes;
  const safeReferenceSeconds = Math.max(0, referenceSeconds) + JUDGE_TIME_EPSILON_SECONDS;
  while (pendingNotes.length > 0) {
    const pending = pendingNotes[0]!;
    if (pending.endSeconds > safeReferenceSeconds) {
      break;
    }
    pendingNotes.shift();
    emit({
      kind: 'long-note',
      seconds: pending.endSeconds,
      channel: pending.note.channel,
      state: 'complete',
      mode: resolveLoggedLongNoteMode(pending.note),
      event: pending.note.event,
      endSeconds: pending.endSeconds,
    });
    applyAutoPerfect(state, pending.note.channel, referenceSeconds, emit);
    if (longNoteScoresTail(state.config.ruleset.longNoteStyle, pending.note)) {
      // Charge modes judge the head and the tail separately; the turntable's auto-scratch clears both.
      applyJudgeToSummary(state.summary, 'PERFECT', state.scoreTracker);
      applyGaugeJudge(state, referenceSeconds, 'PERFECT', emit);
      setCombo(state, referenceSeconds, state.combo + 1, 'judge', emit, 'PERFECT', pending.note.channel);
      emit({ kind: 'judge-combo', judge: 'PERFECT', combo: state.combo, channel: pending.note.channel });
    }
    // Pair the `hold-lane-until-beat` emitted at the head so the LN-hold timer / lane laser fade out at the tail.
    emit({ kind: 'ui', command: { kind: 'long-note-end', channel: pending.note.channel, outcome: 'complete' } });
    emit({ kind: 'ui', command: { kind: 'release-lane', channel: pending.note.channel } });
  }
}

// ---- misses ---------------------------------------------------------------------------------------------------

function applyExpiredScorableJudgements(
  state: JudgeCoreState,
  referenceSeconds: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  const scorableNotes = config.scorableNotes;
  while (state.scorableMissCursor < scorableNotes.length) {
    const note = scorableNotes[state.scorableMissCursor]!;
    if (note.judged) {
      state.scorableMissCursor += 1;
      continue;
    }
    if (referenceSeconds - note.seconds <= resolveMissDeadlineSeconds(config, note)) {
      break;
    }
    state.scorableMissCursor += 1;
    if (!markScorableJudged(state, note)) {
      continue;
    }
    if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
      note.visibleUntilBeat = note.endBeat;
    }
    applyJudgeToSummary(state.summary, 'POOR', state.scoreTracker);
    applyGaugeJudge(state, referenceSeconds, 'POOR', emit, 'miss');
    emit({ kind: 'poor-bga', action: 'trigger', seconds: referenceSeconds });
    emit({
      kind: 'trace',
      name: 'judge',
      seconds: referenceSeconds,
      fields: [
        ['result', 'POOR'],
        ['channel', note.channel],
        ['deltaMs', Math.round((referenceSeconds - note.seconds) * 1000)],
        ['reason', 'miss'],
      ],
    });
    emit({ kind: 'poor-trace', action: 'trigger', seconds: referenceSeconds });
    setCombo(state, referenceSeconds, 0, 'miss', emit, 'POOR', note.channel);
    // Miss-without-press: positive `signedDeltaMs` because the deadline passed without an input — the "late" band.
    emit({
      kind: 'judge-combo',
      judge: 'POOR',
      combo: state.combo,
      channel: note.channel,
      signedDeltaMs: (referenceSeconds - note.seconds) * 1000,
    });
    if (noteOwesTailMiss(config.ruleset, note)) {
      applyTailMissPoor(state, referenceSeconds, emit);
      emit({
        kind: 'trace',
        name: 'judge',
        seconds: referenceSeconds,
        fields: [
          ['result', 'POOR'],
          ['channel', note.channel],
          ['reason', 'charge-tail-miss'],
        ],
      });
    }
  }
}

// ---- presses --------------------------------------------------------------------------------------------------

/**
 * The note a press resolves against, chosen by the ruleset's own selection algorithm. Reachability is per note: the
 * note's own lane (key vs scratch) and its own chart time (the `#EXRANKxx` rank in force there) pick its window set,
 * and both legs are checked separately. A note inside the coarse scan radius but outside its own windows is not a
 * candidate, so the press falls through to the lane keysound / empty-POOR path instead of consuming it as a POOR.
 */
function selectPressCandidate(
  state: JudgeCoreState,
  nowSec: number,
  candidateChannels: ReadonlySet<string>,
): { note: TimedPlayableNote; judge: RulesetJudgeIndex } | undefined {
  const { config } = state;
  const { ruleset, scorableNotes } = config;
  const reachSeconds = maxJudgeReachSeconds(config, nowSec);
  const inputTimeUs = nowSec * 1e6;
  let best: TimedPlayableNote | undefined;
  let bestSelection: JudgeSelectionCandidate | undefined;
  // `scorableNotes` is sorted by time, so the scan visits candidates in the ascending order the selection algorithms
  // assume (`lowest` keeps the first, the others may displace it).
  for (
    let index = lowerBoundBySeconds(scorableNotes, nowSec - reachSeconds);
    index < scorableNotes.length;
    index += 1
  ) {
    const note = scorableNotes[index]!;
    if (note.seconds - nowSec > reachSeconds) {
      break;
    }
    if (note.judged || !candidateChannels.has(note.channel)) {
      continue;
    }
    const windows = judgeWindowsFor(config, note.channel, note.seconds);
    const judge = classifyRulesetJudge((note.seconds - nowSec) * 1e6, windows);
    if (judge === RULESET_JUDGE_NONE) {
      continue;
    }
    const playedMode =
      typeof note.endSeconds === 'number' && note.endSeconds > note.seconds
        ? resolveRulesetLongNoteMode(ruleset.longNoteStyle, note)
        : undefined;
    if (ignoresLateLongNoteHeadBad(ruleset, judge, note.seconds < nowSec, playedMode)) {
      // LR2: a long-note head has no LATE bad — the press falls through to whatever else is in reach. The mode is the
      // one the ruleset plays, not the chart's `#LNMODE`: LR2 plays a `#LNMODE 2` note as a plain LN too.
      continue;
    }
    const selection: JudgeSelectionCandidate = {
      noteTimeUs: note.seconds * 1e6,
      dmUs: (note.seconds - nowSec) * 1e6,
      judge,
      windows,
    };
    if (bestSelection === undefined || preferJudgeCandidate(ruleset.selection, bestSelection, selection, inputTimeUs)) {
      best = note;
      bestSelection = selection;
    }
  }
  return best === undefined || bestSelection === undefined ? undefined : { note: best, judge: bestSelection.judge };
}

/**
 * lr2oraja `MultiBadCollector`: once a press has consumed its note, every OTHER unjudged note on the pressed lanes
 * that sits inside the BAD window but outside the GOOD window also resolves as a BAD (pruned by
 * {@link isMultiBadCollectorTarget}).
 */
function applyMultiBadCollector(
  state: JudgeCoreState,
  nowSec: number,
  candidateChannels: ReadonlySet<string>,
  consumed: TimedPlayableNote,
  consumedJudge: RulesetJudgeIndex,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  const scorableNotes = config.scorableNotes;
  const reachSeconds = maxJudgeReachSeconds(config, nowSec);
  const consumedNote = { time: consumed.seconds, isLong: isLongPlayableNote(consumed), judge: consumedJudge };
  const extras: TimedPlayableNote[] = [];
  for (
    let index = lowerBoundBySeconds(scorableNotes, nowSec - reachSeconds);
    index < scorableNotes.length;
    index += 1
  ) {
    const note = scorableNotes[index]!;
    if (note.seconds - nowSec > reachSeconds) {
      break;
    }
    if (note === consumed || note.judged || !candidateChannels.has(note.channel)) {
      continue;
    }
    if (state.activeLongNotes.get(note.channel)?.note === note) {
      continue;
    }
    const windows = judgeWindowsFor(config, note.channel, note.seconds);
    const dmUs = (note.seconds - nowSec) * 1e6;
    const bad = windows.judges[3];
    const good = windows.judges[2];
    if (dmUs < bad[0] || dmUs > bad[1]) {
      continue;
    }
    if (dmUs >= good[0] && dmUs <= good[1]) {
      continue;
    }
    if (!isMultiBadCollectorTarget(consumedNote, { time: note.seconds, isLong: isLongPlayableNote(note) })) {
      continue;
    }
    extras.push(note);
  }
  for (const note of extras) {
    if (!markScorableJudged(state, note)) {
      continue;
    }
    applyResolvedManualJudge(
      state,
      note.channel,
      { kind: 'BAD', signedDeltaMs: (nowSec - note.seconds) * 1000 },
      nowSec,
      emit,
    );
    if (noteOwesTailMiss(config.ruleset, note)) {
      applyTailMissPoor(state, nowSec, emit);
    }
  }
}

/**
 * Is there a note near enough on any pressed lane for a note-less press to charge an empty POOR? The reach is the
 * ruleset's own miss (`ms`) window, which is not symmetric: LR2's is early-only, beatoraja's reaches 500 ms early and
 * 150 ms late. Both neighbours of the press are tested, since the late side matters where the ruleset has one.
 */
function hasEmptyPoorReferenceNote(state: JudgeCoreState, channels: ReadonlySet<string>, nowSec: number): boolean {
  for (const channel of channels) {
    const noteTimes = state.scorableNoteSecondsByChannel.get(channel);
    if (!noteTimes) {
      continue;
    }
    const missWindow = judgeWindowsFor(state.config, channel, nowSec).ms;
    if (!missWindow) {
      continue;
    }
    const index = findFirstIndexNumberAtOrAfter(noteTimes, nowSec);
    for (const neighbour of [index - 1, index]) {
      const noteSeconds = noteTimes[neighbour];
      if (noteSeconds === undefined) {
        continue;
      }
      const dmUs = (noteSeconds - nowSec) * 1e6;
      if (dmUs >= missWindow[0] && dmUs <= missWindow[1]) {
        return true;
      }
    }
  }
  return false;
}

function isLongNoteRepeatSuppressedInput(
  state: JudgeCoreState,
  candidateChannels: ReadonlySet<string>,
  nowSec: number,
): boolean {
  for (const channel of candidateChannels) {
    const suppressUntil = state.longNoteSuppressUntilSeconds.get(channel);
    if (suppressUntil !== undefined && nowSec < suppressUntil) {
      return true;
    }
  }
  return false;
}

function handleLanePress(
  state: JudgeCoreState,
  candidateChannels: ReadonlySet<string>,
  tokens: readonly string[],
  nowMs: number,
  nowSec: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  const { ruleset } = config;
  // Play-log press event — recorded BEFORE any judging so the log stays a raw input replay.
  emit({ kind: 'record-input', action: 'down', seconds: nowSec, tokens, channels: candidateChannels });

  for (const mappedChannel of candidateChannels) {
    emit({ kind: 'ui', command: { kind: 'flash-lane', channel: mappedChannel } });
  }

  let refreshedHold = false;
  for (const channel of candidateChannels) {
    if (!state.activeLongNotes.has(channel)) {
      continue;
    }
    state.longHoldUntilMs.set(channel, nowMs + LONG_NOTE_REPEAT_HOLD_GRACE_MS);
    refreshedHold = true;
  }

  // LR2 mine model — the press itself counts as "key ON": record the press instant for the non-kitty hold
  // approximation, then detonate any mine currently inside the PGREAT window on these lanes. Detonation never
  // consumes the press: the regular note judgment below still runs.
  for (const channel of candidateChannels) {
    state.lastLanePressMs.set(channel, nowMs);
  }
  processLandminePassage(state, nowSec, nowMs, emit);

  const selected = selectPressCandidate(state, nowSec, candidateChannels);

  if (!selected) {
    if (refreshedHold) {
      // Active LN re-tap inside the hold-grace window — input is part of the sustain, not a phantom press.
      return;
    }
    if (isLongNoteRepeatSuppressedInput(state, candidateChannels, nowSec)) {
      // LN repeat-suppress window — same intent as the hold path above, just on the cooldown side.
      return;
    }
    const fallback = findLaneSoundCandidate(
      config.laneSoundNotes,
      candidateChannels,
      nowSec,
      maxJudgeEarlyReachSeconds(config, nowSec),
    );
    if (fallback) {
      emit({
        kind: 'sound',
        source: 'lane-fallback',
        event: fallback.event,
        seconds: nowSec,
        channel: fallback.channel,
      });
      if (config.freeZoneChannels.has(fallback.channel)) {
        // Free zone keysound — authored for empty-press playback. No POOR cue; this is intended audio.
        return;
      }
    }
    if (!hasEmptyPoorReferenceNote(state, candidateChannels, nowSec)) {
      // No note in the ruleset's miss window — the press is harmless: only the lane keysound plays.
      return;
    }
    // Empty POOR (空POOR): a phantom press near a note but outside every judgable window. It costs gauge and fires the
    // POOR cue without consuming the note, so it never reaches EX-SCORE. Repeatable per note (LR2's
    // `MissCondition.ALWAYS`). Whether it breaks the combo is the ruleset's call.
    state.summary.emptyPoor += 1;
    applyGaugeJudge(state, nowSec, 'EMPTY_POOR', emit, 'empty-poor');
    if (ruleset.comboBreaksOnEmptyPoor) {
      setCombo(state, nowSec, 0, 'judge', emit, 'POOR');
    }
    emit({ kind: 'record-empty-poor' });
    emit({ kind: 'poor-bga', action: 'trigger', seconds: nowSec });
    emit({
      kind: 'trace',
      name: 'judge',
      seconds: nowSec,
      fields: [
        ['result', 'EMPTY_POOR'],
        ['reason', 'empty-poor'],
      ],
    });
    // The UI maps this back to the LR2 `'poor'` skin slot (NOWJUDGE 0/1 share one kind in our model).
    emit({ kind: 'judge-combo', judge: 'POOR', combo: state.combo });
    return;
  }

  const candidate = selected.note;
  if (!markScorableJudged(state, candidate)) {
    return;
  }
  const channel = candidate.channel;
  const signedDeltaMs = (nowSec - candidate.seconds) * 1000;
  const collectMultiBad = (): void => {
    if (ruleset.multiBad) {
      applyMultiBadCollector(state, nowSec, candidateChannels, candidate, selected.judge, emit);
    }
  };
  emit({ kind: 'ui', command: { kind: 'flash-lane', channel } });
  emit({ kind: 'sound', source: 'manual-note', event: candidate.event, seconds: nowSec, channel });
  const endSeconds = candidate.endSeconds;
  if (typeof endSeconds === 'number' && Number.isFinite(endSeconds) && endSeconds > candidate.seconds) {
    const longNoteMode = resolveRulesetLongNoteMode(ruleset.longNoteStyle, candidate);
    const previousSuppressUntil = state.longNoteSuppressUntilSeconds.get(channel) ?? Number.NEGATIVE_INFINITY;
    if (endSeconds > previousSuppressUntil) {
      state.longNoteSuppressUntilSeconds.set(channel, endSeconds);
    }
    emit({
      kind: 'long-note',
      seconds: nowSec,
      channel,
      state: 'start',
      mode: longNoteMode === 2 || longNoteMode === 3 ? longNoteMode : 1,
      event: candidate.event,
      endSeconds,
    });
    candidate.visibleUntilBeat = candidate.endBeat;
    // Light the renderer's LN-hold timer on the head; the matching `release-lane` comes when the note resolves.
    if (longNoteMode !== undefined) {
      emit({
        kind: 'ui',
        command: { kind: 'hold-lane-until-beat', channel, beat: candidate.endBeat ?? candidate.beat },
      });
      emit({
        kind: 'ui',
        command: { kind: 'long-note-start', channel, beat: candidate.beat, mode: toUiLongNoteMode(longNoteMode) },
      });
    }
    const headJudge = resolveManualTimedJudge(signedDeltaMs, judgeWindowsFor(config, channel, nowSec));
    if (longNoteMode !== undefined && isChargeLongNoteMode(longNoteMode)) {
      // Charge modes score the head right here — it is a judgment of its own, not half of a deferred one.
      applyResolvedManualJudge(state, channel, headJudge, nowSec, emit);
      if (ruleset.headBadSkipsTail && (headJudge.kind === 'BAD' || headJudge.kind === 'POOR')) {
        // IIDX: a broken charge-note head cancels the tail; the note is finished with a single judgment.
        state.activeLongNotes.delete(channel);
        state.longHoldUntilMs.delete(channel);
        emit({ kind: 'ui', command: { kind: 'long-note-end', channel, outcome: 'dropped' } });
        emit({ kind: 'ui', command: { kind: 'release-lane', channel } });
        collectMultiBad();
        return;
      }
      state.activeLongNotes.set(channel, {
        endSeconds,
        note: candidate,
        mode: longNoteMode,
        headJudge,
        headScored: true,
        gaugeDrainCursorSeconds: nowSec,
        audioStopped: false,
      });
      state.longHoldUntilMs.set(channel, nowMs + LONG_NOTE_INITIAL_HOLD_GRACE_MS);
      state.longHoldReleaseSeconds.delete(channel);
      collectMultiBad();
      return;
    }
    if (longNoteMode === 1) {
      state.activeLongNotes.set(channel, {
        endSeconds,
        note: candidate,
        mode: 1,
        headJudge,
        headScored: false,
        gaugeDrainCursorSeconds: nowSec,
        audioStopped: false,
      });
      state.longHoldUntilMs.set(channel, nowMs + LONG_NOTE_INITIAL_HOLD_GRACE_MS);
      state.longHoldReleaseSeconds.delete(channel);
      collectMultiBad();
      return;
    }
    state.activeLongNotes.delete(channel);
    state.longHoldUntilMs.delete(channel);
    collectMultiBad();
    return;
  }
  state.activeLongNotes.delete(channel);
  state.longHoldUntilMs.delete(channel);

  applyResolvedManualJudge(
    state,
    channel,
    resolveManualTimedJudge(signedDeltaMs, judgeWindowsFor(config, channel, nowSec)),
    nowSec,
    emit,
  );
  collectMultiBad();
}

function handleLaneRelease(
  state: JudgeCoreState,
  input: Extract<JudgeCoreInput, { kind: 'release' }>,
  emit: JudgeCoreEffectSink,
): void {
  if (input.channels.size > 0) {
    emit({
      kind: 'record-input',
      action: 'up',
      seconds: input.recordSec,
      tokens: input.tokens,
      channels: input.channels,
    });
  }
  for (const channel of input.channels) {
    state.heldChannels.delete(channel);
    emit({ kind: 'ui', command: { kind: 'release-lane', channel } });
    if (state.activeLongNotes.has(channel)) {
      state.longHoldUntilMs.set(channel, input.nowMs);
      state.longHoldReleaseSeconds.set(channel, input.nowSec);
    }
  }
}

// ---- long notes -----------------------------------------------------------------------------------------------

function finalizeActiveLongNote(
  state: JudgeCoreState,
  channel: string,
  judge: TimedManualJudge,
  atSeconds: number,
  emit: JudgeCoreEffectSink,
): void {
  state.activeLongNotes.delete(channel);
  state.longHoldUntilMs.delete(channel);
  state.longHoldReleaseSeconds.delete(channel);
  // Pair the head's `hold-lane-until-beat` so the renderer fades the LN-hold timer and lane laser out right here.
  emit({
    kind: 'ui',
    command: {
      kind: 'long-note-end',
      channel,
      outcome: judge.kind === 'BAD' || judge.kind === 'POOR' ? 'dropped' : 'complete',
    },
  });
  emit({ kind: 'ui', command: { kind: 'release-lane', channel } });
  applyResolvedManualJudge(state, channel, judge, atSeconds, emit);
}

/**
 * The judgment a long note's tail contributes. Charge modes already scored the head on the press, so the tail is its
 * own judgment; LN mode defers both and resolves them into the worse of the two.
 */
function resolveLongNoteTailJudge(hold: ActiveLongNoteState, tail: TimedManualJudge): TimedManualJudge {
  return hold.headScored ? tail : combineLongNoteJudges(hold.headJudge, tail);
}

function stopLongNoteSound(
  hold: ActiveLongNoteState,
  channel: string,
  nowSec: number,
  state: 'release' | 'break',
  emit: JudgeCoreEffectSink,
): void {
  emit({
    kind: 'long-note',
    seconds: nowSec,
    channel,
    state,
    mode: hold.mode,
    event: hold.note.event,
    endSeconds: hold.endSeconds,
  });
  emit({
    kind: 'stop-sound',
    channel,
    seconds: nowSec,
    reason: state === 'release' ? 'long-note-release' : 'long-note-break',
    event: hold.note.event,
  });
  hold.audioStopped = true;
}

/**
 * One judgment step at a single chart instant: long-note hold / tail resolution, auto-scratch, misses, mines and
 * invisible-note expiry.
 */
function advanceJudgeState(state: JudgeCoreState, nowSec: number, nowMs: number, emit: JudgeCoreEffectSink): void {
  const { config } = state;
  for (const channel of state.heldChannels) {
    if (!state.activeLongNotes.has(channel)) {
      continue;
    }
    state.longHoldUntilMs.set(channel, nowMs + LONG_NOTE_REPEAT_HOLD_GRACE_MS);
  }

  for (const [channel, hold] of state.activeLongNotes.entries()) {
    const holdUntilMs = state.longHoldUntilMs.get(channel);
    const isHolding = holdUntilMs !== undefined && nowMs <= holdUntilMs;
    // The tail is judged against the release instant when there was one — a frame can be hundreds of chart
    // milliseconds wide at high `speed`, and quantizing to it would turn a clean release into a GOOD.
    const releaseSeconds = state.longHoldReleaseSeconds.get(channel);
    const tailJudgeSeconds = releaseSeconds ?? nowSec;
    if (hold.mode === 1 && holdUntilMs !== undefined && nowMs > holdUntilMs && tailJudgeSeconds < hold.endSeconds) {
      if (!hold.audioStopped) {
        stopLongNoteSound(hold, channel, nowSec, 'release', emit);
      }
      finalizeActiveLongNote(
        state,
        channel,
        { kind: 'BAD', signedDeltaMs: (tailJudgeSeconds - hold.endSeconds) * 1000 },
        tailJudgeSeconds,
        emit,
      );
      continue;
    }
    if (hold.mode === 3) {
      const accumulateUntilSeconds = Math.min(nowSec, hold.endSeconds);
      if (accumulateUntilSeconds > hold.gaugeDrainCursorSeconds) {
        const elapsedSeconds = accumulateUntilSeconds - hold.gaugeDrainCursorSeconds;
        if (isHolding) {
          // HCN GAIN — held cleanly through this step (upstream `gauge.update(1, 0.5f)` per 200 ms tick).
          applyGaugeDelta(state, nowSec, elapsedSeconds * HELL_CHARGE_GAUGE_GAIN_PER_SECOND, 'hold-gain', emit);
        } else {
          // HCN DRAIN — hold broken during this step (upstream `gauge.update(3, 0.5f)` per 200 ms tick).
          applyGaugeDelta(state, nowSec, -elapsedSeconds * HELL_CHARGE_GAUGE_DRAIN_PER_SECOND, 'hold-drain', emit);
        }
      }
      hold.gaugeDrainCursorSeconds = accumulateUntilSeconds;
      if (!isHolding && !hold.audioStopped) {
        stopLongNoteSound(hold, channel, nowSec, 'break', emit);
      }
    }

    if (nowSec >= hold.endSeconds) {
      if (
        isChargeLongNoteMode(hold.mode) &&
        isHolding &&
        nowSec < hold.endSeconds + judgeWindowLateReachUs(judgeWindowsFor(config, channel, hold.endSeconds, true)) / 1e6
      ) {
        // Charge modes judge the tail on the RELEASE. Still holding past the tail is not yet a judgment — the player
        // has until the tail's late window closes to let go, exactly as the play-log simulator models it.
        continue;
      }
      if (hold.mode === 1) {
        emit({
          kind: 'long-note',
          seconds: nowSec,
          channel,
          state: 'complete',
          mode: hold.mode,
          event: hold.note.event,
          endSeconds: hold.endSeconds,
        });
        finalizeActiveLongNote(state, channel, hold.headJudge, nowSec, emit);
        continue;
      }
      if (hold.mode === 3 && hold.endSeconds > hold.gaugeDrainCursorSeconds) {
        // Catch the HCN accumulator up to the tail mark; the residual slice takes the current step's hold state.
        const elapsedSeconds = hold.endSeconds - hold.gaugeDrainCursorSeconds;
        applyGaugeDelta(
          state,
          nowSec,
          isHolding
            ? elapsedSeconds * HELL_CHARGE_GAUGE_GAIN_PER_SECOND
            : -elapsedSeconds * HELL_CHARGE_GAUGE_DRAIN_PER_SECOND,
          isHolding ? 'hold-gain' : 'hold-drain',
          emit,
        );
        hold.gaugeDrainCursorSeconds = hold.endSeconds;
      }
      emit({
        kind: 'long-note',
        seconds: nowSec,
        channel,
        state: 'complete',
        mode: hold.mode,
        event: hold.note.event,
        endSeconds: hold.endSeconds,
      });
      const finalJudge =
        hold.mode === 3 && !isHolding && releaseSeconds === undefined
          ? resolveLongNoteTailJudge(hold, { kind: 'POOR', signedDeltaMs: (nowSec - hold.endSeconds) * 1000 })
          : resolveLongNoteTailJudge(
              hold,
              resolveManualTimedJudge(
                (tailJudgeSeconds - hold.endSeconds) * 1000,
                judgeWindowsFor(config, channel, hold.endSeconds, true),
              ),
            );
      finalizeActiveLongNote(state, channel, finalJudge, tailJudgeSeconds, emit);
      continue;
    }

    if (hold.mode === 2 && holdUntilMs !== undefined && nowMs > holdUntilMs) {
      if (!hold.audioStopped) {
        stopLongNoteSound(hold, channel, nowSec, 'release', emit);
      }
      finalizeActiveLongNote(
        state,
        channel,
        resolveLongNoteTailJudge(
          hold,
          resolveManualTimedJudge(
            (tailJudgeSeconds - hold.endSeconds) * 1000,
            judgeWindowsFor(config, channel, hold.endSeconds, true),
          ),
        ),
        tailJudgeSeconds,
        emit,
      );
    }
  }

  drainPendingAutoScratchLongNotes(state, nowSec, emit);
  for (const [channel, suppressUntil] of state.longNoteSuppressUntilSeconds.entries()) {
    if (nowSec >= suppressUntil) {
      state.longNoteSuppressUntilSeconds.delete(channel);
    }
  }

  applyAutoScratchJudgements(state, nowSec, emit);
  applyExpiredScorableJudgements(state, nowSec, emit);

  processLandminePassage(state, nowSec, nowMs, emit);
  markExpiredInvisibleNotes(state, nowSec);
}

/**
 * Safety net for notes the per-step sweep never reached (an audio tail that outran the loop, a hold still open at the
 * end). Counted from the notes themselves rather than from `summary.total`: the total is the ruleset's EX-SCORE
 * denominator, and under IIDX a missed charge note owes only ONE judgment even though it counts for two.
 */
function finishJudgeState(state: JudgeCoreState, totalSeconds: number, emit: JudgeCoreEffectSink): void {
  const { ruleset } = state.config;
  let missingCount = 0;
  for (const note of state.config.scorableNotes) {
    if (note.judged) {
      continue;
    }
    note.judged = true;
    missingCount += 1;
    if (noteOwesTailMiss(ruleset, note)) {
      missingCount += 1;
    }
  }
  for (const hold of state.activeLongNotes.values()) {
    // The head already scored; only the unresolved tail is outstanding.
    if (hold.headScored) {
      missingCount += 1;
    }
  }
  state.activeLongNotes.clear();
  if (missingCount === 0) {
    return;
  }
  for (let index = 0; index < missingCount; index += 1) {
    applyJudgeToSummary(state.summary, 'POOR', state.scoreTracker);
    applyGaugeJudge(state, totalSeconds, 'POOR', emit, 'remaining-notes');
  }
  emit({ kind: 'poor-bga', action: 'trigger', seconds: totalSeconds });
  emit({
    kind: 'trace',
    name: 'judge',
    seconds: totalSeconds,
    fields: [
      ['result', 'POOR'],
      ['reason', 'remaining-notes'],
      ['count', missingCount],
    ],
  });
  emit({ kind: 'poor-trace', action: 'trigger', seconds: totalSeconds });
  setCombo(state, totalSeconds, 0, 'remaining-notes', emit, 'POOR');
  emit({ kind: 'judge-combo', judge: 'POOR', combo: state.combo });
  emit({ kind: 'frame', seconds: totalSeconds });
}

// ---- replay ---------------------------------------------------------------------------------------------------

/** A recorded input stream being re-driven through the core. */
export interface JudgeCoreReplay {
  readonly events: readonly PlaylogInputEvent[];
  cursor: number;
  stepIndex: number;
  /** The chart second the judge state has been advanced to. */
  judgedThroughSeconds: number;
}

/** Sorts a play log's inputs into replay order. */
export function createJudgeCoreReplay(inputs: readonly PlaylogInputEvent[]): JudgeCoreReplay {
  return {
    events: [...inputs].sort((left, right) => left.timeUs - right.timeUs || left.seq - right.seq),
    cursor: 0,
    stepIndex: 0,
    judgedThroughSeconds: Number.NEGATIVE_INFINITY,
  };
}

function processReplayEventsUntil(
  state: JudgeCoreState,
  replay: JudgeCoreReplay,
  untilSec: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  while (replay.cursor < replay.events.length) {
    const event = replay.events[replay.cursor]!;
    const eventSec = event.timeUs / 1_000_000;
    if (eventSec > untilSec) break;
    replay.cursor += 1;
    const channels = new Set(event.channels);
    if (config.autoScratch) {
      for (const channel of channels) {
        if (config.scratchChannels.has(channel)) {
          channels.delete(channel);
        }
      }
    }
    if (channels.size === 0) continue;
    const eventMs = eventSec * config.judgeMsPerChartSecond;
    if (event.action === 'down') {
      runJudgeCoreStep(state, { kind: 'hold', channels }, emit);
      emit({ kind: 'input-time', seconds: eventSec });
      runJudgeCoreStep(
        state,
        { kind: 'press', channels, tokens: event.tokens ?? [], nowSec: eventSec, nowMs: eventMs },
        emit,
      );
    } else {
      runJudgeCoreStep(
        state,
        {
          kind: 'release',
          channels,
          tokens: event.tokens ?? [],
          nowSec: eventSec,
          nowMs: eventMs,
          recordSec: eventSec,
        },
        emit,
      );
    }
  }
}

/**
 * Advances a replay's judge state up to `untilSec` on a fixed chart-time grid ({@link REPLAY_JUDGE_STEP_SECONDS})
 * merged with the replay events' own timestamps. The state is stepped to each event's instant BEFORE the event is
 * applied, so a release resolves its long note before a later press on that lane can refresh the hold, and misses,
 * tails and presses reach the gauge in chart-time order — the gauge clamps at its bounds, so the order of judgments
 * is part of the result. Steps past the last grid point at or before `untilSec` wait for the next call, keeping the
 * step times (and with them every judgment) independent of how the calls are spaced.
 */
export function advanceJudgeCoreReplay(
  state: JudgeCoreState,
  replay: JudgeCoreReplay,
  untilSec: number,
  emit: JudgeCoreEffectSink,
): void {
  const msPerSecond = state.config.judgeMsPerChartSecond;
  for (;;) {
    const nextEvent = replay.events[replay.cursor];
    const nextEventSec = nextEvent === undefined ? Number.POSITIVE_INFINITY : nextEvent.timeUs / 1_000_000;
    const nextGridSec = (replay.stepIndex + 1) * REPLAY_JUDGE_STEP_SECONDS;
    const stepSec = Math.min(nextEventSec, nextGridSec);
    if (stepSec > untilSec) {
      return;
    }
    if (nextGridSec <= nextEventSec) {
      replay.stepIndex += 1;
    }
    advanceJudgeState(state, stepSec, stepSec * msPerSecond, emit);
    replay.judgedThroughSeconds = stepSec;
    if (nextEventSec <= stepSec) {
      processReplayEventsUntil(state, replay, stepSec, emit);
    }
  }
}
