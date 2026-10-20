import { normalizeChannel } from '@be-music/json';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import type { RulesetConfig } from '../ruleset/definitions.ts';
import { judgeWindowLateReachUs } from '../ruleset/judge.ts';
import {
  JUDGE_TIME_EPSILON_SECONDS,
  type JudgeCoreEffect,
  type JudgeCoreEffectSink,
  type JudgeCoreScore,
} from './judge-core.ts';
import {
  insertPendingAutoLongNote,
  longNoteScoresTail,
  resolveLoggedLongNoteMode,
  resolveLongNoteEndSeconds,
  resolveRulesetLongNoteMode,
  toUILongNoteMode,
  type PendingAutoLongNoteState,
} from './judge-rules.ts';
import { clampToReversal } from './judge-core-score.ts';
import { applyJudgeToSummary } from './scoring.ts';

/**
 * The judge core of AUTO play: every judgment resolves as a PGREAT when chart time reaches it — a tap note and a charge
 * note's head at the note, an LN's one judgment and a charge note's tail at the tail, as AUTO SCRATCH and beatoraja's
 * autoplay do — and mines / invisible notes retire once their window has passed.
 *
 * Like the manual judge core it holds its state in an explicit object, changes it only through
 * {@link runAutoJudgeStep}, reads no clock and reports what happened as {@link JudgeCoreEffect}s. The `autoPlay`
 * driver steps it from the playback clock and owns audio scheduling (keysounds are queued against the audio write
 * head, ahead of the judgment).
 */

export interface AutoJudgeConfig {
  ruleset: RulesetConfig;
  /** Judged notes, sorted by time. The core marks them `judged` (and sets `visibleUntilBeat` on long notes). */
  scorableNotes: TimedPlayableNote[];
  landmineNotes: TimedLandmineNote[];
  invisibleNotes: TimedPlayableNote[];
  /** Lane channel → key label, for the trace's `key` field. */
  keyLabels: ReadonlyMap<string, string>;
  /**
   * Chart second of the LR2 negative-BPM reversal, when the chart has one (see `JudgeCoreConfig.reversalSeconds`).
   * AUTO play freezes there the same way: nothing at or past it is judged, and a play that ends with notes
   * outstanding empties the gauge.
   */
  reversalSeconds?: number;
}

export interface AutoJudgeState {
  readonly config: AutoJudgeConfig;
  readonly summary: JudgeCoreScore['summary'];
  readonly scoreTracker: JudgeCoreScore['scoreTracker'];
  readonly applyGaugeJudge: JudgeCoreScore['applyGaugeJudge'];
  readonly drainGaugeToZero: JudgeCoreScore['drainGaugeToZero'];
  combo: number;
  /** Notes up to this index have been judged. */
  judgeCursor: number;
  landmineExpireCursor: number;
  invisibleExpireCursor: number;
  readonly pendingLongNotes: PendingAutoLongNoteState[];
}

export type AutoJudgeInput =
  /** Judge every note whose time has been reached (heads only — tails wait for `advance`). */
  | { kind: 'reach'; nowSec: number }
  /** Time passes: due notes, long-note tails, and mine / invisible-note expiry. */
  | { kind: 'advance'; nowSec: number }
  /** The chart ended: resolve the remaining tails and retire every mine and invisible note. */
  | { kind: 'finish'; totalSeconds: number };

export function createAutoJudgeState(
  config: AutoJudgeConfig,
  score: Omit<JudgeCoreScore, 'applyGaugeDelta'>,
): AutoJudgeState {
  return {
    config,
    summary: score.summary,
    scoreTracker: score.scoreTracker,
    applyGaugeJudge: score.applyGaugeJudge,
    drainGaugeToZero: score.drainGaugeToZero,
    combo: 0,
    judgeCursor: 0,
    landmineExpireCursor: 0,
    invisibleExpireCursor: 0,
    pendingLongNotes: [],
  };
}

