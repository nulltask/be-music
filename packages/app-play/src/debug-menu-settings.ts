// One document for every Debug Menu setting. The browser copy lives in `localStorage`. A copy on the player origin
// is addressed by a cookie the server sets, so Safari can delete this `localStorage` entry after seven days of use
// and the next visit still restores it (`debug-menu-settings-sync.ts`).

import type { TunableCompressor } from '@be-music/player-browser/audio';
import { isGaugeType, isRulesetId } from '@be-music/player-engine/ruleset';
import {
  DIFFICULTY_FILTER_CYCLE,
  KEYS_FILTER_CYCLE,
  RANDOM_CYCLE,
  PLAY_OPTION_CHOICES,
  resolvePlayOptionValue,
  clampShutter,
  SORT_CYCLE,
  snapHiSpeed,
  type BrowseSort,
  type DifficultyFilter,
  type KeysFilter,
} from '@be-music/player-scene-model';
import { COURSE_TABLE_URLS_STORAGE_KEY, parseStoredCourseTableURLs } from './course-table-import.ts';
import { parseCompressorTunings, type CompressorTuning } from './compressor-tuning.ts';
import { parseStoredHiSpeed, HI_SPEED_STORAGE_KEY } from './hi-speed-storage.ts';
import { parseStoredPlayTempoSettings, PLAY_TEMPO_STORAGE_KEY, type PlayTempoSettings } from './play-tempo-settings.ts';
import { parseRecordingFormatKey, recordingFormatKey } from './recording-format-choice.ts';
import { parseStoredRenderResolution, RENDER_RESOLUTION_STORAGE_KEY } from './render-resolution.ts';
import { parseStoredReplayView, REPLAY_VIEW_STORAGE_KEY } from './replay-view-settings.ts';
import { parseStoredSkinSettings, serializeStoredSkinSettings, type StoredSkinSettingValue } from './skin-settings.ts';
import {
  parseStoredPlayInSilentMode,
  PLAY_IN_SILENT_MODE_STORAGE_KEY,
  serializePlayInSilentMode,
} from './silent-mode-playback.ts';
import type { PlayerGUIState, SkinFamilyOverride } from './types.ts';
import { DEBUG_MENU_FOLDERS_STORAGE_KEY, parseFolderOpenStates, type FolderOpenStates } from './debug-menu-storage.ts';
import { WORKER_COUNT_STORAGE_KEY } from './worker-settings.ts';

/** `localStorage` key of the whole Debug Menu document. Reset deletes it with the other `be-music.*` settings. */
export const DEBUG_MENU_SETTINGS_STORAGE_KEY = 'be-music.debug-menu-settings';
/** Bumped when the stored shape changes; another version is ignored. */
const DOCUMENT_VERSION = 1;

type RandomMode = PlayerGUIState['random1P'];
type SkinEffects = PlayerGUIState['skinEffects'];
type PlayLayout = PlayerGUIState['playLayout'];

/** Every Debug Menu value that survives a reload. Absent fields keep the visit's own default. */
export interface DebugMenuSettings {
  autoPlay: boolean;
  autoPauseOnBlur: boolean;
  peakGain: boolean;
  compressor: boolean;
  compressorKey: boolean;
  compressorBGM: boolean;
  compressorMaster: boolean;
  bgaResizeMaxEdgePx: number;
  bgaUseWebCodecs: boolean;
  showInvisibleNotes: boolean;
  judgedNoteDisplay: PlayerGUIState['judgedNoteDisplay'];
  autoSaveReplay: boolean;
  courseAutoAdvance: boolean;
  nonstopPlacement: PlayerGUIState['nonstopPlacement'];
  submitToLeaderboard: boolean;
  judgeRuleset: PlayerGUIState['judgeRuleset'];
  gauge: PlayerGUIState['gauge'];
  random1P: RandomMode;
  random2P: RandomMode;
  dpFlip: boolean;
  classicHiSpeed: boolean;
  normalHiSpeedLevel: number;
  bpmGuide: boolean;
  judgeAlgorithm: PlayerGUIState['judgeAlgorithm'];
  longNoteModifier: PlayerGUIState['longNoteModifier'];
  autoScratch1P: boolean;
  autoScratch2P: boolean;
  sort: BrowseSort;
  keysFilter: KeysFilter;
  difficultyFilter: DifficultyFilter;
  skinFamilyOverride: SkinFamilyOverride;
  masterVolume: number;
  muted: boolean;
  keyVolume: number;
  bgmVolume: number;
  playInSilentMode: boolean;
  tempoEnabled: boolean;
  tempoPercent: number;
  tempoPitchMode: PlayTempoSettings['tempoPitchMode'];
  tempoStretchAlgorithm: PlayTempoSettings['tempoStretchAlgorithm'];
  replayView: PlayerGUIState['replayView'];
  hiSpeed: number;
  hsFix: PlayerGUIState['hsFix'];
  displayAreaInfo: PlayerGUIState['displayAreaInfo'];
  hiddenSudden1P: PlayerGUIState['hiddenSudden1P'];
  hiddenSudden2P: PlayerGUIState['hiddenSudden2P'];
  laneCover: PlayerGUIState['laneCover'];
  shutter: PlayerGUIState['shutter'];
  builtInSkin: string;
  skinEffects: SkinEffects;
  renderResolution: number;
  playLayout: PlayLayout;
  recordingFormat: string;
  workerCount: number;
  compressorTuning: Record<TunableCompressor, CompressorTuning>;
  skinSettings: Record<string, Record<string, StoredSkinSettingValue>>;
  courseTableURLs: string[];
  folders: FolderOpenStates;
}

