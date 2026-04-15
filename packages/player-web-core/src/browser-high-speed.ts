import {
  applyHighSpeedControlAction,
  resolveHighSpeedControlActionFromLaneChannels,
  resolveHighSpeedMultiplier,
  type HighSpeedControlAction,
} from '../../player/src/core/high-speed-control.ts';

const DEFAULT_HIGH_SPEED = 1;
const BROWSER_HIGH_SPEED_STORAGE_KEY = 'be-music.player-web.high-speed';

interface BrowserStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function normalizeBrowserHighSpeed(value: number | undefined): number {
  return resolveHighSpeedMultiplier(value);
}

export function increaseBrowserHighSpeed(current: number): number {
  return applyHighSpeedControlAction(current, 'increase');
}

export function decreaseBrowserHighSpeed(current: number): number {
  return applyHighSpeedControlAction(current, 'decrease');
}

export function resolveBrowserHighSpeedActionFromManualInput(
  channels: ReadonlyArray<string>,
  altModifier: boolean,
): HighSpeedControlAction | undefined {
  if (!altModifier) {
    return undefined;
  }
  return resolveHighSpeedControlActionFromLaneChannels(channels);
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

export function resolveBrowserHighSpeedModifierLabel(userAgentPlatform = resolveBrowserPlatform()): 'Alt' | 'Option' {
  return /mac|iphone|ipad|ipod/i.test(userAgentPlatform) ? 'Option' : 'Alt';
}

function resolveBrowserPlatform(): string {
  try {
    const navigatorValue = globalThis.navigator;
    if (!navigatorValue) {
      return '';
    }
    if (typeof navigatorValue.userAgent === 'string' && navigatorValue.userAgent.length > 0) {
      return navigatorValue.userAgent;
    }
    if ('platform' in navigatorValue && typeof navigatorValue.platform === 'string') {
      return navigatorValue.platform;
    }
    return '';
  } catch {
    return '';
  }
}
