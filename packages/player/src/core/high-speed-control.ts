export type HighSpeedControlAction = 'increase' | 'decrease';

export const DEFAULT_HIGH_SPEED = 1;
export const MIN_HIGH_SPEED = 0.5;
export const MAX_HIGH_SPEED = 10;
export const HIGH_SPEED_STEP = 0.5;

export function resolveHighSpeedControlActionFromLaneChannels(
  channels: ReadonlyArray<string>,
): HighSpeedControlAction | undefined {
  let hasOddLane = false;
  let hasEvenLane = false;

  for (const channel of channels) {
    const laneIndex = resolvePlayableLaneIndex(channel);
    if (laneIndex === undefined) {
      continue;
    }
    if ((laneIndex & 1) === 0) {
      hasEvenLane = true;
    } else {
      hasOddLane = true;
    }
    if (hasOddLane && hasEvenLane) {
      return undefined;
    }
  }

  if (hasEvenLane) {
    return 'increase';
  }
  if (hasOddLane) {
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

function resolvePlayableLaneIndex(channel: string): number | undefined {
  const normalized = channel.trim().toUpperCase();
  if (normalized.length !== 2) {
    return undefined;
  }
  const side = normalized[0];
  if (side !== '1' && side !== '2') {
    return undefined;
  }

  const lane = normalized[1];
  const code = lane.charCodeAt(0);
  if (code >= 0x31 && code <= 0x39) {
    return code - 0x30;
  }
  if (code >= 0x41 && code <= 0x5a) {
    return code - 0x41 + 10;
  }
  return undefined;
}
