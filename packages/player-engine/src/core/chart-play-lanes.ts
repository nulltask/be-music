import {
  PLAY_MODE_LAYOUTS,
  type ChartPlayVariant,
  type ChartRandomOption,
  type PlayModeLayoutId,
} from '@be-music/chart-model';
import { drawLaneRandomIndex } from '../lane-random-source.ts';
import { resolveLaneOptionChannels, type ChannelLike } from './lane-layout.ts';

/**
 * A chart's forced arrangement (`774:RANDOM_*`, #844) for a host without lane options of its own: the engine's own
 * chart preparation, which the terminal plays through (#932). The browser runs its ALL / ALL+ on a double-play chart
 * here too (#1245), and maps the others onto its lane options (`applyChartPlayOptions`). The domains are:
 *
 * - `MIRROR`: each side's keys reversed.
 * - `RANDOM`: each side's keys permuted; `RANDOM+` with the side's scratch lanes too (keys only where there are none).
 * - `ALL` / `ALL+` on a double-play chart: one permutation of both sides' keys, with `ALL+` both sides' scratch lanes too;
 *   on a single-play chart they are `RANDOM` / `RANDOM+`.
 *
 * A permutation is drawn uniformly, target by target (as beatoraja's lane shuffle draws it), from `random`, under every
 * judge ruleset: nanasigroove's catalog gives no algorithm, so this is Be-Music's reading, and no LR2 or beatoraja lane
 * option runs it. Mines and invisible objects move with the notes of their lane. Changes `channel` in place.
 */
export function arrangeChartPlayLanes(
  objects: ReadonlyArray<Array<{ channel: string }>>,
  arrangement: ChartRandomOption,
  playVariant: ChartPlayVariant,
  random: () => number,
  channels: ReadonlyArray<ChannelLike> = objects[0] ?? [],
): void {
  if (playVariant.startsWith('generic-')) return;
  const keys = (side: '1P' | '2P') => resolveLaneOptionChannels(side, playVariant, channels);
  const scratch = (side: '1P' | '2P'): string[] =>
    playVariant === '9'
      ? []
      : PLAY_MODE_LAYOUTS[playVariant as PlayModeLayoutId].lanes
          .filter((lane) => lane.side === side && lane.kind !== 'key')
          .map((lane) => lane.channel);
  const doublePlay = playVariant === '10' || playVariant === '14' || playVariant === '48';
  const withScratch = arrangement === 'RANDOM+' || arrangement === 'ALL+';
  const domains: string[][] =
    doublePlay && (arrangement === 'ALL' || arrangement === 'ALL+')
      ? [[...keys('1P'), ...keys('2P'), ...(withScratch ? [...scratch('1P'), ...scratch('2P')] : [])]]
      : (['1P', '2P'] as const).map((side) => [...keys(side), ...(withScratch ? scratch(side) : [])]);
  const map = new Map<string, string>();
  for (const domain of domains) {
    if (domain.length < 2) continue;
    if (arrangement === 'MIRROR') {
      domain.forEach((lane, index) => map.set(lane, domain[domain.length - 1 - index]!));
      continue;
    }
    const available = [...domain];
    for (const target of domain)
      map.set(available.splice(drawLaneRandomIndex(available.length, random), 1)[0]!, target);
  }
  for (const array of objects) for (const object of array) object.channel = map.get(object.channel) ?? object.channel;
}
