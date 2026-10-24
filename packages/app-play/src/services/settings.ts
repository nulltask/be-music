// The settings the player remembers across visits (`localStorage`, under `be-music.*` keys). Every read falls back
// to the default and every write is skipped when storage is blocked (a private window), so a setting still applies
// for the visit. The keys are part of the player's contract with returning players and with the end-to-end suite, which
// seeds them: never rename one.

import { parseCompressorMode, type CompressorMode } from '@be-music/player-browser/audio';
import { readStoredHiSpeed } from '../hi-speed-storage.ts';
import { readStoredPlayTempoSettings } from '../play-tempo-settings.ts';
import { parseRecordingFormatKey, recordingFormatKey } from '../recording-format-choice.ts';
import {
  DEFAULT_RENDER_RESOLUTION,
  nearestRenderResolution,
  readStoredRenderResolution,
  renderResolutionSteps,
} from '../render-resolution.ts';
import { readStoredReplayView } from '../replay-view-settings.ts';
import { overlayDebugMenuSettings, readStoredDebugMenuSettings } from '../debug-menu-settings.ts';
import { readPlayInSilentMode } from '../silent-mode-playback.ts';
import type { PlayerGUIState } from '../types.ts';
import {
  readDeviceSignals,
  resolveDefaultSkinEffects,
  type DeviceSignals,
  type PlayLayoutChoice,
  type SkinEffectsLevel,
} from '../device-profile.ts';

/** Where the settings are kept: `localStorage`, or a stand-in. */
export type SettingStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** `localStorage`, or `undefined` where there is none or it is blocked. */
export function defaultSettingStorage(): SettingStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export const BUILT_IN_SKIN_STORAGE_KEY = 'be-music.built-in-skin';

