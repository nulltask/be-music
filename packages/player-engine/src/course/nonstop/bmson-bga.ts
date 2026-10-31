import { buildBmsonBGAEventTimeline, type BmsonBGAEventCue, type ResolvedChart } from '@be-music/chart-model';
import type { NonstopStagePlacement } from './plan.ts';

/** Place resolved image references and authored animation time on the course clock. */
export function placeNonstopBmsonBGA(
  chart: ResolvedChart,
  placement: NonstopStagePlacement,
  window: { start: number; end: number },
  stage: number,
  bmp: (key: string) => string | undefined,
): BmsonBGAEventCue[] | undefined {
  const place = (seconds: number) => placement.offsetSeconds + seconds / placement.rate;
  const source = buildBmsonBGAEventTimeline(chart.source, chart.timing, { includeOrdinaryLayerClears: true })
    .filter((cue) => cue.seconds <= (chart.reversal?.seconds ?? Infinity))
    .map((cue) => ({ ...cue, seconds: place(cue.seconds) }));
  const start = Math.max(0, window.start);
  let initial: BmsonBGAEventCue | undefined;
  for (const cue of source) {
    if (cue.seconds > start) break;
    initial = cue;
  }
  const clear: BmsonBGAEventCue = { seconds: start, plane: 'layer', condition: 'always', interval: 0, sequences: [] };
  const selected = [initial ?? clear, ...source.filter((cue) => cue.seconds > start && cue.seconds < window.end)];
  const result: BmsonBGAEventCue[] = [];
  for (const cue of selected) {
    let failed = false;
    const sequences = cue.sequences.map((sequence) => ({
      ...sequence,
      frames: sequence.frames.map((frame) => {
        const key = frame.key === undefined ? undefined : bmp(frame.key);
        if (frame.key !== undefined && key === undefined) failed = true;
        return {
          ...frame,
          elapsedSeconds: frame.elapsedSeconds / placement.rate,
          ...(key !== undefined ? { key } : {}),
        };
      }),
    }));
    if (failed) return undefined;
    result.push({
      ...cue,
      seconds: Math.max(start, cue.seconds),
      animationStartSeconds: cue.seconds,
      interval: cue.interval / placement.rate,
      sequences,
      stage,
      playbackRate: placement.rate,
      ...(Number.isFinite(window.end) ? { endSeconds: window.end } : {}),
      ...(chart.reversal ? { freezeSeconds: place(chart.reversal.seconds) } : {}),
    });
  }
  return result;
}
