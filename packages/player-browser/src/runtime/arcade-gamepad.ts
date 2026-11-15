const infinitasUSBId = /\bvendor:\s*1ccf\s+product:\s*(?:8048|1018)\b|^1ccf-(?:8048|1018)-/i;
const iidxProductNames = [
  /\bcontroller inf&bms\b/i,
  /\bbeatmania\s+iidx\s+(?:(?:usb\s+)?controller|pro\s+cont(?:r)?oller|professional\s+controller)\b/i,
  /\b(?:dj\s*dao\s+|gamo2\s+)?fp7\s+emp\b/i,
  /\b(?:yuan\s*con\s+)?dx\s*6th\b/i,
];

/** Detect devices exposing the INFINITAS layout as an unmapped HID gamepad. */
export function isIIDXArcadeGamepad(pad: Pick<Gamepad, 'id' | 'mapping' | 'axes' | 'buttons'>): boolean {
  if (pad.mapping !== '' || pad.axes.length < 1 || pad.buttons.length < 7) return false;
  return infinitasUSBId.test(pad.id) || iidxProductNames.some((name) => name.test(pad.id));
}

export const IIDX_GAMEPAD_SCRATCH = { algorithm: 'be-music/gamepad-iidx/1', thresholdTicks: 2, stopMs: 100 };

export interface ArcadeScratchState {
  tick: number;
  direction?: 'up' | 'down';
  movedAt: number;
}

/** An 8-bit absolute encoder wraps at 256. Keep a direction held while it continues moving. */
export function sampleArcadeScratch(
  axis: number,
  nowMs: number,
  previous?: ArcadeScratchState,
): ArcadeScratchState | undefined {
  if (!Number.isFinite(axis) || axis < -1 || axis > 1) return undefined;
  const tick = Math.round((axis + 1) * 127.5);
  if (previous === undefined) return { tick, movedAt: nowMs };
  const delta = ((tick - previous.tick + 384) % 256) - 128;
  if (Math.abs(delta) >= IIDX_GAMEPAD_SCRATCH.thresholdTicks) {
    return { tick, movedAt: nowMs, direction: delta > 0 ? 'up' : 'down' };
  }
  return nowMs - previous.movedAt < IIDX_GAMEPAD_SCRATCH.stopMs
    ? previous
    : { tick: previous.tick, movedAt: previous.movedAt };
}
