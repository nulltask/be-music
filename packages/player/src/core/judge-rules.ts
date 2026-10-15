import type { LongNoteStyle } from '../ruleset/definitions.ts';
import { classifyRulesetJudge, RULESET_JUDGE_NONE } from '../ruleset/judge.ts';
import type { JudgeWindowSetUs } from '../ruleset/definitions.ts';
import {
  isChargeLongNoteMode,
  resolveEffectiveLongNoteMode,
  resolveLnEarlyRelease,
  type LnJudgeIndex,
  type LnTimedJudge,
} from '../ruleset/long-note.ts';
import type { RulesetConfig } from '../ruleset/definitions.ts';
import type { LongNoteMode, TimedPlayableNote } from '../playable-notes.ts';
import type { JudgeKind } from './scoring.ts';
import type { PlayerUiLongNoteMode } from './ui-signal-bus.ts';

/**
 * Pure judgment rules of the live engine: timing classification, long-note judgment merging and the long-note mode a
 * ruleset plays. Shared by the judge core (`judge-core.ts`) and the auto-play driver; nothing here reads a clock.
 */

/**
 * `noteTime - inputTime` in whole microseconds, the unit of the play log's clock and of the ruleset window tables.
 * The difference of two float second values can land a hair outside a window edge that an exact delta sits on (a
 * press 150 ms late reading as 150.0000001 ms), so every window comparison of the judge core goes through this.
 */
export function judgeDeltaUs(noteSeconds: number, inputSeconds: number): number {
  return Math.round((noteSeconds - inputSeconds) * 1e6);
}

/** A judgment with the signed timing it was made at (positive = the press was LATE). */
export interface TimedManualJudge {
  kind: JudgeKind;
  signedDeltaMs: number;
}

/** Judge indices, best to worst, in the order the ruleset window sets use. */
export const RULESET_JUDGE_KINDS: readonly [JudgeKind, JudgeKind, JudgeKind, JudgeKind] = [
  'PERFECT',
  'GREAT',
  'GOOD',
  'BAD',
];

/**
 * Classify a signed timing delta against one ruleset window set, or `undefined` when the press cannot reach the
 * note at all. Both legs of every window matter: beatoraja's seven-key BAD window reaches 280 ms late but only
 * 220 ms early, so "within the BAD width" is not a question that can be asked of an absolute delta.
 *
 * `signedDeltaMs` is the engine's convention (positive = the press was LATE); the window tables use beatoraja's
 * (`noteTime - inputTime`, positive = EARLY), hence the negation.
 */
export function resolveManualJudgeKind(signedDeltaMs: number, windows: JudgeWindowSetUs): JudgeKind | undefined {
  const judge = classifyRulesetJudge(Math.round(-signedDeltaMs * 1000), windows);
  return judge === RULESET_JUDGE_NONE ? undefined : RULESET_JUDGE_KINDS[judge];
}

/**
 * Same classification, for contexts where "out of reach" is itself a miss — a long-note end that the player never
 * released inside its window is a POOR, not a non-event.
 */
export function resolveManualTimedJudge(signedDeltaMs: number, windows: JudgeWindowSetUs): TimedManualJudge {
  return {
    kind: resolveManualJudgeKind(signedDeltaMs, windows) ?? 'POOR',
    signedDeltaMs,
  };
}

function resolveJudgeSeverity(judge: JudgeKind): number {
  switch (judge) {
    case 'PERFECT':
      return 0;
    case 'GREAT':
      return 1;
    case 'GOOD':
      return 2;
    case 'BAD':
      return 3;
    case 'POOR':
      return 4;
  }
}

/** An LN's single judgment: the worse of head and tail, and on a tie the one further off its mark. */
export function combineLongNoteJudges(head: TimedManualJudge, tail: TimedManualJudge): TimedManualJudge {
  const headSeverity = resolveJudgeSeverity(head.kind);
  const tailSeverity = resolveJudgeSeverity(tail.kind);
  if (headSeverity > tailSeverity) {
    return head;
  }
  if (tailSeverity > headSeverity) {
    return tail;
  }
  return Math.abs(head.signedDeltaMs) >= Math.abs(tail.signedDeltaMs) ? head : tail;
}

