import type { ChartPlayVariant } from '@be-music/chart-model';
import type { RulesetId } from '../ruleset/index.ts';

/** Mutually exclusive source battle/conversion choices. */
export type BattleMode = 'OFF' | 'SP-TO-DP' | 'BATTLE';

/** Resolve source availability before constructing a play; a selection remains in the options snapshot. */
export function resolveEffectiveBattleMode(
  selected: BattleMode,
  ruleset: RulesetId,
  sourceVariant: ChartPlayVariant,
  course: boolean,
): BattleMode {
  if (selected === 'OFF') return 'OFF';
  if (selected === 'SP-TO-DP') {
    if (ruleset !== 'lr2') throw new RangeError('SP TO DP requires LR2 judgment rules.');
    return course ? 'OFF' : selected;
  }
  if (selected === 'BATTLE') {
    if (ruleset === 'lr2')
      throw new RangeError('LR2 BATTLE requires independent player judgments and is not available yet.');
    const supported = ruleset === 'beatoraja' ? ['5', '7', '24'] : ['7'];
    return supported.includes(sourceVariant) ? selected : 'OFF';
  }
  throw new RangeError('Unsupported battle mode.');
}
