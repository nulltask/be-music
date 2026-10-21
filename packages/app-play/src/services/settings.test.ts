import { DEFAULT_HISPEED } from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import type { DeviceSignals } from '../device-profile.ts';
import { HI_SPEED_STORAGE_KEY } from '../hi-speed-storage.ts';
import { PLAY_TEMPO_STORAGE_KEY } from '../play-tempo-settings.ts';
import { RENDER_RESOLUTION_STORAGE_KEY } from '../render-resolution.ts';
import { PLAY_IN_SILENT_MODE_STORAGE_KEY } from '../silent-mode-playback.ts';
import {
  BUILT_IN_SKIN_STORAGE_KEY,
  createDemoGUIState,
  resolveCompressorMode,
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
    const full = { masterVolume: 100, muted: false, keyVolume: 100, bgmVolume: 100 };
    expect(readStoredVolumes(memoryStorage())).toEqual(full);
    expect(readStoredVolumes(memoryStorage({ [VOLUME_STORAGE_KEY]: '{not json' }))).toEqual(full);
    expect(readStoredVolumes(blockedStorage)).toEqual(full);
  });

  test('round-trip, each clamped to 0..100, a missing or non-numeric one at 100', () => {
    const storage = memoryStorage();
    storeVolumes({ masterVolume: 80, keyVolume: 55, bgmVolume: 30 }, storage);
    expect(readStoredVolumes(storage)).toEqual({ masterVolume: 80, muted: false, keyVolume: 55, bgmVolume: 30 });
    const odd = memoryStorage({
      [VOLUME_STORAGE_KEY]: JSON.stringify({ masterVolume: 140, keyVolume: -5, bgmVolume: 'x' }),
    });
    expect(readStoredVolumes(odd)).toEqual({ masterVolume: 100, muted: false, keyVolume: 0, bgmVolume: 100 });
    expect(() => storeVolumes({ masterVolume: 1, keyVolume: 1, bgmVolume: 1 }, blockedStorage)).not.toThrow();
  });
});

describe('createDemoGUIState', () => {
  const actions = {
    openFolder: vi.fn(),
    openFiles: vi.fn(),
    record: vi.fn(),
    screenshot: vi.fn(),
  };
  const create = (storage: SettingStorage, overrides: { devicePixelRatio?: number; signals?: DeviceSignals } = {}) =>
    createDemoGUIState({
      storage,
      signals: overrides.signals ?? desktop,
      devicePixelRatio: overrides.devicePixelRatio ?? 2,
      builtInSkinId: (stored) => (stored === 'plain' ? 'plain' : 'synesthesia'),
      actions,
    });

  test('starts a first visit from the defaults', () => {
    const state = create(memoryStorage());
    expect(state).toMatchObject({
      autoPlay: false,
      masterVolume: 100,
      muted: false,
      keyVolume: 100,
      bgmVolume: 100,
      playInSilentMode: true,
      compressor: true,
      autoSaveReplay: false,
      tempoEnabled: false,
      tempoStretchAlgorithm: 'wsola',
      tempoPercent: 0,
      judgeRuleset: 'lr2',
      gauge: 'GROOVE',
      random1P: 'OFF',
      sort: 'OFF',
      hiSpeed: DEFAULT_HISPEED,
      skinFamilyOverride: 'auto',
      builtInSkin: 'synesthesia',
      skinEffects: 'full',
      renderResolution: 1.5,
      playLayout: 'auto',
      recordingFormat: 'mp4/avc',
      status: 'Ready',
    });
    expect(state.openFolder).toBe(actions.openFolder);
    expect(state.record).toBe(actions.record);
  });

  test('picks up every remembered setting from its be-music-demo.* key', () => {
    const state = create(
      memoryStorage({
        [VOLUME_STORAGE_KEY]: JSON.stringify({ masterVolume: 70, keyVolume: 60, bgmVolume: 50 }),
        [PLAY_IN_SILENT_MODE_STORAGE_KEY]: 'off',
        [PLAY_TEMPO_STORAGE_KEY]: JSON.stringify({
          tempoEnabled: true,
          tempoPercent: 10,
          tempoPitchMode: 'keep-pitch',
        }),
        [HI_SPEED_STORAGE_KEY]: '3.5',
        [BUILT_IN_SKIN_STORAGE_KEY]: 'plain',
        [SKIN_EFFECTS_STORAGE_KEY]: 'off',
        [RENDER_RESOLUTION_STORAGE_KEY]: '1',
        [PLAY_LAYOUT_STORAGE_KEY]: 'touch',
        [RECORDING_FORMAT_STORAGE_KEY]: 'webm/vp9',
      }),
    );
    expect(state).toMatchObject({
      masterVolume: 70,
      muted: false,
      keyVolume: 60,
      bgmVolume: 50,
      playInSilentMode: false,
      tempoEnabled: true,
      tempoPercent: 10,
      tempoPitchMode: 'keep-pitch',
      hiSpeed: 3.5,
      builtInSkin: 'plain',
      skinEffects: 'off',
      renderResolution: 1,
      playLayout: 'touch',
      recordingFormat: 'webm/vp9',
    });
  });

  test('fits the render resolution to the display, and the skin effects to the device', () => {
    expect(
      create(memoryStorage({ [RENDER_RESOLUTION_STORAGE_KEY]: '3' }), { devicePixelRatio: 2 }).renderResolution,
    ).toBe(2);
    expect(create(memoryStorage(), { devicePixelRatio: 1 }).renderResolution).toBe(1);
    expect(create(memoryStorage(), { signals: phone }).skinEffects).toBe('reduced');
  });

  test('starts from the defaults when storage is blocked', () => {
    const state = create(blockedStorage);
    expect(state).toMatchObject({
      masterVolume: 100,
      hiSpeed: DEFAULT_HISPEED,
      builtInSkin: 'synesthesia',
      playLayout: 'auto',
    });
  });
});

describe('resolveCompressorMode', () => {
  const at = (query: string) => resolveCompressorMode(`https://be-music.app/${query}`);

  test('keeps the split compressor on without a flag, or with one it does not know', () => {
    expect(at('')).toEqual({ mode: 'split', enabled: true });
    expect(at('?compressor=loud')).toEqual({ mode: 'split', enabled: true });
  });

  test('split and legacy pick that architecture, on; off turns it off', () => {
    expect(at('?compressor=split')).toEqual({ mode: 'split', enabled: true });
    expect(at('?compressor=legacy')).toEqual({ mode: 'legacy', enabled: true });
    expect(at('?e2e=1&compressor=off')).toEqual({ mode: 'split', enabled: false });
    expect(at('?compressor=LEGACY')).toEqual({ mode: 'legacy', enabled: true });
  });
});