const LN_JUDGE_KINDS: readonly JudgeKind[] = ['PERFECT', 'GREAT', 'GOOD', 'BAD', 'POOR'];

/**
 * The single judgment of an LN released before its tail, by the ruleset's rule ({@link resolveLnEarlyRelease}).
 * `releaseDeltaMs` is the release against the tail in the engine's convention (negative = before the tail).
 */
export function resolveLongNoteEarlyReleaseJudge(
  ruleset: Pick<RulesetConfig, 'lnEarlyRelease'>,
  head: TimedManualJudge,
  releaseDeltaMs: number,
  endWindows: JudgeWindowSetUs,
): TimedManualJudge {
  const toRuleset = (judge: TimedManualJudge): LnTimedJudge => ({
    judge: resolveJudgeSeverity(judge.kind) as LnJudgeIndex,
    dmUs: Math.round(-judge.signedDeltaMs * 1000),
  });
  // Whole microseconds, like every other window comparison (see `judgeDeltaUs`).
  const released = resolveLnEarlyRelease(ruleset, toRuleset(head), Math.round(-releaseDeltaMs * 1000), endWindows);
  return { kind: LN_JUDGE_KINDS[released.judge]!, signedDeltaMs: -released.dmUs / 1000 };
}

/** True when a playable note carries a tail — a long / charge note rather than a single hit. */
export function isLongPlayableNote(note: TimedPlayableNote): boolean {
  return typeof note.endSeconds === 'number' && Number.isFinite(note.endSeconds) && note.endSeconds > note.seconds;
}

/** The tail time of a long note, or `undefined` for a single hit. */
export function resolveLongNoteEndSeconds(note: TimedPlayableNote): number | undefined {
  if (typeof note.endSeconds !== 'number' || !Number.isFinite(note.endSeconds) || note.endSeconds <= note.seconds) {
    return undefined;
  }
  return note.endSeconds;
}

/** The chart's long-note mode of a note (2 when the chart names none), or `undefined` for a single hit. */
export function resolvePlayableLongNoteMode(note: TimedPlayableNote): LongNoteMode | undefined {
  if (resolveLongNoteEndSeconds(note) === undefined) {
    return undefined;
  }
  return note.longNoteMode ?? 2;
}

/** The long-note mode the ruleset plays this note as, or `undefined` for a note without one. */
export function resolveRulesetLongNoteMode(style: LongNoteStyle, note: TimedPlayableNote): LongNoteMode | undefined {
  const chartMode = resolvePlayableLongNoteMode(note);
  return chartMode === undefined ? undefined : resolveEffectiveLongNoteMode(style, chartMode);
}

/** True when the ruleset scores this long note's tail as a judgment of its own (charge modes). */
export function longNoteScoresTail(style: LongNoteStyle, note: TimedPlayableNote): boolean {
  if (!isLongPlayableNote(note)) {
    return false;
  }
  const mode = resolveRulesetLongNoteMode(style, note);
  return mode !== undefined && isChargeLongNoteMode(mode);
}

/** The long-note mode a log line reports for a note: the chart's mode, LN for anything else. */
export function resolveLoggedLongNoteMode(note: TimedPlayableNote): 1 | 2 | 3 {
  const mode = resolvePlayableLongNoteMode(note);
  return mode === 2 || mode === 3 ? mode : 1;
}

/** The UI-command spelling of an effective long-note mode. */
export function toUiLongNoteMode(mode: LongNoteMode): PlayerUiLongNoteMode {
  return mode === 3 ? 'hcn' : mode === 2 ? 'cn' : 'ln';
}

/** An auto-played long note waiting for its tail. */
export interface PendingAutoLongNoteState {
  endSeconds: number;
  note: TimedPlayableNote;
}

/** Inserts a pending auto long note, keeping the queue sorted by tail time (stable for equal tails). */
export function insertPendingAutoLongNote(
  pendingNotes: PendingAutoLongNoteState[],
  note: TimedPlayableNote,
  endSeconds: number,
): void {
  let insertIndex = pendingNotes.length;
  while (insertIndex > 0 && pendingNotes[insertIndex - 1]!.endSeconds > endSeconds) {
    insertIndex -= 1;
  }
  pendingNotes.splice(insertIndex, 0, { endSeconds, note });
}
