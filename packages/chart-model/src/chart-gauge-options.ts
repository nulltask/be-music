import type { ChartOptionTimeline } from './chart-options.ts';

/**
 * Chart-authored gauge options (#845): nanasigroove's `774:GAMELEVEL_*` (the stage's clear / fail conditions) and
 * `774:EXTRA_*` (how fast that gauge rises and falls). The source makes them initial-only. A ruleset maps the pair onto
 * one of its own gauges (`resolveChartGaugeType` in `@be-music/player-engine/ruleset`,
 * docs/adr/0034-chart-authored-gauge-options.md).
 */

export const CHART_GAME_LEVELS = ['BEGINNER', 'NORMAL', 'HYPER', 'DANGER'] as const;
export type ChartGameLevel = (typeof CHART_GAME_LEVELS)[number];
export const CHART_GAUGE_EXTRAS = ['EASY', 'HARD', 'VERYHARD'] as const;
export type ChartGaugeExtra = (typeof CHART_GAUGE_EXTRAS)[number];

/** The chart's gauge choice; empty when it makes none. */
export interface ChartGaugeOptions {
  gameLevel?: ChartGameLevel;
  /** Absent for `EXTRA_OFF` or none. */
  extra?: ChartGaugeExtra;
}

type Patch = (options: ChartGaugeOptions) => ChartGaugeOptions;

/** How one exact-case modern declaration changes the gauge options, or `undefined` when it is not one of these. */
export function parseChartGaugeOption(declaration: string): Patch | undefined {
  const level = /^774:GAMELEVEL_(.+)$/.exec(declaration)?.[1];
  if (level !== undefined)
    return (CHART_GAME_LEVELS as readonly string[]).includes(level)
      ? (options) => ({ ...options, gameLevel: level as ChartGameLevel })
      : undefined;
  const extra = /^774:EXTRA_(.+)$/.exec(declaration)?.[1];
  if (extra === undefined) return undefined;
  if (extra === 'OFF')
    return (options) => {
      const next = { ...options };
      delete next.extra;
      return next;
    };
  return (CHART_GAUGE_EXTRAS as readonly string[]).includes(extra)
    ? (options) => ({ ...options, extra: extra as ChartGaugeExtra })
    : undefined;
}

/** True for a declaration this module consumes (so the display compiler does not diagnose it as unsupported). */
export function isChartGaugeOptionDeclaration(declaration: string): boolean {
  return parseChartGaugeOption(declaration) !== undefined;
}

/** Compile the initial gauge declarations in source order, the later one winning within GAMELEVEL and within EXTRA. */
export function compileChartGaugeOptions(timeline: Pick<ChartOptionTimeline, 'initial'>): ChartGaugeOptions {
  let options: ChartGaugeOptions = {};
  for (const declaration of timeline.initial) {
    const patch = parseChartGaugeOption(declaration);
    if (patch !== undefined) options = patch(options);
  }
  return options;
}
