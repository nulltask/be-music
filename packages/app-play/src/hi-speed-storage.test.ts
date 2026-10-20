import { DEFAULT_HISPEED, HISPEED_MAX, HISPEED_MIN } from '@be-music/player-scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { HI_SPEED_STORAGE_KEY, parseStoredHiSpeed, readStoredHiSpeed, storeHiSpeed } from './hi-speed-storage.ts';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('hi-speed storage', () => {
  test('falls back to the default for a missing or unreadable value', () => {
    expect(parseStoredHiSpeed(null)).toBe(DEFAULT_HISPEED);
    expect(parseStoredHiSpeed('')).toBe(DEFAULT_HISPEED);
    expect(parseStoredHiSpeed('fast')).toBe(DEFAULT_HISPEED);
  });

  test('snaps and clamps a stored value to the in-game range', () => {
    expect(parseStoredHiSpeed('2.5')).toBe(2.5);
    expect(parseStoredHiSpeed('1.3000000000000003')).toBe(1.3);
    expect(parseStoredHiSpeed('0')).toBe(HISPEED_MIN);
    expect(parseStoredHiSpeed('99')).toBe(HISPEED_MAX);
  });

  test('round-trips through storage', () => {
    const storage = memoryStorage();
    expect(readStoredHiSpeed(storage)).toBe(DEFAULT_HISPEED);
    storeHiSpeed(3.4000000000000004, storage);
    expect(storage.getItem(HI_SPEED_STORAGE_KEY)).toBe('3.4');
    expect(readStoredHiSpeed(storage)).toBe(3.4);
  });

  test('ignores a non-finite value and blocked storage', () => {
    const storage = memoryStorage();
    storeHiSpeed(Number.NaN, storage);
    expect(storage.getItem(HI_SPEED_STORAGE_KEY)).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredHiSpeed(blocked)).toBe(DEFAULT_HISPEED);
    expect(() => storeHiSpeed(2, blocked)).not.toThrow();
  });
});
