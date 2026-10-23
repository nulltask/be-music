/**
 * The gauge the player picks, spelled in LR2's names because that is what the skins' `#SRC_BUTTON,type=40 / 41`
 * cycling exposes. Each judge ruleset plays it on a gauge of its own line-up, its gauge id (`resolveRuleset`; a course
 * stage's by `resolveCourseGaugeId`):
 *
 * - `'GROOVE'` — the default recovery gauge; beatoraja and That-Which-Must-Not-Be-Named call the same one `NORMAL`.
 * - `'EASY'` — gentler recovery with a lower clear threshold.
 * - `'HARD'` — starts full, drains on misses, fails at the ruleset's death border.
 * - `'DEATH'` — starts full and ends the run on the first break; beatoraja calls it `HAZARD`.
 */
export type GaugeType = 'GROOVE' | 'HARD' | 'DEATH' | 'EASY';

/** Every gauge type, in the order LR2's gauge button cycles them (`#SRC_BUTTON,type=40 / 41` cells 0..3). */
export const GAUGE_TYPES: readonly GaugeType[] = ['GROOVE', 'HARD', 'DEATH', 'EASY'];

/** Whether `value` names a gauge type. */
export function isGaugeType(value: unknown): value is GaugeType {
  return typeof value === 'string' && (GAUGE_TYPES as readonly string[]).includes(value);
}
