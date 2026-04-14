const DEFAULT_HIGH_SPEED = 1;
const MIN_HIGH_SPEED = 0.5;
const MAX_HIGH_SPEED = 10;
const HIGH_SPEED_STEP = 0.5;

export function normalizeBrowserHighSpeed(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return DEFAULT_HIGH_SPEED;
  }
  const clamped = Math.min(MAX_HIGH_SPEED, Math.max(MIN_HIGH_SPEED, Number(value)));
  return Math.round(clamped / HIGH_SPEED_STEP) * HIGH_SPEED_STEP;
}

export function increaseBrowserHighSpeed(current: number): number {
  return normalizeBrowserHighSpeed(current + HIGH_SPEED_STEP);
}

export function decreaseBrowserHighSpeed(current: number): number {
  return normalizeBrowserHighSpeed(current - HIGH_SPEED_STEP);
}

export function formatBrowserHighSpeed(value: number): string {
  const safe = normalizeBrowserHighSpeed(value);
  return Number.isInteger(safe) ? safe.toFixed(1) : safe.toFixed(1);
}