/** The document in `localStorage` and on the player origin. `settings` holds only the fields that were saved. */
export interface DebugMenuSettingsDocument {
  version: 1;
  updatedAt: number;
  settings: Partial<DebugMenuSettings>;
  /** Reset barrier kept remotely without retaining any settings values. */
  deleted?: true;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const RANDOM_MODES: readonly RandomMode[] = [...RANDOM_CYCLE, 'SCATTER'];
const SKIN_FAMILIES: readonly SkinFamilyOverride[] = ['auto', 'default', 'lr2', 'beatoraja'];
const SKIN_EFFECTS: readonly SkinEffects[] = ['full', 'reduced', 'off'];
const PLAY_LAYOUTS: readonly PlayLayout[] = ['auto', 'standard', 'touch'];
const VOLUME_KEY = 'be-music.volumes';
const BUILT_IN_SKIN_KEY = 'be-music.built-in-skin';
const SKIN_EFFECTS_KEY = 'be-music.skin-effects';
const PLAY_LAYOUT_KEY = 'be-music.play-layout';
const RECORDING_FORMAT_KEY = 'be-music.recording-format';
const COMPRESSOR_TUNING_KEY = 'be-music.compressor-tuning';
const SKIN_SETTINGS_KEY = 'be-music.skin-settings';

const LEGACY_KEYS = [
  VOLUME_KEY,
  PLAY_IN_SILENT_MODE_STORAGE_KEY,
  PLAY_TEMPO_STORAGE_KEY,
  REPLAY_VIEW_STORAGE_KEY,
  HI_SPEED_STORAGE_KEY,
  BUILT_IN_SKIN_KEY,
  SKIN_EFFECTS_KEY,
  RENDER_RESOLUTION_STORAGE_KEY,
  PLAY_LAYOUT_KEY,
  RECORDING_FORMAT_KEY,
  WORKER_COUNT_STORAGE_KEY,
  COMPRESSOR_TUNING_KEY,
  SKIN_SETTINGS_KEY,
  COURSE_TABLE_URLS_STORAGE_KEY,
  DEBUG_MENU_FOLDERS_STORAGE_KEY,
] as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function booleanOf(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function percentOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined;
}

function assign<K extends keyof DebugMenuSettings>(
  settings: Partial<DebugMenuSettings>,
  key: K,
  value: DebugMenuSettings[K] | undefined,
): void {
  if (value !== undefined) settings[key] = value;
}

/** Reads a stored document. An unknown version or unreadable text yields nothing. */
export function parseDebugMenuSettingsDocument(raw: string | null | undefined): DebugMenuSettingsDocument | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return debugMenuSettingsDocument(parsed);
}

/** The same check for a response body. */
export function debugMenuSettingsDocument(value: unknown): DebugMenuSettingsDocument | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { version, updatedAt, settings } = value as { version?: unknown; updatedAt?: unknown; settings?: unknown };
  if (version !== DOCUMENT_VERSION || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0)
    return undefined;
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return undefined;
  if ((value as { deleted?: unknown }).deleted === true)
    return { version: DOCUMENT_VERSION, updatedAt, settings: {}, deleted: true };
  return { version: DOCUMENT_VERSION, updatedAt, settings: pickSettings(settings as Record<string, unknown>) };
}

