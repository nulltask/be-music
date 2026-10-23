import { resolveClearLamp, type ClearLamp } from '../ruleset/clear-lamp.ts';
import type { RulesetId } from '../ruleset/definitions.ts';
import type { ReplayRulesetResult } from './format.ts';

/**
 * The clear lamp of one play's result under `ruleset` (a simulated result, or the engine's own), by the one clear-lamp
 * rule (`resolveClearLamp`): LR2 awards a full combo before checking the gauge; other rulesets require a clear, then
 * the lamp of the gauge it cleared on, kept to the ruleset's own lamps.
 */
export function resolveRulesetResultLamp(
  result: Pick<ReplayRulesetResult, 'judge' | 'noteCount' | 'gauge'>,
  ruleset: RulesetId,
): ClearLamp {
  const { pgreat, great, good } = result.judge;
  return resolveClearLamp({
    ruleset,
    cleared: result.gauge.cleared,
    gauge: result.gauge.type,
    score: { total: result.noteCount, perfect: pgreat, great, good },
  });
}
