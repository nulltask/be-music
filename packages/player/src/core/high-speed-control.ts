import type readline from 'node:readline';

export type HighSpeedControlAction = 'increase' | 'decrease';

export const DEFAULT_HIGH_SPEED = 1;
export const MIN_HIGH_SPEED = 0.5;
export const MAX_HIGH_SPEED = 10;
export const HIGH_SPEED_STEP = 0.5;

export function resolveHighSpeedControlActionFromKey(
  chunk: string | undefined,
  key: readline.Key,
): HighSpeedControlAction | undefined {
  const keyName = key.name?.toLowerCase();
  if (chunk === 'W' || (key.shift && keyName === 'w')) {
    return 'increase';
  }
  if (chunk === 'E' || (key.shift && keyName === 'e')) {
    return 'decrease';
  }
  return undefined;
}

export function resolveHighSpeedMultiplier(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return DEFAULT_HIGH_SPEED;
  }
  const clamped = Math.min(MAX_HIGH_SPEED, Math.max(MIN_HIGH_SPEED, Number(value)));
  return Math.round(clamped / HIGH_SPEED_STEP) * HIGH_SPEED_STEP;
}

export function applyHighSpeedControlAction(current: number, action: HighSpeedControlAction): number {
  const safeCurrent = Number.isFinite(current) && current > 0 ? current : DEFAULT_HIGH_SPEED;
  const delta = action === 'increase' ? HIGH_SPEED_STEP : -HIGH_SPEED_STEP;
  const next = Math.min(MAX_HIGH_SPEED, Math.max(MIN_HIGH_SPEED, safeCurrent + delta));
  return resolveHighSpeedMultiplier(next);
}
