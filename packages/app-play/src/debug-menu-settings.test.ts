import { describe, expect, test } from 'vite-plus/test';
import {
  DEBUG_MENU_SETTINGS_STORAGE_KEY,
  captureDebugMenuSettings,
  readStoredDebugMenuSettings,
  type DebugMenuSettings,
  debugMenuSettingsFromLegacy,
  overlayDebugMenuSettings,
  parseDebugMenuSettingsDocument,
  writeDebugMenuSettings,
} from './debug-menu-settings.ts';
import { defaultCompressorTunings } from './compressor-tuning.ts';
import { createPlayerGUIState, VOLUME_STORAGE_KEY } from './services/settings.ts';
import type { PlayerGUIState } from './types.ts';

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
    const state = { gauge: 'GROOVE', autoPlay: false, peakGain: false } as PlayerGUIState;
    overlayDebugMenuSettings(state, { gauge: 'DEATH', peakGain: true });
    expect(state.gauge).toBe('DEATH');
    expect(state.peakGain).toBe(true);
    expect(state.autoPlay).toBe(false);
  });
});

describe('captureDebugMenuSettings', () => {
  test('round-trips every setting through the document and boot-time legacy keys', () => {
    const storage = memory();
    const create = () =>
      createPlayerGUIState({
        storage,
        signals: {
          coarsePointer: false,
          anyCoarsePointer: false,
          prefersReducedMotion: false,
          screenWidth: 1920,
          screenHeight: 1080,
        },
        devicePixelRatio: 2,
        builtInSkinId: (stored) => stored ?? 'native',
        actions: { openFolder() {}, openFiles() {}, record() {}, screenshot() {} },
      });
    const expected = {
      autoPlay: true,
      autoPauseOnBlur: true,
      peakGain: true,
      compressor: false,
      compressorKey: false,
      compressorBGM: false,
      compressorMaster: false,
      bgaResizeMaxEdgePx: 720,
      bgaUseWebCodecs: false,
      showInvisibleNotes: true,
      judgedNoteDisplay: 'HIDE',
      autoSaveReplay: true,
      courseAutoAdvance: true,
      nonstopPlacement: 'lr2',
      submitToLeaderboard: true,
      judgeRuleset: 'beatoraja',
      gauge: 'HARD',
      random1P: 'SCATTER',
      hRandomThresholdBPM: 120,
      randomSeed1P: '-1',
      randomSeed2P: '-1',
      randomFixedLane1P: 0,
      randomFixedLane2P: 0,
      random2P: 'MIRROR',
      dpFlip: true,
      bpmGuide: true,
      judgeTimingMs: 0,
      visualConstant: false,
      noteDurationMs: 500,
      lift1P: 0.1,
      lift2P: 0.1,
      liftOn1P: false,
      liftOn2P: false,

      constantFadeMs: 100,
      normalHiSpeedLevel: 0,
      classicHiSpeed: true,
      floatingHiSpeed: false,
      fixedDisplayArea: false,
      judgeAlgorithm: 'duration',
      longNoteModifier: 'REMOVE',
      mineModifier: 'OFF',
      gaugeAutoShift: 'NONE',
      autoScratch1P: true,
      autoScratch2P: true,
      sort: 'OFF',
      keysFilter: 'ALL',
      difficultyFilter: 'ALL',
      skinFamilyOverride: 'lr2',
      masterVolume: 21,
      muted: true,
      keyVolume: 32,
      bgmVolume: 43,
      playInSilentMode: false,
      tempoEnabled: true,
      tempoPercent: 15,
      tempoPitchMode: 'keep-pitch',
      tempoStretchAlgorithm: 'signalsmith',
      replayView: { tempo: false, hiSpeed: false, covers: false, lift: false },
      hiSpeed: 2.5,
      hsFix: 'STARTBPM',
      displayAreaInfo: 'ON',
      hiddenSudden1P: 'SUDDEN',
      hiddenSudden2P: 'HID+SUD',
      laneCover: true,
      shutter: 0.4,
      builtInSkin: 'plain',
      skinEffects: 'off',
      renderResolution: 1,
      playLayout: 'touch',
      recordingFormat: 'mp4/avc',
      workerCount: 3,
      compressorTuning: defaultCompressorTunings(),
      skinSettings: { test: { glow: false, offset: 5, theme: 'light' } },
      courseTableURLs: ['https://example.com/courses.json'],
      folders: { Audio: false, 'Skin & display': true },
    } satisfies DebugMenuSettings;
    expected.compressorTuning.master.thresholdDb = -12;
    const state = Object.assign(create(), expected);
    const captured = captureDebugMenuSettings(state, {
      ...expected,
      skinSettings: new Map(Object.entries(expected.skinSettings)),
      updatedAt: 42,
    });
    expect(captured).toEqual({ version: 1, updatedAt: 42, settings: expected });
    writeDebugMenuSettings(captured, storage);
    expect(readStoredDebugMenuSettings(storage)).toEqual(captured);
    const restored = create();
    for (const key of Object.keys(expected) as (keyof DebugMenuSettings)[]) {
      if (key in restored) expect(restored[key as keyof PlayerGUIState], key).toEqual(expected[key]);
    }
    const legacy = debugMenuSettingsFromLegacy(storage, 43).settings;
    for (const key of ['workerCount', 'compressorTuning', 'skinSettings', 'courseTableURLs', 'folders'] as const) {
      expect(legacy[key], key).toEqual(expected[key]);
    }
  });

  test('normalizes a reset to metadata only and rejects negative revisions', () => {
    expect(
      parseDebugMenuSettingsDocument(
        JSON.stringify({ version: 1, updatedAt: 42, settings: { gauge: 'HARD' }, deleted: true }),
      ),
    ).toEqual({ version: 1, updatedAt: 42, settings: {}, deleted: true });
    expect(parseDebugMenuSettingsDocument(JSON.stringify({ version: 1, updatedAt: -1, settings: {} }))).toBeUndefined();
  });
});

