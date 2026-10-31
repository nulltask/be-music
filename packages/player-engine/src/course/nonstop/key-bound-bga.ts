import { buildKeyBoundBGATimeline, type KeyBoundBGACue, type ResolvedChart } from '@be-music/chart-model';
import type { NonstopStagePlacement } from './plan.ts';

/** Preserve structured frames: mixed bmson courses can allocate BMP ids longer than the packed BMS grammar. */
export function placeNonstopKeyBoundBGA(
  chart: ResolvedChart,
  placement: NonstopStagePlacement,
  window: { start: number; end: number },
  stage: number,
  bmp: (key: string) => string | undefined,
): KeyBoundBGACue[] | undefined {
  const source = buildKeyBoundBGATimeline(chart.source, chart.timing)
    .filter((cue) => cue.seconds <= (chart.reversal?.seconds ?? Infinity))
    .map((cue) => ({ ...cue, seconds: placement.offsetSeconds + cue.seconds / placement.rate }));
  const start = Math.max(0, window.start);
  let initial: KeyBoundBGACue | undefined;
  for (const cue of source) {
    if (cue.seconds > start) break;
    initial = cue;
  }
  const selected = [
    ...(initial ? [{ ...initial, seconds: start }] : []),
    ...source.filter((cue) => cue.seconds > start && cue.seconds < window.end),
  ];
  const result: KeyBoundBGACue[] = [];
  for (const cue of selected) {
    const frames = cue.definition.frames.map(bmp);
    if (frames.some((key) => key === undefined)) return undefined;
    result.push({
      seconds: cue.seconds,
      ...(placement.rate !== 1 ? { playbackRate: placement.rate } : {}),
      ...(Number.isFinite(window.end) ? { endSeconds: window.end } : {}),
      definitionId: `stage:${stage}:${cue.definitionId}`,
      definition: {
        ...cue.definition,
        frameIntervalMs: cue.definition.frameIntervalMs / placement.rate,
        durationMs: cue.definition.durationMs / placement.rate,
        argb: { ...cue.definition.argb },
        frames: frames as string[],
      },
    });
  }
  return result;
}
