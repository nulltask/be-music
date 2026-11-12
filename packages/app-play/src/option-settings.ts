// One document for every Options dialog setting. The browser copy lives in `localStorage`. A copy on the player origin
// is addressed by a cookie the server sets, so Safari can delete this `localStorage` entry after seven days of use
// and the next visit still restores it (`option-settings-sync.ts`).

import type { TunableCompressor } from '@be-music/player-browser/audio';
import { isGaugeType, isRulesetId, migrateOptionValue, type RulesetId } from '@be-music/player-engine/ruleset';
import {
  DIFFICULTY_FILTER_CYCLE,
  KEYS_FILTER_CYCLE,
  PLAY_OPTION_CHOICES,
  resolvePlayOptionValue,
  clampShutter,
  SORT_CYCLE,
  snapHiSpeed,
  clampFloatingHiSpeed,
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
import { LEADERBOARD_SUBMIT_RULES } from './leaderboard-submit-rule.ts';
import { REPLAY_AUTO_SAVE_RULES, type ReplayAutoSaveRule } from './services/replay-slots.ts';
import { GHOST_MODES, GHOST_SOURCES } from './services/ghost.ts';
import type { PlayerGUIState, SkinFamilyOverride } from './types.ts';
import { WORKER_COUNT_STORAGE_KEY } from './worker-settings.ts';
import { parseLaneKeys } from './lane-keys.ts';
import { CONTROL_SCHEMES, parseActionKeys, parseControlKeys } from './control-keys.ts';
import type { ControlActionOverrides, ControlKeyOverrides, ControlScheme } from '@be-music/player-browser/host';
import type { LaneKeyOverrides } from '@be-music/player-engine/lanes';

/** `localStorage` key of the whole Options dialog document. Reset deletes it with the other `be-music.*` settings. */
export const OPTION_SETTINGS_STORAGE_KEY = 'be-music.option-settings';
/**
 * The stored document's revision. `0` while the shape is still being defined: it may change incompatibly without the
 * number moving. Any other stamp is unreadable. The worker copy uses the same number. Values are migrated as they are
 * read instead (`pickSettings`): a bare RANDOM, S-RANDOM, CONVERGE or BATTLE becomes the stored ruleset's qualified one
 * (ADR 0019).
 */
const DOCUMENT_VERSION = 0;

type RandomMode = PlayerGUIState['random1P'];
type SkinEffects = PlayerGUIState['skinEffects'];
type PlayLayout = PlayerGUIState['playLayout'];

/** Every Options dialog value that survives a reload. Absent fields keep the visit's own default. */
export interface OptionSettings {
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
  ghost: PlayerGUIState['ghost'];
  ghostMode: PlayerGUIState['ghostMode'];
  autoSaveReplay: boolean;
  replaySlotAutoSave1: ReplayAutoSaveRule;
  replaySlotAutoSave2: ReplayAutoSaveRule;
  replaySlotAutoSave3: ReplayAutoSaveRule;
  replaySlotAutoSave4: ReplayAutoSaveRule;
  courseAutoAdvance: boolean;
  nonstopPlacement: PlayerGUIState['nonstopPlacement'];
  submitToLeaderboard: boolean;
  leaderboardSubmitRule: PlayerGUIState['leaderboardSubmitRule'];
  judgeRuleset: PlayerGUIState['judgeRuleset'];
  gauge: PlayerGUIState['gauge'];
  random1P: RandomMode;
  hRandomThresholdBPM: number;
  randomSeed1P: string;
  randomSeed2P: string;
  randomFixedLane1P: number;
  randomFixedLane2P: number;
  random2P: RandomMode;
  dpFlip: boolean;
  classicHiSpeed: boolean;
  floatingHiSpeed: boolean;
  fixedDisplayArea: boolean;
  normalHiSpeedLevel: number;
  judgeTimingMs: number;
  visualConstant: boolean;
  lift1P: number;
  lift2P: number;
  liftOn1P: boolean;
  liftOn2P: boolean;
  noteDurationMs: number;
  constantFadeMs: number;
  bpmGuide: boolean;
  bpmChangeWarning: boolean;
  lr2SpiralEffect: PlayerGUIState['lr2SpiralEffect'];
  lr2Wave: PlayerGUIState['lr2Wave'];
  lr2SinCurve: PlayerGUIState['lr2SinCurve'];
  lr2Nabeatsu: PlayerGUIState['lr2Nabeatsu'];
  lr2Heartbeat: PlayerGUIState['lr2Heartbeat'];
  lr2Char: PlayerGUIState['lr2Char'];
  lr2SuperLoop: PlayerGUIState['lr2SuperLoop'];
  lr2Tornado: PlayerGUIState['lr2Tornado'];
  lr2Earthquake: PlayerGUIState['lr2Earthquake'];
  lr2Acceleration: PlayerGUIState['lr2Acceleration'];
  autoScratchNotes: PlayerGUIState['autoScratchNotes'];
  judgeTimingAutoAdjust: PlayerGUIState['judgeTimingAutoAdjust'];
  judgeAlgorithm: PlayerGUIState['judgeAlgorithm'];
  longNoteModifier: PlayerGUIState['longNoteModifier'];
  longNoteRate: number;
  extraNoteDepth: number;
  extraNoteScratch: boolean;
  sevenToNinePattern: PlayerGUIState['sevenToNinePattern'];
  sevenToNineType: PlayerGUIState['sevenToNineType'];
  battleMode: PlayerGUIState['battleMode'];
  dBattleScratch: boolean;
  gauge2P: PlayerGUIState['gauge2P'];
  mRan1P: boolean;
  mRan2P: boolean;
  longNoteMode: PlayerGUIState['longNoteMode'];
  customJudge: boolean;
  practice: boolean;
  practiceGauge: PlayerGUIState['practiceGauge'];
  practiceGaugeCategory: PlayerGUIState['practiceGaugeCategory'];
  practiceStartGauge: number;
  practiceJudgeRank: number;
  practiceTotal: number;
  customJudgeKeyPerfectGreat: number;
  customJudgeKeyGreat: number;
  customJudgeKeyGood: number;
  customJudgeScratchPerfectGreat: number;
  customJudgeScratchGreat: number;
  customJudgeScratchGood: number;
  customJudgeLongNoteMargin: number;
  lr2ExtraMode: boolean;
  lr2ExtraLevel: PlayerGUIState['lr2ExtraLevel'];
  mineModifier: PlayerGUIState['mineModifier'];
  scrollModifier: PlayerGUIState['scrollModifier'];
  scrollSection: number;
  scrollRate: number;
  gaugeAutoShift: PlayerGUIState['gaugeAutoShift'];
  bottomShiftableGauge: PlayerGUIState['bottomShiftableGauge'];
  bmsonTotalMode: PlayerGUIState['bmsonTotalMode'];
  autoScratch1P: boolean;
  autoScratch2P: boolean;
  anyKey: boolean;
  laneKeys: LaneKeyOverrides;
  controlKeys: ControlKeyOverrides;
  builtInControlScheme: ControlScheme;
  actionKeys: ControlActionOverrides;
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
  renderer: PlayerGUIState['renderer'];
  recordingFormat: string;
  workerCount: number;
  compressorTuning: Record<TunableCompressor, CompressorTuning>;
  skinSettings: Record<string, Record<string, StoredSkinSettingValue>>;
  courseTableURLs: string[];
}

/** The document in `localStorage` and on the player origin. `settings` holds only the fields that were saved. */
export interface OptionSettingsDocument {
  version: 0;
  updatedAt: number;
  settings: Partial<OptionSettings>;
  /** Reset barrier kept remotely without retaining any settings values. */
  deleted?: true;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const SKIN_FAMILIES: readonly SkinFamilyOverride[] = ['auto', 'default', 'lr2', 'beatoraja'];
const SKIN_EFFECTS: readonly SkinEffects[] = ['full', 'reduced', 'off'];
const PLAY_LAYOUTS: readonly PlayLayout[] = ['auto', 'standard', 'touch'];
const RENDERERS: readonly PlayerGUIState['renderer'][] = ['webgl', 'webgpu'];
const RENDERER_KEY = 'be-music.renderer';
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

function assign<K extends keyof OptionSettings>(
  settings: Partial<OptionSettings>,
  key: K,
  value: OptionSettings[K] | undefined,
): void {
  if (value !== undefined) settings[key] = value;
}

/** Reads a stored document. An unknown version or unreadable text yields nothing. */
export function parseOptionSettingsDocument(raw: string | null | undefined): OptionSettingsDocument | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return optionSettingsDocument(parsed);
}

/** The same check for a response body. */
export function optionSettingsDocument(value: unknown): OptionSettingsDocument | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { version, updatedAt, settings } = value as { version?: unknown; updatedAt?: unknown; settings?: unknown };
  if (version !== DOCUMENT_VERSION || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0)
    return undefined;
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return undefined;
  if ((value as { deleted?: unknown }).deleted === true)
    return { version: DOCUMENT_VERSION, updatedAt, settings: {}, deleted: true };
  return { version: DOCUMENT_VERSION, updatedAt, settings: pickSettings(settings as Record<string, unknown>) };
}

