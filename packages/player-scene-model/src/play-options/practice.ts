import {
  isPracticeGaugePick,
  splitPracticeGaugePick,
  practiceReadsJudgeRankAndTotal,
  resolveDefaultPracticeGauge,
  type BeatorajaGaugeCategory,
  type RulesetId,
} from '@be-music/player-engine/ruleset';
import type { PlayOptions, PracticeGaugePick } from './options.ts';

/** The PRACTICE play options a play reads. */
export type PracticePlayOptions = Pick<
  PlayOptions,
  | 'practiceGauge'
  | 'practiceGaugeCategory'
  | 'practiceStartGauge'
  | 'practiceJudgeRank'
  | 'practiceTotal'
  | 'practiceRestBefore'
  | 'practiceRestAfter'
  | 'practiceCarriedLongNotes'
>;

/**
 * The bars a PRACTICE play loops, as chart milliseconds: from the first bar's line up to the line closing the last
 * (`chartScoreRangeTimes`). Absent `endMs` plays to the chart's end.
 */
export interface PracticeRange {
  readonly startMs: number;
  readonly endMs?: number;
}

/** The range and rules of a PRACTICE play, as the engine takes them (`PlayerOptions.practice`). */
export interface PracticeSelection {
  startMs: number;
  /** Absent plays to the chart's end. */
  endMs?: number;
  /** The judge ruleset's own PRACTICE gauge, or another source's qualified with it. */
  gauge: PracticeGaugePick;
  /** beatoraja only; absent uses the play mode's. */
  gaugeCategory?: BeatorajaGaugeCategory;
  startGauge: number;
  /** Absent keeps the chart's. */
  judgeRank?: number;
  /** Absent keeps the chart's. */
  total?: number;
  /** Bars of rest before the range. */
  restBarsBefore: number;
  /** Bars of rest after the range. */
  restBarsAfter: number;
  /** Keeps a long note held into the range from before it. */
  carriedLongNotes: boolean;
}

/** The source whose gauge a PRACTICE pick plays on under the judge ruleset `ruleset`: its own, or the ruleset's. */
export function practiceGaugeSource(gauge: PracticeGaugePick, ruleset: RulesetId): RulesetId {
  return splitPracticeGaugePick(gauge)?.source ?? ruleset;
}

/**
 * `gauge` when it is one of `ruleset`'s PRACTICE gauges or another source's qualified with it, else the ruleset's default
 * (#933): a bare PRACTICE gauge is the judge ruleset's own, so changing the ruleset restores its default gauge, as the
 * play's gauge pick does; a qualified one keeps its source (ADR 0019).
 */
export function keepPracticeGauge(gauge: PracticeGaugePick, ruleset: RulesetId): PracticeGaugePick {
  return isPracticeGaugePick(gauge, ruleset) ? gauge : resolveDefaultPracticeGauge(ruleset);
}

/**
 * The PRACTICE a play under `ruleset` runs (#933): the bars picked for it (`range`; the whole chart without one), the
 * ruleset's own gauge (its default when the stored one is another ruleset's), GAUGE CATEGORY under beatoraja only, and
 * JUDGERANK and TOTAL where the ruleset reads them (not under That-Which-Must-Not-Be-Named). A 0 JUDGERANK or TOTAL
 * keeps the chart's.
 */
export function resolvePracticeSelection(
  options: PracticePlayOptions,
  ruleset: RulesetId,
  range?: PracticeRange,
): PracticeSelection {
  const readsRules = practiceReadsJudgeRankAndTotal(ruleset);
  const gauge = keepPracticeGauge(options.practiceGauge, ruleset);
  const startMs = Math.max(0, Math.trunc(range?.startMs ?? 0));
  // Built field by field in the original key order; conditional spreads would copy an object for every optional field.
  const selection: PracticeSelection = { startMs } as PracticeSelection;
  if (range?.endMs !== undefined && range.endMs > startMs) selection.endMs = Math.trunc(range.endMs);
  selection.gauge = gauge;
  // GAUGE CATEGORY is beatoraja's: it follows a beatoraja gauge, under every judge ruleset.
  if (practiceGaugeSource(gauge, ruleset) === 'beatoraja' && options.practiceGaugeCategory !== 'MODE') {
    selection.gaugeCategory = options.practiceGaugeCategory;
  }
  selection.startGauge = options.practiceStartGauge;
  selection.restBarsBefore = options.practiceRestBefore;
  selection.restBarsAfter = options.practiceRestAfter;
  selection.carriedLongNotes = options.practiceCarriedLongNotes;
  if (readsRules && options.practiceJudgeRank > 0) selection.judgeRank = options.practiceJudgeRank;
  if (readsRules && options.practiceTotal > 0) selection.total = options.practiceTotal;
  return selection;
}

/** `ms` as `m:ss.s`, tenths rounded down (`83_456` → `1:23.4`). */
export function formatPracticeTime(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}
