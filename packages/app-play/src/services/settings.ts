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
import { overlayOptionSettings, readStoredOptionSettings } from '../option-settings.ts';
import { readPlayInSilentMode } from '../silent-mode-playback.ts';
import type { PlayerGUIState } from '../types.ts';
import { optionDefault } from '../option-defaults.ts';
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

export const RENDERER_STORAGE_KEY = 'be-music.renderer';

/** The renderer the player draws with: WebGL 2 or WebGPU. */
export type RendererChoice = 'webgl' | 'webgpu';

/**
 * Stored renderer pick, else WebGL 2: on a laptop's integrated GPU the WebGPU path drew the built-in skin at 1920 × 1080
 * well under the display's rate where WebGL 2 kept up.
 */
export function readStoredRenderer(storage: SettingStorage | undefined = defaultSettingStorage()): RendererChoice {
  try {
    const renderer = storage?.getItem(RENDERER_STORAGE_KEY);
    return renderer === 'webgl' || renderer === 'webgpu' ? renderer : optionDefault('renderer');
  } catch {
    // Storage blocked — the default.
    return optionDefault('renderer');
  }
}

/** Remembers the renderer pick; it takes effect when the player next loads. */
export function storeRenderer(
  renderer: RendererChoice,
  storage: SettingStorage | undefined = defaultSettingStorage(),
): void {
  try {
    storage?.setItem(RENDERER_STORAGE_KEY, renderer);
  } catch {
    // Private windows / blocked storage: the pick lasts for this session only.
  }
}

export const PLAY_LAYOUT_STORAGE_KEY = 'be-music.play-layout';

