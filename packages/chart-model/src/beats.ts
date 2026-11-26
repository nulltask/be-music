import type { BeMusicEvent, BeMusicJSON } from '@be-music/chart-source';

export interface BeatResolver {
  measureToBeat: (measure: number, position?: number) => number;
  eventToBeat: (event: BeMusicEvent) => number;
}

export function getMeasureBeats(length: number): number {
  return 4 * length;
}

export function measureToBeat(json: BeMusicJSON, measure: number, position = 0): number {
  const safeMeasure = Math.max(0, Math.floor(measure));
  if (json.measures.length === 0) {
    return safeMeasure * 4 + 4 * clamp01(position);
  }
  const safePosition = clamp01(position);
  const measureLengths = createExactMeasureLengthRecord(json);
  let beats = 0;
  for (let current = 0; current < safeMeasure; current += 1) {
    beats += getMeasureBeats(measureLengths[current] ?? 1);
  }
  beats += getMeasureBeats(measureLengths[safeMeasure] ?? 1) * safePosition;
  return beats;
}

export function eventToBeat(json: BeMusicJSON, event: BeMusicEvent): number {
  if (json.measures.length === 0) {
    const measure = Math.max(0, Math.floor(event.measure));
    const denominator = normalizePositionDenominator(event.position[1]);
    const numerator = normalizePositionNumerator(event.position[0], denominator);
    return measure * 4 + (4 * numerator) / denominator;
  }
  return measureToBeat(json, event.measure, getEventPosition(event));
}

export function createBeatResolver(json: BeMusicJSON): BeatResolver {
  if (json.measures.length === 0) {
    return {
      measureToBeat: (measure, position = 0) => {
        const safeMeasure = Math.max(0, Math.floor(measure));
        return safeMeasure * 4 + 4 * clamp01(position);
      },
      eventToBeat: (event) => {
        const safeMeasure = Math.max(0, Math.floor(event.measure));
        const denominator = normalizePositionDenominator(event.position[1]);
        const numerator = normalizePositionNumerator(event.position[0], denominator);
        return safeMeasure * 4 + (4 * numerator) / denominator;
      },
    };
  }

  const measureLengths: number[] = [];
  let maxDefinedMeasure = -1;
  for (const measure of json.measures) {
    const normalizedIndex = Math.max(0, Math.floor(measure.index));
    const normalizedLength = Number.isFinite(measure.length) && measure.length > 0 ? measure.length : 1;
    measureLengths[normalizedIndex] = normalizedLength;
    if (normalizedIndex > maxDefinedMeasure) {
      maxDefinedMeasure = normalizedIndex;
    }
  }

  const measureStartBeats: number[] = [];
  let cumulativeBeats = 0;
  for (let measure = 0; measure <= maxDefinedMeasure; measure += 1) {
    measureStartBeats[measure] = cumulativeBeats;
    cumulativeBeats += getMeasureBeats(measureLengths[measure] ?? 1);
  }
  const denseLimit = maxDefinedMeasure + 1;

  const resolveMeasureStartBeat = (measure: number): number => {
    if (measure <= 0) {
      return 0;
    }
    if (measure < denseLimit) {
      return measureStartBeats[measure] ?? 0;
    }
    return cumulativeBeats + (measure - denseLimit) * 4;
  };

  const resolveMeasureLength = (measure: number): number => (measure < denseLimit ? (measureLengths[measure] ?? 1) : 1);

  return {
    measureToBeat: (measure, position = 0) => {
      const safeMeasure = Math.max(0, Math.floor(measure));
      const safePosition = clamp01(position);
      const start = resolveMeasureStartBeat(safeMeasure);
      const measureBeats = getMeasureBeats(resolveMeasureLength(safeMeasure));
      return start + measureBeats * safePosition;
    },
    eventToBeat: (event) => {
      const safeMeasure = Math.max(0, Math.floor(event.measure));
      const start = resolveMeasureStartBeat(safeMeasure);
      const measureBeats = getMeasureBeats(resolveMeasureLength(safeMeasure));
      return start + measureBeats * getEventPosition(event);
    },
  };
}

export function sortEvents(events: BeMusicEvent[]): BeMusicEvent[] {
  if (events.length <= 1) {
    return [...events];
  }

  let sorted = true;
  for (let index = 1; index < events.length; index += 1) {
    if (compareEvents(events[index - 1]!, events[index]!) > 0) {
      sorted = false;
      break;
    }
  }
  if (sorted) {
    return [...events];
  }
  return sortEventsInPlace([...events]);
}

/** Below this many events one comparison sort is as fast as sorting measure by measure. */
const MEASURE_BUCKET_MIN_EVENTS = 64;
/** Measures past this index fall back to one comparison sort, so a stray huge index allocates no buckets. */
const MEASURE_BUCKET_MAX_MEASURE = 4095;

/**
 * Sorts `events` in place in {@link compareEvents} order and returns the same array; equal events keep their input
 * order, as `events.sort(compareEvents)` leaves them.
 *
 * A chart lists its events almost measure by measure, and the measure is the first sort key, so a large list is split
 * by measure and each measure sorted alone: the comparator then runs on a few dozen events at a time instead of
 * merging the whole chart's lines.
 */
