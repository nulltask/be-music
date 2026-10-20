import { drawRandomOutcomes, resolveChart, type ResolvedChart } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import { resolveBMSControlFlowWithDraws } from '@be-music/chart-parser';
import { rulesetChartFactsFromChart, type RulesetChartFacts } from '../ruleset/index.ts';
import { preparePlaybackChart } from './bootstrap.ts';
import type { PlayerOptions, ResolvedPlayChart, ResolvePlayChartOptions } from './engine-types.ts';

/*
 * The chart-side steps of a play, apart from the engine's audio and UI start-up so that runtime-neutral consumers (a
 * replay verifier on a server) can rebuild the chart a play was played on without loading the driver.
 */

/**
 * The hosts' single control-flow step: draws `source`'s `#RANDOM` / `#SWITCH` outcomes once (or takes
 * `options.randomDraws`) and resolves the chart with them. Every consumer of the play — the scene, the engine, the
 * result screen, the replay — then works from the returned chart and draws, so nothing rolls `#RANDOM` again.
 */
export function resolvePlayChart(source: BeMusicJSON, options: ResolvePlayChartOptions = {}): ResolvedPlayChart {
  const randomDraws = options.randomDraws ?? drawRandomOutcomes(source, options.random ?? Math.random);
  return { chart: resolveBMSControlFlowWithDraws(source, randomDraws), randomDraws };
}

/**
 * The engine's Resolved layer for a play: `resolveChart` over the control-flow-resolved chart, with the host's lane mode
 * inputs and long-note inference. Timing, triggers, timelines and chart facts all come from it.
 */
export function resolveEngineChart(resolvedJSON: BeMusicJSON, options: PlayerOptions): ResolvedChart {
  return resolveChart(resolvedJSON, {
    randomDraws: options.randomDraws,
    chartPath: options.laneModeExtension,
    playVariant: options.playVariant,
    inferBmsLNTypeWhenMissing: Boolean(options.inferBmsLNTypeWhenMissing),
  });
}

/**
 * The ruleset facts of a chart a host has not played: what a course result needs to count the notes of a stage the
 * run never reached. `#RANDOM` / `#SWITCH` take their first branch, so the count is the same every time.
 */
export function resolveChartRulesetFacts(
  json: BeMusicJSON,
  options: Pick<PlayerOptions, 'laneModeExtension' | 'playVariant' | 'inferBmsLNTypeWhenMissing'> = {},
): RulesetChartFacts {
  const { chart, randomDraws } = resolvePlayChart(json, { random: () => 0 });
  const resolved = resolveEngineChart(chart, { ...options, randomDraws });
  return rulesetChartFactsFromChart(chart, preparePlaybackChart(resolved, options));
}
