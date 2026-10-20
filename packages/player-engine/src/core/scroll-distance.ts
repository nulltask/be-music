import { clamp, findLastIndexAtOrBefore } from '@be-music/shared-utils/core';
import type { ScrollTimelinePoint, SpeedTimelinePoint } from '@be-music/chart-model';

export interface ScrollDistanceMapperOptions {
  lookaheadBeats?: number;
  invalidDistance?: number;
}

export interface ScrollDistanceMapperLike {
  distanceBetween: (fromBeat: number, toBeat: number) => number;
  hasBidirectionalScrollWithinLookahead: (fromBeat: number) => boolean;
  maxBeatWithinDistance: (fromBeat: number, distance: number) => number;
  /**
   * Where the chart first runs past a lane `distance` beats tall ({@link ScrollDistanceMapper.firstBeatBeyondDistance}).
   * Optional so implementations written before it keep type-checking; callers then walk without an early exit.
   */
  firstBeatBeyondDistance?: (fromBeat: number, distance: number) => number;
  /**
   * The scroll distance per beat at a beat ({@link ScrollDistanceMapper.rateAt}). Optional so implementations written
   * before it keep type-checking; callers then assume a rate of 1.
   */
  rateAt?: (beat: number) => number;
}

interface ScrollSegment {
  startBeat: number;
  scrollSpeed: number;
  speedStart: number;
  speedSlope: number;
  startDistance: number;
}

interface SegmentDistanceTerms {
  linear: number;
  quadratic: number;
}

interface TimelinePointNormalizerOptions {
  allowNegativeSpeed: boolean;
  dropConsecutiveSameSpeed: boolean;
}

const DEFAULT_SCROLL_LOOKAHEAD_BEATS = 4 * 64;
const BEAT_EPSILON = 1e-9;

export class ScrollDistanceMapper implements ScrollDistanceMapperLike {
  private readonly segments: ScrollSegment[];
  private readonly lookaheadBeats: number;
  private readonly invalidDistance: number;
  /**
   * The last `fromBeat` {@link distanceBetween} measured from, and its distance: a frame measures every note and bar
   * line from the same playhead, so its distance is worked out once per frame instead of once per object.
   */
  private lastFromBeat = Number.NaN;
  private lastFromDistance = 0;

  constructor(
    scrollTimeline?: ReadonlyArray<ScrollTimelinePoint>,
    speedTimeline?: ReadonlyArray<SpeedTimelinePoint>,
    options: ScrollDistanceMapperOptions = {},
  ) {
    this.segments = buildScrollSegments(scrollTimeline, speedTimeline);
    this.lookaheadBeats = normalizeLookaheadBeats(options.lookaheadBeats);
    this.invalidDistance = options.invalidDistance ?? Number.NaN;
  }

  distanceBetween(fromBeat: number, toBeat: number): number {
    if (!Number.isFinite(fromBeat) || !Number.isFinite(toBeat)) {
      return this.invalidDistance;
    }
    if (fromBeat !== this.lastFromBeat) {
      this.lastFromDistance = this.distanceAt(fromBeat);
      this.lastFromBeat = fromBeat;
    }
    return this.distanceAt(toBeat) - this.lastFromDistance;
  }

  hasBidirectionalScrollWithinLookahead(fromBeat: number): boolean {
    const safeFromBeat = Number.isFinite(fromBeat) ? Math.max(0, fromBeat) : 0;
    const capBeat = safeFromBeat + this.lookaheadBeats;
    let index = findLastSegmentIndexByBeat(this.segments, safeFromBeat);
    let sawPositive = false;
    let sawNegative = false;

    while (index < this.segments.length) {
      const segment = this.segments[index]!;
      const segmentStartBeat = Math.max(safeFromBeat, segment.startBeat);
      const nextStartBeat = this.segments[index + 1]?.startBeat ?? Number.POSITIVE_INFINITY;
      const segmentEndBeat = Math.min(capBeat, nextStartBeat);
      if (segmentEndBeat - segmentStartBeat <= BEAT_EPSILON) {
        if (segmentEndBeat >= capBeat) {
          break;
        }
        index += 1;
        continue;
      }

      const signedDistance = integratedSignedSegmentDistance(segment, segmentStartBeat, segmentEndBeat);
      if (signedDistance > BEAT_EPSILON) {
        sawPositive = true;
      } else if (signedDistance < -BEAT_EPSILON) {
        sawNegative = true;
      }

      if (sawPositive && sawNegative) {
        return true;
      }
      if (segmentEndBeat >= capBeat) {
        break;
      }
      index += 1;
    }

    return false;
  }

