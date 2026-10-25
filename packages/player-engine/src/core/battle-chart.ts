import { getPlayModeLayouts, PLAY_MODE_LAYOUTS, type ResolvedChart } from '@be-music/chart-model';
import type { TimedPlayableNote, TimedLandmineNote } from '../playable-notes.ts';
import { withChartOverrides } from './resolved-chart-overrides.ts';

const BATTLE_PLAY_VARIANTS = { '5': '10', '7': '14', '24': '48' } as const;

/**
 * Source single-player DP BATTLE, after scroll/LN/mine/EXTRA and before lane random.
 * Each copied note has its own mutable state and event identity, including a paired LN.
 * Its 2P source channel identifies that copy independently in arrangement replays.
 * Background triggers, timing, TOTAL and source control-flow draws are shared once.
 */
export function duplicateBattleChart(
  source: ResolvedChart,
  notes: TimedPlayableNote[],
  mines: TimedLandmineNote[],
  invisible: TimedPlayableNote[],
): { chart: ResolvedChart; changedObjectCount: number } {
  const sourceVariant = source.playVariant;
  if (sourceVariant !== '5' && sourceVariant !== '7' && sourceVariant !== '24')
    throw new RangeError('DP BATTLE requires a 5KEY, 7KEY or 24KEY source chart.');
  const playVariant = BATTLE_PLAY_VARIANTS[sourceVariant];
  // Ignore decoder-inaccessible source cells (#17 in 7KEY is not a beatoraja lane).
  const allowed = new Set(PLAY_MODE_LAYOUTS[sourceVariant].lanes.map((lane) => lane.channel));
  let changedObjectCount = 0;
  for (const objects of [notes, mines, invisible]) {
    for (let index = objects.length - 1; index >= 0; index--)
      if (!allowed.has(objects[index]!.channel)) objects.splice(index, 1);
    for (const original of [...objects]) {
      const copied = {
        ...original,
        channel: `2${original.channel.slice(1)}`,
        event: {
          ...original.event,
          position: [...original.event.position] as [number, number],
          channel: `${original.event.channel[0] === 'D' ? 'E' : original.event.channel[0] === '3' ? '4' : original.event.channel[0] === '5' ? '6' : '2'}${original.event.channel.slice(1)}`,
        },
      };
      // Both array element types have the same runtime fields; each array keeps its own note kind.
      objects.push(copied as TimedPlayableNote & TimedLandmineNote);
      changedObjectCount++;
    }
    objects.sort((a, b) => a.seconds - b.seconds || a.channel.localeCompare(b.channel));
  }
  return {
    chart: withChartOverrides(source, { playVariant, layouts: getPlayModeLayouts(playVariant) }),
    changedObjectCount,
  };
}
