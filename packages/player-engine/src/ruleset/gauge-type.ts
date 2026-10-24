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
 * - `'DEATH'` — starts full and ends the run on the first break; beatoraja calls it `HAZARD`.
 */
export type GaugeType = 'GROOVE' | 'HARD' | 'DEATH' | 'EASY' | 'EX-HARD' | 'ASSIST-EASY';

/** Every gauge type, in the order LR2's gauge button cycles them (`#SRC_BUTTON,type=40 / 41` cells 0..3). */
export const LR2_GAUGE_TYPES: readonly GaugeType[] = ['GROOVE', 'HARD', 'DEATH', 'EASY'];

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

/** beatoraja 0.8.9 gauge auto-shift policies implemented by the player. */
export type GaugeAutoShift = 'NONE' | 'CONTINUE';

/**
 * CONTINUE retains the selected dead gauge and keeps judging; NONE stops the play.
 * An omitted policy preserves the older host-level endOnFailure contract.
 */
export function resolveGaugeEndOnFailure(
  policy: GaugeAutoShift | undefined,
  ruleset: 'lr2' | 'beatoraja' | '____',
  fallback = true,
): boolean {
  if (policy === undefined) return fallback;
  if (policy === 'NONE') return true;
  if (policy !== 'CONTINUE' || ruleset !== 'beatoraja')
    throw new RangeError('Gauge auto-shift CONTINUE is available only for beatoraja.');
  return false;
}
