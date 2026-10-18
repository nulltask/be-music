import { describe, expect, test } from 'vite-plus/test';
import type { DeviceSignals } from '../device-profile.ts';
import {
  BUILT_IN_SKIN_STORAGE_KEY,
  PLAY_LAYOUT_STORAGE_KEY,
  readStoredBuiltInSkinId,
  readStoredPlayLayout,
  readStoredRecordingFormat,
  readStoredSkinEffects,
  readStoredVolumes,
  RECORDING_FORMAT_STORAGE_KEY,
  SKIN_EFFECTS_STORAGE_KEY,
  storeBuiltInSkinId,
  storePlayLayout,
  storeRecordingFormat,
  storeSkinEffects,
  storeVolumes,
  VOLUME_STORAGE_KEY,
  type SettingStorage,
} from './settings.ts';

/** A `localStorage` stand-in, seeded with `entries`. */
function memoryStorage(
  entries: Record<string, string> = {},
): SettingStorage & { readonly values: Map<string, string> } {
  const values = new Map(Object.entries(entries));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** Storage that throws on every call, as a blocked `localStorage` does in a private window. */
const blockedStorage: SettingStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

const desktop: DeviceSignals = {
  coarsePointer: false,
  anyCoarsePointer: false,
  prefersReducedMotion: false,
  screenWidth: 1920,
  screenHeight: 1080,
};
const phone: DeviceSignals = {
  ...desktop,
  coarsePointer: true,
  anyCoarsePointer: true,
  screenWidth: 390,
  screenHeight: 844,
};

describe('settings storage keys', () => {
  test('stay the be-music-demo.* keys returning players and the end-to-end suite rely on', () => {
    expect([
      BUILT_IN_SKIN_STORAGE_KEY,
      SKIN_EFFECTS_STORAGE_KEY,
      PLAY_LAYOUT_STORAGE_KEY,
      RECORDING_FORMAT_STORAGE_KEY,
      VOLUME_STORAGE_KEY,
    ]).toEqual([
      'be-music-demo.built-in-skin',
      'be-music-demo.skin-effects',
      'be-music-demo.play-layout',
      'be-music-demo.recording-format',
      'be-music-demo.volumes',
    ]);
  });
});

describe('built-in skin', () => {
  test('round-trips the picked skin id, and reads nothing when none is stored', () => {
    const storage = memoryStorage();
    expect(readStoredBuiltInSkinId(storage)).toBeUndefined();
    storeBuiltInSkinId('plain', storage);
    expect(storage.values.get(BUILT_IN_SKIN_STORAGE_KEY)).toBe('plain');
    expect(readStoredBuiltInSkinId(storage)).toBe('plain');
  });

  test('blocked or missing storage reads nothing and stores nothing, without throwing', () => {
    expect(readStoredBuiltInSkinId(blockedStorage)).toBeUndefined();
    expect(() => storeBuiltInSkinId('plain', blockedStorage)).not.toThrow();
    expect(readStoredBuiltInSkinId(undefined)).toBeUndefined();
  });
});

describe('skin effects', () => {
  test('reads the stored level, else the device default', () => {
    expect(readStoredSkinEffects(memoryStorage({ [SKIN_EFFECTS_STORAGE_KEY]: 'off' }), desktop)).toBe('off');
    expect(readStoredSkinEffects(memoryStorage(), desktop)).toBe('full');
    expect(readStoredSkinEffects(memoryStorage(), phone)).toBe('reduced');
    expect(readStoredSkinEffects(memoryStorage(), { ...desktop, prefersReducedMotion: true })).toBe('reduced');
  });

  test('falls back to the device default when storage is blocked, and stores a pick', () => {
    expect(readStoredSkinEffects(blockedStorage, phone)).toBe('reduced');
    const storage = memoryStorage();
    storeSkinEffects('reduced', storage);
    expect(storage.values.get(SKIN_EFFECTS_STORAGE_KEY)).toBe('reduced');
    expect(() => storeSkinEffects('off', blockedStorage)).not.toThrow();
  });
});

describe('play layout', () => {
  test('reads a known pick, else auto', () => {
    expect(readStoredPlayLayout(memoryStorage({ [PLAY_LAYOUT_STORAGE_KEY]: 'touch' }))).toBe('touch');
    expect(readStoredPlayLayout(memoryStorage({ [PLAY_LAYOUT_STORAGE_KEY]: 'standard' }))).toBe('standard');
    expect(readStoredPlayLayout(memoryStorage({ [PLAY_LAYOUT_STORAGE_KEY]: 'sideways' }))).toBe('auto');
    expect(readStoredPlayLayout(memoryStorage())).toBe('auto');
    expect(readStoredPlayLayout(blockedStorage)).toBe('auto');
  });

  test('stores a pick', () => {
    const storage = memoryStorage();
    storePlayLayout('touch', storage);
    expect(readStoredPlayLayout(storage)).toBe('touch');
    expect(() => storePlayLayout('touch', blockedStorage)).not.toThrow();
  });
});

describe('recording format', () => {
  test('round-trips a format key, and falls back to MP4 · H.264', () => {
    const storage = memoryStorage();
    expect(readStoredRecordingFormat(storage)).toBe('mp4/avc');
    storeRecordingFormat('webm/vp9', storage);
    expect(storage.values.get(RECORDING_FORMAT_STORAGE_KEY)).toBe('webm/vp9');
    expect(readStoredRecordingFormat(storage)).toBe('webm/vp9');
  });

  test('an unknown key or blocked storage reads the default', () => {
    expect(readStoredRecordingFormat(memoryStorage({ [RECORDING_FORMAT_STORAGE_KEY]: 'gif/none' }))).toBe('mp4/avc');
    expect(readStoredRecordingFormat(blockedStorage)).toBe('mp4/avc');
    expect(() => storeRecordingFormat('webm/vp9', blockedStorage)).not.toThrow();
  });
});

describe('volumes', () => {
  test('are all 100 % when nothing is stored, the JSON is broken or storage is blocked', () => {
    const full = { masterVolume: 100, keyVolume: 100, bgmVolume: 100 };
    expect(readStoredVolumes(memoryStorage())).toEqual(full);
    expect(readStoredVolumes(memoryStorage({ [VOLUME_STORAGE_KEY]: '{not json' }))).toEqual(full);
    expect(readStoredVolumes(blockedStorage)).toEqual(full);
  });

  test('round-trip, each clamped to 0..100, a missing or non-numeric one at 100', () => {
    const storage = memoryStorage();
    storeVolumes({ masterVolume: 80, keyVolume: 55, bgmVolume: 30 }, storage);
    expect(readStoredVolumes(storage)).toEqual({ masterVolume: 80, keyVolume: 55, bgmVolume: 30 });
    const odd = memoryStorage({
      [VOLUME_STORAGE_KEY]: JSON.stringify({ masterVolume: 140, keyVolume: -5, bgmVolume: 'x' }),
    });
    expect(readStoredVolumes(odd)).toEqual({ masterVolume: 100, keyVolume: 0, bgmVolume: 100 });
    expect(() => storeVolumes({ masterVolume: 1, keyVolume: 1, bgmVolume: 1 }, blockedStorage)).not.toThrow();
  });
});
