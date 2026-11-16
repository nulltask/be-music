/**
 * The gauge the player picks, spelled in LR2's names because that is what the skins' `#SRC_BUTTON,type=40 / 41`
 * cycling exposes. Each judge ruleset plays it on a gauge of its own line-up, its gauge id (`resolveRuleset`; a course
 * stage's by `resolveCourseGaugeId`):
 *
 * - `'GROOVE'` — the default recovery gauge; beatoraja and That-Which-Must-Not-Be-Named call the same one `NORMAL`.
 * - `'ASSIST-EASY'` — beatoraja ASSIST EASY / AC ASSISTED EASY recovery gauge.
 * - `'EASY'` — gentler recovery with a lower clear threshold.
 * - `'HARD'` — starts full, drains on misses, fails at the ruleset's death border.
 * - `'EX-HARD'` — independent beatoraja / AC survival gauge, without HARD's low-life softening.
 * - `'G-ATTACK'` — LR2 GOOD ATTACK: GOOD recovers; PGREAT costs the same as missed POOR.
 * - `'P-ATTACK'` — LR2 PERFECT ATTACK: GOOD or worse kills; GREAT drains one percent.
 * - `'DEATH'` — starts full and ends the run on the first break; beatoraja calls it `HAZARD`. LR2 (its HAZARD) also
 *   clears a single chart only with HP 80 or more at the end, as it checks GROOVE (OpenLR2 `LR2f.cpp` L1842-L1862).
 * - `'DEATH-CORRECTED'` — LR2's HAZARD that clears by surviving, without that 80 border. Under the other rulesets it
 *   reads as their DEATH.
 * - `'EX-GROOVE'` / `'EX-EASY'` / `'EX-DEATH'` — plugout's EXNORMAL (clears only at 100 %), EX EASY and EXHAZARD; only
 *   plugout has them. plugout's EXHARD is `'EX-HARD'`.
 */
export type GaugeType =
  | 'GROOVE'
  | 'HARD'
  | 'DEATH'
  | 'DEATH-CORRECTED'
  | 'EASY'
  | 'EX-HARD'
  | 'ASSIST-EASY'
  | 'P-ATTACK'
  | 'G-ATTACK'
  | 'EX-GROOVE'
  | 'EX-EASY'
  | 'EX-DEATH';

/** Every gauge type, in the order LR2's gauge button cycles them (`#SRC_BUTTON,type=40 / 41` cells 0..5). */
export const LR2_GAUGE_TYPES: readonly GaugeType[] = ['GROOVE', 'HARD', 'DEATH', 'EASY', 'P-ATTACK', 'G-ATTACK'];

/** Every accepted gauge pick; source-specific menus use resolveGaugeTypes. */
export const GAUGE_TYPES: readonly GaugeType[] = [
  ...LR2_GAUGE_TYPES,
  'EX-HARD',
  'ASSIST-EASY',
  'DEATH-CORRECTED',
  'EX-GROOVE',
  'EX-EASY',
  'EX-DEATH',
];
/** LR2's menu: its own six gauges, then the corrected HAZARD. */
const LR2_MENU_GAUGE_TYPES: readonly GaugeType[] = [...LR2_GAUGE_TYPES, 'DEATH-CORRECTED'];
const BEATORAJA_GAUGE_TYPES: readonly GaugeType[] = ['GROOVE', 'HARD', 'EX-HARD', 'DEATH', 'EASY', 'ASSIST-EASY'];
const ____GAUGE_TYPES: readonly GaugeType[] = ['GROOVE', 'HARD', 'EX-HARD', 'EASY', 'ASSIST-EASY'];
/** plugout's four gauges, then their EX variants (NORMAL / HARD / HAZARD / EASY, the select skin's order). */
const PLUGOUT_GAUGE_TYPES: readonly GaugeType[] = [
  'GROOVE',
  'HARD',
  'DEATH',
  'EASY',
  'EX-GROOVE',
  'EX-HARD',
  'EX-DEATH',
  'EX-EASY',
];

/** Source menu choices: LR2 has no EX-HARD; the AC menu has no DEATH pick; plugout has no ASSIST EASY. */
export function resolveGaugeTypes(ruleset: GaugeSource): readonly GaugeType[] {
  switch (ruleset) {
    case 'lr2':
      return LR2_MENU_GAUGE_TYPES;
    case 'beatoraja':
      return BEATORAJA_GAUGE_TYPES;
    case 'plugout':
      return PLUGOUT_GAUGE_TYPES;
    default:
      return ____GAUGE_TYPES;
  }
}

/** Whether `value` names a gauge type. */
export function isGaugeType(value: unknown): value is GaugeType {
  return typeof value === 'string' && (GAUGE_TYPES as readonly string[]).includes(value);
}

/** The sources a gauge pick can name: the judge rulesets, whose gauge line-ups differ. */
type GaugeSource = 'lr2' | 'beatoraja' | '____' | 'plugout';

