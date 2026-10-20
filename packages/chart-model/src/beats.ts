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
  return [...events].sort(compareEvents);
}

export function compareEvents(left: BeMusicEvent, right: BeMusicEvent): number {
  if (left.measure !== right.measure) {
    return left.measure - right.measure;
  }
  const leftDenominator = normalizePositionDenominator(left.position[1]);
  const leftNumerator = normalizePositionNumerator(left.position[0], leftDenominator);
  const rightDenominator = normalizePositionDenominator(right.position[1]);
  const rightNumerator = normalizePositionNumerator(right.position[0], rightDenominator);
  if (leftDenominator === rightDenominator) {
    const numeratorDelta = leftNumerator - rightNumerator;
    if (numeratorDelta !== 0) {
      return numeratorDelta;
    }
  } else {
    const leftScaled = leftNumerator * rightDenominator;
    const rightScaled = rightNumerator * leftDenominator;
    if (Number.isSafeInteger(leftScaled) && Number.isSafeInteger(rightScaled)) {
      if (leftScaled < rightScaled) {
        return -1;
      }
      if (leftScaled > rightScaled) {
        return 1;
      }
    } else {
      const leftScaledBigInt = BigInt(leftNumerator) * BigInt(rightDenominator);
      const rightScaledBigInt = BigInt(rightNumerator) * BigInt(leftDenominator);
      if (leftScaledBigInt < rightScaledBigInt) {
        return -1;
      }
      if (leftScaledBigInt > rightScaledBigInt) {
        return 1;
      }
    }
  }
  if (left.channel !== right.channel) {
    return left.channel < right.channel ? -1 : 1;
  }
  if (left.value !== right.value) {
    return left.value < right.value ? -1 : 1;
  }
  return 0;
}

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
