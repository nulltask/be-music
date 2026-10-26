import type { ChartPlayVariant } from '@be-music/chart-model';
import type { RulesetId } from '../ruleset/index.ts';

/**
 * Mutually exclusive source battle/conversion choices.
 *
 * - `SP-TO-DP` — LR2 SP TO DP (`battle` 3)
 * - `D-BATTLE` — LR2 DOUBLE BATTLE (`battle` 2): one player, the SP chart on both sides
 * - `BATTLE` — beatoraja BATTLE (`doubleoption` 2) and That-Which-Must-Not-Be-Named DP BATTLE
 * - `BATTLE-AS` — beatoraja BATTLE AS (`doubleoption` 3): BATTLE with both scratches moved to the background
 * - `TWO-PLAYER` — two players on the SP chart, each judged on its own side: LR2 BATTLE (`battle` 1) and
 *   That-Which-Must-Not-Be-Named two-player play
 */
export type BattleMode = 'OFF' | 'SP-TO-DP' | 'D-BATTLE' | 'BATTLE' | 'BATTLE-AS' | 'TWO-PLAYER';

/** The battle modes that copy one SP chart onto both sides. */
export function isDuplicatedBattleMode(mode: BattleMode | undefined, sourceVariant?: ChartPlayVariant): boolean {
  if (mode === 'TWO-PLAYER') return sourceVariant === undefined || sourceVariant === '5' || sourceVariant === '7';
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
  // SP TO DP, D-BATTLE (LR2) and BATTLE AS (beatoraja) build a chart and judge nothing themselves, so every judge ruleset
  // offers them (#774), each with its source's chart support.
  if (selected === 'SP-TO-DP' || selected === 'D-BATTLE') {
    // SP TO DP is skipped in a course (isCourse) and LR2 has no keyboard modes; D-BATTLE copies 1x cells at parse
    // time for 5/7KEY sources.
    if (selected === 'SP-TO-DP') return course || sourceVariant === '24' || sourceVariant === '48' ? 'OFF' : selected;
    return sourceVariant === '5' || sourceVariant === '7' ? selected : 'OFF';
  }
  if (selected === 'TWO-PLAYER') {
    if (ruleset === 'beatoraja') throw new RangeError('beatoraja has no two-player play.');
    // LR2 copies the 1x cells of a 5/7KEY chart for the second player at parse time, and on a 10/14KEY chart each player
    // takes one side (COUPLE); a course plays one player.
    const variants = ruleset === 'lr2' ? ['5', '7', '10', '14'] : ['5', '7'];
    return !course && variants.includes(sourceVariant) ? selected : 'OFF';
  }
  if (selected === 'BATTLE-AS') return ['5', '7', '24'].includes(sourceVariant) ? selected : 'OFF';
  if (selected === 'BATTLE') {
    // LR2's BATTLE is two-player play (TWO-PLAYER); the one-player copy keeps its beatoraja / That-Which-Must-Not-Be-Named name.
    if (ruleset === 'lr2') throw new RangeError('LR2 BATTLE is two-player play (TWO-PLAYER).');
    const supported = ruleset === 'beatoraja' ? ['5', '7', '24'] : ['7'];
    return supported.includes(sourceVariant) ? selected : 'OFF';
  }
  throw new RangeError('Unsupported battle mode.');
}