function pickSettings(raw: Record<string, unknown>): Partial<DebugMenuSettings> {
  const settings: Partial<DebugMenuSettings> = {};
  assign(settings, 'autoPlay', booleanOf(raw.autoPlay));
  assign(settings, 'autoPauseOnBlur', booleanOf(raw.autoPauseOnBlur));
  assign(settings, 'peakGain', booleanOf(raw.peakGain));
  assign(settings, 'compressor', booleanOf(raw.compressor));
  assign(settings, 'compressorKey', booleanOf(raw.compressorKey));
  assign(settings, 'compressorBGM', booleanOf(raw.compressorBGM));
  assign(settings, 'compressorMaster', booleanOf(raw.compressorMaster));
  assign(settings, 'showInvisibleNotes', booleanOf(raw.showInvisibleNotes));
  assign(settings, 'autoSaveReplay', booleanOf(raw.autoSaveReplay));
  assign(settings, 'courseAutoAdvance', booleanOf(raw.courseAutoAdvance));
  assign(settings, 'submitToLeaderboard', booleanOf(raw.submitToLeaderboard));
  assign(settings, 'dpFlip', booleanOf(raw.dpFlip));
  assign(settings, 'bpmGuide', booleanOf(raw.bpmGuide));
  assign(settings, 'normalHiSpeedLevel', resolvePlayOptionValue('normalHiSpeedLevel', raw.normalHiSpeedLevel));
  assign(settings, 'classicHiSpeed', booleanOf(raw.classicHiSpeed));
  assign(settings, 'judgeAlgorithm', oneOf(raw.judgeAlgorithm, ['combo', 'duration', 'lowest'] as const));
  assign(settings, 'longNoteModifier', oneOf(raw.longNoteModifier, ['OFF', 'LEGACY', 'REMOVE'] as const));
  assign(settings, 'autoScratch1P', booleanOf(raw.autoScratch1P));
  assign(settings, 'autoScratch2P', booleanOf(raw.autoScratch2P));
  assign(settings, 'playInSilentMode', booleanOf(raw.playInSilentMode));
  assign(settings, 'muted', booleanOf(raw.muted));
  assign(settings, 'tempoEnabled', booleanOf(raw.tempoEnabled));
  assign(settings, 'bgaUseWebCodecs', booleanOf(raw.bgaUseWebCodecs));
  assign(settings, 'judgedNoteDisplay', oneOf(raw.judgedNoteDisplay, ['KEEP_SCROLLING', 'HIDE'] as const));
  assign(settings, 'nonstopPlacement', oneOf(raw.nonstopPlacement, ['intended', 'lr2'] as const));
  assign(settings, 'judgeRuleset', isRulesetId(raw.judgeRuleset) ? raw.judgeRuleset : undefined);
  assign(settings, 'gauge', isGaugeType(raw.gauge) ? raw.gauge : undefined);
  assign(settings, 'random1P', oneOf(raw.random1P, RANDOM_MODES));
  assign(settings, 'random2P', oneOf(raw.random2P, RANDOM_MODES));
  assign(settings, 'sort', oneOf(raw.sort, SORT_CYCLE));
  assign(settings, 'keysFilter', oneOf(raw.keysFilter, KEYS_FILTER_CYCLE));
  assign(settings, 'difficultyFilter', oneOf(raw.difficultyFilter, DIFFICULTY_FILTER_CYCLE));
  assign(settings, 'skinFamilyOverride', oneOf(raw.skinFamilyOverride, SKIN_FAMILIES));
  assign(settings, 'hiddenSudden1P', oneOf(raw.hiddenSudden1P, PLAY_OPTION_CHOICES.hiddenSudden1P!));
  assign(settings, 'hiddenSudden2P', oneOf(raw.hiddenSudden2P, PLAY_OPTION_CHOICES.hiddenSudden2P!));
  assign(settings, 'laneCover', booleanOf(raw.laneCover));
  if (typeof raw.shutter === 'number' && Number.isFinite(raw.shutter)) settings.shutter = clampShutter(raw.shutter);
  assign(settings, 'displayAreaInfo', oneOf(raw.displayAreaInfo, PLAY_OPTION_CHOICES.displayAreaInfo!));
  assign(settings, 'hsFix', oneOf(raw.hsFix, PLAY_OPTION_CHOICES.hsFix!));
  assign(settings, 'skinEffects', oneOf(raw.skinEffects, SKIN_EFFECTS));
  assign(settings, 'playLayout', oneOf(raw.playLayout, PLAY_LAYOUTS));
  assign(settings, 'tempoPitchMode', oneOf(raw.tempoPitchMode, ['pitch', 'keep-pitch'] as const));
  assign(settings, 'tempoStretchAlgorithm', oneOf(raw.tempoStretchAlgorithm, ['wsola', 'signalsmith'] as const));
  assign(settings, 'masterVolume', percentOf(raw.masterVolume));
  assign(settings, 'keyVolume', percentOf(raw.keyVolume));
  assign(settings, 'bgmVolume', percentOf(raw.bgmVolume));
  if (typeof raw.tempoPercent === 'number' && Number.isFinite(raw.tempoPercent)) {
    settings.tempoPercent = parseStoredPlayTempoSettings(
      JSON.stringify({ tempoPercent: raw.tempoPercent }),
    ).tempoPercent;
  }
  if (typeof raw.hiSpeed === 'number') assign(settings, 'hiSpeed', snapHiSpeed(raw.hiSpeed));
  if (
    typeof raw.bgaResizeMaxEdgePx === 'number' &&
    raw.bgaResizeMaxEdgePx >= 0 &&
    Number.isFinite(raw.bgaResizeMaxEdgePx)
  ) {
    settings.bgaResizeMaxEdgePx = Math.round(raw.bgaResizeMaxEdgePx);
  }
  if (typeof raw.renderResolution === 'number' && Number.isFinite(raw.renderResolution)) {
    settings.renderResolution = raw.renderResolution;
  }
  if (typeof raw.workerCount === 'number' && Number.isInteger(raw.workerCount) && raw.workerCount >= 1) {
    settings.workerCount = raw.workerCount;
  }
  if (typeof raw.builtInSkin === 'string' && raw.builtInSkin.length > 0 && raw.builtInSkin.length < 80) {
    settings.builtInSkin = raw.builtInSkin;
  }
  if (
    typeof raw.recordingFormat === 'string' &&
    recordingFormatKey(parseRecordingFormatKey(raw.recordingFormat)) === raw.recordingFormat
  ) {
    settings.recordingFormat = raw.recordingFormat;
  }
  if (typeof raw.replayView === 'object' && raw.replayView !== null) {
    settings.replayView = parseStoredReplayView(JSON.stringify(raw.replayView));
  }
  if (typeof raw.compressorTuning === 'object' && raw.compressorTuning !== null) {
    settings.compressorTuning = parseCompressorTunings(JSON.stringify(raw.compressorTuning));
  }
  if (typeof raw.skinSettings === 'object' && raw.skinSettings !== null && !Array.isArray(raw.skinSettings)) {
    settings.skinSettings = Object.fromEntries(
      parseStoredSkinSettings(JSON.stringify({ version: 1, skins: raw.skinSettings })),
    );
  }
  if (Array.isArray(raw.courseTableURLs)) {
    settings.courseTableURLs = parseStoredCourseTableURLs(JSON.stringify(raw.courseTableURLs));
  }
  if (typeof raw.folders === 'object' && raw.folders !== null) {
    settings.folders = parseFolderOpenStates(JSON.stringify(raw.folders));
  }
  return settings;
}

