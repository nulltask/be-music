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
/** plugout has no PRACTICE: Be-Music's offers its single-play gauges, by their ids (`PLUGOUT_GAUGE_IDS`). */
const PLUGOUT_PRACTICE_GAUGE_TYPES = [
  'EASY',
  'NORMAL',
  'HARD',
  'HAZARD',
  'EX-EASY',
  'EX-NORMAL',
  'EX-HARD',
  'EX-HAZARD',
] as const;

/** A PRACTICE `GAUGE TYPE` of any ruleset: a gauge id, read under the judge ruleset it belongs to. */
export type PracticeGaugeType =
  | (typeof BEATORAJA_PRACTICE_GAUGE_TYPES)[number]
  | (typeof LR2_PRACTICE_GAUGE_TYPES)[number]
  | (typeof ____PRACTICE_GAUGE_TYPES)[number]
  | (typeof PLUGOUT_PRACTICE_GAUGE_TYPES)[number];

/** Every ruleset's PRACTICE gauge types, each once: what a stored PRACTICE gauge may hold. */
export const PRACTICE_GAUGE_TYPES: readonly PracticeGaugeType[] = [
  ...new Set<PracticeGaugeType>([
    ...BEATORAJA_PRACTICE_GAUGE_TYPES,
    ...LR2_PRACTICE_GAUGE_TYPES,
    ...____PRACTICE_GAUGE_TYPES,
    ...PLUGOUT_PRACTICE_GAUGE_TYPES,
  ]),
];

/** The PRACTICE gauge types `ruleset` offers, in its own order. */
export function resolvePracticeGaugeTypes(ruleset: RulesetId): readonly PracticeGaugeType[] {
  switch (ruleset) {
    case 'lr2':
      return LR2_PRACTICE_GAUGE_TYPES;
    case 'beatoraja':
      return BEATORAJA_PRACTICE_GAUGE_TYPES;
    case 'plugout':
      return PLUGOUT_PRACTICE_GAUGE_TYPES;
    default:
      return ____PRACTICE_GAUGE_TYPES;
  }
}

/** The PRACTICE gauge a ruleset starts with: its default recovery gauge (LR2 GROOVE, else NORMAL). */
export function resolveDefaultPracticeGauge(ruleset: RulesetId): PracticeGaugeType {
  return ruleset === 'lr2' ? 'GROOVE' : 'NORMAL';
}

/** Whether `value` is a PRACTICE gauge type: of `ruleset` when given, else of any ruleset. */
export function isPracticeGaugeType(value: unknown, ruleset?: RulesetId): value is PracticeGaugeType {
  if (typeof value !== 'string') return false;
  return ruleset === undefined
    ? PRACTICE_GAUGE_TYPE_SET.has(value)
    : (resolvePracticeGaugeTypes(ruleset) as readonly string[]).includes(value);
}

const PRACTICE_GAUGE_TYPE_SET: ReadonlySet<string> = new Set(PRACTICE_GAUGE_TYPES);

/** The rulesets whose PRACTICE gauges a pick can name. */
const PRACTICE_GAUGE_SOURCES: readonly RulesetId[] = ['lr2', 'beatoraja', '____', 'plugout'];

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
export function splitPracticeGaugePick(value: unknown): Readonly<PracticeGaugePickParts> | undefined {
  return typeof value === 'string' ? PRACTICE_GAUGE_PICK_PARTS.get(value) : undefined;
}

interface PracticeGaugePickParts {
  source: RulesetId | undefined;
  type: PracticeGaugeType;
}

/** Every PRACTICE gauge pick and its parts, so a pick is split by one lookup: the table is fixed. */
const PRACTICE_GAUGE_PICK_PARTS: ReadonlyMap<string, Readonly<PracticeGaugePickParts>> = new Map<
  string,
  Readonly<PracticeGaugePickParts>
>([
  ...PRACTICE_GAUGE_TYPES.map((type) => [type, Object.freeze({ source: undefined, type })] as const),
  ...PRACTICE_GAUGE_SOURCES.flatMap((source) =>
    resolvePracticeGaugeTypes(source).map(
      (type) => [qualifyPracticeGaugePick(source, type), Object.freeze({ source, type })] as const,
    ),
  ),
]);

/** The PRACTICE gauge picks valid under each judge ruleset: its own bare gauges and every qualified one. */
const PRACTICE_GAUGE_PICKS_BY_RULESET = new Map<RulesetId, ReadonlySet<string>>();

function practiceGaugePicksOf(ruleset: RulesetId): ReadonlySet<string> {
  let picks = PRACTICE_GAUGE_PICKS_BY_RULESET.get(ruleset);
  if (picks === undefined) {
    picks = new Set([
      ...resolvePracticeGaugeTypes(ruleset),
      ...[...PRACTICE_GAUGE_PICK_PARTS].flatMap(([pick, parts]) => (parts.source === undefined ? [] : [pick])),
    ]);
    PRACTICE_GAUGE_PICKS_BY_RULESET.set(ruleset, picks);
  }
  return picks;
}

/**
 * Whether `value` is a PRACTICE gauge pick: a qualified one of any source, or a bare one of `ruleset` when given (else of
 * any ruleset).
 */
export function isPracticeGaugePick(value: unknown, ruleset?: RulesetId): value is PracticeGaugePick {
  // The ruleset's own bare gauge is the common case, and needs no split.
  if (typeof value !== 'string') return false;
  return ruleset === undefined ? PRACTICE_GAUGE_PICK_PARTS.has(value) : practiceGaugePicksOf(ruleset).has(value);
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
