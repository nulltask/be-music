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

/** LR2's single-play gauges in source order, followed by the corrected HAZARD. */
export const LR2_PRACTICE_GAUGE_TYPES = [
  'GROOVE',
  'HARD',
  'DEATH',
  'EASY',
  'P-ATTACK',
  'G-ATTACK',
  'DEATH-CORRECTED',
] as const;

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

/** The rulesets whose PRACTICE gauges a pick can name. */
const PRACTICE_GAUGE_SOURCES: readonly RulesetId[] = ['lr2', 'beatoraja', '____'];

/**
 * A PRACTICE `GAUGE TYPE` of one source, whatever ruleset judges the play: `beatoraja:ASSIST-EASY` under LR2 plays on
 * beatoraja's ASSIST EASY, as a source-qualified gauge pick does (ADR 0019).
 */
export type QualifiedPracticeGaugeType = `${RulesetId}:${PracticeGaugeType}`;

/**
 * The gauge a PRACTICE play runs on. A bare {@link PracticeGaugeType} is the judge ruleset's own; a
 * {@link QualifiedPracticeGaugeType} keeps its source's gauge and that source's TOTAL reading under every judge ruleset.
 */
export type PracticeGaugePick = PracticeGaugeType | QualifiedPracticeGaugeType;

/**
 * Splits a PRACTICE gauge pick into its source (`undefined` for a bare one) and its gauge type, or `undefined` when
 * `value` is none. A qualified pick names a gauge its own source's PRACTICE list offers; it is never mapped to a
 * lookalike.
 */
export function splitPracticeGaugePick(
  value: unknown,
): { source: RulesetId | undefined; type: PracticeGaugeType } | undefined {
  if (typeof value !== 'string') return undefined;
  const colon = value.indexOf(':');
  if (colon < 0) return isPracticeGaugeType(value) ? { source: undefined, type: value } : undefined;
  const source = PRACTICE_GAUGE_SOURCES.find((id) => id === value.slice(0, colon));
  const type = value.slice(colon + 1);
  return source !== undefined && isPracticeGaugeType(type, source) ? { source, type } : undefined;
}

/**
 * Whether `value` is a PRACTICE gauge pick: a qualified one of any source, or a bare one of `ruleset` when given (else of
 * any ruleset).
 */
export function isPracticeGaugePick(value: unknown, ruleset?: RulesetId): value is PracticeGaugePick {
  const parts = splitPracticeGaugePick(value);
  if (parts === undefined) return false;
  return parts.source !== undefined || ruleset === undefined || isPracticeGaugeType(parts.type, ruleset);
}

/** `type` as `source`'s PRACTICE gauge. */
export function qualifyPracticeGaugePick(source: RulesetId, type: PracticeGaugeType): QualifiedPracticeGaugeType {
  return `${source}:${type}`;
}

/**
 * Whether PRACTICE's `JUDGERANK` and `TOTAL` take effect under `ruleset`. beatoraja and LR2 read them (a judgerank
 * percent on their own window tables, an absolute TOTAL); That-Which-Must-Not-Be-Named's windows are fixed and its
 * gauges do not use TOTAL.
 */
export function practiceReadsJudgeRankAndTotal(ruleset: RulesetId): boolean {
  return ruleset !== '____';
}
