import { describe, expect, test } from 'vite-plus/test';
import {
  DEBUG_MENU_SETTINGS_STORAGE_KEY,
  debugMenuSettingsFromLegacy,
  overlayDebugMenuSettings,
  parseDebugMenuSettingsDocument,
  writeDebugMenuSettings,
} from './debug-menu-settings.ts';
import { VOLUME_STORAGE_KEY } from './services/settings.ts';
import type { DemoGUIState } from './types.ts';

function memory(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
  };
}

describe('parseDebugMenuSettingsDocument', () => {
  test('keeps a known setting and drops an unknown one', () => {
    const document = parseDebugMenuSettingsDocument(
      JSON.stringify({
        version: 1,
        updatedAt: 10,
        settings: { gauge: 'HARD', autoPlay: true, judgedNoteDisplay: 'NOPE', peakGain: true },
      }),
    );
    expect(document?.settings).toMatchObject({ gauge: 'HARD', autoPlay: true, peakGain: true });
    expect(document?.settings.judgedNoteDisplay).toBeUndefined();
  });

  test('ignores another version', () => {
    expect(parseDebugMenuSettingsDocument(JSON.stringify({ version: 2, updatedAt: 1, settings: {} }))).toBeUndefined();
  });
});

describe('debugMenuSettingsFromLegacy', () => {
  test('reads the volumes key this app used to write on its own', () => {
    const storage = memory();
    storage.setItem(
      VOLUME_STORAGE_KEY,
      JSON.stringify({ masterVolume: 40, keyVolume: 100, bgmVolume: 100, muted: true }),
    );
    const document = debugMenuSettingsFromLegacy(storage, 5);
    expect(document.settings).toMatchObject({ masterVolume: 40, muted: true });
    expect(document.updatedAt).toBe(5);
  });
});

describe('writeDebugMenuSettings', () => {
  test('writes the document and the volume key a boot still reads', () => {
    const storage = memory();
    writeDebugMenuSettings(
      {
        version: 1,
        updatedAt: 8,
        settings: { masterVolume: 12, muted: false, keyVolume: 100, bgmVolume: 80, gauge: 'EASY' },
      },
      storage,
    );
    expect(parseDebugMenuSettingsDocument(storage.getItem(DEBUG_MENU_SETTINGS_STORAGE_KEY))?.settings.gauge).toBe(
      'EASY',
    );
    expect(JSON.parse(storage.getItem(VOLUME_STORAGE_KEY)!)).toMatchObject({ masterVolume: 12, bgmVolume: 80 });
  });
});

describe('overlayDebugMenuSettings', () => {
  test('replaces only the fields the document has', () => {
    const state = { gauge: 'GROOVE', autoPlay: false, peakGain: false } as DemoGUIState;
    overlayDebugMenuSettings(state, { gauge: 'DEATH', peakGain: true });
    expect(state.gauge).toBe('DEATH');
    expect(state.peakGain).toBe(true);
    expect(state.autoPlay).toBe(false);
  });
});
