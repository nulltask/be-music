/** A judgment of a note, best first. */
export type JudgmentKind = 'PERFECT' | 'GREAT' | 'GOOD' | 'BAD' | 'POOR';

/** The judgments, best first. */
export const JUDGMENT_KINDS: readonly JudgmentKind[] = ['PERFECT', 'GREAT', 'GOOD', 'BAD', 'POOR'];

/** Whether `value` names a judgment. */
export function isJudgmentKind(value: unknown): value is JudgmentKind {
  return typeof value === 'string' && (JUDGMENT_KINDS as readonly string[]).includes(value);
}

/** A play side. `'2P'` only exists in double play. */
export type PlaySide = '1P' | '2P';

/** One timed judgment: when it happened, how early or late, and what it was. */
export interface JudgmentTiming {
  /** Play-clock ms of the judgment. */
  atMs: number;
  /** Signed offset (ms): > 0 late, < 0 early. */
  deltaMs: number;
  judge: JudgmentKind;
  /** Lane channel of the judged note. */
  channel?: string;
}

/**
 * One sample of the gauge graph. `progress` is the chart-time fraction (0 = the start, 1 = the end of the chart); `value`
 * is the gauge in percent (0..100) at that moment.
 */
export interface GaugeHistorySample {
  progress: number;
  value: number;
}

/** One sample of the EX-score graph: the EX score (0..`total × 2`) at a chart-time fraction. */
export interface ScoreHistorySample {
  progress: number;
  exScore: number;
}

/** One play side's lane covers as drawn, each part a fraction (0..1) of the lane height; 0 = none. */
export interface LaneCover {
  side: PlaySide;
  /** SUDDEN+: the cover over the top of the lanes. */
  sudden: number;
  /** HIDDEN+: the cover just above the judgement line. */
  hidden: number;
  /** LIFT: how far the judgement line is raised. */
  lift: number;
}

/**
 * The gauge as the engine reports it on a frame (`PlayerGaugeSummary`): its value out of `max`, the ruleset's gauge id
 * and its verdict.
 */
export interface PlayGaugeInput {
  readonly current: number;
  readonly max: number;
  readonly initial?: number;
  readonly cleared: boolean;
  readonly type?: string;
}

/**
 * What a play state reads of an engine frame (`PlayerUIFramePayload`): the chart's length and the running score. The
 * combo, the max combo and a course stage's course combo, when the frame carries them, are the engine's own and win over
 * what the judgments counted.
 */
export interface PlayFrameInput {
  readonly totalSeconds: number;
  readonly summary: {
    readonly exScore: number;
    readonly gauge?: PlayGaugeInput;
    readonly combo?: number;
    readonly maxCombo?: number;
    readonly course?: { readonly combo: number; readonly maxCombo: number };
  };
}

/** One judgment a seek rebuilt (`PlayerUISeekJudgment`), in the order the play made it. */
export interface PlaySeekJudgment extends PlayJudgeInput {
  /** The chart second it was made at. */
  readonly seconds: number;
  /** The gauge right after it, out of the gauge's `max`. */
  readonly gauge?: number;
  /** The EX score right after it. */
  readonly exScore: number;
}

/**
 * What the engine rebuilt a play to when it sought (`PlayerUISeekSnapshot`): the summary at the second sought, with the
 * combo and max combo, and every judgment before it.
 */
export interface PlaySeekSnapshot {
  readonly summary: PlayFrameInput['summary'];
  readonly combo: number;
  readonly maxCombo: number;
  readonly judgments: readonly PlaySeekJudgment[];
}

/** What a play state reads of a judgment the engine published (`PlayerJudgeComboSignalState`). */
export interface PlayJudgeInput {
  readonly judge: string;
  /** The running combo after the judgment. */
  readonly combo: number;
  readonly channel?: string;
  /** Signed offset (ms), when the judgment has a timing (not an autoplayed note, a mine or a miss). */
  readonly deltaMs?: number;
}

/**
 * The judgment counts of a play (`ScoreSummary` / `PlayerSummary`): what a finished play's max combo and a result are
 * read from.
 */
export interface PlayScoreInput {
  readonly total: number;
  readonly perfect: number;
  readonly great: number;
  readonly good: number;
  readonly bad: number;
  readonly poor: number;
}

/** The gauge as a percentage (0..100) of its maximum; 0 for a gauge without one. */
export function gaugePercent(gauge: Pick<PlayGaugeInput, 'current' | 'max'>): number {
  return gauge.max > 0 ? (gauge.current / gauge.max) * 100 : 0;
}