/** Applies one input, delivering the effects to `emit` in the order they happen. */
export function runAutoJudgeStep(state: AutoJudgeState, input: AutoJudgeInput, emit: JudgeCoreEffectSink): void {
  switch (input.kind) {
    // Judging is clamped below an LR2 negative-BPM reversal: AUTO play freezes with the pump there too (#134).
    case 'reach':
      applyDueJudgements(state, clampToReversal(state.config, input.nowSec), emit);
      return;
    case 'advance':
      applyDueJudgements(state, clampToReversal(state.config, input.nowSec), emit);
      drainPendingLongNotes(state, clampToReversal(state.config, input.nowSec), emit);
      markExpiredLandmines(state, clampToReversal(state.config, input.nowSec));
      markExpiredInvisibleNotes(state, input.nowSec);
      return;
    case 'finish': {
      const horizon = input.totalSeconds + autoBadWindowSeconds(state.config);
      drainPendingLongNotes(state, clampToReversal(state.config, input.totalSeconds), emit);
      markExpiredLandmines(state, horizon);
      markExpiredInvisibleNotes(state, horizon);
      for (const landmine of state.config.landmineNotes) {
        landmine.judged = true;
      }
      for (const invisible of state.config.invisibleNotes) {
        invisible.judged = true;
      }
      if (
        state.config.reversalSeconds !== undefined &&
        (state.judgeCursor < state.config.scorableNotes.length || state.pendingLongNotes.length > 0)
      ) {
        // LR2 zeroes HP when a play ends with notes outstanding (OpenLR2 `LR2f.cpp:12980-12982`), AUTO included: the
        // notes past a negative-BPM reversal were never reached, so the run is FAILED.
        state.drainGaugeToZero();
        emit({
          kind: 'trace',
          name: 'gauge',
          seconds: input.totalSeconds,
          fields: [
            ['value', 0],
            ['reason', 'notes-outstanding-past-reversal'],
          ],
        });
      }
      return;
    }
  }
}

/** {@link runAutoJudgeStep} collecting the effects into an array. */
export function stepAutoJudge(state: AutoJudgeState, input: AutoJudgeInput): JudgeCoreEffect[] {
  const effects: JudgeCoreEffect[] = [];
  runAutoJudgeStep(state, input, (effect) => {
    effects.push(effect);
  });
  return effects;
}

/** True once every note is judged and no long-note tail is outstanding. */
export function isAutoJudgeSettled(state: AutoJudgeState): boolean {
  return state.judgeCursor >= state.config.scorableNotes.length && state.pendingLongNotes.length === 0;
}

/** The key label of a lane for log output; `17` / `27` (scratch sub-channels) read their scratch lane's label. */
export function resolveNoteKeyLabel(channel: string, keyMap: ReadonlyMap<string, string>): string {
  const normalized = normalizeChannel(channel);
  if (keyMap.has(normalized)) {
    return keyMap.get(normalized) ?? '?';
  }
  if (normalized === '17') {
    return keyMap.get('16') ?? '?';
  }
  if (normalized === '27') {
    return keyMap.get('26') ?? '?';
  }
  return '?';
}

/**
 * Autoplay never misses, so this is purely the horizon after which un-detonated mines and invisible notes are retired.
 * The active ruleset's widest note reach is the right bound: nothing can act on them past it.
 */
function autoBadWindowSeconds(config: AutoJudgeConfig): number {
  return judgeWindowLateReachUs(config.ruleset.windows.note) / 1e6;
}

/** Scores a PGREAT for `note` at `seconds`; `publishFrame` false leaves the frame to the caller. */
function applyAutoPerfect(
  state: AutoJudgeState,
  note: TimedPlayableNote,
  seconds: number,
  emit: JudgeCoreEffectSink,
  publishFrame = true,
): void {
  applyJudgeToSummary(state.summary, 'PERFECT', state.scoreTracker);
  const previousGauge = state.summary.gauge?.current;
  state.applyGaugeJudge('PERFECT');
  const nextGauge = state.summary.gauge?.current;
  emit({
    kind: 'gauge',
    seconds,
    reason: 'judge',
    judge: 'PERFECT',
    delta: previousGauge !== undefined && nextGauge !== undefined ? nextGauge - previousGauge : undefined,
  });
  emit({ kind: 'combo', seconds, value: state.combo + 1, reason: 'judge', judge: 'PERFECT', channel: note.channel });
  state.combo += 1;
  emit({
    kind: 'trace',
    name: 'auto-judge',
    seconds,
    fields: [
      ['result', 'PERFECT'],
      ['channel', note.channel],
      ['key', resolveNoteKeyLabel(note.channel, state.config.keyLabels)],
    ],
  });
  emit({ kind: 'judge-combo', judge: 'PERFECT', combo: state.combo, channel: note.channel });
  if (publishFrame) emit({ kind: 'frame', seconds });
}

