import { describe, expect, test } from 'vitest';
import {
  decreaseBrowserHighSpeed,
  formatBrowserHighSpeed,
  increaseBrowserHighSpeed,
  loadPersistedBrowserHighSpeed,
  normalizeBrowserHighSpeed,
  persistBrowserHighSpeed,
  resolveBrowserHighSpeedActionFromManualInput,
  resolveBrowserHighSpeedModifierLabel,
} from './browser-high-speed.ts';

describe('player-web-core browser high speed', () => {
  test('normalizes high speed to 0.5 steps within the allowed range', () => {
    expect(normalizeBrowserHighSpeed(undefined)).toBe(1);
    expect(normalizeBrowserHighSpeed(0.2)).toBe(0.5);
    expect(normalizeBrowserHighSpeed(1.24)).toBe(1);
    expect(normalizeBrowserHighSpeed(1.26)).toBe(1.5);
    expect(normalizeBrowserHighSpeed(10.7)).toBe(10);
  });

  test('increments and decrements in 0.5 steps', () => {
    expect(increaseBrowserHighSpeed(1)).toBe(1.5);
    expect(decreaseBrowserHighSpeed(1)).toBe(0.5);
    expect(increaseBrowserHighSpeed(10)).toBe(10);
  });

  test('resolves manual high-speed actions from odd/even lane input only with Alt or Option held', () => {
    expect(resolveBrowserHighSpeedActionFromManualInput(['11'], false)).toBeUndefined();
    expect(resolveBrowserHighSpeedActionFromManualInput(['11'], true)).toBe('decrease');
    expect(resolveBrowserHighSpeedActionFromManualInput(['12'], true)).toBe('increase');
    expect(resolveBrowserHighSpeedActionFromManualInput(['11', '12'], true)).toBeUndefined();
  });

  test('formats high speed consistently', () => {
    expect(formatBrowserHighSpeed(1)).toBe('1.0');
    expect(formatBrowserHighSpeed(3.5)).toBe('3.5');
  });

  test('resolves the platform-specific modifier label for manual high-speed control', () => {
    expect(resolveBrowserHighSpeedModifierLabel('MacIntel')).toBe('Option');
    expect(resolveBrowserHighSpeedModifierLabel('iPhone')).toBe('Option');
    expect(resolveBrowserHighSpeedModifierLabel('Win32')).toBe('Alt');
  });

  test('loads persisted high speed from browser storage', () => {
    const storage = new Map<string, string>([['be-music.player-web.high-speed', '3.5']]);
    expect(
      loadPersistedBrowserHighSpeed({
        getItem: (key) => storage.get(key) ?? null,
        setItem: () => undefined,
      }),
    ).toBe(3.5);
  });

  test('persists normalized high speed to browser storage', () => {
    const storage = new Map<string, string>();
    expect(
      persistBrowserHighSpeed(3.26, {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
      }),
    ).toBe(3.5);
    expect(storage.get('be-music.player-web.high-speed')).toBe('3.5');
  });

  test('falls back to the default high speed when browser storage access fails', () => {
    expect(
      loadPersistedBrowserHighSpeed({
        getItem: () => {
          throw new Error('storage blocked');
        },
        setItem: () => undefined,
      }),
    ).toBe(1);
    expect(
      persistBrowserHighSpeed(2, {
        getItem: () => null,
        setItem: () => {
          throw new Error('storage blocked');
        },
      }),
    ).toBe(2);
  });
});