  maxBeatWithinDistance(fromBeat: number, distance: number): number {
    const safeFromBeat = Number.isFinite(fromBeat) ? Math.max(0, fromBeat) : 0;
    const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
    if (safeDistance <= 0) {
      return safeFromBeat;
    }

    const capBeat = safeFromBeat + this.lookaheadBeats;
    let beat = safeFromBeat;
    let remainingDistance = safeDistance;
    let index = findLastSegmentIndexByBeat(this.segments, beat);

    while (index < this.segments.length && beat < capBeat && remainingDistance > BEAT_EPSILON) {
      const segment = this.segments[index]!;
      const nextStartBeat = this.segments[index + 1]?.startBeat ?? Number.POSITIVE_INFINITY;
      const segmentEndBeat = Math.min(capBeat, nextStartBeat);
      const span = Math.max(0, segmentEndBeat - beat);
      if (span <= 0) {
        index += 1;
        continue;
      }

      const traversableDistance = integratedAbsoluteSegmentDistance(segment, beat, segmentEndBeat);
      if (traversableDistance <= BEAT_EPSILON) {
        beat = segmentEndBeat;
        index += 1;
        continue;
      }
      if (traversableDistance >= remainingDistance) {
        return Math.min(capBeat, beat + solveBeatDeltaWithinSegment(segment, beat, remainingDistance));
      }

      remainingDistance -= traversableDistance;
      beat = segmentEndBeat;
      index += 1;
    }

    return capBeat;
  }

  /**
   * The first beat at or after `fromBeat` whose signed scroll distance from `fromBeat` exceeds `distance` — where the
   * chart first runs past a lane `distance` beats tall — or `+Infinity` when it never does. Negative and zero
   * `#SCROLL` segments only bring the distance down or hold it, so the walk carries on through them; unlike
   * {@link maxBeatWithinDistance} it neither takes absolute distances nor stops at the lookahead cap.
   *
   * beatoraja's `LaneRenderer` walks the chart's timelines from the playhead and stops after the first one past the lane
   * top, so nothing beyond this beat is drawn, even what a later negative `#SCROLL` brings back into the lane.
   */
  firstBeatBeyondDistance(fromBeat: number, distance: number): number {
    const safeFromBeat = Number.isFinite(fromBeat) ? Math.max(0, fromBeat) : 0;
    const limit = Number.isFinite(distance) ? Math.max(0, distance) : 0;
    let beat = safeFromBeat;
    let travelled = 0;
    for (let index = findLastSegmentIndexByBeat(this.segments, beat); index < this.segments.length; index += 1) {
      const segment = this.segments[index]!;
      const nextStartBeat = this.segments[index + 1]?.startBeat ?? Number.POSITIVE_INFINITY;
      if (segment.scrollSpeed > 0) {
        // The last segment runs forever: it overruns any lane unless `#SPEED` holds it at 0.
        const segmentDistance = Number.isFinite(nextStartBeat)
          ? integratedSignedSegmentDistance(segment, beat, nextStartBeat)
          : segmentDistanceTerms(segment, beat, segment.scrollSpeed).linear > BEAT_EPSILON
            ? Number.POSITIVE_INFINITY
            : 0;
        if (travelled + segmentDistance > limit) {
          const delta = solveBeatDeltaWithinSegment(segment, beat, limit - travelled);
          return Number.isFinite(nextStartBeat) ? Math.min(nextStartBeat, beat + delta) : beat + delta;
        }
        travelled += segmentDistance;
      } else if (Number.isFinite(nextStartBeat)) {
        travelled += integratedSignedSegmentDistance(segment, beat, nextStartBeat);
      }
      beat = Math.max(beat, nextStartBeat);
    }
    return Number.POSITIVE_INFINITY;
  }

  /**
   * The scroll distance per beat at `beat`: the `#SCROLL` multiplier times the interpolated `#SPEED`. Negative while the
   * chart scrolls backwards, 0 while it stands still.
   */
  rateAt(beat: number): number {
    const safeBeat = Number.isFinite(beat) ? Math.max(0, beat) : 0;
    const segment = this.segments[findLastSegmentIndexByBeat(this.segments, safeBeat)]!;
    return segmentDistanceTerms(segment, safeBeat, segment.scrollSpeed).linear;
  }

