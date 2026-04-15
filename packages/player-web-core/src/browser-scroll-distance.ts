import type { ScrollTimelinePoint, SpeedTimelinePoint } from './timing.ts';

interface ScrollSegment {
  startBeat: number;
  scrollSpeed: number;
  speedStart: number;
  speedSlope: number;
  startDistance: number;
}

export class BrowserScrollDistanceMapper {
  private readonly segments: ScrollSegment[];
  private readonly scrollTimeline: ReadonlyArray<ScrollTimelinePoint>;
  private readonly speedTimeline: ReadonlyArray<SpeedTimelinePoint>;

  public constructor(
    scrollTimeline?: ReadonlyArray<ScrollTimelinePoint>,
    speedTimeline?: ReadonlyArray<SpeedTimelinePoint>,
  ) {
    this.scrollTimeline = normalizeScrollPoints(scrollTimeline);
    this.speedTimeline = normalizeSpeedPoints(speedTimeline);
    this.segments = buildScrollSegments(this.scrollTimeline, this.speedTimeline);
  }

  public distanceBetween(fromBeat: number, toBeat: number): number {
    if (!Number.isFinite(fromBeat) || !Number.isFinite(toBeat)) {
      return Number.NaN;
    }
    return this.distanceAt(toBeat) - this.distanceAt(fromBeat);
  }

  public scrollAtBeat(beat: number): number {
    return resolveScrollSpeedAtBeat(this.scrollTimeline, beat);
  }

  public speedAtBeat(beat: number): number {
    return resolveInterpolatedSpeedAtBeat(this.speedTimeline, beat);
  }

  private distanceAt(beat: number): number {
    const safeBeat = Number.isFinite(beat) ? Math.max(0, beat) : 0;
    const segment = this.segments[findLastSegmentIndexByBeat(this.segments, safeBeat)]!;
    return segment.startDistance + integratedSignedSegmentDistance(segment, segment.startBeat, safeBeat);
  }
}

function buildScrollSegments(
  scrollTimeline: ReadonlyArray<ScrollTimelinePoint>,
  speedTimeline: ReadonlyArray<SpeedTimelinePoint>,
): ScrollSegment[] {
  const breakpoints = [...new Set([...scrollTimeline.map((point) => point.beat), ...speedTimeline.map((point) => point.beat)])]
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
    const scrollSpeed = resolveScrollSpeedAtBeat(scrollTimeline, startBeat);
    const speedStart = resolveInterpolatedSpeedAtBeat(speedTimeline, startBeat);
    const speedEnd =
      typeof endBeat === 'number' ? resolveInterpolatedSpeedAtBeat(speedTimeline, endBeat) : speedStart;
    const speedSlope =
      typeof endBeat === 'number' && endBeat > startBeat ? (speedEnd - speedStart) / (endBeat - startBeat) : 0;
    const segment: ScrollSegment = {
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
  const points: ScrollTimelinePoint[] = [{ beat: 0, speed: 1 }];
  for (const point of timeline ?? []) {
    if (!Number.isFinite(point.beat) || !Number.isFinite(point.speed) || point.beat < 0) {
      continue;
    }
    points.push({ beat: point.beat, speed: point.speed });
  }
  points.sort((left, right) => left.beat - right.beat);

  const merged: ScrollTimelinePoint[] = [];
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

function normalizeSpeedPoints(timeline?: ReadonlyArray<SpeedTimelinePoint>): SpeedTimelinePoint[] {
  const points: SpeedTimelinePoint[] = [{ beat: 0, speed: 1 }];
  for (const point of timeline ?? []) {
    if (!Number.isFinite(point.beat) || !Number.isFinite(point.speed) || point.beat < 0 || point.speed < 0) {
      continue;
    }
    points.push({ beat: point.beat, speed: point.speed });
  }
  points.sort((left, right) => left.beat - right.beat);

  const merged: SpeedTimelinePoint[] = [];
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
    merged.push({ ...point });
  }
  return merged;
}

function resolveScrollSpeedAtBeat(points: ReadonlyArray<ScrollTimelinePoint>, beat: number): number {
  const index = findLastTimelineIndexAtOrBefore(points, beat);
  return points[Math.max(0, index)]?.speed ?? 1;
}

function resolveInterpolatedSpeedAtBeat(points: ReadonlyArray<SpeedTimelinePoint>, beat: number): number {
  const index = findLastTimelineIndexAtOrBefore(points, beat);
  const current = points[Math.max(0, index)] ?? { beat: 0, speed: 1 };
  const next = points[index + 1];
  if (!next || beat <= current.beat || Math.abs(next.beat - current.beat) < 1e-9) {
    return current.speed;
  }
  const ratio = clamp((beat - current.beat) / (next.beat - current.beat), 0, 1);
  return current.speed + (next.speed - current.speed) * ratio;
}

function integratedSignedSegmentDistance(segment: ScrollSegment, fromBeat: number, toBeat: number): number {
  const delta = Math.max(0, toBeat - fromBeat);
  if (delta <= 0) {
    return 0;
  }
  const offset = Math.max(0, fromBeat - segment.startBeat);
  const startSpeed = segment.speedStart + segment.speedSlope * offset;
  return segment.scrollSpeed * (startSpeed * delta + 0.5 * segment.speedSlope * delta * delta);
}

function findLastTimelineIndexAtOrBefore<T extends { beat: number }>(points: ReadonlyArray<T>, beat: number): number {
  let low = 0;
  let high = points.length - 1;
  let index = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = points[mid]!;
    if (candidate.beat <= beat) {
      index = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }
  return index;
}

function findLastSegmentIndexByBeat(segments: ReadonlyArray<ScrollSegment>, beat: number): number {
  let low = 0;
  let high = segments.length - 1;
  let index = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = segments[mid]!;
    if (candidate.startBeat <= beat) {
      index = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }
  return index;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
