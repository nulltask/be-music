/**
 * Browser-friendly copies of the chart-timing helpers that
 * `packages/player`'s `core/timeline.ts` exposes.
 *
 * Why this lives here: `core/timeline.ts` imports from
 * `@be-music/audio-renderer` (root entry), which the
 * `player-web-demo` Vite config intentionally excludes from the
 * browser build because it pulls in Node-only audio code. The
 * subpath `@be-music/audio-renderer/triggers` is browser-safe and
 * exports the only audio-renderer types we actually need
 * (`TimingResolver`), so we reach for it directly here and
 * re-implement the small chart-timing helpers locally.
 *
 * Functional behaviour mirrors `core/timeline.ts` 1-for-1; if that
 * file's spec changes the corresponding helper here should follow.
 */
import { isScrollChannel, sortEvents, type BeatResolver } from '@be-music/chart';
import { normalizeChannel, normalizeObjectKey, type BeMusicJson } from '@be-music/json';
import type { TimingResolver } from '@be-music/audio-renderer/triggers';

export interface ScrollTimelinePoint {
  beat: number;
  speed: number;
}

export interface SpeedTimelinePoint {
  beat: number;
  speed: number;
}

export interface StopBeatWindow {
  beat: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

/**
 * Builds a `#SCROLL` timeline from the chart's `scroll` map and
 * scroll-channel events. Returns `[]` when no `#SCROLL` declarations
 * exist (lets the gameplay view skip the scroll-distance integrator
 * entirely on the common case).
 */
export function createScrollTimeline(json: BeMusicJson, beatResolver: BeatResolver): ScrollTimelinePoint[] {
  const timeline: ScrollTimelinePoint[] = [];
  const scrollMap = json.bms.scroll;
  if (Object.keys(scrollMap).length === 0) {
    return timeline;
  }
  for (const event of sortEvents(json.events)) {
    if (!isScrollChannel(event.channel)) continue;
    const key = normalizeObjectKey(event.value);
    if (!Object.hasOwn(scrollMap, key)) continue;
    const speed = scrollMap[key];
    if (typeof speed !== 'number' || !Number.isFinite(speed)) continue;
    const beat = beatResolver.eventToBeat(event);
    if (!Number.isFinite(beat) || beat < 0) continue;
    timeline.push({ beat, speed });
  }
  return timeline;
}

/**
 * Builds a `#SPEED` timeline from the chart's `speed` map and the
 * `SP` channel events. Returns `[]` when no `#SPEED` declarations
 * exist.
 */
export function createSpeedTimeline(json: BeMusicJson, beatResolver: BeatResolver): SpeedTimelinePoint[] {
  const timeline: SpeedTimelinePoint[] = [];
  const speedMap = json.bms.speed;
  if (Object.keys(speedMap).length === 0) {
    return timeline;
  }
  for (const event of sortEvents(json.events)) {
    if (normalizeChannel(event.channel) !== 'SP') continue;
    const key = normalizeObjectKey(event.value);
    if (!Object.hasOwn(speedMap, key)) continue;
    const speed = speedMap[key];
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0) continue;
    const beat = beatResolver.eventToBeat(event);
    if (!Number.isFinite(beat) || beat < 0) continue;
    timeline.push({ beat, speed });
  }
  return timeline;
}

/**
 * Collapses the resolver's STOP points into time-window
 * descriptors. Multiple STOPs at the same beat are summed.
 */
export function createStopBeatWindows(resolver: TimingResolver): StopBeatWindow[] {
  const durationByBeat = new Map<number, number>();
  for (const point of resolver.stopPoints) {
    const current = durationByBeat.get(point.beat) ?? 0;
    durationByBeat.set(point.beat, current + point.seconds);
  }
  return [...durationByBeat.entries()]
    .sort(([leftBeat], [rightBeat]) => leftBeat - rightBeat)
    .map(([beat, durationSeconds]) => {
      const startSeconds = resolver.beatToSeconds(beat);
      return {
        beat,
        startSeconds,
        endSeconds: startSeconds + durationSeconds,
        durationSeconds,
      } satisfies StopBeatWindow;
    });
}

/**
 * Returns a stateful `(seconds) => beat` resolver that freezes the
 * advance during `#STOP` windows. Internal cursor state assumes
 * mostly-monotonic input; non-monotonic seconds (seek / restart)
 * trigger a cursor reset transparently.
 */
export function createBeatAtSecondsResolverFromTimingResolver(resolver: TimingResolver): (seconds: number) => number {
  const stopWindows = createStopBeatWindows(resolver);
  let lastSeconds = Number.NEGATIVE_INFINITY;
  let stopCursor = 0;
  let endedStopSeconds = 0;

  return (seconds: number): number => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return 0;
    }
    const safeSeconds = Math.max(0, seconds);
    if (safeSeconds + 1e-9 < lastSeconds) {
      stopCursor = 0;
      endedStopSeconds = 0;
    }
    lastSeconds = safeSeconds;
    while (stopCursor < stopWindows.length && safeSeconds >= stopWindows[stopCursor]!.endSeconds) {
      endedStopSeconds += stopWindows[stopCursor]!.durationSeconds;
      stopCursor += 1;
    }
    const activeWindow = stopWindows[stopCursor];
    if (activeWindow && safeSeconds >= activeWindow.startSeconds && safeSeconds < activeWindow.endSeconds) {
      return activeWindow.beat;
    }
    const adjustedSeconds = Math.max(0, safeSeconds - endedStopSeconds);
    return secondsToBeatWithoutStops(resolver.tempoPoints, adjustedSeconds);
  };
}

function secondsToBeatWithoutStops(
  tempoPoints: ReadonlyArray<{ beat: number; bpm: number; seconds: number }>,
  seconds: number,
): number {
  if (tempoPoints.length === 0 || seconds <= 0) {
    return 0;
  }
  // Linear scan from the right — tempo-point arrays are tiny (< 100
  // entries even for very tempo-busy charts) so the binary search
  // upstream uses isn't worth the helper-import cost here.
  let index = 0;
  for (let i = tempoPoints.length - 1; i >= 0; i -= 1) {
    if (tempoPoints[i]!.seconds <= seconds) {
      index = i;
      break;
    }
  }
  const point = tempoPoints[index]!;
  const elapsed = Math.max(0, seconds - point.seconds);
  return point.beat + (elapsed * point.bpm) / 60;
}
