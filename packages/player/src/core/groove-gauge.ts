import type { GaugeType } from '../ruleset/gauge-type.ts';
import type { JudgeKind } from './scoring.ts';

/**
 * The judges the engine moves the gauge with.
 *
 * The gauge model itself — per-judge deltas, TOTAL scaling, guts softening, death borders, the clear rule — belongs
 * entirely to the active compat ruleset (`src/ruleset/definitions.ts`, applied through `RulesetGauge`), and the gauge the
 * player picks is the ruleset vocabulary's `GaugeType` (`src/ruleset/gauge-type.ts`).
 */

/** Judges that move the gauge. `'EMPTY_POOR'` is the input-on-an-empty-lane penalty, which is not a note judgment. */
export type GrooveGaugeJudgeKind = JudgeKind | 'EMPTY_POOR';

/** @deprecated The gauge type is the ruleset vocabulary's `GaugeType` (`@be-music/player/ruleset`). */
export type GrooveGaugeType = GaugeType;
