import type { ChartPlayVariant } from '@be-music/chart-model';
import type { RulesetId } from '../ruleset/index.ts';

/**
 * Mutually exclusive source battle/conversion choices.
 *
 * - `SP-TO-DP` — LR2 SP TO DP (`battle` 3)
 * - `D-BATTLE` — LR2 DOUBLE BATTLE (`battle` 2): one player, the SP chart on both sides
 * - `BATTLE` — beatoraja BATTLE (`doubleoption` 2) and That-Which-Must-Not-Be-Named DP BATTLE
 * - `BATTLE-AS` — beatoraja BATTLE AS (`doubleoption` 3): BATTLE with both scratches moved to the background
 *
 * LR2's two-player BATTLE (`battle` 1) needs independent player judgments and is not offered.
 */
export type BattleMode = 'OFF' | 'SP-TO-DP' | 'D-BATTLE' | 'BATTLE' | 'BATTLE-AS';

/** The battle modes that copy one SP chart onto both sides. */
export function isDuplicatedBattleMode(mode: BattleMode | undefined): boolean {
  return mode === 'D-BATTLE' || mode === 'BATTLE' || mode === 'BATTLE-AS';
}

/** Resolve source availability before constructing a play; a selection remains in the options snapshot. */
export function resolveEffectiveBattleMode(
  selected: BattleMode,
  ruleset: RulesetId,
  sourceVariant: ChartPlayVariant,
  course: boolean,
): BattleMode {
  if (selected === 'OFF') return 'OFF';
  if (selected === 'SP-TO-DP' || selected === 'D-BATTLE') {
    if (ruleset !== 'lr2') throw new RangeError(`${selected} requires LR2 judgment rules.`);
    // SP TO DP is skipped in a course (isCourse); D-BATTLE copies 1x cells at parse time for 5/7KEY sources.
    if (selected === 'SP-TO-DP') return course ? 'OFF' : selected;
    return sourceVariant === '5' || sourceVariant === '7' ? selected : 'OFF';
  }
  if (selected === 'BATTLE' || selected === 'BATTLE-AS') {
    if (ruleset === 'lr2')
      throw new RangeError('LR2 BATTLE requires independent player judgments and is not available.');
    if (selected === 'BATTLE-AS' && ruleset !== 'beatoraja')
      throw new RangeError('BATTLE AS requires beatoraja judgment rules.');
    const supported = ruleset === 'beatoraja' ? ['5', '7', '24'] : ['7'];
    return supported.includes(sourceVariant) ? selected : 'OFF';
  }
  throw new RangeError('Unsupported battle mode.');
}