/**
 * A stored lane option or battle mode, valid and source-qualified: a bare colliding value (RANDOM, S-RANDOM, CONVERGE,
 * BATTLE) from before ADR 0019 is the ruleset the document was saved with, as it meant then. The migration runs once in
 * effect: the qualified value is what the next save writes.
 */
function migrateStoredOption<K extends 'random1P' | 'random2P' | 'battleMode'>(
  key: K,
  value: unknown,
  ruleset: RulesetId,
): OptionSettings[K] | undefined {
  const valid = resolvePlayOptionValue(key, value);
  if (valid === undefined) return undefined;
  const migrated = migrateOptionValue(valid, ruleset);
  return (resolvePlayOptionValue(key, migrated) ?? valid) as OptionSettings[K];
}

function pickSettings(raw: Record<string, unknown>): Partial<OptionSettings> {
  const settings: Partial<OptionSettings> = {};
  // The settings this document was saved with default to LR2 rules, as a fresh visit does.
  const storedRuleset: RulesetId = isRulesetId(raw.judgeRuleset) ? raw.judgeRuleset : 'lr2';
  assign(settings, 'autoPlay', booleanOf(raw.autoPlay));
  assign(settings, 'autoPauseOnBlur', booleanOf(raw.autoPauseOnBlur));
  assign(settings, 'peakGain', booleanOf(raw.peakGain));
  assign(settings, 'compressor', booleanOf(raw.compressor));
  assign(settings, 'compressorKey', booleanOf(raw.compressorKey));
  assign(settings, 'compressorBGM', booleanOf(raw.compressorBGM));
  assign(settings, 'compressorMaster', booleanOf(raw.compressorMaster));
  assign(settings, 'showInvisibleNotes', booleanOf(raw.showInvisibleNotes));
  assign(settings, 'autoSaveReplay', booleanOf(raw.autoSaveReplay));
  assign(settings, 'replaySlotAutoSave1', oneOf(raw.replaySlotAutoSave1, REPLAY_AUTO_SAVE_RULES));
  assign(settings, 'replaySlotAutoSave2', oneOf(raw.replaySlotAutoSave2, REPLAY_AUTO_SAVE_RULES));
  assign(settings, 'replaySlotAutoSave3', oneOf(raw.replaySlotAutoSave3, REPLAY_AUTO_SAVE_RULES));
  assign(settings, 'replaySlotAutoSave4', oneOf(raw.replaySlotAutoSave4, REPLAY_AUTO_SAVE_RULES));
  assign(settings, 'courseAutoAdvance', booleanOf(raw.courseAutoAdvance));
  assign(settings, 'submitToLeaderboard', booleanOf(raw.submitToLeaderboard));
  assign(settings, 'leaderboardSubmitRule', oneOf(raw.leaderboardSubmitRule, LEADERBOARD_SUBMIT_RULES));
  assign(settings, 'dpFlip', booleanOf(raw.dpFlip));
  assign(settings, 'bpmGuide', booleanOf(raw.bpmGuide));
  assign(settings, 'bpmChangeWarning', booleanOf(raw.bpmChangeWarning));
  assign(settings, 'lr2SpiralEffect', resolvePlayOptionValue('lr2SpiralEffect', raw.lr2SpiralEffect));
  assign(settings, 'lr2Wave', resolvePlayOptionValue('lr2Wave', raw.lr2Wave));
  assign(settings, 'lr2SinCurve', resolvePlayOptionValue('lr2SinCurve', raw.lr2SinCurve));
  assign(settings, 'lr2Nabeatsu', resolvePlayOptionValue('lr2Nabeatsu', raw.lr2Nabeatsu));
  assign(settings, 'lr2Heartbeat', resolvePlayOptionValue('lr2Heartbeat', raw.lr2Heartbeat));
  assign(settings, 'lr2Char', resolvePlayOptionValue('lr2Char', raw.lr2Char));
  assign(settings, 'lr2SuperLoop', resolvePlayOptionValue('lr2SuperLoop', raw.lr2SuperLoop));
  assign(settings, 'lr2Tornado', resolvePlayOptionValue('lr2Tornado', raw.lr2Tornado));
  assign(settings, 'lr2Earthquake', resolvePlayOptionValue('lr2Earthquake', raw.lr2Earthquake));
  assign(settings, 'lr2Acceleration', resolvePlayOptionValue('lr2Acceleration', raw.lr2Acceleration));
  assign(settings, 'autoScratchNotes', resolvePlayOptionValue('autoScratchNotes', raw.autoScratchNotes));
  // A boolean from before the modes is beatoraja's switch.
  assign(settings, 'judgeTimingAutoAdjust', resolvePlayOptionValue('judgeTimingAutoAdjust', raw.judgeTimingAutoAdjust));
  assign(settings, 'visualConstant', booleanOf(raw.visualConstant));
  assign(settings, 'lift1P', resolvePlayOptionValue('lift1P', raw.lift1P));
  assign(settings, 'lift2P', resolvePlayOptionValue('lift2P', raw.lift2P));
  assign(settings, 'liftOn1P', resolvePlayOptionValue('liftOn1P', raw.liftOn1P));
  assign(settings, 'liftOn2P', resolvePlayOptionValue('liftOn2P', raw.liftOn2P));
  assign(settings, 'noteDurationMs', resolvePlayOptionValue('noteDurationMs', raw.noteDurationMs));
  assign(settings, 'constantFadeMs', resolvePlayOptionValue('constantFadeMs', raw.constantFadeMs));
  assign(settings, 'judgeTimingMs', resolvePlayOptionValue('judgeTimingMs', raw.judgeTimingMs));
  assign(settings, 'normalHiSpeedLevel', resolvePlayOptionValue('normalHiSpeedLevel', raw.normalHiSpeedLevel));
  assign(settings, 'fixedDisplayArea', resolvePlayOptionValue('fixedDisplayArea', raw.fixedDisplayArea));
  assign(settings, 'floatingHiSpeed', resolvePlayOptionValue('floatingHiSpeed', raw.floatingHiSpeed));
  assign(settings, 'classicHiSpeed', booleanOf(raw.classicHiSpeed));
  assign(settings, 'judgeAlgorithm', oneOf(raw.judgeAlgorithm, ['combo', 'duration', 'lowest'] as const));
  assign(settings, 'gaugeAutoShift', resolvePlayOptionValue('gaugeAutoShift', raw.gaugeAutoShift));
  assign(settings, 'bmsonTotalMode', resolvePlayOptionValue('bmsonTotalMode', raw.bmsonTotalMode));
  assign(settings, 'bottomShiftableGauge', resolvePlayOptionValue('bottomShiftableGauge', raw.bottomShiftableGauge));
  assign(settings, 'scrollSection', resolvePlayOptionValue('scrollSection', raw.scrollSection));
  assign(settings, 'scrollRate', resolvePlayOptionValue('scrollRate', raw.scrollRate));
  assign(settings, 'scrollModifier', resolvePlayOptionValue('scrollModifier', raw.scrollModifier));
  assign(settings, 'mineModifier', resolvePlayOptionValue('mineModifier', raw.mineModifier));
  assign(settings, 'sevenToNinePattern', resolvePlayOptionValue('sevenToNinePattern', raw.sevenToNinePattern));
  assign(settings, 'sevenToNineType', resolvePlayOptionValue('sevenToNineType', raw.sevenToNineType));
  assign(settings, 'battleMode', migrateStoredOption('battleMode', raw.battleMode, storedRuleset));
  assign(settings, 'dBattleScratch', resolvePlayOptionValue('dBattleScratch', raw.dBattleScratch));
  assign(settings, 'gauge2P', resolvePlayOptionValue('gauge2P', raw.gauge2P));
  assign(settings, 'mRan1P', resolvePlayOptionValue('mRan1P', raw.mRan1P));
  assign(settings, 'mRan2P', resolvePlayOptionValue('mRan2P', raw.mRan2P));
  assign(settings, 'longNoteMode', resolvePlayOptionValue('longNoteMode', raw.longNoteMode));
  assign(settings, 'customJudge', resolvePlayOptionValue('customJudge', raw.customJudge));
  assign(settings, 'practice', resolvePlayOptionValue('practice', raw.practice));
  assign(settings, 'practiceGauge', resolvePlayOptionValue('practiceGauge', raw.practiceGauge));
  assign(settings, 'practiceGaugeCategory', resolvePlayOptionValue('practiceGaugeCategory', raw.practiceGaugeCategory));
  assign(settings, 'practiceStartGauge', resolvePlayOptionValue('practiceStartGauge', raw.practiceStartGauge));
  assign(settings, 'practiceJudgeRank', resolvePlayOptionValue('practiceJudgeRank', raw.practiceJudgeRank));
  assign(settings, 'practiceTotal', resolvePlayOptionValue('practiceTotal', raw.practiceTotal));
  assign(
    settings,
    'customJudgeKeyPerfectGreat',
    resolvePlayOptionValue('customJudgeKeyPerfectGreat', raw.customJudgeKeyPerfectGreat),
  );
  assign(settings, 'customJudgeKeyGreat', resolvePlayOptionValue('customJudgeKeyGreat', raw.customJudgeKeyGreat));
  assign(settings, 'customJudgeKeyGood', resolvePlayOptionValue('customJudgeKeyGood', raw.customJudgeKeyGood));
  assign(
    settings,
    'customJudgeScratchPerfectGreat',
    resolvePlayOptionValue('customJudgeScratchPerfectGreat', raw.customJudgeScratchPerfectGreat),
  );
  assign(
    settings,
    'customJudgeScratchGreat',
    resolvePlayOptionValue('customJudgeScratchGreat', raw.customJudgeScratchGreat),
  );
  assign(
    settings,
    'customJudgeScratchGood',
    resolvePlayOptionValue('customJudgeScratchGood', raw.customJudgeScratchGood),
  );
  assign(
    settings,
    'customJudgeLongNoteMargin',
    resolvePlayOptionValue('customJudgeLongNoteMargin', raw.customJudgeLongNoteMargin),
  );
  assign(settings, 'lr2ExtraMode', resolvePlayOptionValue('lr2ExtraMode', raw.lr2ExtraMode));
  assign(settings, 'lr2ExtraLevel', resolvePlayOptionValue('lr2ExtraLevel', raw.lr2ExtraLevel));
  assign(settings, 'extraNoteDepth', resolvePlayOptionValue('extraNoteDepth', raw.extraNoteDepth));
  assign(settings, 'extraNoteScratch', resolvePlayOptionValue('extraNoteScratch', raw.extraNoteScratch));
  assign(settings, 'longNoteRate', resolvePlayOptionValue('longNoteRate', raw.longNoteRate));
  assign(settings, 'longNoteModifier', resolvePlayOptionValue('longNoteModifier', raw.longNoteModifier));
  assign(settings, 'autoScratch1P', booleanOf(raw.autoScratch1P));
  assign(settings, 'autoScratch2P', booleanOf(raw.autoScratch2P));
  assign(settings, 'anyKey', booleanOf(raw.anyKey));
  if (raw.laneKeys !== undefined) settings.laneKeys = parseLaneKeys(raw.laneKeys);
  if (raw.controlKeys !== undefined) settings.controlKeys = parseControlKeys(raw.controlKeys);
  assign(settings, 'builtInControlScheme', oneOf(raw.builtInControlScheme, CONTROL_SCHEMES));
  if (raw.actionKeys !== undefined) settings.actionKeys = parseActionKeys(raw.actionKeys);
  assign(settings, 'playInSilentMode', booleanOf(raw.playInSilentMode));
  assign(settings, 'muted', booleanOf(raw.muted));
  assign(settings, 'tempoEnabled', booleanOf(raw.tempoEnabled));
  assign(settings, 'bgaUseWebCodecs', booleanOf(raw.bgaUseWebCodecs));
  assign(settings, 'judgedNoteDisplay', oneOf(raw.judgedNoteDisplay, ['KEEP_SCROLLING', 'HIDE'] as const));
  assign(settings, 'ghost', oneOf(raw.ghost, GHOST_SOURCES));
  assign(settings, 'ghostMode', oneOf(raw.ghostMode, GHOST_MODES));
  assign(settings, 'nonstopPlacement', oneOf(raw.nonstopPlacement, ['intended', 'lr2'] as const));
  assign(settings, 'judgeRuleset', isRulesetId(raw.judgeRuleset) ? raw.judgeRuleset : undefined);
  assign(settings, 'gauge', isGaugeType(raw.gauge) ? raw.gauge : undefined);
  assign(settings, 'hRandomThresholdBPM', resolvePlayOptionValue('hRandomThresholdBPM', raw.hRandomThresholdBPM));
  for (const key of ['randomFixedLane1P', 'randomFixedLane2P', 'randomSeed1P', 'randomSeed2P'] as const)
    assign(settings, key, resolvePlayOptionValue(key, raw[key]));
  assign(settings, 'random1P', migrateStoredOption('random1P', raw.random1P, storedRuleset));
  assign(settings, 'random2P', migrateStoredOption('random2P', raw.random2P, storedRuleset));
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
  assign(settings, 'renderer', oneOf(raw.renderer, RENDERERS));
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
  if (typeof raw.hiSpeed === 'number')
    assign(
      settings,
      'hiSpeed',
      raw.floatingHiSpeed === true ? clampFloatingHiSpeed(raw.hiSpeed) : snapHiSpeed(raw.hiSpeed),
    );
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
      parseStoredSkinSettings(JSON.stringify({ version: 0, skins: raw.skinSettings })),
    );
  }
  if (Array.isArray(raw.courseTableURLs)) {
    settings.courseTableURLs = parseStoredCourseTableURLs(JSON.stringify(raw.courseTableURLs));
  }
  return settings;
}

