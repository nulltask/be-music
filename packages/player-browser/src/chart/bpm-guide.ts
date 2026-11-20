import type { ScrollTimelinePoint, SpeedTimelinePoint, TimingResolver } from '@be-music/chart-model';

/** What a guide label marks: a BPM change, a STOP, a `#SCROLL` change or a `#SPEED` change. */
export type BPMGuideKind = 'bpm' | 'stop' | 'scroll' | 'speed';

export interface BPMGuideEvent {
  readonly beat: number;
  readonly seconds: number;
  readonly kind: BPMGuideKind;
  readonly text: string;
}

/** Which kinds of guide label to show; each defaults to on for BPM and STOP (beatoraja's guide) and off for the rest. */
export interface BPMGuideKinds {
  readonly bpm: boolean;
  readonly stop: boolean;
  readonly scroll: boolean;
  readonly speed: boolean;
}

/** beatoraja's BPM GUIDE: BPM changes and STOPs, without the `#SCROLL` / `#SPEED` labels Be-Music adds. */
export const DEFAULT_BPM_GUIDE_KINDS: BPMGuideKinds = { bpm: true, stop: true, scroll: false, speed: false };

/**
 * The guide labels of a chart, in beat order. BPM changes and positive STOPs as beatoraja 0.8.9's `LaneRenderer` labels
 * them (`BPM <n>`, `STOP <n>ms`, integers; beatoraja writes `BPM<n>`, Be-Music spaces every label's number alike), and Be-Music's `#SCROLL` / `#SPEED` changes (`SCROLL <x>`, `SPEED <x>`, up to
 * two decimals), each where the value actually changes from the one before (starting from 1).
 */
export function collectBPMGuideEvents(
  timing: TimingResolver,
  scroll: readonly ScrollTimelinePoint[] = [],
  speed: readonly SpeedTimelinePoint[] = [],
): BPMGuideEvent[] {
  const result: BPMGuideEvent[] = [];
  let previousBPM: number | undefined;
  for (const point of timing.tempoPoints) {
    if (previousBPM !== undefined && point.bpm !== previousBPM) {
      result.push({
        beat: point.beat,
        seconds: timing.beatToSeconds(point.beat),
        kind: 'bpm',
        text: `BPM ${Math.trunc(point.bpm)}`,
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
  pushKeyframes(result, timing, scroll, 'scroll', 'SCROLL');
  pushKeyframes(result, timing, speed, 'speed', 'SPEED');
  return result.sort((a, b) => a.beat - b.beat || a.seconds - b.seconds);
}

function pushKeyframes(
  out: BPMGuideEvent[],
  timing: TimingResolver,
  points: readonly { readonly beat: number; readonly speed: number }[],
  kind: 'scroll' | 'speed',
  label: string,
): void {
  let previous = 1;
  for (const point of points) {
    if (!Number.isFinite(point.speed) || point.speed === previous) continue;
    previous = point.speed;
    out.push({
      beat: point.beat,
      seconds: timing.beatToSeconds(point.beat),
      kind,
      text: `${label} ${formatRate(point.speed)}`,
    });
  }
}

/** A rate with up to two decimals and no trailing zeros: `0.5`, `2`, `-1.25`. */
function formatRate(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
