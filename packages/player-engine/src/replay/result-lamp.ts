import { resolveClearLamp, resolveMissCount, type ClearLamp } from '../ruleset/clear-lamp.ts';
import type { RulesetId } from '../ruleset/definitions.ts';
import type { ReplayRulesetResult } from './format.ts';

/**
 * The clear lamp of one play's result under `ruleset` (a simulated result, or the engine's own), by the one clear-lamp
 * rule (`resolveClearLamp`): LR2 awards a full combo before checking the gauge; other rulesets require a clear, then
 * the lamp of the gauge it cleared on, kept to the ruleset's own lamps.
 */
export function resolveRulesetResultLamp(
  result: Pick<ReplayRulesetResult, 'judge' | 'noteCount' | 'gauge' | 'fullCombo'>,
  ruleset: RulesetId,
): ClearLamp {
  const { pgreat, great, good } = result.judge;
  return resolveClearLamp({
    ruleset,
    cleared: result.gauge.cleared,
    gauge: result.gauge.type,
    score: {
      total: result.noteCount,
      perfect: pgreat,
      great,
      good,
      ...(result.fullCombo !== undefined ? { fullCombo: result.fullCombo } : {}),
    },
  });
}

/**
 * The BP of one play's result (or one course stage's) under any ruleset (`resolveMissCount`): its BADs, POORs and empty
 * POORs, plus the notes a play that failed or was given up mid-way never judged, as LR2 and beatoraja count them
 * (OpenLR2 L9436-L9439, beatoraja `BMSPlayer` L915). A mine POOR (`minePoor`, which LR2 counts in its POOR) judges no
 * note.
 */
export function resolveRulesetResultMissCount(
  result: Pick<ReplayRulesetResult, 'judge' | 'noteCount' | 'minePoor'>,
): number {
  const { pgreat, great, good, bad, poor } = result.judge;
  const judged = pgreat + great + good + bad + poor - (result.minePoor ?? 0);
  return resolveMissCount(result.judge, result.noteCount - judged);
}
