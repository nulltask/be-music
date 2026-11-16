import { LRX_TICKS_PER_BEAT } from '@be-music/chart-source';
import type { ResolvedChart } from './resolved-chart.ts';

/** How long plugout plays on after the last sound note of a chart without an end note (0x442799). */
export const LRX_PLAY_END_TAIL_SECONDS = 3;

/**
 * When an LRX chart's play ends, as plugout4 -ARCADE EDITION- sets it while loading the chart (`plugout4.exe`
 * 0x442594..0x442825): at the end-of-song note (`c="309"`, `lrx.endTick`) when the chart has one (0x44268c), else 3 s
 * after the last sound note (`c` 0–199: lane, hidden, chain and BGM notes) starts (0x442790). plugout keeps the time in
 * whole milliseconds, so it is truncated to them. The play ends there whatever is still sounding or showing (0x43f085,
 * 0x43f6b9). `undefined` for a chart that is not LRX.
 */
export function resolveLRXPlayEndSeconds(chart: ResolvedChart): number | undefined {
  if (chart.sourceFormat !== 'lrx') return undefined;
  const endTick = chart.source.lrx?.endTick;
  if (endTick !== undefined) return truncateToMilliseconds(chart.timing.beatToSeconds(endTick / LRX_TICKS_PER_BEAT));
  let last: number | undefined;
  for (const trigger of chart.sampleTriggers)
    last = last === undefined ? trigger.seconds : Math.max(last, trigger.seconds);
  return last === undefined ? 0 : truncateToMilliseconds(last) + LRX_PLAY_END_TAIL_SECONDS;
}

function truncateToMilliseconds(seconds: number): number {
  return Math.trunc(seconds * 1000) / 1000;
}