test('persists both sides of R-RANDOM in Debug Menu settings', () => {
  const settings = { random1P: 'R-RANDOM', random2P: 'R-RANDOM' };
  expect(
    parseDebugMenuSettingsDocument(JSON.stringify({ version: 1, updatedAt: 1, settings }))?.settings,
  ).toMatchObject(settings);
});

test('persists and validates the H-RANDOM source configuration', () => {
  expect(
    parseDebugMenuSettingsDocument(
      JSON.stringify({ version: 1, updatedAt: 1, settings: { random1P: 'H-RANDOM', hRandomThresholdBPM: 300 } }),
    )?.settings,
  ).toMatchObject({ random1P: 'H-RANDOM', hRandomThresholdBPM: 300 });
});

test('persists per-side LR2 CONVERGE targets', () => {
  const settings = { random1P: 'CONVERGE', randomFixedLane1P: 3, randomFixedLane2P: 7 };
  expect(
    parseDebugMenuSettingsDocument(JSON.stringify({ version: 1, updatedAt: 1, settings }))?.settings,
  ).toMatchObject(settings);
});

test('persists large seed values as decimal strings', () => {
  const settings = { randomSeed1P: '9223372036854775807', randomSeed2P: '-1' };
  expect(
    parseDebugMenuSettingsDocument(JSON.stringify({ version: 1, updatedAt: 1, settings }))?.settings,
  ).toMatchObject(settings);
});

test('persists mine REMOVE independently of note drawing preferences', () => {
  expect(
    parseDebugMenuSettingsDocument(
      JSON.stringify({ version: 1, updatedAt: 1, settings: { mineModifier: 'REMOVE', showInvisibleNotes: true } }),
    )?.settings,
  ).toMatchObject({ mineModifier: 'REMOVE', showInvisibleNotes: true });
});

test('gauge auto-shift CONTINUE is retained in saved settings', () => {
  expect(
    parseDebugMenuSettingsDocument(
      JSON.stringify({ version: 1, updatedAt: 1, settings: { gaugeAutoShift: 'CONTINUE' } }),
    )?.settings,
  ).toMatchObject({ gaugeAutoShift: 'CONTINUE' });
});

test('floating speed persistence keeps source precision and values above the generic speed cap', () => {
  const settings = { floatingHiSpeed: true, hiSpeed: 8 + 1 / 300 };
  expect(
    parseDebugMenuSettingsDocument(JSON.stringify({ version: 1, updatedAt: 1, settings }))?.settings,
  ).toMatchObject(settings);
});

test('fixed display area persists independently from floating mode', () => {
  const settings = { fixedDisplayArea: true, floatingHiSpeed: false };
  expect(
    parseDebugMenuSettingsDocument(JSON.stringify({ version: 1, updatedAt: 1, settings }))?.settings,
  ).toMatchObject(settings);
});
