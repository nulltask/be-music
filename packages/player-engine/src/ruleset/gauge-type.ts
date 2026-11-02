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
 * - `'DEATH'` — starts full and ends the run on the first break; beatoraja calls it `HAZARD`.
 */
export type GaugeType = 'GROOVE' | 'HARD' | 'DEATH' | 'EASY' | 'EX-HARD' | 'ASSIST-EASY' | 'P-ATTACK' | 'G-ATTACK';

/** Every gauge type, in the order LR2's gauge button cycles them (`#SRC_BUTTON,type=40 / 41` cells 0..5). */
export const LR2_GAUGE_TYPES: readonly GaugeType[] = ['GROOVE', 'HARD', 'DEATH', 'EASY', 'P-ATTACK', 'G-ATTACK'];

/** Every accepted gauge pick; source-specific menus use resolveGaugeTypes. */
export const GAUGE_TYPES: readonly GaugeType[] = [...LR2_GAUGE_TYPES, 'EX-HARD', 'ASSIST-EASY'];
const BEATORAJA_GAUGE_TYPES: readonly GaugeType[] = ['GROOVE', 'HARD', 'EX-HARD', 'DEATH', 'EASY', 'ASSIST-EASY'];
const ____GAUGE_TYPES: readonly GaugeType[] = ['GROOVE', 'HARD', 'EX-HARD', 'EASY', 'ASSIST-EASY'];

/** Source menu choices: LR2 has no EX-HARD; the AC menu has no DEATH pick. */
export function resolveGaugeTypes(ruleset: 'lr2' | 'beatoraja' | '____'): readonly GaugeType[] {
  return ruleset === 'lr2' ? LR2_GAUGE_TYPES : ruleset === 'beatoraja' ? BEATORAJA_GAUGE_TYPES : ____GAUGE_TYPES;
}

/** Whether `value` names a gauge type. */
export function isGaugeType(value: unknown): value is GaugeType {
  return typeof value === 'string' && (GAUGE_TYPES as readonly string[]).includes(value);
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
 */
export function resolveGaugeEndOnFailure(policy: GaugeAutoShift | undefined, fallback = true): boolean {
  if (policy === undefined) return fallback;
  if (!GAUGE_AUTO_SHIFTS.includes(policy)) throw new RangeError(`Unknown gauge auto-shift policy: ${String(policy)}`);
  return policy === 'NONE';
}

/**
 * The lowest gauge BEST CLEAR / SELECT TO UNDER shift to, in ASSIST EASY / EASY / NORMAL order (beatoraja's), spelled in
 * LR2's names like {@link GaugeType}; each ruleset reads it on its own ladder (`resolveGaugeShiftBottomIndex`).
 */
export type GaugeShiftBottom = 'ASSIST-EASY' | 'EASY' | 'GROOVE';
