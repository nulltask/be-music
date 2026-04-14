const DEFAULT_HIGH_SPEED = 1;
const MIN_HIGH_SPEED = 0.5;
const MAX_HIGH_SPEED = 10;
const HIGH_SPEED_STEP = 0.5;
const BROWSER_HIGH_SPEED_STORAGE_KEY = 'be-music.player-web.high-speed';

interface BrowserStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

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

export function loadPersistedBrowserHighSpeed(storage = resolveBrowserStorage()): number {
  if (!storage) {
    return DEFAULT_HIGH_SPEED;
  }
  try {
    const rawValue = storage.getItem(BROWSER_HIGH_SPEED_STORAGE_KEY);
    if (typeof rawValue !== 'string' || rawValue.length === 0) {
      return DEFAULT_HIGH_SPEED;
    }
    return normalizeBrowserHighSpeed(Number.parseFloat(rawValue));
  } catch {
    return DEFAULT_HIGH_SPEED;
  }
}

export function persistBrowserHighSpeed(value: number, storage = resolveBrowserStorage()): number {
  const normalized = normalizeBrowserHighSpeed(value);
  if (!storage) {
    return normalized;
  }
  try {
    storage.setItem(BROWSER_HIGH_SPEED_STORAGE_KEY, String(normalized));
  } catch {
    // Ignore browser storage failures and continue with the in-memory value.
  }
  return normalized;
}

function resolveBrowserStorage(): BrowserStorageLike | undefined {
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      return undefined;
    }
    if (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      return undefined;
    }
    return storage;
  } catch {
    return undefined;
  }
}