const GAUGE_SOURCES: readonly GaugeSource[] = ['lr2', 'beatoraja', '____', 'plugout'];

/** A gauge of one source, whatever ruleset judges the play: `lr2:HARD`, `beatoraja:EX-HARD`, `____:EASY` (ADR 0019). */
export type QualifiedGaugeType = `${GaugeSource}:${GaugeType}`;

/**
 * The gauge a play runs on. A bare {@link GaugeType} is the judge ruleset's own gauge of that name. A
 * {@link QualifiedGaugeType} keeps its source under every judge ruleset: that source's gauge table, TOTAL reading,
 * auto-shift ladder, fallback gauge and course gauges (#1171).
 */
export type GaugePick = GaugeType | QualifiedGaugeType;

/** A gauge pick's source (`undefined` for a bare pick) and its gauge type. */
export interface GaugePickParts {
  source: GaugeSource | undefined;
  type: GaugeType;
}

/** Splits a gauge pick into its source and type, or `undefined` when `value` is no gauge pick. */
export function splitGaugePick(value: unknown): GaugePickParts | undefined {
  if (typeof value !== 'string') return undefined;
  const colon = value.indexOf(':');
  if (colon < 0) return isGaugeType(value) ? { source: undefined, type: value } : undefined;
  const source = GAUGE_SOURCES.find((id) => id === value.slice(0, colon));
  const type = value.slice(colon + 1);
  // A qualified pick names a gauge its source's own menu offers; it is never mapped to a lookalike.
  return source !== undefined && isGaugeType(type) && resolveGaugeTypes(source).includes(type)
    ? { source, type }
    : undefined;
}

/** Whether `value` is a gauge pick: a bare gauge type, or one qualified with a source that defines it. */
export function isGaugePick(value: unknown): value is GaugePick {
  return splitGaugePick(value) !== undefined;
}

/**
 * The gauge type of a pick, without its source (`lr2:HARD` is HARD): what a skin's label reads. A value that is no
 * gauge pick (an unvalidated log) is returned as it is.
 */
export function gaugePickType(pick: GaugePick): GaugeType {
  return splitGaugePick(pick)?.type ?? (pick as GaugeType);
}

/** The source whose gauge `pick` runs under the judge ruleset `ruleset`: its own source, or the ruleset for a bare pick. */
export function resolveGaugePickSource(pick: GaugePick, ruleset: GaugeSource): GaugeSource {
  return splitGaugePick(pick)?.source ?? ruleset;
}

/** `type` as `source`'s gauge. */
export function qualifyGaugePick(source: GaugeSource, type: GaugeType): QualifiedGaugeType {
  return `${source}:${type}`;
}

/**
 * Gauge auto-shift policies, beatoraja 0.8.9's (`BMSPlayer`), usable under every ruleset (#933): each shifts along the
 * judge ruleset's own gauge ladder (`resolveGaugeShiftLadder`).
 */
export type GaugeAutoShift = 'NONE' | 'CONTINUE' | 'SURVIVAL_TO_GROOVE' | 'BEST_CLEAR' | 'SELECT_TO_UNDER';

/** Every gauge auto-shift policy, in beatoraja's button order. */
export const GAUGE_AUTO_SHIFTS: readonly GaugeAutoShift[] = [
  'NONE',
  'CONTINUE',
  'SURVIVAL_TO_GROOVE',
  'BEST_CLEAR',
  'SELECT_TO_UNDER',
];

/**
 * Whether a play ends when its survival gauge empties. NONE stops the play; every other policy keeps judging to the end:
 * CONTINUE on the emptied gauge, SURVIVAL TO GROOVE on the ruleset's default recovery gauge, BEST CLEAR / SELECT TO
 * UNDER on the parallel gauges of the ruleset's ladder. An omitted policy keeps the host-level `endOnFailure` contract.
 * A single play on plugout's gauges (`singlePlayGaugeSource`) always plays on, as plugout does.
 */
export function resolveGaugeEndOnFailure(
  policy: GaugeAutoShift | undefined,
  fallback = true,
  singlePlayGaugeSource?: string,
): boolean {
  if (policy !== undefined && !GAUGE_AUTO_SHIFTS.includes(policy))
    throw new RangeError(`Unknown gauge auto-shift policy: ${String(policy)}`);
  // plugout plays a single chart to its end on an emptied survival gauge: the gauge stays at 0 and nothing stops the
  // play (`plugout4.exe` 0x43a4f1; the single-play gauge path raises no event, unlike the course gauges').
  if (singlePlayGaugeSource === 'plugout') return false;
  if (policy === undefined) return fallback;
  return policy === 'NONE';
}

/**
 * The lowest gauge BEST CLEAR / SELECT TO UNDER shift to, in ASSIST EASY / EASY / NORMAL order (beatoraja's), spelled in
 * LR2's names like {@link GaugeType}; each ruleset reads it on its own ladder (`resolveGaugeShiftBottomIndex`).
 */
export type GaugeShiftBottom = 'ASSIST-EASY' | 'EASY' | 'GROOVE';