  private distanceAt(beat: number): number {
    const safeBeat = Number.isFinite(beat) ? Math.max(0, beat) : 0;
    const segment = this.segments[findLastSegmentIndexByBeat(this.segments, safeBeat)]!;
    return segment.startDistance + integratedSignedSegmentDistance(segment, segment.startBeat, safeBeat);
  }
}

export function createScrollDistanceMapper(
  scrollTimeline?: ReadonlyArray<ScrollTimelinePoint>,
  speedTimeline?: ReadonlyArray<SpeedTimelinePoint>,
  options?: ScrollDistanceMapperOptions,
): ScrollDistanceMapper {
  return new ScrollDistanceMapper(scrollTimeline, speedTimeline, options);
}

function buildScrollSegments(
  scrollTimeline?: ReadonlyArray<ScrollTimelinePoint>,
  speedTimeline?: ReadonlyArray<SpeedTimelinePoint>,
): ScrollSegment[] {
  const scrollPoints = normalizeScrollPoints(scrollTimeline);
  const speedPoints = normalizeSpeedPoints(speedTimeline);
  const breakpoints = [
    ...new Set([...scrollPoints.map((point) => point.beat), ...speedPoints.map((point) => point.beat)]),
  ]
    .filter((beat) => Number.isFinite(beat) && beat >= 0)
    .sort((left, right) => left - right);
  if (breakpoints.length === 0 || breakpoints[0] !== 0) {
    breakpoints.unshift(0);
  }

  const segments: ScrollSegment[] = [];
  let distance = 0;
  for (let index = 0; index < breakpoints.length; index += 1) {
    const startBeat = breakpoints[index]!;
    const endBeat = breakpoints[index + 1];
    const scrollSpeed = resolveScrollSpeedAtBeat(scrollPoints, startBeat);
    const speedStart = resolveInterpolatedSpeedAtBeat(speedPoints, startBeat);
    const speedEnd = typeof endBeat === 'number' ? resolveInterpolatedSpeedAtBeat(speedPoints, endBeat) : speedStart;
    const speedSlope =
      typeof endBeat === 'number' && endBeat > startBeat ? (speedEnd - speedStart) / (endBeat - startBeat) : 0;
    const segment = {
      startBeat,
      scrollSpeed,
      speedStart,
      speedSlope,
      startDistance: distance,
    };
    segments.push(segment);
    if (typeof endBeat === 'number') {
      distance += integratedSignedSegmentDistance(segment, startBeat, endBeat);
    }
  }
  return segments.length > 0
    ? segments
    : [{ startBeat: 0, scrollSpeed: 1, speedStart: 1, speedSlope: 0, startDistance: 0 }];
}

function normalizeScrollPoints(timeline?: ReadonlyArray<ScrollTimelinePoint>): ScrollTimelinePoint[] {
  return normalizeTimelinePoints(timeline, {
    allowNegativeSpeed: true,
    dropConsecutiveSameSpeed: true,
  });
}

/**
 * `#SPEEDxx` keyframes behind a beat-0 head of `1`, so the speed ramps linearly from 1 at beat 0 to the first keyframe,
 * as beatoraja's `LaneRenderer.getCurrentSpeed` ramps from 1.0 at time 0 (a keyframe on beat 0 applies at once).
 * be-music interpolates in beats where beatoraja interpolates in time; see docs/format-compat.md §2.10.
 */
function normalizeSpeedPoints(timeline?: ReadonlyArray<SpeedTimelinePoint>): SpeedTimelinePoint[] {
  return normalizeTimelinePoints(timeline, {
    allowNegativeSpeed: false,
    dropConsecutiveSameSpeed: false,
  });
}

