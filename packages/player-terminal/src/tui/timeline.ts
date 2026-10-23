import type { ScrollTimelinePoint } from '@be-music/chart-model';

export interface MeasureTimelinePoint {
  measure: number;
  seconds: number;
}

export interface BPMTimelinePoint {
  bpm: number;
  seconds: number;
}

export interface StopWindowPoint {
  startSeconds: number;
  endSeconds: number;
}

export const _____MEASURE_BEATS = 4;
const MEASURE_SIGNATURE_MAX_DENOMINATOR = 32;
const MEASURE_SIGNATURE_TOLERANCE = 1e-8;

export function findCurrentMeasure(
  timeline: ReadonlyArray<MeasureTimelinePoint> | undefined,
  currentSeconds: number,
): number {
  if (!timeline || timeline.length === 0) {
    return 0;
  }

  let low = 0;
  let high = timeline.length - 1;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = timeline[mid];
    if (point.seconds <= currentSeconds) {
      best = point.measure;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return Math.max(0, best);
}

export function findTotalMeasures(timeline: ReadonlyArray<MeasureTimelinePoint> | undefined): number {
  if (!timeline || timeline.length === 0) {
    return 1;
  }
  const last = timeline[timeline.length - 1];
  return Math.max(1, Math.floor(last.measure));
}

export function resolveMeasureLength(measureLengths: ReadonlyMap<number, number> | undefined, measure: number): number {
  const safeMeasure = Math.max(0, Math.floor(measure));
  const length = measureLengths?.get(safeMeasure);
  if (typeof length !== 'number' || !Number.isFinite(length) || length <= 0) {
    return 1;
  }
  return length;
}

export function formatMeasureSignature(length: number | undefined): string {
  const safeLength = typeof length === 'number' && Number.isFinite(length) && length > 0 ? length : 1;
  const quarterBeats = safeLength * _____MEASURE_BEATS;
  const fraction = approximateFraction(quarterBeats, MEASURE_SIGNATURE_MAX_DENOMINATOR, MEASURE_SIGNATURE_TOLERANCE);
  if (fraction) {
    return `${fraction.numerator}/${fraction.denominator * _____MEASURE_BEATS}`;
  }
  return `${formatMeterDecimal(quarterBeats)}/${_____MEASURE_BEATS}`;
}

function approximateFraction(
  value: number,
  maxDenominator: number,
  tolerance: number,
): { numerator: number; denominator: number } | undefined {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maxDenominator) || maxDenominator < 1) {
    return undefined;
  }

  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Number.POSITIVE_INFINITY;
  for (let denominator = 1; denominator <= Math.floor(maxDenominator); denominator += 1) {
    const numerator = Math.round(value * denominator);
    if (numerator <= 0) {
      continue;
    }
    const error = Math.abs(value - numerator / denominator);
    if (error < bestError) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
    }
  }

  if (bestNumerator <= 0 || bestError > tolerance) {
    return undefined;
  }

  const divisor = greatestCommonDivisor(bestNumerator, bestDenominator);
  return {
    numerator: Math.floor(bestNumerator / divisor),
    denominator: Math.floor(bestDenominator / divisor),
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.floor(left));
  let b = Math.abs(Math.floor(right));
  while (b !== 0) {
    const rest = a % b;
    a = b;
    b = rest;
  }
  return Math.max(1, a);
}

function formatMeterDecimal(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const fixed = safe.toFixed(6);
  return fixed.replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}

export function findCurrentBPM(timeline: ReadonlyArray<BPMTimelinePoint> | undefined, currentSeconds: number): number {
  if (!timeline || timeline.length === 0) {
    return 0;
  }

  let low = 0;
  let high = timeline.length - 1;
  let best = timeline[0].bpm;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = timeline[mid];
    if (point.seconds <= currentSeconds) {
      best = point.bpm;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return Math.max(0, best);
}

export function findCurrentScroll(
  timeline: ReadonlyArray<ScrollTimelinePoint> | undefined,
  currentBeat: number,
): number {
  if (!timeline || timeline.length === 0) {
    return 1;
  }

  let low = 0;
  let high = timeline.length - 1;
  let best = 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = timeline[mid];
    if (point.beat <= currentBeat) {
      best = point.speed;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return Number.isFinite(best) ? best : 1;
}

export function findRemainingStopSeconds(
  stopWindows: ReadonlyArray<StopWindowPoint> | undefined,
  currentSeconds: number,
): number {
  if (!stopWindows || stopWindows.length === 0 || !Number.isFinite(currentSeconds)) {
    return 0;
  }

  let low = 0;
  let high = stopWindows.length - 1;
  let index = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = stopWindows[mid];
    if (point.startSeconds <= currentSeconds) {
      index = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  if (index < 0) {
    return 0;
  }
  const window = stopWindows[index];
  if (currentSeconds >= window.endSeconds) {
    return 0;
  }
  return Math.max(0, window.endSeconds - currentSeconds);
}
