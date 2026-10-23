import { DEFAULT_HIGH_SPEED, MAX_HIGH_SPEED, MIN_HIGH_SPEED } from '@be-music/player-engine/signals';
import { clamp } from '@be-music/shared-utils/core';

const _____MEASURE_BEATS = 4;
const _____MEASURE_ROWS_AT_HS1 = 16;
const MIN_SCROLL_WINDOW_BEATS = 0.25;
const MIN_GRID_ROWS = 4;

export function normalizeHighSpeed(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_HIGH_SPEED;
  }
  return Math.min(MAX_HIGH_SPEED, Math.max(MIN_HIGH_SPEED, value));
}

export function resolveVisibleBeatsForTUIGrid(rowCount: number, highSpeed: number): number {
  const safeRows = Number.isFinite(rowCount) ? Math.max(MIN_GRID_ROWS, Math.floor(rowCount)) : MIN_GRID_ROWS;
  const safeHighSpeed = normalizeHighSpeed(highSpeed);
  const visibleMeasures = safeRows / (_____MEASURE_ROWS_AT_HS1 * safeHighSpeed);
  return Math.max(MIN_SCROLL_WINDOW_BEATS, visibleMeasures * _____MEASURE_BEATS);
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