function normalizeTimelinePoints<T extends ScrollTimelinePoint | SpeedTimelinePoint>(
  timeline: ReadonlyArray<T> | undefined,
  options: TimelinePointNormalizerOptions,
): T[] {
  const collected: Array<{ beat: number; speed: number }> = [];
  for (const point of timeline ?? []) {
    if (
      !Number.isFinite(point.beat) ||
      !Number.isFinite(point.speed) ||
      point.beat < 0 ||
      (!options.allowNegativeSpeed && point.speed < 0)
    ) {
      continue;
    }
    collected.push({
      beat: point.beat,
      speed: point.speed,
    });
  }
  collected.sort((left, right) => left.beat - right.beat);
  const points: Array<{ beat: number; speed: number }> = [{ beat: 0, speed: 1 }, ...collected];

  const merged: Array<{ beat: number; speed: number }> = [];
  for (const point of points) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push({ ...point });
      continue;
    }
    if (Math.abs(point.beat - previous.beat) < BEAT_EPSILON) {
      previous.speed = point.speed;
      continue;
    }
    if (options.dropConsecutiveSameSpeed && Math.abs(point.speed - previous.speed) < BEAT_EPSILON) {
      continue;
    }
    merged.push({ ...point });
  }
  return merged as T[];
}

function resolveScrollSpeedAtBeat(points: ReadonlyArray<ScrollTimelinePoint>, beat: number): number {
  const index = findLastIndexAtOrBefore(points, beat, (point) => point.beat);
  return points[Math.max(0, index)]?.speed ?? 1;
}

function resolveInterpolatedSpeedAtBeat(points: ReadonlyArray<SpeedTimelinePoint>, beat: number): number {
  const index = findLastIndexAtOrBefore(points, beat, (point) => point.beat);
  const current = points[Math.max(0, index)] ?? { beat: 0, speed: 1 };
  const next = points[index + 1];
  if (!next || beat <= current.beat || Math.abs(next.beat - current.beat) < BEAT_EPSILON) {
    return current.speed;
  }
  const ratio = clamp((beat - current.beat) / (next.beat - current.beat), 0, 1);
  return current.speed + (next.speed - current.speed) * ratio;
}

function integratedSignedSegmentDistance(segment: ScrollSegment, fromBeat: number, toBeat: number): number {
  return integratedSegmentDistance(segment, fromBeat, toBeat, segment.scrollSpeed);
}

function integratedAbsoluteSegmentDistance(segment: ScrollSegment, fromBeat: number, toBeat: number): number {
  return integratedSegmentDistance(segment, fromBeat, toBeat, Math.abs(segment.scrollSpeed));
}

function integratedSegmentDistance(
  segment: ScrollSegment,
  fromBeat: number,
  toBeat: number,
  scrollScale: number,
): number {
  const delta = Math.max(0, toBeat - fromBeat);
  if (delta <= 0) {
    return 0;
  }
  return integrateSegmentDistanceTerms(segmentDistanceTerms(segment, fromBeat, scrollScale), delta);
}

function solveBeatDeltaWithinSegment(segment: ScrollSegment, fromBeat: number, distance: number): number {
  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  if (safeDistance <= 0) {
    return 0;
  }

  const absScroll = Math.abs(segment.scrollSpeed);
  if (absScroll <= BEAT_EPSILON) {
    return 0;
  }
  const { linear, quadratic } = segmentDistanceTerms(segment, fromBeat, absScroll);
  if (Math.abs(quadratic) <= BEAT_EPSILON) {
    return linear <= BEAT_EPSILON ? 0 : safeDistance / linear;
  }
  const discriminant = linear * linear + 4 * quadratic * safeDistance;
  if (discriminant <= 0) {
    return 0;
  }
  return Math.max(0, (-linear + Math.sqrt(discriminant)) / (2 * quadratic));
}

function segmentDistanceTerms(segment: ScrollSegment, fromBeat: number, scrollScale: number): SegmentDistanceTerms {
  const offset = Math.max(0, fromBeat - segment.startBeat);
  const baseSpeed = segment.speedStart + segment.speedSlope * offset;
  return {
    linear: scrollScale * baseSpeed,
    quadratic: 0.5 * scrollScale * segment.speedSlope,
  };
}

function integrateSegmentDistanceTerms({ linear, quadratic }: SegmentDistanceTerms, deltaBeats: number): number {
  return linear * deltaBeats + quadratic * deltaBeats * deltaBeats;
}

const segmentStartBeat = (segment: ScrollSegment): number => segment.startBeat;

function findLastSegmentIndexByBeat(segments: ScrollSegment[], beat: number): number {
  const index = findLastIndexAtOrBefore(segments, beat, segmentStartBeat);
  return Math.max(0, index);
}

function normalizeLookaheadBeats(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SCROLL_LOOKAHEAD_BEATS;
  }
  return value;
}
