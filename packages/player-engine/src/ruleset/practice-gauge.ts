import type { RulesetId } from './definitions.ts';

/**
 * PRACTICE's `GAUGE TYPE` per judge ruleset (#933). PRACTICE is beatoraja's mode (`PracticeConfiguration`), usable under
 * every ruleset; its gauge list is the judge ruleset's own gauges, spelled as that ruleset's gauge ids.
 */

/** beatoraja PRACTICE `GAUGE TYPE`, in source order: the six single gauges, then the three class gauges. */
export const BEATORAJA_PRACTICE_GAUGE_TYPES = [
  'ASSIST-EASY',
  'EASY',
  'NORMAL',
  'HARD',
  'EX-HARD',
  'HAZARD',
  'CLASS',
  'EXCLASS',
  'EXHARDCLASS',
] as const;

/** LR2's single-play gauges, in the order of its gauge option (GROOVE, HARD, HAZARD, EASY, P.ATTACK, G.ATTACK). */
export const LR2_PRACTICE_GAUGE_TYPES = ['GROOVE', 'HARD', 'DEATH', 'EASY', 'P-ATTACK', 'G-ATTACK'] as const;

/** That-Which-Must-Not-Be-Named's single-play gauges, gentlest first. */
const ____PRACTICE_GAUGE_TYPES = ['ASSISTED-EASY', 'EASY', 'NORMAL', 'HARD', 'EX-HARD'] as const;

/** A PRACTICE `GAUGE TYPE` of any ruleset: a gauge id, read under the judge ruleset it belongs to. */
export type PracticeGaugeType =
  | (typeof BEATORAJA_PRACTICE_GAUGE_TYPES)[number]
  | (typeof LR2_PRACTICE_GAUGE_TYPES)[number]
  | (typeof ____PRACTICE_GAUGE_TYPES)[number];

/** Every ruleset's PRACTICE gauge types, each once: what a stored PRACTICE gauge may hold. */
export const PRACTICE_GAUGE_TYPES: readonly PracticeGaugeType[] = [
  ...new Set<PracticeGaugeType>([
    ...BEATORAJA_PRACTICE_GAUGE_TYPES,
    ...LR2_PRACTICE_GAUGE_TYPES,
    ...____PRACTICE_GAUGE_TYPES,
  ]),
];

/** The PRACTICE gauge types `ruleset` offers, in its own order. */
export function resolvePracticeGaugeTypes(ruleset: RulesetId): readonly PracticeGaugeType[] {
  return ruleset === 'lr2'
    ? LR2_PRACTICE_GAUGE_TYPES
    : ruleset === 'beatoraja'
      ? BEATORAJA_PRACTICE_GAUGE_TYPES
      : ____PRACTICE_GAUGE_TYPES;
}

/** The PRACTICE gauge a ruleset starts with: its default recovery gauge (LR2 GROOVE, else NORMAL). */
export function resolveDefaultPracticeGauge(ruleset: RulesetId): PracticeGaugeType {
  return ruleset === 'lr2' ? 'GROOVE' : 'NORMAL';
}

/** Whether `value` is a PRACTICE gauge type: of `ruleset` when given, else of any ruleset. */
export function isPracticeGaugeType(value: unknown, ruleset?: RulesetId): value is PracticeGaugeType {
  const types: readonly string[] = ruleset === undefined ? PRACTICE_GAUGE_TYPES : resolvePracticeGaugeTypes(ruleset);
  return typeof value === 'string' && types.includes(value);
}

/**
 * Whether PRACTICE's `JUDGERANK` and `TOTAL` take effect under `ruleset`. beatoraja and LR2 read them (a judgerank
 * percent on their own window tables, an absolute TOTAL); That-Which-Must-Not-Be-Named's windows are fixed and its
 * gauges do not use TOTAL.
 */
export function practiceReadsJudgeRankAndTotal(ruleset: RulesetId): boolean {
  return ruleset !== '____';
}