export function readStoredBuiltInSkinId(
  storage: SettingStorage | undefined = defaultSettingStorage(),
): string | undefined {
  try {
    return storage?.getItem(BUILT_IN_SKIN_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function storeBuiltInSkinId(id: string, storage: SettingStorage | undefined = defaultSettingStorage()): void {
  try {
    storage?.setItem(BUILT_IN_SKIN_STORAGE_KEY, id);
  } catch {
    // Private windows / blocked storage: the pick still applies for this session.
  }
}

export const SKIN_EFFECTS_STORAGE_KEY = 'be-music.skin-effects';

/** Stored effect level, else `'reduced'` on a phone / tablet or when the OS asks for reduced motion, else `'full'`. */
export function readStoredSkinEffects(
  storage: SettingStorage | undefined = defaultSettingStorage(),
  signals: DeviceSignals = readDeviceSignals(),
): SkinEffectsLevel {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(SKIN_EFFECTS_STORAGE_KEY) ?? null;
  } catch {
    // Storage blocked — fall back to the device default.
  }
  return resolveDefaultSkinEffects(stored, signals);
}

export function storeSkinEffects(
  level: SkinEffectsLevel,
  storage: SettingStorage | undefined = defaultSettingStorage(),
): void {
  try {
    storage?.setItem(SKIN_EFFECTS_STORAGE_KEY, level);
  } catch {
    // Private windows / blocked storage: the pick still applies for this session.
  }
}

export const PLAY_LAYOUT_STORAGE_KEY = 'be-music.play-layout';

/** Stored Debug Menu play-layout pick, `'auto'` when none. */
export function readStoredPlayLayout(storage: SettingStorage | undefined = defaultSettingStorage()): PlayLayoutChoice {
  try {
    const stored = storage?.getItem(PLAY_LAYOUT_STORAGE_KEY);
    if (stored === 'auto' || stored === 'standard' || stored === 'touch') return stored;
  } catch {
    // Storage blocked — use the default.
  }
  return 'auto';
}

export function storePlayLayout(
  choice: PlayLayoutChoice,
  storage: SettingStorage | undefined = defaultSettingStorage(),
): void {
  try {
    storage?.setItem(PLAY_LAYOUT_STORAGE_KEY, choice);
  } catch {
    // Private windows / blocked storage: the pick still applies for this session.
  }
}

export const RECORDING_FORMAT_STORAGE_KEY = 'be-music.recording-format';

/** The remembered "Video format" (`mp4/avc`, `webm/vp9`, …); MP4 · H.264 when none is stored or it is unknown. */
export function readStoredRecordingFormat(storage: SettingStorage | undefined = defaultSettingStorage()): string {
  try {
    return recordingFormatKey(parseRecordingFormatKey(storage?.getItem(RECORDING_FORMAT_STORAGE_KEY) ?? null));
  } catch {
    // Storage blocked — use the default.
    return recordingFormatKey(parseRecordingFormatKey(null));
  }
}

export function storeRecordingFormat(key: string, storage: SettingStorage | undefined = defaultSettingStorage()): void {
  try {
    storage?.setItem(RECORDING_FORMAT_STORAGE_KEY, key);
  } catch {
    // Storage blocked — the choice lasts for this visit only.
  }
}

export const VOLUME_STORAGE_KEY = 'be-music.volumes';

export interface StoredVolumes {
  masterVolume: number;
  muted: boolean;
  keyVolume: number;
  bgmVolume: number;
}

/** Master / keysound / BGM volumes in percent, as last set in the Debug Menu (all 100 when nothing is stored). */
export function readStoredVolumes(storage: SettingStorage | undefined = defaultSettingStorage()): StoredVolumes {
  const fallback = { masterVolume: 100, muted: false, keyVolume: 100, bgmVolume: 100 };
  try {
    const raw = storage?.getItem(VOLUME_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Record<keyof StoredVolumes, unknown>>;
    const percent = (value: unknown, otherwise: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : otherwise;
    return {
      masterVolume: percent(parsed.masterVolume, 100),
      muted: parsed.muted === true,
      keyVolume: percent(parsed.keyVolume, 100),
      bgmVolume: percent(parsed.bgmVolume, 100),
    };
  } catch {
    return fallback;
  }
}

export function storeVolumes(
  volumes: Pick<StoredVolumes, 'masterVolume' | 'keyVolume' | 'bgmVolume'> & Partial<Pick<StoredVolumes, 'muted'>>,
  storage: SettingStorage | undefined = defaultSettingStorage(),
): void {
  try {
    storage?.setItem(VOLUME_STORAGE_KEY, JSON.stringify({ ...volumes, muted: volumes.muted ?? false }));
  } catch {
    // Private windows / blocked storage: the volumes still apply for this session.
  }
}

/** What {@link createPlayerGUIState} reads besides the stored settings: the device, and the Debug Menu's buttons. */
export interface PlayerGUIStateInputs {
  /** Where the remembered settings are read from; `localStorage` when left out. */
  readonly storage?: SettingStorage;
  /** The device, for the skin effect level it starts with. */
  readonly signals: DeviceSignals;
  /** The display's pixel ratio, for the render resolutions offered. */
  readonly devicePixelRatio: number;
  /** The built-in skin to start with for the remembered id (`undefined` when none is stored). */
  readonly builtInSkinId: (stored: string | undefined) => string;
  /** The Debug Menu's buttons. */
  readonly actions: Pick<PlayerGUIState, 'openFolder' | 'openFiles' | 'record' | 'screenshot'>;
}

/**
 * The state the Debug Menu's controllers read and write, as a visit starts: the remembered settings over the defaults.
 */
export function createPlayerGUIState(inputs: PlayerGUIStateInputs): PlayerGUIState {
  const storage = inputs.storage ?? defaultSettingStorage();
  const state: PlayerGUIState = {
    autoPlay: false,
    autoPauseOnBlur: false,
    // Compressor stack ON by default — without it, multiple simultaneous `#WAV` samples sum past full scale and
    // digital- clip at the destination. The `MIXER_HEADROOM_GAIN_LINEAR` attenuation in `audio-bus.ts` buys a little
    // headroom but the master limiter is what reliably prevents audible clipping on dense charts. Power users wanting
    // an unprocessed signal path can still flip it via `?compressor=off` or the GUI.
    ...readStoredVolumes(storage),
    playInSilentMode: readPlayInSilentMode(storage),
    // Peak gain is off until the Debug Menu turns it on. The choice is remembered with the other Debug Menu settings.
    peakGain: false,
    compressor: true,
    compressorKey: true,
    compressorBGM: true,
    compressorMaster: true,
    // BGA resize is OFF by default — original-resolution transcode is the safe choice for visual parity. Power users
    // hitting long encode times on HD BGA can pick a pixel cap from the GUI dropdown without rebuilding. `0` means
    // "preserve resolution"; any positive integer activates the resize path with that long-edge cap.
    bgaResizeMaxEdgePx: 0,
    // WebCodecs encode defaults ON when the browser exposes `VideoEncoder` — typically a 5-20× encode-side speedup
    // over the single-threaded wasm libx264 fallback, and the runtime silently falls back to ffmpeg if the encoder
    // rejects the configured codec parameters or any step throws. Browsers without `VideoEncoder` (Safari < 17, older
    // Firefox) keep the toggle disabled in the GUI and the seed stays `false`.
    bgaUseWebCodecs: typeof globalThis !== 'undefined' && 'VideoEncoder' in globalThis,
    // Debug overlay for invisible / keysound notes — off by default. Power users investigating chart authoring (or
    // diagnosing missing keysound triggers) flip it on; the regular gameplay surface stays clean otherwise.
    showInvisibleNotes: false,
    // LR2's and beatoraja's own behaviour: a judged note stays until its time, so one hit early keeps scrolling down
    // to the judgement line. The dropdown offers `'HIDE'` (gone the moment it is judged) as a preference.
    judgedNoteDisplay: 'KEEP_SCROLLING',
    // Play-history auto-save defaults OFF, so plays don't pile up downloaded files. Users who want every play's
    // replay (`*.bmplay.json`) preserved turn it on from the Debug Menu checkbox; it then downloads when the result
    // scene mounts.
    autoSaveReplay: false,
    courseAutoAdvance: false,
    nonstopPlacement: 'intended',
    // The play tempo, its pitch handling and the keep-pitch stretcher, remembered from the last visit.
    ...readStoredPlayTempoSettings(storage),
    // What a replay reproduces of the recorded view, remembered from the last visit.
    replayView: readStoredReplayView(storage),
    // Leaderboard submission is opt-in: a play is only sent once the player turns it on.
    submitToLeaderboard: false,
    // Play options (playMode / chartOptions / assists / judge / gauge equivalents). Two-way synced with the LR2
    // select scene's PLAY OPTION panel where a counterpart exists; latched at song start and disabled during a
    // play. The judge ruleset has no in-skin counterpart — the Debug Menu is its only surface.
    judgeRuleset: 'lr2',
    gauge: 'GROOVE',
    random1P: 'OFF',
    random2P: 'OFF',
    dpFlip: false,
    bpmGuide: false,
    normalHiSpeedLevel: 0,
    classicHiSpeed: false,
    judgeAlgorithm: 'combo',
    longNoteModifier: 'OFF',
    autoScratch1P: false,
    autoScratch2P: false,
    sort: 'OFF',
    keysFilter: 'ALL',
    difficultyFilter: 'ALL',
    hiSpeed: readStoredHiSpeed(storage),
    hsFix: 'OFF',
    displayAreaInfo: 'OFF',
    hiddenSudden1P: 'OFF',
    hiddenSudden2P: 'OFF',
    laneCover: false,
    shutter: 0.25,
    // Skin-family routing defaults to `'auto'`: beatoraja > LR2 > default, picked per-scene from what's loaded.
    // The Debug Menu's "Skin family" dropdown lets users force a specific family; LR2 / beatoraja entries appear
    // in the dropdown only when their theme is loaded (see `rebuildSkinFamilyPicker` in `ui/debug-menu/skin.ts`).
    skinFamilyOverride: 'auto',
    builtInSkin: inputs.builtInSkinId(readStoredBuiltInSkinId(storage)),
    skinEffects: readStoredSkinEffects(storage, inputs.signals),
    renderResolution: nearestRenderResolution(
      renderResolutionSteps(inputs.devicePixelRatio),
      readStoredRenderResolution(storage) ?? DEFAULT_RENDER_RESOLUTION,
    ),
    playLayout: readStoredPlayLayout(storage),
    status: 'Ready',
    openFolder: inputs.actions.openFolder,
    openFiles: inputs.actions.openFiles,
    recordingFormat: readStoredRecordingFormat(storage),
    record: inputs.actions.record,
    screenshot: inputs.actions.screenshot,
  };
  const saved = readStoredDebugMenuSettings(storage);
  if (saved) overlayDebugMenuSettings(state, saved.settings);
  return state;
}

/** The compressor a visit starts with: its architecture, and whether it is on (the Debug Menu's "Enabled"). */
export interface CompressorStart {
  readonly mode: 'split' | 'legacy';
  readonly enabled: boolean;
}

/**
 * The compressor the `?compressor=split|legacy|off` URL flag of `href` asks for. The flag goes through
 * `parseCompressorMode` (the same helper exported from `audio-bus.ts`) so the recognized values stay synced with the
 * runtime API. An unrecognized or missing flag keeps the defaults: the `'split'` architecture, compressor on (see the
 * `compressor: true` seed in {@link createPlayerGUIState} for the rationale). `split` and `legacy` are an explicit opt-in
 * to that architecture and keep it on; `off` turns it off for an unprocessed-signal A/B comparison.
 */
export function resolveCompressorMode(href: string): CompressorStart {
  const flag: CompressorMode | undefined = parseCompressorMode(new URL(href).searchParams.get('compressor'));
  if (flag === 'split' || flag === 'legacy') return { mode: flag, enabled: true };
  return { mode: 'split', enabled: flag !== 'off' };
}

/** The `?compressor=` flag when the URL sets one. Absent, the remembered Debug Menu value stays. */
export function readCompressorRequest(href: string): CompressorStart | undefined {
  const raw = new URL(href).searchParams.get('compressor');
  if (raw === null || raw.trim() === '') return undefined;
  return resolveCompressorMode(href);
}
