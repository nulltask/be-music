import type { ChartPlayVariant } from '@be-music/chart-model';
import type { RulesetId } from '../ruleset/index.ts';
import { splitOptionSource, type QualifiedOptionValue } from '../ruleset/option-source.ts';

/**
 * Mutually exclusive source battle/conversion choices.
 *
 * - `AUTO` — opt into BMS PLAYER 2/4 interpretation; never changes an explicit selection.
 * - `COUPLE` — two players keep authored sides, including an empty second side.
 * - `SP-TO-DP` — LR2 SP TO DP (`battle` 3)
 * - `D-BATTLE` — LR2 DOUBLE BATTLE (`battle` 2): one player, the SP chart on both sides
 * - `BATTLE` — beatoraja BATTLE (`doubleoption` 2) and That-Which-Must-Not-Be-Named DP BATTLE. The bare value is the judge
 *   ruleset's own; `beatoraja:BATTLE` and `____:BATTLE` keep their source under every ruleset (ADR 0019)
 * - `BATTLE-AS` — beatoraja BATTLE AS (`doubleoption` 3): BATTLE with both scratches moved to the background
 * - `TWO-PLAYER` — two players on the SP chart, each judged on its own side: LR2 BATTLE (`battle` 1) and
 *   That-Which-Must-Not-Be-Named two-player play. Each player is judged by the judge ruleset's windows and gauges, under
 *   every ruleset (#774)
 */
export type BattleMode =
  | 'AUTO'
  | 'COUPLE'
  | 'OFF'
  | 'SP-TO-DP'
  | 'D-BATTLE'
  | 'BATTLE'
  | QualifiedOptionValue<'BATTLE'>
  | 'BATTLE-AS'
  | 'TWO-PLAYER';

/** Whether `mode` is a BATTLE, bare or source-qualified: one player on both sides. */
export function isOnePlayerBattleMode(mode: string | undefined): boolean {
  return mode !== undefined && splitOptionSource(mode).name === 'BATTLE';
}

/** A resolved execution mode; AUTO is a source selection, never a recorded arrangement. */
export type EffectiveBattleMode = Exclude<BattleMode, 'AUTO'>;

/** The battle modes that copy one SP chart onto both sides. */
export function isDuplicatedBattleMode(mode: BattleMode | undefined, sourceVariant?: ChartPlayVariant): boolean {
  if (mode === 'TWO-PLAYER') return sourceVariant === undefined || sourceVariant === '5' || sourceVariant === '7';
  return mode === 'D-BATTLE' || isOnePlayerBattleMode(mode) || mode === 'BATTLE-AS';
}

/** Resolve source availability before constructing a play; a selection remains in the options snapshot. */
export function resolveEffectiveBattleMode(
  selected: BattleMode,
  ruleset: RulesetId,
  sourceVariant: ChartPlayVariant,
  course: boolean,
  player?: number,
): EffectiveBattleMode {
  // Header interpretation is opt-in: corpus authors commonly use PLAYER 2 for SP/DP/PMS.
  if (selected === 'AUTO')
    selected = ruleset === 'lr2' && !course ? (player === 2 ? 'COUPLE' : player === 4 ? 'TWO-PLAYER' : 'OFF') : 'OFF';
  if (selected === 'COUPLE') {
    if (ruleset !== 'lr2') throw new RangeError('COUPLE is available only for LR2.');
    return !course && ['5', '7', '10', '14'].includes(sourceVariant) ? 'COUPLE' : 'OFF';
  }
  if (selected === 'OFF' || sourceVariant.startsWith('generic-')) return 'OFF';
  // SP TO DP, D-BATTLE (LR2) and BATTLE AS (beatoraja) build a chart and judge nothing themselves, so every judge ruleset
  // offers them (#774), each with its source's chart support.
  if (selected === 'SP-TO-DP' || selected === 'D-BATTLE') {
    // SP TO DP is skipped in a course (isCourse) and LR2 has no keyboard modes; D-BATTLE copies 1x cells at parse
    // time for 5/7KEY sources.
    if (selected === 'SP-TO-DP') return course || sourceVariant === '24' || sourceVariant === '48' ? 'OFF' : selected;
    return sourceVariant === '5' || sourceVariant === '7' ? selected : 'OFF';
  }
  if (selected === 'TWO-PLAYER') {
    // LR2 copies the 1x cells of a 5/7KEY chart for the second player at parse time, and on a 10/14KEY chart each player
    // takes one side (COUPLE); a course plays one player. beatoraja has no two-player play of its own: LR2's BATTLE
    // builds the chart there, and each player is judged by beatoraja's windows and gauges (#774).
    const variants = ruleset === '____' ? ['5', '7'] : ['5', '7', '10', '14'];
    return !course && variants.includes(sourceVariant) ? selected : 'OFF';
  }
  if (selected === 'BATTLE-AS') return ['5', '7', '24'].includes(sourceVariant) ? selected : 'OFF';
  const battle = splitOptionSource(selected);
  if (battle.name === 'BATTLE') {
    // LR2's BATTLE is two-player play (TWO-PLAYER); the one-player copy keeps its beatoraja / That-Which-Must-Not-Be-Named
    // name. A qualified BATTLE builds its source's chart under every ruleset.
    const source = battle.source ?? ruleset;
    if (source === 'lr2') throw new RangeError('LR2 BATTLE is two-player play (TWO-PLAYER).');
    const supported = source === 'beatoraja' ? ['5', '7', '24'] : ['7'];
    return supported.includes(sourceVariant) ? selected : 'OFF';
  }
  throw new RangeError('Unsupported battle mode.');
}