/** The saved document, or nothing when this browser has never written one. */
export function readStoredOptionSettings(
  storage: Pick<Storage, 'getItem'> | undefined,
): OptionSettingsDocument | undefined {
  try {
    return parseOptionSettingsDocument(storage?.getItem(OPTION_SETTINGS_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

/** Whether any of the older per-setting keys is present, so the first visit after this change can upload them. */
export function hasLegacyOptionSettings(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return LEGACY_KEYS.some((key) => storage?.getItem(key) != null);
  } catch {
    return false;
  }
}

/** A document made from the keys this app used to write one by one. `updatedAt` is the moment of the migration. */
export function optionSettingsFromLegacy(
  storage: Pick<Storage, 'getItem'> | undefined,
  updatedAt: number,
): OptionSettingsDocument {
  const settings: Partial<OptionSettings> = {};
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

/** Copies saved fields onto the Options dialog state. Fields the document leaves out stay as they are. */
export function overlayOptionSettings(state: PlayerGUIState, settings: Partial<OptionSettings>): void {
  const assignState = <K extends keyof PlayerGUIState & keyof OptionSettings>(key: K): void => {
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
  assignState('ghost');
  assignState('ghostMode');
  assignState('autoSaveReplay');
  assignState('replaySlotAutoSave1');
  assignState('replaySlotAutoSave2');
  assignState('replaySlotAutoSave3');
  assignState('replaySlotAutoSave4');
  assignState('courseAutoAdvance');
  assignState('nonstopPlacement');
  assignState('submitToLeaderboard');
  assignState('leaderboardSubmitRule');
  assignState('judgeRuleset');
  assignState('gauge');
  assignState('random1P');
  assignState('hRandomThresholdBPM');
  assignState('randomSeed1P');
  assignState('randomSeed2P');
  assignState('randomFixedLane1P');
  assignState('randomFixedLane2P');
  assignState('random2P');
  assignState('dpFlip');
  assignState('bpmGuide');
  assignState('bpmChangeWarning');
  assignState('lr2SpiralEffect');
  assignState('lr2Wave');
  assignState('lr2SinCurve');
  assignState('lr2Nabeatsu');
  assignState('lr2Heartbeat');
  assignState('lr2Char');
  assignState('lr2SuperLoop');
  assignState('lr2Tornado');
  assignState('lr2Earthquake');
  assignState('lr2Acceleration');
  assignState('autoScratchNotes');
  assignState('judgeTimingAutoAdjust');
  assignState('visualConstant');
  assignState('noteDurationMs');
  assignState('lift1P');
  assignState('lift2P');
  assignState('liftOn1P');
  assignState('liftOn2P');

  assignState('constantFadeMs');
  assignState('judgeTimingMs');
  assignState('normalHiSpeedLevel');
  assignState('classicHiSpeed');
  assignState('floatingHiSpeed');
  assignState('fixedDisplayArea');
  assignState('judgeAlgorithm');
  assignState('longNoteModifier');
  assignState('longNoteRate');
  assignState('sevenToNinePattern');
  assignState('sevenToNineType');
  assignState('battleMode');
  assignState('dBattleScratch');
  assignState('gauge2P');
  assignState('mRan1P');
  assignState('mRan2P');
  assignState('longNoteMode');
  assignState('customJudge');
  assignState('practice');
  assignState('practiceGauge');
  assignState('practiceGaugeCategory');
  assignState('practiceStartGauge');
  assignState('practiceJudgeRank');
  assignState('practiceTotal');
  assignState('customJudgeKeyPerfectGreat');
  assignState('customJudgeKeyGreat');
  assignState('customJudgeKeyGood');
  assignState('customJudgeScratchPerfectGreat');
  assignState('customJudgeScratchGreat');
  assignState('customJudgeScratchGood');
  assignState('customJudgeLongNoteMargin');
  assignState('lr2ExtraMode');
  assignState('lr2ExtraLevel');
  assignState('extraNoteDepth');
  assignState('extraNoteScratch');
  assignState('mineModifier');
  assignState('scrollModifier');
  assignState('scrollSection');
  assignState('scrollRate');
  assignState('gaugeAutoShift');
  assignState('bmsonTotalMode');
  assignState('bottomShiftableGauge');
  assignState('autoScratch1P');
  assignState('autoScratch2P');
  assignState('anyKey');
  assignState('laneKeys');
  assignState('controlKeys');
  assignState('builtInControlScheme');
  assignState('actionKeys');
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
  assignState('renderer');
  assignState('recordingFormat');
}

/** The live Options dialog, plus the settings kept beside it, as one document. */
export function captureOptionSettings(
  state: PlayerGUIState,
  extras: {
    compressorTuning: Record<TunableCompressor, CompressorTuning>;
    skinSettings: ReadonlyMap<string, Record<string, StoredSkinSettingValue>>;
    courseTableURLs: readonly string[];
    workerCount: number;
    updatedAt?: number;
  },
): OptionSettingsDocument {
  const settings: Partial<OptionSettings> = {
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
    ghost: state.ghost,
    ghostMode: state.ghostMode,
    autoSaveReplay: state.autoSaveReplay,
    replaySlotAutoSave1: state.replaySlotAutoSave1,
    replaySlotAutoSave2: state.replaySlotAutoSave2,
    replaySlotAutoSave3: state.replaySlotAutoSave3,
    replaySlotAutoSave4: state.replaySlotAutoSave4,
    courseAutoAdvance: state.courseAutoAdvance,
    nonstopPlacement: state.nonstopPlacement,
    submitToLeaderboard: state.submitToLeaderboard,
    leaderboardSubmitRule: state.leaderboardSubmitRule,
    judgeRuleset: state.judgeRuleset,
    gauge: state.gauge,
    random1P: state.random1P,
    hRandomThresholdBPM: state.hRandomThresholdBPM,
    randomSeed1P: state.randomSeed1P,
    randomSeed2P: state.randomSeed2P,
    randomFixedLane1P: state.randomFixedLane1P,
    randomFixedLane2P: state.randomFixedLane2P,
    random2P: state.random2P,
    dpFlip: state.dpFlip,
    bpmGuide: state.bpmGuide,
    bpmChangeWarning: state.bpmChangeWarning,
    lr2SpiralEffect: state.lr2SpiralEffect,
    lr2Wave: state.lr2Wave,
    lr2SinCurve: state.lr2SinCurve,
    lr2Nabeatsu: state.lr2Nabeatsu,
    lr2Heartbeat: state.lr2Heartbeat,
    lr2Char: state.lr2Char,
    lr2SuperLoop: state.lr2SuperLoop,
    lr2Tornado: state.lr2Tornado,
    lr2Earthquake: state.lr2Earthquake,
    lr2Acceleration: state.lr2Acceleration,
    autoScratchNotes: state.autoScratchNotes,
    judgeTimingAutoAdjust: state.judgeTimingAutoAdjust,
    visualConstant: state.visualConstant,
    noteDurationMs: state.noteDurationMs,
    lift1P: state.lift1P,
    lift2P: state.lift2P,
    liftOn1P: state.liftOn1P,
    liftOn2P: state.liftOn2P,

    constantFadeMs: state.constantFadeMs,
    judgeTimingMs: state.judgeTimingMs,
    normalHiSpeedLevel: state.normalHiSpeedLevel,
    classicHiSpeed: state.classicHiSpeed,
    floatingHiSpeed: state.floatingHiSpeed,
    fixedDisplayArea: state.fixedDisplayArea,
    judgeAlgorithm: state.judgeAlgorithm,
    longNoteModifier: state.longNoteModifier,
    longNoteRate: state.longNoteRate,
    sevenToNinePattern: state.sevenToNinePattern,
    sevenToNineType: state.sevenToNineType,
    battleMode: state.battleMode,
    dBattleScratch: state.dBattleScratch,
    gauge2P: state.gauge2P,
    mRan1P: state.mRan1P,
    mRan2P: state.mRan2P,
    longNoteMode: state.longNoteMode,
    customJudge: state.customJudge,
    practice: state.practice,
    practiceGauge: state.practiceGauge,
    practiceGaugeCategory: state.practiceGaugeCategory,
    practiceStartGauge: state.practiceStartGauge,
    practiceJudgeRank: state.practiceJudgeRank,
    practiceTotal: state.practiceTotal,
    customJudgeKeyPerfectGreat: state.customJudgeKeyPerfectGreat,
    customJudgeKeyGreat: state.customJudgeKeyGreat,
    customJudgeKeyGood: state.customJudgeKeyGood,
    customJudgeScratchPerfectGreat: state.customJudgeScratchPerfectGreat,
    customJudgeScratchGreat: state.customJudgeScratchGreat,
    customJudgeScratchGood: state.customJudgeScratchGood,
    customJudgeLongNoteMargin: state.customJudgeLongNoteMargin,
    lr2ExtraMode: state.lr2ExtraMode,
    lr2ExtraLevel: state.lr2ExtraLevel,
    extraNoteDepth: state.extraNoteDepth,
    extraNoteScratch: state.extraNoteScratch,
    mineModifier: state.mineModifier,
    scrollModifier: state.scrollModifier,
    scrollSection: state.scrollSection,
    scrollRate: state.scrollRate,
    gaugeAutoShift: state.gaugeAutoShift,
    bmsonTotalMode: state.bmsonTotalMode,
    bottomShiftableGauge: state.bottomShiftableGauge,
    autoScratch1P: state.autoScratch1P,
    autoScratch2P: state.autoScratch2P,
    anyKey: state.anyKey,
    laneKeys: state.laneKeys,
    controlKeys: state.controlKeys,
    builtInControlScheme: state.builtInControlScheme,
    actionKeys: state.actionKeys,
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
    renderer: state.renderer,
    recordingFormat: state.recordingFormat,
    workerCount: extras.workerCount,
    compressorTuning: extras.compressorTuning,
    skinSettings: Object.fromEntries(extras.skinSettings),
    courseTableURLs: [...extras.courseTableURLs],
  };
  return { version: DOCUMENT_VERSION, updatedAt: extras.updatedAt ?? Date.now(), settings: pickSettings(settings) };
}

/** Writes the document and the older keys the rest of the app still reads at boot. */
export function writeOptionSettings(document: OptionSettingsDocument, storage: StorageLike | undefined): void {
  if (!storage) return;
  const { settings } = document;
  try {
    storage.setItem(OPTION_SETTINGS_STORAGE_KEY, JSON.stringify(document));
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
    if (settings.renderer) storage.setItem(RENDERER_KEY, settings.renderer);
    if (settings.recordingFormat) storage.setItem(RECORDING_FORMAT_KEY, settings.recordingFormat);
    if (settings.workerCount !== undefined) storage.setItem(WORKER_COUNT_STORAGE_KEY, String(settings.workerCount));
    if (settings.compressorTuning) storage.setItem(COMPRESSOR_TUNING_KEY, JSON.stringify(settings.compressorTuning));
    if (settings.skinSettings) {
      storage.setItem(SKIN_SETTINGS_KEY, serializeStoredSkinSettings(new Map(Object.entries(settings.skinSettings))));
    }
    if (settings.courseTableURLs)
      storage.setItem(COURSE_TABLE_URLS_STORAGE_KEY, JSON.stringify(settings.courseTableURLs));
  } catch {
    // Blocked or full storage: the visit still has the values in memory.
  }
}

function writeVolumes(storage: StorageLike, settings: Partial<OptionSettings>): void {
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
