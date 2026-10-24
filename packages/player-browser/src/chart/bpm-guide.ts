import type { TimingResolver } from '@be-music/chart-model';

export interface BPMGuideEvent {
  readonly beat: number;
  readonly seconds: number;
  readonly kind: 'bpm' | 'stop';
  readonly text: string;
}

/** beatoraja 0.8.9 LaneRenderer: actual BPM changes and positive STOPs, with integer labels. */
export function collectBPMGuideEvents(timing: TimingResolver): BPMGuideEvent[] {
  const result: BPMGuideEvent[] = [];
  let previousBPM: number | undefined;
  for (const point of timing.tempoPoints) {
    if (previousBPM !== undefined && point.bpm !== previousBPM) {
      result.push({
        beat: point.beat,
        seconds: timing.beatToSeconds(point.beat),
        kind: 'bpm',
        text: `BPM${Math.trunc(point.bpm)}`,
      });
    }
    previousBPM = point.bpm;
  }
  for (const point of timing.stopPoints) {
    if (point.seconds > 0)
      result.push({
        beat: point.beat,
        seconds: timing.beatToSeconds(point.beat),
        kind: 'stop',
        text: `STOP ${Math.trunc(point.seconds * 1000)}ms`,
      });
  }
  return result.sort((a, b) => a.beat - b.beat || a.seconds - b.seconds);
}