/** Stored Options dialog play-layout pick, `'auto'` when none. */
export function readStoredPlayLayout(storage: SettingStorage | undefined = defaultSettingStorage()): PlayLayoutChoice {
  try {
    const stored = storage?.getItem(PLAY_LAYOUT_STORAGE_KEY);
    if (stored === 'auto' || stored === 'standard' || stored === 'touch') return stored;
  } catch {
    // Storage blocked — use the default.
  }
  return optionDefault('playLayout');
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

/** Master / keysound / BGM volumes in percent, as last set in the Options dialog (all 100 when nothing is stored). */
export function readStoredVolumes(storage: SettingStorage | undefined = defaultSettingStorage()): StoredVolumes {
  const fallback: StoredVolumes = {
    masterVolume: optionDefault('masterVolume'),
    muted: optionDefault('muted'),
    keyVolume: optionDefault('keyVolume'),
    bgmVolume: optionDefault('bgmVolume'),
  };
  try {
    const raw = storage?.getItem(VOLUME_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Record<keyof StoredVolumes, unknown>>;
    const percent = (value: unknown, otherwise: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : otherwise;
    return {
      masterVolume: percent(parsed.masterVolume, fallback.masterVolume),
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : fallback.muted,
      keyVolume: percent(parsed.keyVolume, fallback.keyVolume),
      bgmVolume: percent(parsed.bgmVolume, fallback.bgmVolume),
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

/** What {@link createPlayerGUIState} reads besides the stored settings: the device, and the Options dialog's buttons. */
export interface PlayerGUIStateInputs {
  /** Where the remembered settings are read from; `localStorage` when left out. */
  readonly storage?: SettingStorage;
  /** The device, for the skin effect level it starts with. */
  readonly signals: DeviceSignals;
  /** The display's pixel ratio, for the render resolutions offered. */
  readonly devicePixelRatio: number;
  /** The built-in skin to start with for the remembered id (`undefined` when none is stored). */
  readonly builtInSkinId: (stored: string | undefined) => string;
  /** The Options dialog's buttons. */
  readonly actions: Pick<PlayerGUIState, 'openFolder' | 'openFiles' | 'record' | 'screenshot'>;
}

/**
 * The state the Options dialog's controllers read and write, as a visit starts: the remembered settings over the defaults.
 */
export function createPlayerGUIState(inputs: PlayerGUIStateInputs): PlayerGUIState {
  const storage = inputs.storage ?? defaultSettingStorage();
  const state: PlayerGUIState = {
    autoPlay: optionDefault('autoPlay'),
    autoPauseOnBlur: optionDefault('autoPauseOnBlur'),
    showFPS: optionDefault('showFPS'),
    // Compressor stack ON by default — without it, multiple simultaneous `#WAV` samples sum past full scale and
    // digital- clip at the destination. The `MIXER_HEADROOM_GAIN_LINEAR` attenuation in `audio-bus.ts` buys a little
    // headroom but the master limiter is what reliably prevents audible clipping on dense charts. Power users wanting
    // an unprocessed signal path can still flip it via `?compressor=off` or the GUI.
    ...readStoredVolumes(storage),
    playInSilentMode: readPlayInSilentMode(storage),
    // Peak gain is off until the Options dialog turns it on. The choice is remembered with the other Options dialog settings.
    peakGain: optionDefault('peakGain'),
    compressor: optionDefault('compressorEnabled'),
    compressorKey: optionDefault('compressorKey'),
    compressorBGM: optionDefault('compressorBGM'),
    compressorMaster: optionDefault('compressorMaster'),
    // BGA resize is OFF by default — original-resolution transcode is the safe choice for visual parity. Power users
    // hitting long encode times on HD BGA can pick a pixel cap from the GUI dropdown without rebuilding. `0` means
    // "preserve resolution"; any positive integer activates the resize path with that long-edge cap.
    bgaResizeMaxEdgePx: optionDefault('bgaResizeMaxEdgePx'),
    // WebCodecs encode defaults ON when the browser exposes `VideoEncoder` — typically a 5-20× encode-side speedup
    // over the single-threaded wasm libx264 fallback, and the runtime silently falls back to ffmpeg if the encoder
    // rejects the configured codec parameters or any step throws. Browsers without `VideoEncoder` (Safari < 17, older
    // Firefox) keep the toggle disabled in the GUI and the seed stays `false`.
    bgaUseWebCodecs: typeof globalThis !== 'undefined' && 'VideoEncoder' in globalThis,
    bgaTranscodeQuality: optionDefault('bgaTranscodeQuality'),
    // Debug overlay for invisible / keysound notes — off by default. Power users investigating chart authoring (or
    // diagnosing missing keysound triggers) flip it on; the regular gameplay surface stays clean otherwise.
    showInvisibleNotes: optionDefault('showInvisibleNotes'),
    // The guide labels besides BPM (the play option `bpmGuide`) are opt-in.
    guideStop: optionDefault('guideStop'),
    guideScroll: optionDefault('guideScroll'),
    guideSpeed: optionDefault('guideSpeed'),
    // No ghost unless the player asks for one; when they do, it shows as a second playfield unless they pick another mode.
    ghost: optionDefault('ghost'),
    ghostMode: optionDefault('ghostMode'),
    // Play-history auto-save defaults OFF, so plays don't pile up downloaded files. Users who want every play's
    // replay (`*.bmplay.json`) preserved turn it on from the Options dialog checkbox; it then downloads when the result
    // scene mounts.
    autoSaveReplay: optionDefault('autoSaveReplay'),
    // A replay records only coarse device classes unless the player opts in to the controllers' own names.
    replayDeviceNames: optionDefault('replayDeviceNames'),
    // Bemuse server songs play at the volume Bemuse plays them at, unless the player turns it off.
    bemuseReplayGain: optionDefault('bemuseReplayGain'),
    // Every replay slot saves by itself until the player picks otherwise (`DEFAULT_REPLAY_AUTO_SAVE_RULES`): the best EX
    // score, the best lamp, the fewest BP and the latest play.
    replaySlotAutoSave1: optionDefault('replaySlotAutoSave1'),
    replaySlotAutoSave2: optionDefault('replaySlotAutoSave2'),
    replaySlotAutoSave3: optionDefault('replaySlotAutoSave3'),
    replaySlotAutoSave4: optionDefault('replaySlotAutoSave4'),
    courseAutoAdvance: optionDefault('courseAutoAdvance'),
    nonstopPlacement: optionDefault('nonstopPlacement'),
    // The play tempo, its pitch handling and the keep-pitch stretcher, remembered from the last visit.
    ...readStoredPlayTempoSettings(storage),
    // What a replay reproduces of the recorded view, remembered from the last visit.
    replayView: readStoredReplayView(storage),
    // Leaderboard submission is opt-in: a play is only sent once the player turns it on.
    submitToLeaderboard: optionDefault('submitToLeaderboard'),
    // Once on, a play is sent when it improves the player's EX-SCORE on the chart (its first play always).
    leaderboardSubmitRule: optionDefault('leaderboardSubmitRule'),
    // Play options (playMode / chartOptions / assists / judge / gauge equivalents). Two-way synced with the LR2
    // select scene's PLAY OPTION panel where a counterpart exists; latched at song start and disabled during a
    // play. The judge ruleset has no in-skin counterpart — the Options dialog is its only surface.
    judgeRuleset: optionDefault('judgeRuleset'),
    gauge: optionDefault('gauge'),
    random1P: optionDefault('random1P'),
    hRandomThresholdBPM: optionDefault('hRandomThresholdBPM'),
    randomSeed1P: optionDefault('randomSeed1P'),
    randomSeed2P: optionDefault('randomSeed2P'),
    randomFixedLane1P: optionDefault('randomFixedLane1P'),
    randomFixedLane2P: optionDefault('randomFixedLane2P'),
    lr2RandomScratch1P: optionDefault('lr2RandomScratch1P'),
    lr2RandomScratch2P: optionDefault('lr2RandomScratch2P'),
    random2P: optionDefault('random2P'),
    dpFlip: optionDefault('dpFlip'),
    bpmGuide: optionDefault('bpmGuide'),
    bpmChangeWarning: optionDefault('bpmChangeWarning'),
    guideSE: optionDefault('guideSE'),
    windowHold: optionDefault('windowHold'),
    judgeCounts: optionDefault('judgeCounts'),
    judgeDetailSplit: optionDefault('judgeDetailSplit'),
    judgeDetail: optionDefault('judgeDetail'),
    scoreTargetRate: optionDefault('scoreTargetRate'),
    judgePosition: optionDefault('judgePosition'),
    judgeDisplay: optionDefault('judgeDisplay'),
    laneBrightness: optionDefault('laneBrightness'),
    scoreTarget: optionDefault('scoreTarget'),
    markProcessedNotes: optionDefault('markProcessedNotes'),
    showJudgeArea: optionDefault('showJudgeArea'),
    lr2AddMines: optionDefault('lr2AddMines'),
    lr2AddLongNotes: optionDefault('lr2AddLongNotes'),
    lr2Loudness: optionDefault('lr2Loudness'),
    lr2AddNotes: optionDefault('lr2AddNotes'),
    lr2Gambol: optionDefault('lr2Gambol'),
    lr2SideJump: optionDefault('lr2SideJump'),
    lr2SpiralEffect: optionDefault('lr2SpiralEffect'),
    lr2Wave: optionDefault('lr2Wave'),
    lr2SinCurve: optionDefault('lr2SinCurve'),
    lr2Nabeatsu: optionDefault('lr2Nabeatsu'),
    lr2Heartbeat: optionDefault('lr2Heartbeat'),
    lr2Char: optionDefault('lr2Char'),
    lr2SuperLoop: optionDefault('lr2SuperLoop'),
    lr2Tornado: optionDefault('lr2Tornado'),
    lr2Earthquake: optionDefault('lr2Earthquake'),
    lr2Acceleration: optionDefault('lr2Acceleration'),
    autoScratchNotes: optionDefault('autoScratchNotes'),
    judgeTimingAutoAdjust: optionDefault('judgeTimingAutoAdjust'),
    visualConstant: optionDefault('visualConstant'),
    noteDurationMs: optionDefault('noteDurationMs'),
    lift1P: optionDefault('lift1P'),
    lift2P: optionDefault('lift2P'),
    liftOn1P: optionDefault('liftOn1P'),
    liftOn2P: optionDefault('liftOn2P'),
    constantFadeMs: optionDefault('constantFadeMs'),
    judgeTimingMs: optionDefault('judgeTimingMs'),
    normalHiSpeedLevel: optionDefault<boolean>('normalHiSpeed') ? optionDefault('normalHiSpeedLevel') : 0,
    classicHiSpeed: optionDefault('classicHiSpeed'),
    floatingHiSpeed: optionDefault('floatingHiSpeed'),
    fixedDisplayArea: optionDefault('fixedDisplayArea'),
    judgeAlgorithm: optionDefault('judgeAlgorithm'),
    longNoteModifier: optionDefault('longNoteModifier'),
    longNoteRate: optionDefault('longNoteRate'),
    sevenToNinePattern: optionDefault('sevenToNinePattern'),
    sevenToNineType: optionDefault('sevenToNineType'),
    battleMode: optionDefault('battleMode'),
    dBattleScratch: optionDefault('dBattleScratch'),
    gauge2P: optionDefault('gauge2P'),
    mRan1P: optionDefault('mRan1P'),
    mRan2P: optionDefault('mRan2P'),
    longNoteMode: optionDefault('longNoteMode'),
    customJudge: optionDefault('customJudge'),
    practice: optionDefault('practice'),
    practiceGauge: optionDefault('practiceGauge'),
    practiceGaugeCategory: optionDefault('practiceGaugeCategory'),
    practiceStartGauge: optionDefault('practiceStartGauge'),
    practiceJudgeRank: optionDefault('practiceJudgeRank'),
    practiceTotal: optionDefault('practiceTotal'),
    practiceRestBefore: optionDefault('practiceRestBefore'),
    practiceRestAfter: optionDefault('practiceRestAfter'),
    practiceCarriedLongNotes: optionDefault('practiceCarriedLongNotes'),
    customJudgeKeyPerfectGreat: optionDefault('customJudgeKeyPerfectGreat'),
    customJudgeKeyGreat: optionDefault('customJudgeKeyGreat'),
    customJudgeKeyGood: optionDefault('customJudgeKeyGood'),
    customJudgeScratchPerfectGreat: optionDefault('customJudgeScratchPerfectGreat'),
    customJudgeScratchGreat: optionDefault('customJudgeScratchGreat'),
    customJudgeScratchGood: optionDefault('customJudgeScratchGood'),
    customJudgeLongNoteMargin: optionDefault('customJudgeLongNoteMargin'),
    lr2ExtraMode: optionDefault('lr2ExtraMode'),
    lr2ExtraLevel: optionDefault('lr2ExtraLevel'),
    extraNoteDepth: optionDefault('extraNoteDepth'),
    extraNoteScratch: optionDefault('extraNoteScratch'),
    mineModifier: optionDefault('mineModifier'),
    crazyJudge: optionDefault('crazyJudge'),
    crazyHellJudge: optionDefault('crazyHellJudge'),
    crazyAddMine: optionDefault('crazyAddMine'),
    crazyNotes: optionDefault('crazyNotes'),
    scrollModifier: optionDefault('scrollModifier'),
    scrollSection: optionDefault('scrollSection'),
    scrollRate: optionDefault('scrollRate'),
    gaugeAutoShift: optionDefault('gaugeAutoShift'),
    bmsonTotalMode: optionDefault('bmsonTotalMode'),
    bottomShiftableGauge: optionDefault('bottomShiftableGauge'),
    autoScratch1P: optionDefault('autoScratch1P'),
    autoScratch2P: optionDefault('autoScratch2P'),
    anyKey: optionDefault('anyKey'),
    laneKeys: {},
    controlKeys: {},
    builtInControlScheme: optionDefault('builtInControlScheme'),
    actionKeys: {},
    sort: optionDefault('sort'),
    keysFilter: optionDefault('keysFilter'),
    difficultyFilter: optionDefault('difficultyFilter'),
    hiSpeed: readStoredHiSpeed(storage),
    hsFix: optionDefault('hsFix'),
    displayAreaInfo: optionDefault('displayAreaInfo'),
    bga: optionDefault('bga'),
    bgaSize: optionDefault('bgaSize'),
    scoreGraph: optionDefault('scoreGraph'),
    hiddenSudden1P: optionDefault('hiddenSudden1P'),
    hiddenSudden2P: optionDefault('hiddenSudden2P'),
    laneCover: optionDefault('laneCover'),
    shutter: optionDefault('shutter'),
    // Skin-family routing defaults to `'auto'`: beatoraja > LR2 > default, picked per-scene from what's loaded.
    // The Options dialog's "Skin family" dropdown lets users force a specific family; LR2 / beatoraja entries appear
    // in the dropdown only when their theme is loaded (see `rebuildSkinFamilyPicker` in `ui/options/skin.ts`).
    confirmDroppedSkin: optionDefault('confirmDroppedSkin'),
    skipDroppedSkin: false,
    skinFamilyOverride: optionDefault('skinFamilyOverride'),
    builtInSkin: inputs.builtInSkinId(readStoredBuiltInSkinId(storage)),
    skinEffects: readStoredSkinEffects(storage, inputs.signals),
    renderResolution: nearestRenderResolution(
      renderResolutionSteps(inputs.devicePixelRatio),
      readStoredRenderResolution(storage) ?? DEFAULT_RENDER_RESOLUTION,
    ),
    playLayout: readStoredPlayLayout(storage),
    renderer: readStoredRenderer(storage),
    status: 'Ready',
    openFolder: inputs.actions.openFolder,
    openFiles: inputs.actions.openFiles,
    recordingFormat: readStoredRecordingFormat(storage),
    recordingQuality: optionDefault('recordingQuality'),
    record: inputs.actions.record,
    screenshot: inputs.actions.screenshot,
  };
  const saved = readStoredOptionSettings(storage);
  if (saved) overlayOptionSettings(state, saved.settings);
  return state;
}

/** The compressor a visit starts with: its architecture, and whether it is on (the Options dialog's "Enabled"). */
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
  return { mode: 'split', enabled: flag === 'off' ? false : optionDefault('compressorEnabled') };
}

/** The `?compressor=` flag when the URL sets one. Absent, the remembered Options dialog value stays. */
export function readCompressorRequest(href: string): CompressorStart | undefined {
  const raw = new URL(href).searchParams.get('compressor');
  if (raw === null || raw.trim() === '') return undefined;
  return resolveCompressorMode(href);
}
