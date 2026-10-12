import type { BeMusicJson } from '@be-music/json';

/**
 * Returns the chart to hand the shared engine for a chart the host already resolved with `resolveBmsControlFlow`.
 *
 * The resolver pushes every active `#RANDOM` / `#SWITCH` branch into `events` / the headers but keeps
 * `bms.controlFlow` populated on its result. The engine's `manualPlay` / `autoPlay` resolve control flow themselves,
 * so handing them the resolved chart as is would roll every `#RANDOM` a second time and add the newly rolled branch
 * on top of the one already resolved: a different roll plays both branches' notes and keysounds, the same roll
 * doubles them, and the engine's random pattern / play log describe the second roll instead of the branch the
 * decide screen, skin graphs and BGA timeline were built from. Clearing `controlFlow` makes the engine's resolve a
 * plain clone, so the play uses the host's single resolution.
 */
export function toEngineChart(resolvedChart: BeMusicJson): BeMusicJson {
  if (resolvedChart.bms.controlFlow.length === 0) {
    return resolvedChart;
  }
  return { ...resolvedChart, bms: { ...resolvedChart.bms, controlFlow: [] } };
}
