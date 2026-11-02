import {
  isPracticeGaugeType,
  practiceReadsJudgeRankAndTotal,
  resolveDefaultPracticeGauge,
  type BeatorajaGaugeCategory,
  type RulesetId,
} from '@be-music/player-engine/ruleset';
import type { PlayOptions, PracticeGaugeType } from './options.ts';

/** The PRACTICE play options a play reads. */
export type PracticePlayOptions = Pick<
  PlayOptions,
  | 'practiceStartMs'
  | 'practiceEndMs'
  | 'practiceGauge'
  | 'practiceGaugeCategory'
  | 'practiceStartGauge'
  | 'practiceJudgeRank'
  | 'practiceTotal'
>;

/** The range and rules of a PRACTICE play, as the engine takes them (`PlayerOptions.practice`). */
export interface PracticeSelection {
  startMs: number;
  /** Absent plays to the chart's end. */
  endMs?: number;
  gauge: PracticeGaugeType;
  /** beatoraja only; absent uses the play mode's. */
  gaugeCategory?: BeatorajaGaugeCategory;
  startGauge: number;
  /** Absent keeps the chart's. */
  judgeRank?: number;
  /** Absent keeps the chart's. */
  total?: number;
}

/**
 * `gauge` when it is one of `ruleset`'s PRACTICE gauges, else the ruleset's default (#933): a PRACTICE gauge is the judge
 * ruleset's own, so changing the ruleset restores its default gauge, as the play's gauge pick does.
 */
export function keepPracticeGauge(gauge: PracticeGaugeType, ruleset: RulesetId): PracticeGaugeType {
  return isPracticeGaugeType(gauge, ruleset) ? gauge : resolveDefaultPracticeGauge(ruleset);
}

/**
 * The PRACTICE a play under `ruleset` runs (#933): the range, the ruleset's own gauge (its default when the stored one
 * is another ruleset's), GAUGE CATEGORY under beatoraja only, and JUDGERANK and TOTAL where the ruleset reads them
 * (not under That-Which-Must-Not-Be-Named). A 0 END TIME, JUDGERANK or TOTAL keeps the chart's.
 */
export function resolvePracticeSelection(options: PracticePlayOptions, ruleset: RulesetId): PracticeSelection {
  const readsRules = practiceReadsJudgeRankAndTotal(ruleset);
  return {
    startMs: options.practiceStartMs,
    ...(options.practiceEndMs > 0 ? { endMs: options.practiceEndMs } : {}),
    gauge: keepPracticeGauge(options.practiceGauge, ruleset),
    ...(ruleset === 'beatoraja' && options.practiceGaugeCategory !== 'MODE'
      ? { gaugeCategory: options.practiceGaugeCategory }
      : {}),
    startGauge: options.practiceStartGauge,
    ...(readsRules && options.practiceJudgeRank > 0 ? { judgeRank: options.practiceJudgeRank } : {}),
    ...(readsRules && options.practiceTotal > 0 ? { total: options.practiceTotal } : {}),
  };
}
