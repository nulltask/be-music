import { clamp } from '@be-music/utils';

const IIDX_MEASURE_BEATS = 4;
const IIDX_MEASURE_ROWS_AT_HS1 = 16;
const MIN_SCROLL_WINDOW_BEATS = 0.25;
const MIN_HIGH_SPEED = 0.5;
const MAX_HIGH_SPEED = 10;
const MIN_GRID_ROWS = 4;

export function normalizeHighSpeed(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(MAX_HIGH_SPEED, Math.max(MIN_HIGH_SPEED, value));
}

export function resolveVisibleBeatsForTuiGrid(rowCount: number, highSpeed: number): number {
  const safeRows = Number.isFinite(rowCount) ? Math.max(MIN_GRID_ROWS, Math.floor(rowCount)) : MIN_GRID_ROWS;
  const safeHighSpeed = normalizeHighSpeed(highSpeed);
  const visibleMeasures = safeRows / (IIDX_MEASURE_ROWS_AT_HS1 * safeHighSpeed);
  return Math.max(MIN_SCROLL_WINDOW_BEATS, visibleMeasures * IIDX_MEASURE_BEATS);
}

export function resolveAnimatedHighSpeedValue(
  fromHighSpeed: number,
  toHighSpeed: number,
  elapsedMs: number,
  durationMs: number,
): number {
  const from = normalizeHighSpeed(fromHighSpeed);
  const to = normalizeHighSpeed(toHighSpeed);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return to;
  }
  const safeElapsedMs = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const ratio = clamp(safeElapsedMs / durationMs, 0, 1);
  return from + (to - from) * ratio;
}