export function sortEventsInPlace(events: BeMusicEvent[]): BeMusicEvent[] {
  const length = events.length;
  if (length < MEASURE_BUCKET_MIN_EVENTS) {
    return events.sort(compareEvents);
  }
  let maxMeasure = 0;
  for (let index = 0; index < length; index += 1) {
    const measure = events[index]!.measure;
    if (!Number.isInteger(measure) || measure < 0 || measure > MEASURE_BUCKET_MAX_MEASURE) {
      return events.sort(compareEvents);
    }
    if (measure > maxMeasure) {
      maxMeasure = measure;
    }
  }
  const buckets: Array<BeMusicEvent[] | undefined> = Array.from({ length: maxMeasure + 1 });
  for (let index = 0; index < length; index += 1) {
    const event = events[index]!;
    const bucket = buckets[event.measure];
    if (bucket === undefined) {
      buckets[event.measure] = [event];
    } else {
      bucket.push(event);
    }
  }
  let cursor = 0;
  for (let measure = 0; measure <= maxMeasure; measure += 1) {
    const bucket = buckets[measure];
    if (bucket === undefined) {
      continue;
    }
    if (bucket.length > 1) {
      bucket.sort(compareEvents);
    }
    for (let index = 0; index < bucket.length; index += 1) {
      events[cursor] = bucket[index]!;
      cursor += 1;
    }
  }
  return events;
}

export function compareEvents(left: BeMusicEvent, right: BeMusicEvent): number {
  if (left.measure !== right.measure) {
    return left.measure - right.measure;
  }
  const leftPosition = left.position;
  const rightPosition = right.position;
  const leftNumerator = leftPosition[0];
  const leftDenominator = leftPosition[1];
  const rightNumerator = rightPosition[0];
  const rightDenominator = rightPosition[1];
  // Parsed events hold a position `[n, d]` with integers `0 <= n < d`, and `d` far below 2 ** 26: the cross products
  // are then exact small integers, compared with plain arithmetic the JIT keeps in registers. Anything else (a
  // hand-built event out of range, a huge grid) takes the general path below.
  if (
    (leftNumerator | 0) === leftNumerator &&
    (rightNumerator | 0) === rightNumerator &&
    (leftDenominator | 0) === leftDenominator &&
    (rightDenominator | 0) === rightDenominator &&
    leftNumerator >= 0 &&
    rightNumerator >= 0 &&
    leftNumerator < leftDenominator &&
    rightNumerator < rightDenominator &&
    leftDenominator <= MAX_FAST_POSITION_DENOMINATOR &&
    rightDenominator <= MAX_FAST_POSITION_DENOMINATOR
  ) {
    const delta =
      leftDenominator === rightDenominator
        ? leftNumerator - rightNumerator
        : leftNumerator * rightDenominator - rightNumerator * leftDenominator;
    if (delta !== 0) {
      return delta < 0 ? -1 : 1;
    }
  } else {
    const order = comparePositionsExactly(leftPosition, rightPosition);
    if (order !== 0) {
      return order;
    }
  }
  if (left.channel !== right.channel) {
    return left.channel < right.channel ? -1 : 1;
  }
  // Duplicate timing objects on one channel and position keep their input (file) order, so the later line wins as in
  // beatoraja; LR2 leaves the order undefined there (#133). Other channels stay sorted by value.
  if (FILE_ORDER_CHANNELS.has(left.channel)) {
    return 0;
  }
  if (left.value !== right.value) {
    return left.value < right.value ? -1 : 1;
  }
  return 0;
}

/** Denominators up to here keep the cross products of two positions under 2 ** 52, so they need no overflow check. */
const MAX_FAST_POSITION_DENOMINATOR = 2 ** 26;

/** The order of two positions of one measure after normalizing them, exact for any denominator. */
function comparePositionsExactly(left: BeMusicEvent['position'], right: BeMusicEvent['position']): number {
  const leftDenominator = normalizePositionDenominator(left[1]);
  const leftNumerator = normalizePositionNumerator(left[0], leftDenominator);
  const rightDenominator = normalizePositionDenominator(right[1]);
  const rightNumerator = normalizePositionNumerator(right[0], rightDenominator);
  if (leftDenominator === rightDenominator) {
    return leftNumerator - rightNumerator;
  }
  const leftScaled = leftNumerator * rightDenominator;
  const rightScaled = rightNumerator * leftDenominator;
  if (Number.isSafeInteger(leftScaled) && Number.isSafeInteger(rightScaled)) {
    return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
  }
  const leftScaledBigInt = BigInt(leftNumerator) * BigInt(rightDenominator);
  const rightScaledBigInt = BigInt(rightNumerator) * BigInt(leftDenominator);
  return leftScaledBigInt < rightScaledBigInt ? -1 : leftScaledBigInt > rightScaledBigInt ? 1 : 0;
}

/** BPM, STOP, SCROLL and SPEED channels, where the last object at a position takes effect. */
const FILE_ORDER_CHANNELS: ReadonlySet<string> = new Set(['03', '08', '09', 'SC', 'SP']);

function createExactMeasureLengthRecord(json: BeMusicJSON): Record<number, number> {
  const measureLengths: number[] = [];
  for (const measure of json.measures) {
    measureLengths[measure.index] = measure.length;
  }
  return measureLengths;
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value >= 1) {
    return 0.999999999;
  }
  return value;
}

function getEventPosition(event: BeMusicEvent): number {
  const denominator = normalizePositionDenominator(event.position[1]);
  const numerator = normalizePositionNumerator(event.position[0], denominator);
  return numerator / denominator;
}

export function normalizePositionDenominator(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

export function normalizePositionNumerator(value: number, denominator: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = Math.floor(value);
  return Math.max(0, Math.min(denominator - 1, normalized));
}
