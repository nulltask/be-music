import { DEFAULT_HISPEED, snapHiSpeed } from '@be-music/scene-model';

/** `localStorage` key of the hi-speed the next play starts at (the last one picked in play, the panel or the menu). */
export const HI_SPEED_STORAGE_KEY = 'be-music-demo.hi-speed';

/** A stored hi-speed, snapped and clamped to the player's range; {@link DEFAULT_HISPEED} when missing or unreadable. */
export function parseStoredHiSpeed(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === '') return DEFAULT_HISPEED;
  return snapHiSpeed(Number(raw)) ?? DEFAULT_HISPEED;
}

/** The remembered hi-speed, or {@link DEFAULT_HISPEED} when none is stored or storage is blocked. */
export function readStoredHiSpeed(storage: Pick<Storage, 'getItem'> | undefined = defaultStorage()): number {
  try {
    return parseStoredHiSpeed(storage?.getItem(HI_SPEED_STORAGE_KEY));
  } catch {
    // Storage blocked — use the default.
    return DEFAULT_HISPEED;
  }
}

/** Remembers `value` (snapped and clamped) for the next play; ignores non-finite values. */
export function storeHiSpeed(value: number, storage: Pick<Storage, 'setItem'> | undefined = defaultStorage()): void {
  const snapped = snapHiSpeed(value);
  if (snapped === undefined) return;
  try {
    storage?.setItem(HI_SPEED_STORAGE_KEY, String(snapped));
  } catch {
    // Private windows / blocked storage: the value still applies for this session.
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
