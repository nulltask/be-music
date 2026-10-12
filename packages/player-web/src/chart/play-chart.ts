import type { BeMusicJson } from '@be-music/json';
import { resolveBmsControlFlow } from '@be-music/parser';

export interface ResolvePlayChartOptions {
  /** Random source for the `#RANDOM` / `#SWITCH` draws. Defaults to `Math.random`. */
  random?: () => number;
  /**
   * Values to use for the `#RANDOM` / `#SWITCH` lines, in file order — e.g. a play log's `play.randomOutcomes`, to
   * play the branches a recorded run played. A missing or out-of-range entry is drawn from `random`.
   */
  outcomes?: ReadonlyArray<number>;
}

/** A chart resolved for one play, together with the values its `#RANDOM` / `#SWITCH` lines were resolved with. */
export interface ResolvedPlayChart {
  /** The chart with the chosen branches applied (the `resolveBmsControlFlow` result). */
  chart: BeMusicJson;
  /**
   * Value of every `#RANDOM` / `#SWITCH` line in file order (empty without control flow) — the play log's
   * `play.randomOutcomes`. `resolveBmsControlFlow(source, { outcomes: randomOutcomes })` rebuilds `chart`.
   */
  randomOutcomes: number[];
}

/**
 * Resolves `#RANDOM` / `#SETRANDOM` / `#SWITCH` control flow once for a play and keeps the drawn values with the
 * result, so the chart a scene plays and the outcomes its play log records come from the same resolution.
 */
export function resolvePlayChart(chart: BeMusicJson, options: ResolvePlayChartOptions = {}): ResolvedPlayChart {
  const randomOutcomes: number[] = [];
  const resolved = resolveBmsControlFlow(chart, {
    random: options.random ?? Math.random,
    ...(options.outcomes !== undefined ? { outcomes: options.outcomes } : {}),
    onOutcome: (value) => randomOutcomes.push(value),
  });
  return { chart: resolved, randomOutcomes };
}
