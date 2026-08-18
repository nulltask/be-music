import type { LongNoteMode } from '../playable-notes.ts';

/**
 * The chart-side inputs a ruleset needs, in a form both the live engine and the play-log simulator can produce.
 *
 * The rulesets used to read a `PlaylogChart` directly, which tied them to the offline replay path. The live engine
 * has the same facts available (a resolved `BeMusicJson` plus its prepared note arrays) but in a different shape,
 * so the ruleset tables now take this neutral record and each caller supplies an adapter. Everything here is
 * chart-derived and fixed for the whole play — per-play choices (gauge, judge algorithm) travel separately in
 * `ResolveRulesetOptions`.
 */
export interface RulesetChartFacts {
  sourceFormat: 'bms' | 'bmson';
  /** Engine lane display mode (`resolveLaneDisplayMode` output) — picks beatoraja's per-mode window tables. */
  laneMode: string;
  /** Raw `#TOTAL` / bmson `info.total`. Absent when the chart specified none; each ruleset applies its own default. */
  total?: number;
  /** Chart-level long-note mode after `#LNMODE` / `info.ln_type` resolution. */
  lnMode: LongNoteMode;
  judgeRank: RulesetJudgeRankFacts;
  notes: RulesetNoteCounts;
}

export interface RulesetJudgeRankFacts {
  /** Initial judgerank on the internal LR2 percent axis (VERY HARD 25 / HARD 50 / NORMAL 75 / EASY 100). */
  percent: number;
  /** Raw `#RANK` when the chart specified one. */
  sourceRank?: number;
  /** Raw `#DEFEXRANK` (BMS) / `info.judge_rank` (bmson), in the `100 = NORMAL` unit. */
  sourceExRank?: number;
  /** Dynamic `#EXRANKxx` changes (channel `A0`) in chart order, in the same unit as `sourceExRank`. */
  timeline?: ReadonlyArray<{ timeUs: number; exRankValue: number }>;
}

/**
 * Scorable-note tallies split the way the note-count rules need them: a long note counts once under LN styles and
 * twice under charge styles, so the long notes are grouped by the mode the CHART declared and each ruleset decides
 * what to do with them. Mines, invisibles, and free-zone notes are excluded — they are never scorable.
 */
export interface RulesetNoteCounts {
  /** Scorable notes with no tail. */
  normal: number;
  /** Long notes keyed by their chart-declared mode (1 LN / 2 CN / 3 HCN). */
  long: Readonly<Record<LongNoteMode, number>>;
}

export function createEmptyRulesetNoteCounts(): RulesetNoteCounts {
  return { normal: 0, long: { 1: 0, 2: 0, 3: 0 } };
}

/** Total scorable note OBJECTS — every long note counts once. The denominator every TOTAL formula uses. */
export function countBaseNotes(notes: RulesetNoteCounts): number {
  return notes.normal + notes.long[1] + notes.long[2] + notes.long[3];
}