function applyDueJudgements(state: AutoJudgeState, referenceSeconds: number, emit: JudgeCoreEffectSink): void {
  const { scorableNotes, ruleset } = state.config;
  const safeReferenceSeconds = Math.max(0, referenceSeconds) + JUDGE_TIME_EPSILON_SECONDS;
  while (state.judgeCursor < scorableNotes.length) {
    const note = scorableNotes[state.judgeCursor]!;
    if (note.seconds > safeReferenceSeconds) {
      break;
    }
    note.judged = true;
    state.judgeCursor += 1;

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
      insertPendingAutoLongNote(state.pendingLongNotes, note, endSeconds);
      if (longNoteScoresTail(ruleset.longNoteStyle, note)) {
        // Charge modes judge the head and the tail separately: AUTO clears the head now and the tail at the tail, as
        // AUTO SCRATCH and beatoraja's autoplay do. The frame below publishes it.
        applyAutoPerfect(state, note, note.seconds, emit, false);
      }
      emit({
        kind: 'ui',
        command: {
          kind: 'long-note-start',
          channel: note.channel,
          beat: note.beat,
          mode: toUILongNoteMode(resolveRulesetLongNoteMode(ruleset.longNoteStyle, note) ?? 2),
        },
      });
      emit({ kind: 'frame', seconds: note.seconds, beat: note.beat });
    } else {
      applyAutoPerfect(state, note, note.seconds, emit);
    }

    markExpiredLandmines(state, note.seconds);
    markExpiredInvisibleNotes(state, note.seconds);
  }
}

function drainPendingLongNotes(state: AutoJudgeState, referenceSeconds: number, emit: JudgeCoreEffectSink): void {
  const safeReferenceSeconds = Math.max(0, referenceSeconds) + JUDGE_TIME_EPSILON_SECONDS;
  const pendingNotes = state.pendingLongNotes;
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
    // The LN's one judgment, or a charge note's tail (its head was cleared at the head).
    applyAutoPerfect(state, pending.note, pending.endSeconds, emit);
    // Pair the head's `hold-lane-until-beat` so the LN-hold timer and the lane laser fade out at the tail.
    emit({ kind: 'ui', command: { kind: 'long-note-end', channel: pending.note.channel, outcome: 'complete' } });
    emit({ kind: 'ui', command: { kind: 'release-lane', channel: pending.note.channel } });
  }
}

function markExpiredLandmines(state: AutoJudgeState, referenceSeconds: number): void {
  const landmineNotes = state.config.landmineNotes;
  const horizon = autoBadWindowSeconds(state.config);
  while (state.landmineExpireCursor < landmineNotes.length) {
    const landmine = landmineNotes[state.landmineExpireCursor]!;
    if (landmine.judged) {
      state.landmineExpireCursor += 1;
      continue;
    }
    if (referenceSeconds - landmine.seconds <= horizon) {
      break;
    }
    landmine.judged = true;
    state.landmineExpireCursor += 1;
  }
}

function markExpiredInvisibleNotes(state: AutoJudgeState, referenceSeconds: number): void {
  const invisibleNotes = state.config.invisibleNotes;
  const horizon = autoBadWindowSeconds(state.config);
  while (state.invisibleExpireCursor < invisibleNotes.length) {
    const invisible = invisibleNotes[state.invisibleExpireCursor]!;
    if (invisible.judged) {
      state.invisibleExpireCursor += 1;
      continue;
    }
    if (referenceSeconds - invisible.seconds <= horizon) {
      break;
    }
    invisible.judged = true;
    state.invisibleExpireCursor += 1;
  }
}