/** The saved document, or nothing when this browser has never written one. */
export function readStoredDebugMenuSettings(
  storage: Pick<Storage, 'getItem'> | undefined,
): DebugMenuSettingsDocument | undefined {
  try {
    return parseDebugMenuSettingsDocument(storage?.getItem(DEBUG_MENU_SETTINGS_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

/** Whether any of the older per-setting keys is present, so the first visit after this change can upload them. */
export function hasLegacyDebugMenuSettings(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return LEGACY_KEYS.some((key) => storage?.getItem(key) != null);
  } catch {
    return false;
  }
}

/** A document made from the keys this app used to write one by one. `updatedAt` is the moment of the migration. */
export function debugMenuSettingsFromLegacy(
  storage: Pick<Storage, 'getItem'> | undefined,
  updatedAt: number,
): DebugMenuSettingsDocument {
  const settings: Partial<DebugMenuSettings> = {};
  const volumes = readJSON(storage, VOLUME_KEY);
  if (typeof volumes === 'object' && volumes !== null) {
    const raw = volumes as { masterVolume?: unknown; keyVolume?: unknown; bgmVolume?: unknown; muted?: unknown };
    assign(settings, 'masterVolume', percentOf(raw.masterVolume));
    assign(settings, 'keyVolume', percentOf(raw.keyVolume));
    assign(settings, 'bgmVolume', percentOf(raw.bgmVolume));
    assign(settings, 'muted', booleanOf(raw.muted));
  }
  if (storage?.getItem(PLAY_IN_SILENT_MODE_STORAGE_KEY) != null) {
    settings.playInSilentMode = parseStoredPlayInSilentMode(storage.getItem(PLAY_IN_SILENT_MODE_STORAGE_KEY));
  }
  if (storage?.getItem(PLAY_TEMPO_STORAGE_KEY) != null)
    Object.assign(settings, parseStoredPlayTempoSettings(storage.getItem(PLAY_TEMPO_STORAGE_KEY)));
  if (storage?.getItem(REPLAY_VIEW_STORAGE_KEY) != null)
    settings.replayView = parseStoredReplayView(storage.getItem(REPLAY_VIEW_STORAGE_KEY));
  if (storage?.getItem(HI_SPEED_STORAGE_KEY) != null)
    settings.hiSpeed = parseStoredHiSpeed(storage.getItem(HI_SPEED_STORAGE_KEY));
  const skin = storage?.getItem(BUILT_IN_SKIN_KEY);
  if (skin) settings.builtInSkin = skin;
  const effects = oneOf(storage?.getItem(SKIN_EFFECTS_KEY), SKIN_EFFECTS);
  if (effects) settings.skinEffects = effects;
  const resolution = parseStoredRenderResolution(storage?.getItem(RENDER_RESOLUTION_STORAGE_KEY) ?? null);
  if (storage?.getItem(RENDER_RESOLUTION_STORAGE_KEY) != null && resolution !== undefined)
    settings.renderResolution = resolution;
  const layout = oneOf(storage?.getItem(PLAY_LAYOUT_KEY), PLAY_LAYOUTS);
  if (layout) settings.playLayout = layout;
  const recording = storage?.getItem(RECORDING_FORMAT_KEY);
  if (recording && recordingFormatKey(parseRecordingFormatKey(recording)) === recording)
    settings.recordingFormat = recording;
  const workers = Number(storage?.getItem(WORKER_COUNT_STORAGE_KEY));
  if (Number.isInteger(workers) && workers >= 1) settings.workerCount = workers;
  const tuning = storage?.getItem(COMPRESSOR_TUNING_KEY);
  if (tuning != null) settings.compressorTuning = parseCompressorTunings(tuning);
  const skinSettings = parseStoredSkinSettings(storage?.getItem(SKIN_SETTINGS_KEY));
  if (skinSettings.size > 0) settings.skinSettings = Object.fromEntries(skinSettings);
  if (storage?.getItem(COURSE_TABLE_URLS_STORAGE_KEY) != null) {
    settings.courseTableURLs = parseStoredCourseTableURLs(storage.getItem(COURSE_TABLE_URLS_STORAGE_KEY));
  }
  if (storage?.getItem(DEBUG_MENU_FOLDERS_STORAGE_KEY) != null) {
    settings.folders = parseFolderOpenStates(storage.getItem(DEBUG_MENU_FOLDERS_STORAGE_KEY));
  }
  return { version: DOCUMENT_VERSION, updatedAt, settings };
}

function readJSON(storage: Pick<Storage, 'getItem'> | undefined, key: string): unknown {
  const raw = storage?.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Copies saved fields onto the Debug Menu state. Fields the document leaves out stay as they are. */
export function overlayDebugMenuSettings(state: PlayerGUIState, settings: Partial<DebugMenuSettings>): void {
  const assignState = <K extends keyof PlayerGUIState & keyof DebugMenuSettings>(key: K): void => {
    const value = settings[key];
    if (value !== undefined) state[key] = value as PlayerGUIState[K];
  };
  assignState('autoPlay');
  assignState('autoPauseOnBlur');
  assignState('peakGain');
  assignState('compressor');
  assignState('compressorKey');
  assignState('compressorBGM');
  assignState('compressorMaster');
  assignState('bgaResizeMaxEdgePx');
  assignState('bgaUseWebCodecs');
  assignState('showInvisibleNotes');
  assignState('judgedNoteDisplay');
  assignState('autoSaveReplay');
  assignState('courseAutoAdvance');
  assignState('nonstopPlacement');
  assignState('submitToLeaderboard');
  assignState('judgeRuleset');
  assignState('gauge');
  assignState('random1P');
  assignState('random2P');
  assignState('dpFlip');
  assignState('bpmGuide');
  assignState('normalHiSpeedLevel');
  assignState('classicHiSpeed');
  assignState('judgeAlgorithm');
  assignState('longNoteModifier');
  assignState('autoScratch1P');
  assignState('autoScratch2P');
  assignState('sort');
  assignState('keysFilter');
  assignState('difficultyFilter');
  assignState('skinFamilyOverride');
  assignState('masterVolume');
  assignState('muted');
  assignState('keyVolume');
  assignState('bgmVolume');
  assignState('playInSilentMode');
  assignState('tempoEnabled');
  assignState('tempoPercent');
  assignState('tempoPitchMode');
  assignState('tempoStretchAlgorithm');
  assignState('replayView');
  assignState('hiSpeed');
  assignState('hsFix');
  assignState('displayAreaInfo');
  assignState('hiddenSudden1P');
  assignState('hiddenSudden2P');
  assignState('laneCover');
  assignState('shutter');
  assignState('builtInSkin');
  assignState('skinEffects');
  assignState('renderResolution');
  assignState('playLayout');
  assignState('recordingFormat');
}

/** The live Debug Menu, plus the settings kept beside it, as one document. */
export function captureDebugMenuSettings(
  state: PlayerGUIState,
  extras: {
    compressorTuning: Record<TunableCompressor, CompressorTuning>;
    skinSettings: ReadonlyMap<string, Record<string, StoredSkinSettingValue>>;
    courseTableURLs: readonly string[];
    folders: FolderOpenStates;
    workerCount: number;
    updatedAt?: number;
  },
): DebugMenuSettingsDocument {
  const settings: Partial<DebugMenuSettings> = {
    autoPlay: state.autoPlay,
    autoPauseOnBlur: state.autoPauseOnBlur,
    peakGain: state.peakGain,
    compressor: state.compressor,
    compressorKey: state.compressorKey,
    compressorBGM: state.compressorBGM,
    compressorMaster: state.compressorMaster,
    bgaResizeMaxEdgePx: state.bgaResizeMaxEdgePx,
    bgaUseWebCodecs: state.bgaUseWebCodecs,
    showInvisibleNotes: state.showInvisibleNotes,
    judgedNoteDisplay: state.judgedNoteDisplay,
    autoSaveReplay: state.autoSaveReplay,
    courseAutoAdvance: state.courseAutoAdvance,
    nonstopPlacement: state.nonstopPlacement,
    submitToLeaderboard: state.submitToLeaderboard,
    judgeRuleset: state.judgeRuleset,
    gauge: state.gauge,
    random1P: state.random1P,
    random2P: state.random2P,
    dpFlip: state.dpFlip,
    bpmGuide: state.bpmGuide,
    normalHiSpeedLevel: state.normalHiSpeedLevel,
    classicHiSpeed: state.classicHiSpeed,
    judgeAlgorithm: state.judgeAlgorithm,
    longNoteModifier: state.longNoteModifier,
    autoScratch1P: state.autoScratch1P,
    autoScratch2P: state.autoScratch2P,
    sort: state.sort,
    keysFilter: state.keysFilter,
    difficultyFilter: state.difficultyFilter,
    skinFamilyOverride: state.skinFamilyOverride,
    masterVolume: state.masterVolume,
    muted: state.muted,
    keyVolume: state.keyVolume,
    bgmVolume: state.bgmVolume,
    playInSilentMode: state.playInSilentMode,
    tempoEnabled: state.tempoEnabled,
    tempoPercent: state.tempoPercent,
    tempoPitchMode: state.tempoPitchMode,
    tempoStretchAlgorithm: state.tempoStretchAlgorithm,
    replayView: { ...state.replayView },
    hiSpeed: state.hiSpeed,
    hsFix: state.hsFix,
    displayAreaInfo: state.displayAreaInfo,
    hiddenSudden1P: state.hiddenSudden1P,
    hiddenSudden2P: state.hiddenSudden2P,
    laneCover: state.laneCover,
    shutter: state.shutter,
    builtInSkin: state.builtInSkin,
    skinEffects: state.skinEffects,
    renderResolution: state.renderResolution,
    playLayout: state.playLayout,
    recordingFormat: state.recordingFormat,
    workerCount: extras.workerCount,
    compressorTuning: extras.compressorTuning,
    skinSettings: Object.fromEntries(extras.skinSettings),
    courseTableURLs: [...extras.courseTableURLs],
    folders: { ...extras.folders },
  };
  return { version: DOCUMENT_VERSION, updatedAt: extras.updatedAt ?? Date.now(), settings: pickSettings(settings) };
}

/** Writes the document and the older keys the rest of the app still reads at boot. */
export function writeDebugMenuSettings(document: DebugMenuSettingsDocument, storage: StorageLike | undefined): void {
  if (!storage) return;
  const { settings } = document;
  try {
    storage.setItem(DEBUG_MENU_SETTINGS_STORAGE_KEY, JSON.stringify(document));
    writeVolumes(storage, settings);
    if (settings.playInSilentMode !== undefined) {
      storage.setItem(PLAY_IN_SILENT_MODE_STORAGE_KEY, serializePlayInSilentMode(settings.playInSilentMode));
    }
    if (
      settings.tempoEnabled !== undefined ||
      settings.tempoPercent !== undefined ||
      settings.tempoPitchMode ||
      settings.tempoStretchAlgorithm
    ) {
      storage.setItem(
        PLAY_TEMPO_STORAGE_KEY,
        JSON.stringify({
          tempoEnabled: settings.tempoEnabled === true,
          tempoPercent: settings.tempoPercent ?? 0,
          tempoPitchMode: settings.tempoPitchMode ?? 'pitch',
          tempoStretchAlgorithm: settings.tempoStretchAlgorithm ?? 'wsola',
        }),
      );
    }
    if (settings.replayView) storage.setItem(REPLAY_VIEW_STORAGE_KEY, JSON.stringify(settings.replayView));
    if (settings.hiSpeed !== undefined) storage.setItem(HI_SPEED_STORAGE_KEY, String(settings.hiSpeed));
    if (settings.builtInSkin) storage.setItem(BUILT_IN_SKIN_KEY, settings.builtInSkin);
    if (settings.skinEffects) storage.setItem(SKIN_EFFECTS_KEY, settings.skinEffects);
    if (settings.renderResolution !== undefined)
      storage.setItem(RENDER_RESOLUTION_STORAGE_KEY, String(settings.renderResolution));
    if (settings.playLayout) storage.setItem(PLAY_LAYOUT_KEY, settings.playLayout);
    if (settings.recordingFormat) storage.setItem(RECORDING_FORMAT_KEY, settings.recordingFormat);
    if (settings.workerCount !== undefined) storage.setItem(WORKER_COUNT_STORAGE_KEY, String(settings.workerCount));
    if (settings.compressorTuning) storage.setItem(COMPRESSOR_TUNING_KEY, JSON.stringify(settings.compressorTuning));
    if (settings.skinSettings) {
      storage.setItem(SKIN_SETTINGS_KEY, serializeStoredSkinSettings(new Map(Object.entries(settings.skinSettings))));
    }
    if (settings.courseTableURLs)
      storage.setItem(COURSE_TABLE_URLS_STORAGE_KEY, JSON.stringify(settings.courseTableURLs));
    if (settings.folders) storage.setItem(DEBUG_MENU_FOLDERS_STORAGE_KEY, JSON.stringify(settings.folders));
  } catch {
    // Blocked or full storage: the visit still has the values in memory.
  }
}

function writeVolumes(storage: StorageLike, settings: Partial<DebugMenuSettings>): void {
  if (
    settings.masterVolume === undefined &&
    settings.keyVolume === undefined &&
    settings.bgmVolume === undefined &&
    settings.muted === undefined
  ) {
    return;
  }
  storage.setItem(
    VOLUME_KEY,
    JSON.stringify({
      masterVolume: settings.masterVolume ?? 100,
      muted: settings.muted === true,
      keyVolume: settings.keyVolume ?? 100,
      bgmVolume: settings.bgmVolume ?? 100,
    }),
  );
}
