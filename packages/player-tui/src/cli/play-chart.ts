import { drawRandomOutcomes, type RandomDraws } from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';
import { resolveBmsControlFlowWithDraws } from '@be-music/parser';

/** A chart resolved for one play, with the `#RANDOM` / `#SWITCH` draws it was resolved with. */
export interface ResolvedPlayChart {
  json: BeMusicJson;
  randomDraws: RandomDraws;
}

/**
 * Draws `source`'s `#RANDOM` / `#SWITCH` outcomes once and resolves the chart with them. The CLI hands both to the
 * gameplay worker (and the preview renderer), so the engine plays this resolution and its RANDOM summary names it.
 */
export function resolvePlayChart(source: BeMusicJson, random: () => number = Math.random): ResolvedPlayChart {
  const randomDraws = drawRandomOutcomes(source, random);
  return { json: resolveBmsControlFlowWithDraws(source, randomDraws), randomDraws };
}
