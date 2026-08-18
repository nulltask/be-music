import type { JudgeKind } from './scoring.ts';

/**
 * Gauge vocabulary shared between the host UI and the engine.
 *
 * The gauge model itself — per-judge deltas, TOTAL scaling, guts softening, death borders, the clear rule — belongs
 * entirely to the active compat ruleset (`src/ruleset/definitions.ts`, applied through `RulesetGauge`). This module
 * keeps only the two names hosts speak in: which judges move the gauge, and which gauge the player picked.
 */

/** Judges that move the gauge. `'EMPTY_POOR'` is the input-on-an-empty-lane penalty, which is not a note judgment. */
export type GrooveGaugeJudgeKind = JudgeKind | 'EMPTY_POOR';

/**
 * The gauge the player picked, spelled in LR2's names because that is what the skins' `#SRC_BUTTON,type=40 / 41`
 * cycling exposes. Each ruleset maps these onto its own line-up (`resolveRulesetGaugeId`):
 *
 * - `'GROOVE'` — the default recovery gauge; beatoraja and IIDX call the same one `NORMAL`.
 * - `'EASY'` — gentler recovery with a lower clear threshold.
 * - `'HARD'` — starts full, drains on misses, fails at the ruleset's death border.
 * - `'DEATH'` — starts full and ends the run on the first break; beatoraja calls it `HAZARD`.
 */
export type GrooveGaugeType = 'GROOVE' | 'HARD' | 'DEATH' | 'EASY';
