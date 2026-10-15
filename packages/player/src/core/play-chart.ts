import { drawRandomOutcomes, resolveChart, type ResolvedChart } from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';
import { resolveBmsControlFlowWithDraws } from '@be-music/parser';
import { rulesetChartFactsFromChart, type RulesetChartFacts } from '../ruleset/index.ts';
import { preparePlaybackChart } from './bootstrap.ts';
import type { PlayerOptions, ResolvedPlayChart, ResolvePlayChartOptions } from './engine-types.ts';

/*
 * The chart-side steps of a play, apart from the engine's audio and UI start-up so that runtime-neutral consumers (a
 * play-log verifier on a server) can rebuild the chart a play was played on without loading the driver.
 */

/**
 * The hosts' single control-flow step: draws `source`'s `#RANDOM` / `#SWITCH` outcomes once (or takes
 * `options.randomDraws`) and resolves the chart with them. Every consumer of the play — the scene, the engine, the
 * result screen, the play log — then works from the returned chart and draws, so nothing rolls `#RANDOM` again.
 */
export function resolvePlayChart(source: BeMusicJson, options: ResolvePlayChartOptions = {}): ResolvedPlayChart {
  const randomDraws = options.randomDraws ?? drawRandomOutcomes(source, options.random ?? Math.random);
  return { chart: resolveBmsControlFlowWithDraws(source, randomDraws), randomDraws };
}

/**
 * The engine's Resolved layer for a play: `resolveChart` over the control-flow-resolved chart, with the host's lane mode
 * inputs and long-note inference. Timing, triggers, timelines and chart facts all come from it.
 */
export function resolveEngineChart(resolvedJson: BeMusicJson, options: PlayerOptions): ResolvedChart {
  return resolveChart(resolvedJson, {
    randomDraws: options.randomDraws,
    chartPath: options.laneModeExtension,
    playVariant: options.playVariant,
    inferBmsLnTypeWhenMissing: Boolean(options.inferBmsLnTypeWhenMissing),
  });
}

/**
 * The ruleset facts of a chart a host has not played: what a course result needs to count the notes of a stage the
 * run never reached. `#RANDOM` / `#SWITCH` take their first branch, so the count is the same every time.
 */
export function resolveChartRulesetFacts(
  json: BeMusicJson,
  options: Pick<PlayerOptions, 'laneModeExtension' | 'playVariant' | 'inferBmsLnTypeWhenMissing'> = {},
): RulesetChartFacts {
  const { chart, randomDraws } = resolvePlayChart(json, { random: () => 0 });
  const resolved = resolveEngineChart(chart, { ...options, randomDraws });
  return rulesetChartFactsFromChart(chart, preparePlaybackChart(resolved, options));
}
