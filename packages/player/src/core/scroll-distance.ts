import { clamp, findLastIndexAtOrBefore } from '@be-music/utils/core';
import type { ScrollTimelinePoint, SpeedTimelinePoint } from './timeline.ts';

export type { ScrollTimelinePoint, SpeedTimelinePoint } from './timeline.ts';

export interface ScrollDistanceMapperOptions {
  lookaheadBeats?: number;
  invalidDistance?: number;
}

export interface ScrollDistanceMapperLike {
  distanceBetween: (fromBeat: number, toBeat: number) => number;
  hasBidirectionalScrollWithinLookahead: (fromBeat: number) => boolean;
  maxBeatWithinDistance: (fromBeat: number, distance: number) => number;
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
    return this.distanceAt(toBeat) - this.distanceAt(fromBeat);
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
  const points: Array<{ beat: number; speed: number }> = [{ beat: 0, speed: 1 }];
  for (const point of timeline ?? []) {
    if (
      !Number.isFinite(point.beat) ||
      !Number.isFinite(point.speed) ||
      point.beat < 0 ||
      (!options.allowNegativeSpeed && point.speed < 0)
    ) {
      continue;
    }
    points.push({
      beat: point.beat,
      speed: point.speed,
    });
  }
  points.sort((left, right) => left.beat - right.beat);

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

function findLastSegmentIndexByBeat(segments: ScrollSegment[], beat: number): number {
  const index = findLastIndexAtOrBefore(segments, beat, (segment) => segment.startBeat);
  return Math.max(0, index);
}

function normalizeLookaheadBeats(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SCROLL_LOOKAHEAD_BEATS;
  }
  return value;
}
