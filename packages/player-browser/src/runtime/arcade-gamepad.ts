/** INFINITAS HID layout as exposed by Gamepad API, including compatible PHOENIXWAN firmware. */
export function isIIDXArcadeGamepad(pad: Pick<Gamepad, 'id' | 'mapping' | 'axes' | 'buttons'>): boolean {
  if (pad.mapping !== '' || pad.axes.length < 1 || pad.buttons.length < 7) return false;
  // INFINITAS and compatible firmware can share these IDs. Some browsers only expose the product name.
  return /\bvendor:\s*1ccf\s+product:\s*8048\b|^1ccf-8048-/i.test(pad.id) || /\bcontroller inf&bms\b/i.test(pad.id);
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
