/**
 * Maps a `(fromBeat, toBeat)` pair into the integrated scroll
 * distance, honouring `#SCROLL` (per-segment scroll factor that can
 * be negative or zero) and `#SPEED` (per-segment visual speed
 * multiplier with linear interpolation between control points).
 *
 * Mirrors the math in `packages/player/src/tui/tui.ts`'s
 * `ScrollDistanceMapper` so the gameplay view animates note Y
 * positions consistently with the TUI player. Kept as a small
 * standalone module here to avoid pulling the 3000-line TUI file
 * into the web build's tree-shaking graph.
 *
 * Usage:
 *
 *   const mapper = createScrollDistanceMapper(scrollTimeline, speedTimeline);
 *   const y = lane.bottom - mapper.distanceBetween(currentBeat, note.beat) * pixelsPerBeat;
 *
 * `distanceBetween` returns 0 when `toBeat <= fromBeat` (notes
 * already past the playhead). Negative-scroll segments produce a
 * negative contribution which lets notes scroll backward, matching
 * the LR2 reference behaviour.
 */
import type { ScrollTimelinePoint, SpeedTimelinePoint } from './chart-timing.ts';

interface ScrollSegment {
  startBeat: number;
  scrollSpeed: number;
  speedStart: number;
  speedSlope: number;
}

export interface ScrollDistanceMapper {
  /**
   * Integrated scroll distance from `fromBeat` to `toBeat`. Negative
   * for notes ahead of `fromBeat` only when there's a negative
   * `#SCROLL` segment in between.
   */
  distanceBetween: (fromBeat: number, toBeat: number) => number;
}

export function createScrollDistanceMapper(
  scrollTimeline?: ReadonlyArray<ScrollTimelinePoint>,
  speedTimeline?: ReadonlyArray<SpeedTimelinePoint>,
): ScrollDistanceMapper {
  const segments = buildScrollSegments(scrollTimeline, speedTimeline);

  const distanceAt = (beat: number): number => {
    const safeBeat = Number.isFinite(beat) ? Math.max(0, beat) : 0;
    let accum = 0;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!;
      const next = segments[index + 1];
      const segmentEnd = next ? next.startBeat : Number.POSITIVE_INFINITY;
      if (safeBeat <= segment.startBeat) {
        break;
      }
      const span = Math.min(segmentEnd, safeBeat) - segment.startBeat;
      accum += integratedSegmentDistance(segment, segment.startBeat, segment.startBeat + span);
      if (segmentEnd >= safeBeat) {
        break;
      }
    }
    return accum;
  };

  return {
    distanceBetween: (fromBeat: number, toBeat: number) => {
      if (!Number.isFinite(fromBeat) || !Number.isFinite(toBeat)) {
        return 0;
      }
      return distanceAt(toBeat) - distanceAt(fromBeat);
    },
  };
}

function buildScrollSegments(
  scrollTimeline?: ReadonlyArray<ScrollTimelinePoint>,
  speedTimeline?: ReadonlyArray<SpeedTimelinePoint>,
): ScrollSegment[] {
  const scrollPoints = normalizePoints(scrollTimeline, /* allowNegative */ true);
  const speedPoints = normalizePoints(speedTimeline, /* allowNegative */ false);
  const breakpoints = [
    ...new Set([...scrollPoints.map((point) => point.beat), ...speedPoints.map((point) => point.beat)]),
  ]
    .filter((beat) => Number.isFinite(beat) && beat >= 0)
    .sort((left, right) => left - right);
  if (breakpoints.length === 0 || breakpoints[0] !== 0) {
    breakpoints.unshift(0);
  }

  const segments: ScrollSegment[] = [];
  for (let index = 0; index < breakpoints.length; index += 1) {
    const startBeat = breakpoints[index]!;
    const endBeat = breakpoints[index + 1];
    const scrollSpeed = lookupAtOrBefore(scrollPoints, startBeat, 1);
    const speedStart = interpolatedSpeed(speedPoints, startBeat);
    const speedEnd = typeof endBeat === 'number' ? interpolatedSpeed(speedPoints, endBeat) : speedStart;
    const speedSlope =
      typeof endBeat === 'number' && endBeat > startBeat ? (speedEnd - speedStart) / (endBeat - startBeat) : 0;
    segments.push({ startBeat, scrollSpeed, speedStart, speedSlope });
  }
  return segments.length > 0 ? segments : [{ startBeat: 0, scrollSpeed: 1, speedStart: 1, speedSlope: 0 }];
}

function normalizePoints(
  timeline: ReadonlyArray<{ beat: number; speed: number }> | undefined,
  allowNegative: boolean,
): { beat: number; speed: number }[] {
  const points: { beat: number; speed: number }[] = [{ beat: 0, speed: 1 }];
  for (const point of timeline ?? []) {
    if (!Number.isFinite(point.beat) || !Number.isFinite(point.speed) || point.beat < 0) {
      continue;
    }
    if (!allowNegative && point.speed < 0) {
      continue;
    }
    points.push({ beat: point.beat, speed: point.speed });
  }
  points.sort((left, right) => left.beat - right.beat);
  // Merge same-beat duplicates (later wins) and drop redundant
  // consecutive same-speed points.
  const merged: { beat: number; speed: number }[] = [];
  for (const point of points) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push({ ...point });
      continue;
    }
    if (Math.abs(point.beat - previous.beat) < 1e-9) {
      previous.speed = point.speed;
      continue;
    }
    if (Math.abs(point.speed - previous.speed) < 1e-9) {
      continue;
    }
    merged.push({ ...point });
  }
  return merged;
}

function lookupAtOrBefore(points: ReadonlyArray<{ beat: number; speed: number }>, beat: number, fallback: number): number {
  let answer = fallback;
  for (const point of points) {
    if (point.beat <= beat) {
      answer = point.speed;
    } else {
      break;
    }
  }
  return answer;
}

function interpolatedSpeed(points: ReadonlyArray<{ beat: number; speed: number }>, beat: number): number {
  if (points.length === 0) return 1;
  let lowerIndex = -1;
  for (let i = 0; i < points.length; i += 1) {
    if (points[i]!.beat <= beat) {
      lowerIndex = i;
    } else {
      break;
    }
  }
  if (lowerIndex < 0) return points[0]!.speed;
  const lower = points[lowerIndex]!;
  const upper = points[lowerIndex + 1];
  if (!upper || beat <= lower.beat || Math.abs(upper.beat - lower.beat) < 1e-9) {
    return lower.speed;
  }
  const ratio = Math.max(0, Math.min(1, (beat - lower.beat) / (upper.beat - lower.beat)));
  return lower.speed + (upper.speed - lower.speed) * ratio;
}

function integratedSegmentDistance(segment: ScrollSegment, fromBeat: number, toBeat: number): number {
  const delta = Math.max(0, toBeat - fromBeat);
  if (delta <= 0) {
    return 0;
  }
  const offset = Math.max(0, fromBeat - segment.startBeat);
  const startSpeed = segment.speedStart + segment.speedSlope * offset;
  // ∫ speedStart + slope*t dt over [0, delta] = speedStart*delta + 0.5*slope*delta^2
  return segment.scrollSpeed * (startSpeed * delta + 0.5 * segment.speedSlope * delta * delta);
}
