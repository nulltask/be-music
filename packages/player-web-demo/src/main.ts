// Imports are split across `@be-music/player-web`'s per-area subpaths so the dependency surface of this demo is
// explicit at the file top. The main `@be-music/player-web` entry is reserved for symbols that don't belong to any
// single area (`logger`, `Rectangle`).
import {
  BUILT_IN_BE_MUSIC_SKINS,
  latticeSkin,
  plainSkin,
  synesthesiaSkin,
  DefaultPixiDecideView,
  DefaultPixiGameplayView,
  DefaultPixiResultView,
  DefaultPixiSongSelectView,
  PixiBeatorajaDecideScene,
  PixiBeatorajaGameplayView,
  PixiBeatorajaResultScene,
  PixiBeatorajaSelectScene,
  PixiDecideView,
  PixiGameplayView,
  PixiResultView,
  PixiSceneHost,
  PixiSongSelectView,
  HISPEED_MAX,
  HISPEED_MIN,
  HISPEED_STEP,
  snapHiSpeed,
  beatorajaClearLampOp,
  type BeatorajaSelectSystemSoundPaths,
  type PixiGameplayResultData,
  type PixiPlayOptions,
  type PixiSongSelectNavigation,
  resolveLr2CourseOps,
  resolveSceneCourseInfo,
  type SceneCourseInfo,
} from '@be-music/player-web/scenes';
import {
  BeatorajaSkinAudioPlayer,
  createBeMusicSkinRegistry,
  resolveBeMusicSkinSettings,
  type BeMusicSkin,
  type BeMusicSongRecord,
  discoverBeatorajaSelectBgmPath,
  discoverBeatorajaSystemSoundPaths,
  findBeatorajaThemeBgm,
  loadBeatorajaFonts,
  loadBeatorajaTexturesFromBundle,
  loadBeatorajaThemeFromFiles,
  loadTextureFromBytes,
  pickBeatorajaPlayableVariant,
  skinFamilyRegistry,
  summarizeBeatorajaPlaySkins,
  type BeatorajaFontCache,
  type BeatorajaPlayableVariant,
  type BeatorajaTextureCache,
  type BeatorajaThemeBgm,
  type BeatorajaThemeBundle,
} from '@be-music/player-web/skin';
import { prepareBeatorajaGameplayChart, type PreparedBeatorajaGameplayChart } from '@be-music/player-web/chart';
import {
  BrowserSongCollectionStore,
  checkBrowserCompat,
  computeChartFileHashes,
  describeSongCollection,
  loadAssetBytes,
  materializeDroppedFiles,
  readDroppedFiles,
  resolveSongSource,
  splitDroppedSongAndThemeFiles,
  createSongHashLookup,
  isCourseFilePath,
  drawBrowserRandomCourse,
  readCourseFile,
  resolveCourseFolders,
  resolveCourseMakerFolders,
  resolveCourseLaneOption,
  resolveCourseStageSettings,
  CourseMaker,
  createCourseSongRecord,
  type BrowserCourseEntry,
  type BrowserDroppedFile,
  type BrowserSongCollection,
  type BrowserSongEntry,
  type ChartFileHashes,
  type CourseDefinitionGroup,
} from '@be-music/player-web/collection';
import {
  downloadBlob,
  parseCompressorMode,
  parsePlaylog,
  resolvePlaylogFilename,
  serializePlaylog,
  PLAYLOG_FILE_SUFFIX,
  DEFAULT_COMPRESSOR_PARAMS,
  setMasterVolume,
  supportsSystemAudioSession,
  applySilentModePlayback,
  type BeMusicPlaylog,
  type PlaylogRecorderInfo,
  type CompressorMode,
  type CompressorParams,
  type TunableCompressor,
  type RecordingFormat,
} from '@be-music/player-web/runtime';
import {
  TUNABLE_COMPRESSORS,
  defaultCompressorTunings,
  paramsFromTuning,
  readStoredCompressorTunings,
  storeCompressorTunings,
  type CompressorTuning,
} from './compressor-tuning.ts';
import { logger } from '@be-music/player-web';
import {
  discoverLr2Themes,
  loadLr2ThemeSkinsFromFiles,
  pickLr2PlaySkin,
  pickLr2PlaySkinVariant,
  summarizeLr2PlaySkins,
  type Lr2DiscoveredTheme,
  type Lr2PlaySkinMap,
  type Lr2PlayVariant,
  type Lr2Skin,
  type Lr2ThemeSkins,
} from '@be-music/lr2-skin';
import {
  BEATORAJA_OP,
  BEATORAJA_SKIN_TYPE,
  buildBaseOpSet,
  buildDefaultSkinConfigFiles,
  buildDefaultSkinConfigOptions,
  bundleBeatorajaSources,
  expandBeatorajaWildcard,
  loadBeatorajaSkin,
  normalizeBeatorajaFonts,
  type BeatorajaLuaRuntimeContext,
  type BeatorajaSkinConfig,
  type BeatorajaSkinEntry,
  type BeatorajaSkinHeader,
} from '@be-music/beatoraja-skin';
import { BeatorajaSkinOptionsGui } from './beatoraja-skin-options-gui.ts';
import {
  courseRunKeepsRecord,
  mergeSongRecord,
  readStoredSongRecords,
  playRecordKey,
  songRecordKey,
  songRecordPlayFromResult,
  songRecordPlayFromSummary,
  type SongRecordPlay,
  storeSongRecords,
} from './song-records.ts';
import { LeaderboardPanel } from './leaderboard-ui.ts';
import { courseStageChartFingerprint } from './leaderboard.ts';
import {
  describeSkinSettingControllers,
  readStoredSkinSettings,
  setStoredSkinSetting,
  storeSkinSettings,
} from './skin-settings.ts';
import {
  resolveChartRulesetFacts,
  resolvePlayChart,
  type PlayerSummary,
  type ResolvedPlayChart,
} from '@be-music/player/core/engine';
import {
  resolveCoursePlaylogFilename,
  serializeCoursePlaylog,
  type BeMusicCoursePlaylog,
  type PlaylogCourseResult,
} from '@be-music/player/playlog';
import {
  buildCourseResultData,
  buildCourseResultSummary,
  CourseSession,
  courseRecordKey,
  joinCourseStageHistories,
  lookupCourseRecord,
  skipsCourseStageResult,
  type CourseStagePlan,
} from './course-session.ts';
import {
  describeCourseTableImportError,
  importCourseTable,
  isTableHeaderFilePath,
  readTableHeaderFile,
  mergeCourseGroup,
  normalizeCourseTableUrl,
  readStoredCourseTableUrls,
  rememberCourseTableUrl,
} from './course-table-import.ts';
import { buildNonstopCoursePlaylog, prepareNonstopCourse, type PreparedNonstopCourse } from './nonstop-course.ts';
import { LR2_COURSE_MAKER_MAX_STAGES, type CourseDefinition } from '@be-music/player/course';
import { CourseMakerPanel } from './course-maker-panel.ts';
import { loadMadeCourses, saveMadeCourses } from './course-maker-store.ts';

/** A NONSTOP course being played as its stitched chart. */
interface NonstopPlay {
  course: BrowserCourseEntry;
  prepared: PreparedNonstopCourse;
}
import demoPackageJson from '../package.json' with { type: 'json' };

const dropLog = logger('drop');
const gameplayLog = logger('gameplay');
const resolutionLog = logger('render-resolution');
const fullscreenLog = logger('fullscreen');

const AUTO_DETECT_RESOLUTION_LABEL = 'Auto-detect resolution';

/** How long the select screen settles (song images, fonts, first BGM) before the first-run resolution benchmark. */
const FIRST_RUN_RESOLUTION_DELAY_MS = 2000;

/** This app as the recorder of its play-logs (`recorder` in `*.bmplay.json`); the engine adds its own version. */
const PLAYLOG_RECORDER: Omit<PlaylogRecorderInfo, 'engine'> = {
  name: 'be-music-web',
  version: demoPackageJson.version,
  ...(__BE_MUSIC_BUILD__.length > 0 ? { build: __BE_MUSIC_BUILD__ } : {}),
  platform: 'web',
};
// lil-gui auto-injects its stylesheet at construction time (see `injectStyles` option, default `true`), so we don't
// import its CSS explicitly — its package.json doesn't expose the file via `exports` anyway.
import GUI, { type Controller } from 'lil-gui';
import { wireHelpModal } from './help-modal.ts';
import { DEMO_APP_HTML } from './dom-template.ts';
import { renderBrowserCompatPanel } from './compat-panel.ts';
import { navigationAfterDrop } from './drop-navigation.ts';
import { InlineSearch } from './inline-search.ts';
import { parseRecordingFormatKey, recordingFormatKey, recordingFormatOptions } from './recording-format-choice.ts';
import { readStoredHiSpeed, storeHiSpeed } from './hi-speed-storage.ts';
import {
  describePlayingStatus,
  readStoredPlayTempoSettings,
  storePlayTempoSettings,
  TEMPO_PERCENT_MAX,
  TEMPO_PERCENT_MIN,
  tempoFromPercent,
} from './play-tempo-settings.ts';
import { askSkinOffer, describeSkinOffer, type OfferedSkinFamily } from './skin-offer.ts';
import { decodeText, showReadtextOverlay } from './readtext-overlay.ts';
import { playSkinTypeForVariant, sanitizeFilenameStem } from './demo-utils.ts';
import { chartShapeFor, resolveBeatorajaSkinVariant } from './chart-shape.ts';
import { hasAnyLr2Skin, pickActiveFamilyForScene, type FamilyDispatchState } from './family-dispatch.ts';
import { applyLoadProgress, hideLoadingOverlay, showLoadingOverlay } from './loading-overlay.ts';
import { fetchZipAsFile, fetchZipAsFiles, parseUrlMediaParams } from './url-load.ts';
import { DEBUG_MENU_FOLDERS, clearDemoSettings, rememberFolderOpenStates, type DebugMenuFolder } from './debug-menu.ts';
import {
  enterTouchFullscreen,
  exitFullscreen,
  FullscreenEscapeLock,
  getFullscreenElement,
  type KeyboardLockNavigatorLike,
  shouldCaptureFullscreenEscape,
  toggleFullscreen,
} from './fullscreen.ts';
import {
  type PlayLayoutChoice,
  type SkinEffectsLevel,
  readDeviceSignals,
  resolvePlayLayoutMode,
  resolveDefaultSkinEffects,
  resolveDeviceProfile,
} from './device-profile.ts';
import {
  SILENT_MODE_STRINGS,
  installSilentModePlayback,
  mountSilentModeHint,
  mountStartSilentModeOption,
  readPlayInSilentMode,
  readSilentModeHintSeen,
  resolveSilentModeLanguage,
  shouldShowSilentModeHint,
  storePlayInSilentMode,
  storeSilentModeHintSeen,
  type StartSilentModeOption,
} from './silent-mode-playback.ts';
import {
  RECORD_LABEL,
  captureScreenshot,
  finalizeRecordingIfActive,
  startArmedRecording,
  toggleRecording,
  type RecordingDeps,
} from './recording-controller.ts';
import {
  benchmarkRenderResolution,
  DEFAULT_RENDER_RESOLUTION,
  nearestRenderResolution,
  RenderResolutionBenchmarkCancelled,
  readStoredRenderResolution,
  renderResolutionLabel,
  renderResolutionSteps,
  storeRenderResolution,
} from './render-resolution.ts';
import type { ChartImageTexture, DemoGuiState, PlayerWebDemoElements, SkinFamilyOverride } from './types.ts';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('missing #app');
}

app.innerHTML = DEMO_APP_HTML;

/**
 * Skins beyond Synesthesia and Plain are on hold while those two are polished: Phantom and Lattice, LR2 themes and
 * beatoraja skins, and every way to add one (theme drops, `?skin=`, the skin ZIP URL, "Add skin", the family and theme
 * pickers). The code stays; turning this on brings it all back.
 */
const EXTRA_SKINS_ENABLED = false;

/** Built-in be-music skins the default family can render with; the Debug Menu's "Built-in skin" picks one. */
const BE_MUSIC_SKINS = createBeMusicSkinRegistry(
  EXTRA_SKINS_ENABLED ? BUILT_IN_BE_MUSIC_SKINS : [synesthesiaSkin, plainSkin],
);
const BUILT_IN_SKIN_STORAGE_KEY = 'be-music-demo.built-in-skin';
// Lattice ships with the player but isn't loaded by default; bring it back when it was the last skin picked.
if (EXTRA_SKINS_ENABLED && readStoredBuiltInSkinId() === latticeSkin.id) BE_MUSIC_SKINS.add(latticeSkin);

/** Loads an added skin's faces in the background, so its first frame doesn't rasterize with a fallback font. */
function loadSkinFonts(skin: BeMusicSkin): void {
  if (!('fonts' in document)) return;
  for (const font of skin.fontLoads) void document.fonts.load(font).catch(() => {});
}

function readStoredBuiltInSkinId(): string | undefined {
  try {
    return window.localStorage.getItem(BUILT_IN_SKIN_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

const SKIN_EFFECTS_STORAGE_KEY = 'be-music-demo.skin-effects';

/** Stored effect level, else `'reduced'` on a phone / tablet or when the OS asks for reduced motion, else `'full'`. */
function readStoredSkinEffects(): SkinEffectsLevel {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(SKIN_EFFECTS_STORAGE_KEY);
  } catch {
    // Storage blocked — fall back to the device default.
  }
  return resolveDefaultSkinEffects(stored, readDeviceSignals());
}

const PLAY_LAYOUT_STORAGE_KEY = 'be-music-demo.play-layout';

/** Stored Debug Menu play-layout pick, `'auto'` when none. */
const RECORDING_FORMAT_STORAGE_KEY = 'be-music-demo.recording-format';

/** The remembered "Video format" (`mp4/avc`, `webm/vp9`, …); MP4 · H.264 when none is stored or it is unknown. */
function readStoredRecordingFormat(): string {
  try {
    return recordingFormatKey(parseRecordingFormatKey(window.localStorage.getItem(RECORDING_FORMAT_STORAGE_KEY)));
  } catch {
    // Storage blocked — use the default.
    return recordingFormatKey(parseRecordingFormatKey(null));
  }
}

function storeRecordingFormat(key: string): void {
  try {
    window.localStorage.setItem(RECORDING_FORMAT_STORAGE_KEY, key);
  } catch {
    // Storage blocked — the choice lasts for this visit only.
  }
}

function readStoredPlayLayout(): PlayLayoutChoice {
  try {
    const stored = window.localStorage.getItem(PLAY_LAYOUT_STORAGE_KEY);
    if (stored === 'auto' || stored === 'standard' || stored === 'touch') return stored;
  } catch {
    // Storage blocked — use the default.
  }
  return 'auto';
}

function storeBuiltInSkinId(id: string): void {
  try {
    window.localStorage.setItem(BUILT_IN_SKIN_STORAGE_KEY, id);
  } catch {
    // Private windows / blocked storage: the pick still applies for this session.
  }
}

const VOLUME_STORAGE_KEY = 'be-music-demo.volumes';

interface StoredVolumes {
  masterVolume: number;
  keyVolume: number;
  bgmVolume: number;
}

/** Master / keysound / BGM volumes in percent, as last set in the Debug Menu (all 100 when nothing is stored). */
function readStoredVolumes(): StoredVolumes {
  const fallback = { masterVolume: 100, keyVolume: 100, bgmVolume: 100 };
  try {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Record<keyof StoredVolumes, unknown>>;
    const percent = (value: unknown, otherwise: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : otherwise;
    return {
      masterVolume: percent(parsed.masterVolume, 100),
      keyVolume: percent(parsed.keyVolume, 100),
      bgmVolume: percent(parsed.bgmVolume, 100),
    };
  } catch {
    return fallback;
  }
}

function storeVolumes(volumes: StoredVolumes): void {
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, JSON.stringify(volumes));
  } catch {
    // Private windows / blocked storage: the volumes still apply for this session.
  }
}

const DEFAULT_UI_FONT_LOADS: readonly string[] = [
  '400 22px "LINE Seed JP"',
  '700 18px "LINE Seed JP"',
  '900 32px "Azeret Mono"',
  // Every registered skin's faces (the built-ins plus any added at startup, such as a remembered Lattice), so switching
  // skins never rasterizes a first frame with a fallback font.
  ...new Set(BE_MUSIC_SKINS.skins.flatMap((skin) => skin.fontLoads)),
];

async function waitForDefaultUiFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await Promise.race([
      Promise.all(DEFAULT_UI_FONT_LOADS.map((font) => document.fonts.load(font))),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1500);
      }),
    ]);
  } catch {
    // The stylesheet uses font-display=swap, so the app can still start with browser fallbacks if Google Fonts is blocked.
  }
}

/** What a decide screen leads to instead of playing its song: a course's first stage, and what backing out undoes. */
interface DecideContinuation {
  start: () => Promise<void>;
  cancel?: () => void;
}

class PlayerWebDemoApp {
  private readonly collectionStore = new BrowserSongCollectionStore();
  /**
   * Per-variant play skins, keyed by `Lr2PlayVariant`. Loaded once at theme-drop time so a DP chart can pick
   * `playSkins['14']` while a regular SP chart picks `playSkins['7']`.
   */
  private readonly playSkins: Lr2PlaySkinMap = {};
  /**
   * LR2 themes detected in the most recent drop, scoped to `LR2files/Theme/<name>/` subdirs that contain at least
   * one `.lr2skin`. Populated by {@link loadTheme}; the Debug Menu's "LR2 theme" picker reads from here and lets
   * the user swap between themes without re-dropping. Empty when no LR2 theme is loaded.
   */
  private availableLr2Themes: ReadonlyArray<Lr2DiscoveredTheme<File>> = [];
  /**
   * Name of the LR2 theme currently mounted into the `playSkins` / `selectSkin` / … slots. Used by the picker to
   * (a) compute the initial selection on rebuild and (b) preserve the user's chosen theme across drops that ship
   * the same theme name. `undefined` when no LR2 theme is loaded.
   */
  private activeLr2ThemeName: string | undefined;
  /**
   * Single PixiJS host shared by every scene (select / gameplay / result). Scenes are attached and detached through
   * `PixiSceneHost` instead of constructing a separate Pixi `Application` per view.
   */
  private readonly sceneHost = new PixiSceneHost();
  private collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  /**
   * Course files dropped so far (`.lr2crs`, beatoraja `course/*.json`) and courses imported from difficulty-table URLs,
   * resolved into `collection.courseFolders`.
   */
  private courseGroups: CourseDefinitionGroup[] = [];
  /** The course being played, between its stages. */
  private courseSession: CourseSession | undefined;
  /** Set when a course was started with AUTO (`true`), so its every stage plays itself; `undefined` follows the menu. */
  private courseAutoPlay: boolean | undefined;
  /** The player's own courses and the course being made (LR2's course maker), kept in IndexedDB. */
  private readonly courseMaker = new CourseMaker({
    md5Of: async (song) => (await this.resolveChartHashes(song))?.md5,
    onChange: (change) => void this.handleCourseMakerChange(change),
  });
  private courseMakerPanel: CourseMakerPanel | undefined;
  private selectSkin: Lr2Skin | undefined;
  private resultSkin: Lr2Skin | undefined;
  /** LR2 course-result skin (`#INFORMATION` type 15); the course result falls back to {@link resultSkin} without it. */
  private courseResultSkin: Lr2Skin | undefined;
  /**
   * Re-parses one of the mounted LR2 theme's skins with extra parse-time ops (`Lr2ThemeSkins.loadSkin`): a course stage
   * plays on its skins parsed with the course ops, as LR2 reads a skin at each scene start.
   */
  private loadLr2ThemeSkin: Lr2ThemeSkins['loadSkin'] | undefined;
  /**
   * LR2 Decide-screen skin (the brief splash between song select and gameplay). Loaded from
   * `Theme/<name>/Decide/decide.lr2skin` by `loadLr2ThemeSkinsFromFiles`. When undefined, the host skips the splash and
   * transitions directly to gameplay.
   */
  private decideSkin: Lr2Skin | undefined;
  /**
   * beatoraja theme bundle held in parallel with the LR2 state. We don't render beatoraja scenes yet — that PixiJS
   * wiring is a follow-up — but we DO want to detect a beatoraja theme drop so the user gets a clear log line and
   * the parser path stays exercised end-to-end.
   */
  private beatorajaTheme: BeatorajaThemeBundle | undefined;
  /**
   * BGM bytes discovered inside the loaded beatoraja theme bundle (`decide.wav` / `clear.wav` /
   * `fail.wav` / `result.wav`). Populated alongside `beatorajaTheme` after a successful drop.
   * The decide / result scenes consume these directly — no separate caching layer needed since
   * decoding happens lazily inside each scene's audio context.
   */
  private beatorajaThemeBgm: BeatorajaThemeBgm = {};
  /**
   * Audio player driving `main_state.audio_play / loop / stop` from Lua. One per theme bundle —
   * the path → AudioBuffer cache is keyed against the bundle's file map, so a fresh theme drop
   * disposes the old player and creates a new one. Without this wired in, the Lua API surface
   * exists but every call returns false (silent), so ModernChic's panel SE were dead even though
   * the eval no longer crashed.
   */
  private beatorajaSkinAudio: BeatorajaSkinAudioPlayer | undefined;
  /**
   * System-sound paths discovered from the active theme bundle. Re-probed every theme load
   * via {@link discoverBeatorajaSystemSoundPaths}; passed to {@link PixiBeatorajaSelectScene}
   * so cursor / decide / folder / option events fire the matching cues. Stays empty (`{}`)
   * for stripped LR2 themes that don't ship a `sound/` subdirectory.
   */
  private beatorajaSystemSoundPaths: BeatorajaSelectSystemSoundPaths = {};
  /**
   * Looping select-scene BGM path discovered from the active theme bundle. Re-probed on
   * every theme load via {@link discoverBeatorajaSelectBgmPath}; passed to the select scene
   * as `selectBgmPath` so the BGM starts on enter and stops on exit. `undefined` for themes
   * that don't ship a select BGM (the scene runs silent in the background then, just chart
   * preview clips and navigation cues).
   */
  private beatorajaSelectBgmPath: string | undefined;
  /**
   * Loop-playable BGM bytes for the song-select scene (`LR2files/Bgm/<theme>/select.wav` from the dropped theme).
   * Forwarded to `PixiSongSelectView` via the constructor option on first mount and via `setSelectBgm` on subsequent
   * theme drops mid-session.
   */
  private selectBgmBytes: Uint8Array | undefined;
  /** Result-screen BGM bytes — picked per outcome inside `PixiResultView`. */
  private clearBgmBytes: Uint8Array | undefined;
  private failBgmBytes: Uint8Array | undefined;
  private resultBgmBytes: Uint8Array | undefined;
  /** LR2 course-result jingles (`courseclear` / `coursefail`); the course result falls back to the clear / fail ones. */
  private courseClearBgmBytes: Uint8Array | undefined;
  private courseFailBgmBytes: Uint8Array | undefined;
  /**
   * One-shot song-decided sound bytes (`LR2files/Bgm/<theme>/decide.wav`). Played by
   * `PixiSongSelectView.playDecideSound` on the select → gameplay transition.
   */
  private decideBgmBytes: Uint8Array | undefined;
  /**
   * LR2 system sound-effect bundle (`LR2files/Sound/lr2/<name>.wav`). Each slot maps to a `PixiSongSelectView`
   * system-sound name (cursorMove / folderOpen / folderClose). Forwarded via the constructor option on first mount and
   * via `setSystemSounds` on subsequent theme drops.
   */
  private systemSoundBundle: {
    cursorMove?: Uint8Array;
    folderOpen?: Uint8Array;
    folderClose?: Uint8Array;
    optionOpen?: Uint8Array;
    optionClose?: Uint8Array;
    optionChange?: Uint8Array;
  } = {};
  private selectView: PixiSongSelectView | DefaultPixiSongSelectView | undefined;
  /** LR2-family or default-family gameplay view (both share the core gameplay API). */
  private gameplayView: PixiGameplayView | DefaultPixiGameplayView | undefined;
  /**
   * Beatoraja gameplay view. Active in place of `gameplayView` when the user toggles
   * `useBeatorajaGameplay` and the loaded theme has a skin variant matching the chart shape. Held
   * separately because the two views don't share an interface — the LR2 view manages its own audio
   * decoding internally, while this one consumes a `PreparedBeatorajaGameplayChart` from the
   * `prepareBeatorajaGameplayChart` helper.
   */
  private beatorajaGameplayView: PixiBeatorajaGameplayView | undefined;
  /**
   * The variant the active gameplay view is mounted against. Held alongside
   * {@link beatorajaGameplayView} so the Debug Menu's "Play 7K / Play 5K / …" dropdowns can
   * resolve their type-code → live-apply call without reaching into the view internals. Cleared
   * on dispose so a stale value can never cause the next dropdown change to no-op silently.
   */
  private currentBeatorajaPlayVariant: BeatorajaPlayableVariant | undefined;
  /** The current chart's prepared assets (audio + BGA). Disposed alongside the gameplay view. */
  private beatorajaGameplayPrep: PreparedBeatorajaGameplayChart | undefined;
  /** The chart path {@link beatorajaGameplayPrep} was prepared for. */
  private beatorajaGameplayPrepChartPath: string | undefined;
  /**
   * The most recently resolved chart for a beatoraja run, paired with the song's `chartPath` so
   * subsequent stages can verify the cached chart still matches the song they're handling.
   *
   * Lifecycle:
   *   1. The decide scene resolves `#IF` / `#RANDOM` once at entry and stores the result here so
   *      the bpmgraph (and the gameplay prep that follows) sees the SAME branches.
   *   2. `playSongBeatoraja` hands it to the prep as `preResolved` — only when `chartPath` matches the
   *      song being played. Mismatched paths fall back to a fresh resolve (= the user reached
   *      gameplay without going through decide; rare but possible via debug paths).
   *   3. `disposeBeatorajaGameplay` re-stamps it from `prep.chart` / `prep.randomDraws` so the result scene gets
   *      the same chart for its bpmgraph.
   *
   * `resolved` holds the chart together with the `#RANDOM` / `#SWITCH` draws it was resolved with; both are plain
   * JSON, so retaining them is cheap.
   */
  private lastBeatorajaChart: { resolved: ResolvedPlayChart; chartPath: string } | undefined;
  /** Beatoraja-skinned song select scene. Active when a beatoraja theme with a select skin is loaded. */
  private beatorajaSelectScene: PixiBeatorajaSelectScene | undefined;
  /**
   * The search field: typed into in place over the skin's search box (built-in and LR2 skins), or at the foot of the
   * screen where the skin has none (beatoraja). It filters whichever select scene is on screen.
   */
  private readonly search = new InlineSearch({
    input: document.querySelector<HTMLInputElement>('#search')!,
    shell: document.querySelector<HTMLElement>('.shell')!,
    canvas: () => this.sceneHost?.app.canvas,
    fieldRect: () => (this.beatorajaSelectScene === undefined ? this.selectView?.getSearchFieldRect() : undefined),
    setQuery: (query) => {
      if (this.beatorajaSelectScene !== undefined) this.beatorajaSelectScene.setSearchQuery(query);
      else this.selectView?.setSearchQuery(query);
    },
    setEditing: (editing) => this.selectView?.setSearchEditing(editing),
    touch: () => document.documentElement.classList.contains('touch-first'),
  });
  /**
   * Beatoraja-skinned decide splash. Active during the select → gameplay handoff when the loaded
   * theme ships a decide skin (`type = 6`). Disposed before the gameplay scene mounts.
   */
  private beatorajaDecideScene: PixiBeatorajaDecideScene | undefined;
  /**
   * Beatoraja-skinned result scene. Active after gameplay completes when the loaded theme ships a
   * result skin (`type = 7`). The chart's final `PlayerSummary` is forwarded so the skin's value
   * destinations can render frozen score / judge / combo readouts.
   */
  private beatorajaResultScene: PixiBeatorajaResultScene | undefined;
  /**
   * Bottom-right lil-gui panel exposing the active beatoraja skin's `property[]` / `filepath[]` /
   * note-offset for live editing. Lazily constructed once `start()` mounts the host (the panel is
   * absolute-positioned inside the demo shell so the shell needs to exist first).
   */
  private beatorajaSkinOptionsGui: BeatorajaSkinOptionsGui | undefined;
  /**
   * Per-skin-entry config picks. The skin-options panel mutates these and the active scene re-mounts
   * with the updated values. Survives scene transitions so navigating away and back preserves the
   * user's choices for each skin (a select skin and a play skin can carry independent configs).
   */
  private readonly beatorajaSkinConfigByEntry = new Map<string, BeatorajaSkinConfig>();
  /**
   * Per-`SkinType` user-picked entry override. Lets the user choose between multiple discovered
   * skins for a given scene type from the Debug Menu. Keyed by the numeric `header.type` so
   * each scene (`MUSIC_SELECT = 5`, `PLAY_7KEYS = 0`, etc.) tracks its own override.
   */
  private readonly beatorajaSkinOverridesByType = new Map<number, string>();
  /**
   * Debug-menu folder hosting one dropdown per skin scene type (Play 5K / 7K / 9K / 10K / 14K /
   * 24K / 24Kdp / Music Select / Decide / Result / etc.). Empty until a beatoraja theme is
   * dropped — `rebuildBeatorajaSkinPickers` (re-)populates it from `beatorajaTheme.entries`.
   */
  private beatorajaSkinPickerFolder: GUI | undefined;
  /**
   * Active controllers inside {@link beatorajaSkinPickerFolder}, keyed by scene type. Cleared
   * and rebuilt on each `rebuildBeatorajaSkinPickers` call so dropdown options stay in sync with
   * the latest theme drop.
   */
  private readonly beatorajaSkinPickerControllers: Map<number, Controller> = new Map();
  /**
   * Last beatoraja-select highlighted index — survives scene tear-down so coming back from gameplay
   * lands on the same song the user just played.
   *
   * Subsumed by {@link beatorajaSelectSnapshot} for richer restore (folder / sort / filter / favorites).
   * Kept for backward compatibility with code paths that haven't been migrated to the snapshot yet.
   */
  private beatorajaSelectIndex = 0;
  /**
   * Last beatoraja-select scene state captured at scene-exit. Re-applied on the next mount so the
   * user lands on the same folder, cursor, sort, filter, and favorites set they left — not just
   * the focused song. Captured via `selectScene.captureSnapshot()` at every dispose site that
   * represents a "coming back later" transition (PLAY entry, decide entry, theme reload). Cleared
   * by `onExit` (ESC at root) since that's the user explicitly leaving the select altogether.
   */
  private beatorajaSelectSnapshot: import('@be-music/player-web').PixiBeatorajaSelectSceneSnapshot | undefined;
  private resultView: PixiResultView | DefaultPixiResultView | undefined;
  /**
   * The chart and play mode of the most recent play start (LR2 / default and beatoraja alike), so the result screen's
   * R key can start the same chart again. `autoPlay` is resolved at play start so a retry keeps the mode the play ran
   * in even when the toggle changes on the result screen; the remaining play options are read from the GUI state as
   * on any play start.
   */
  private lastPlay: { song: BrowserSongEntry; overrides: { autoPlay: boolean; replay?: BeMusicPlaylog } } | undefined;
  private decideView: PixiDecideView | DefaultPixiDecideView | undefined;
  private hostMounted = false;
  /**
   * Last-known cursor / folder state of the select view, captured before gameplay so returning to song select restores
   * the user's position.
   */
  private lastSelectNavigation: PixiSongSelectNavigation | undefined;
  /**
   * Where the select screen was when a course started. A later stage starts with no select screen up, so the course
   * keeps this to put the cursor back on the course bar once it is over.
   */
  private courseReturnNavigation: PixiSongSelectNavigation | undefined;
  /** The skin system the scenes run on, so a pick of one that is not loaded can be undone. */
  private activeSkinSystem: SkinFamilyOverride = EXTRA_SKINS_ENABLED ? 'auto' : 'default';
  /** The skin system the "Drop a skin" prompt asked for, until a drop answers it or it is cancelled. */
  private pendingSkinSystem: OfferedSkinFamily | undefined;
  /**
   * Compressor architecture for `audioCompressorMode` on every gameplay mount. Defaults to `'split'` (the new 3-stage
   * bus — see `audio-bus.ts` for the design rationale); the demo accepts a `?compressor=legacy` URL flag for A/B
   * comparison against the old single-compressor topology, and `?compressor=off` to spawn gameplay with the bypass path
   * active out of the gate (the checkbox can also reach `off` mid-session).
   */
  private compressorMode: 'split' | 'legacy' = 'split';
  /**
   * GUI state object the lil-gui controllers read / write. Held on the instance so the GUI build code and the runtime
   * handlers (`toggleRecording` etc.) share a single source of truth — programmatic updates go through `state.foo = …`
   * + `controller.updateDisplay()`.
   */
  private readonly guiState: DemoGuiState;
  /** The Debug Menu's "Render resolution" dropdown and "Auto-detect resolution" button. */
  private resolutionPicker: Controller | undefined;
  private autoDetectResolutionControl: Controller | undefined;
  /** Whether a render resolution benchmark is running. */
  private detectingResolution = false;
  /** Whether this visit already scheduled the first-run benchmark. */
  private firstRunResolutionScheduled = false;
  /**
   * lil-gui handles for controllers we need to address by name after construction — toggling the per-stage folder
   * visibility, renaming the record button, and reflecting URL- flag-driven compressor changes back into the GUI.
   */
  private gui: GUI | undefined;
  private compressorStageFolder: GUI | undefined;
  /** Compressor tuning in slider units, restored from the last visit; seeds every gameplay mount. */
  private readonly compressorTunings: Record<TunableCompressor, CompressorTuning> = readStoredCompressorTunings();
  private recordController: Controller | undefined;
  /**
   * "Auto-save play history" checkbox controller. Held so the play-start path can `disable()` it for the duration
   * of a play — the playlog options are latched when a song starts and cannot change mid-song — and the result /
   * select paths can `enable()` it again.
   */
  private playlogSaveController: Controller | undefined;
  /** The Leaderboard's Debug Menu folder, account chip and play submission. */
  private readonly leaderboard = new LeaderboardPanel({
    // Read on use: `guiState` is initialized after this field.
    settings: () => this.guiState,
    setStatus: (text) => this.setStatus(text),
    warn: (message, error) => gameplayLog.warn(message, error),
    recorder: PLAYLOG_RECORDER,
  });
  /**
   * Every "Play options" folder controller (auto play / judge / gauge / random / DP flip / auto scratch). Disabled
   * together while a song is playing (`lockPlaylogOptionsForPlay`) and refreshed when the LR2 select panel pushes
   * a change (`refreshPlayOptionControllers`).
   */
  private readonly playOptionControllers: Controller[] = [];
  /** The "Hi-speed" slider — left enabled during a play (it applies live) and repainted by {@link rememberHiSpeed}. */
  private hiSpeedController: Controller | undefined;
  /** Per-entry chart-file hash cache (`null` = lookup failed) — see {@link resolveChartHashes}. */
  private readonly chartHashCache = new Map<string, ChartFileHashes | null>();
  /** In-flight {@link resolveChartHashes} lookups, so a chart is hashed once however often it is asked for. */
  private readonly chartHashPending = new Map<string, Promise<ChartFileHashes | undefined>>();
  /** Best record per chart ({@link songRecordKey}), persisted in `localStorage` and shown to be-music select skins. */
  private readonly songRecords = readStoredSongRecords();
  /** Each be-music skin's `settings` values by skin id, persisted in `localStorage` and handed to its scenes. */
  private readonly skinSettings = readStoredSkinSettings();
  /** Debug Menu folder holding the active be-music skin's settings; hidden for a skin that declares none. */
  private skinSettingsFolder: GUI | undefined;
  /** The Debug Menu's "Skin & display" folder, which hosts the LR2 theme picker once a drop discovers themes. */
  private skinFolder: GUI | undefined;
  /**
   * Record key of the play in flight when it counts towards the chart's best record, latched at song start. `undefined`
   * for autoplay and replay plays, which never touch the records.
   */
  private activePlayRecordKey: string | undefined;
  /**
   * `guiState.autoSavePlaylog` as it was when the current play STARTED. The result-screen auto-save decision reads
   * this latch, not the live checkbox, so the value in effect at song start governs the whole play (the checkbox is
   * disabled during gameplay anyway — this latch is the enforcement for any path that slips through).
   */
  private activePlayAutoSavePlaylog = false;
  /**
   * Top-level "Skin family" dropdown. Rebuilt via {@link rebuildSkinFamilyPicker} on every theme load / wipe so its
   * option list reflects which families are actually selectable (LR2 only shows up once an `.lr2skin` has been
   * dropped; beatoraja only after a `.luaskin` / `skin/*.json` drop; Auto + Default always present). Holding the
   * controller reference lets `rebuildSkinFamilyPicker` swap the options in-place via lil-gui's
   * `Controller#options` API without disturbing the insertion order of subsequent controllers.
   */
  private skinFamilyController: Controller | undefined;
  /**
   * "LR2 theme" picker. Visible only when {@link availableLr2Themes} has 2+ entries; rebuilt on each theme drop so
   * its option list tracks what was just loaded. The lil-gui option-controller pattern (`Controller#options(...)`)
   * preserves the previously-attached `onChange` listener across rebuilds — see {@link rebuildSkinFamilyPicker}
   * for the same idiom.
   */
  private lr2ThemeController: Controller | undefined;
  /**
   * Disabled string controller used as the read-only status row inside the lil-gui panel. We hold a reference so {@link
   * setStatus} can call `updateDisplay()` directly rather than relying on lil-gui's `.listen()` polling.
   */
  private statusController: Controller | undefined;
  /**
   * `true` after the user clicks Record on the song-select screen but before they actually pick a song. Consumed (and
   * cleared) by `playSong` immediately after the gameplay view mounts, kicking off `startRecording()` so the very first
   * frame of the chart is captured.
   *
   * A second click on Record before picking a song flips this back to `false` ("disarm"), and any non-pick path that
   * leaves the select view (e.g. dropping a new folder mid- armed) is responsible for clearing it via {@link
   * disarmAutoRecord} so the flag doesn't survive into a future session that shouldn't be auto-captured.
   */
  private autoRecordArmed = false;
  /** The Debug Menu's "Play in silent mode" checkbox, when the browser offers the setting. */
  private silentModeController: Controller | undefined;
  /** The start card's "Play in silent mode" checkbox, when the browser offers the setting. */
  private startSilentModeOption: StartSilentModeOption | undefined;
  private readonly elements: PlayerWebDemoElements;
  public constructor(elements: PlayerWebDemoElements) {
    this.elements = elements;
    this.guiState = {
      autoPlay: false,
      autoPauseOnBlur: false,
      // Compressor stack ON by default — without it, multiple simultaneous `#WAV` samples sum past full scale and
      // digital- clip at the destination. The `MIXER_HEADROOM_GAIN_LINEAR` attenuation in `audio-bus.ts` buys a little
      // headroom but the master limiter is what reliably prevents audible clipping on dense charts. Power users wanting
      // an unprocessed signal path can still flip it via `?compressor=off` or the GUI.
      ...readStoredVolumes(),
      playInSilentMode: readPlayInSilentMode(),
      compressor: true,
      compressorKey: true,
      compressorBgm: true,
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
      // play-log (`*.bmplay.json`) preserved turn it on from the Debug Menu checkbox; it then downloads when the result
      // scene mounts.
      autoSavePlaylog: false,
      courseAutoAdvance: false,
      nonstopPlacement: 'intended',
      // The play tempo, its pitch handling and the keep-pitch stretcher, remembered from the last visit.
      ...readStoredPlayTempoSettings(),
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
      autoScratch1P: false,
      autoScratch2P: false,
      hiSpeed: readStoredHiSpeed(),
      // Skin-family routing defaults to `'auto'`: beatoraja > LR2 > default, picked per-scene from what's loaded.
      // The Debug Menu's "Skin family" dropdown lets users force a specific family; LR2 / beatoraja entries appear
      // in the dropdown only when their theme is loaded (see {@link rebuildSkinFamilyPicker}).
      // With extra skins on hold, every scene renders with the built-in be-music skin.
      skinFamilyOverride: EXTRA_SKINS_ENABLED ? 'auto' : 'default',
      builtInSkin: BE_MUSIC_SKINS.resolve(readStoredBuiltInSkinId()).id,
      skinEffects: readStoredSkinEffects(),
      renderResolution: nearestRenderResolution(
        renderResolutionSteps(window.devicePixelRatio || 1),
        readStoredRenderResolution() ?? DEFAULT_RENDER_RESOLUTION,
      ),
      playLayout: readStoredPlayLayout(),
      status: 'Ready',
      openFolder: () => this.elements.songInput.click(),
      openFiles: () => this.elements.filesInput.click(),
      recordingFormat: readStoredRecordingFormat(),
      record: () => {
        void toggleRecording(this.recordingDeps());
      },
      screenshot: () => {
        void captureScreenshot(this.recordingDeps());
      },
    };
    // Every sound plays through the master volume; start from the remembered level.
    setMasterVolume(this.guiState.masterVolume / 100);
    // Set the platform audio session before any scene creates an AudioContext, and again on the first gesture (which
    // is when the scenes resume their contexts) — see `silent-mode-playback.ts`.
    installSilentModePlayback({
      enabled: () => this.guiState.playInSilentMode,
      target: window,
      visibility: document,
      onFirstGesture: () => this.maybeShowSilentModeHint(),
    });
    // Pick up the `?compressor=split|legacy|off` URL flag once at boot. We resolve it through `parseCompressorMode`
    // (the same helper exported from `audio-bus.ts`) so the recognized values stay synced with the runtime API.
    // Unrecognized / missing flag → fall through to defaults: architecture `'split'`, GUI checkbox checked (compressor
    // on, see the `compressor: true` seed above for the rationale).
    //
    // `?compressor=split|legacy` is an explicit opt-in to that architecture and keeps the checkbox checked.
    // `?compressor=off` unchecks it for an unprocessed-signal A/B comparison.
    const flag: CompressorMode | undefined = parseCompressorMode(
      new URL(window.location.href).searchParams.get('compressor'),
    );
    if (flag === 'split' || flag === 'legacy') {
      this.compressorMode = flag;
      this.guiState.compressor = true;
    } else if (flag === 'off') {
      this.guiState.compressor = false;
    }
  }

  /** Applies and remembers the "Play in silent mode" setting (Debug Menu checkbox or the hint's button). */
  private setPlayInSilentMode(value: boolean): void {
    this.guiState.playInSilentMode = value;
    storePlayInSilentMode(value);
    applySilentModePlayback(value);
    this.silentModeController?.updateDisplay();
    this.startSilentModeOption?.setChecked(value);
    // Once the user has found the setting, the hint has nothing left to say.
    storeSilentModeHintSeen();
  }

  /**
   * The first time sound can start on an iPhone / iPad, point at the setting: the silent switch mutes web audio there
   * and nothing on screen says why. Shown once per browser, only while the setting is off.
   */
  private maybeShowSilentModeHint(): void {
    const show = shouldShowSilentModeHint({
      supported: supportsSystemAudioSession(),
      enabled: this.guiState.playInSilentMode,
      seen: readSilentModeHintSeen(),
      touchFirst: deviceProfile.touchFirst,
    });
    if (!show) return;
    storeSilentModeHintSeen();
    mountSilentModeHint({
      strings: SILENT_MODE_STRINGS[resolveSilentModeLanguage(navigator.language)],
      onEnable: () => this.setPlayInSilentMode(true),
    });
  }

  public start(): void {
    this.buildGui();
    this.courseMakerPanel = new CourseMakerPanel(this.courseMaker);
    void loadMadeCourses().then(async (made) => {
      this.courseMaker.restore(made);
      if (made.courses.length > 0 && this.collection.songs.length > 0) await this.refreshMadeCourses();
    });
    // Keep the initial mount's promise so URL auto-load (below) can wait for the Pixi host to finish initializing
    // before it drives its own `showSelect` — two concurrent first-mounts race and read the renderer before it exists.
    const initialSelectReady = this.showSelect();

    const onFilesPicked = (input: HTMLInputElement, load: (files: File[]) => Promise<void>) => {
      const files = input.files;
      if (!files || files.length === 0) {
        return;
      }
      const fileList = [...files];
      // Reset the input value immediately so picking the SAME folder a second time still fires `change`. Browsers
      // suppress repeat `change` events when the new selection matches the previous value — without this, a user
      // re-picking after a misclick or an interrupted load would see the input silently ignore them.
      input.value = '';
      void (async () => {
        // Browser file-picker drops go through the same loading overlay as drag-drop so a folder picked via the GUI
        // shows progress too. Hide the select scene up-front so its rendering / BGM stays paused while we read + parse
        // — the user shouldn't see the song list flicker mid-load.
        showLoadingOverlay(this.elements);
        this.selectView?.setVisible(false);
        try {
          // Route through the same post-enumeration pipeline as drag-drop so the picker's selection produces a theme +
          // songs split (handy when a user hand-picks a folder whose root carries both an LR2 theme and a BMS pack),
          // instead of the previous `loadSongs`-only path that quietly skipped any LR2 assets in the selection.
          await load(fileList);
        } finally {
          hideLoadingOverlay(this.elements);
        }
      })();
    };
    this.elements.songInput.addEventListener('change', () =>
      onFilesPicked(this.elements.songInput, (files) => this.processIncomingFiles(files)),
    );
    this.elements.filesInput.addEventListener('change', () =>
      onFilesPicked(this.elements.filesInput, (files) => this.loadPickedFiles(files)),
    );

    // Global `/` shortcut focuses the search input. Standard editor convention — same as GitHub / Slack / Discord. We
    // suppress the actual `/` character so it doesn't end up in the input field.
    window.addEventListener('keydown', (event) => {
      if (event.key !== '/') return;
      const target = event.target as HTMLElement | null;
      // Don't hijack `/` when the user is already typing into some other input.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      this.search.open();
    });

    // Drag state via a depth counter rather than a plain add/remove pair on dragover/dragleave. The browser fires
    // `dragleave` not just when the cursor exits the window but also every time it crosses into a child element —
    // without counting, the `.dragging` class flickers off whenever the user drags across the canvas → toolbar
    // boundary, so the overlay would strobe (or, with `dragleave` firing once at the end, disappear before the user can
    // read the hint).
    //
    // Increment on every `dragenter`, decrement on every `dragleave`. We're truly outside the window once the counter
    // hits zero, at which point the class comes off. `drop` and the rare `dragend` reset the counter so a pathological
    // event sequence (browser quirk, devtools overlay, etc.) can't leave the class stuck on.
    let dragDepth = 0;
    const setDragging = (active: boolean): void => {
      document.body.classList.toggle('dragging', active);
    };
    window.addEventListener('dragenter', (event) => {
      event.preventDefault();
      dragDepth += 1;
      if (dragDepth === 1) {
        setDragging(true);
      }
    });
    // `dragover` still has to call `preventDefault` for the browser to treat the page as a valid drop target. We don't
    // toggle state here — that's `dragenter` / `dragleave`'s job — but skipping the preventDefault would silently turn
    // drops into "open file in browser" navigations.
    window.addEventListener('dragover', (event) => {
      event.preventDefault();
    });
    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setDragging(false);
      }
    });
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      dragDepth = 0;
      setDragging(false);
      if (event.dataTransfer) {
        void this.handleDrop(event.dataTransfer);
      }
    });
    // Belt-and-braces: the spec lets `dragend` fire on the source element when a drag is canceled (Esc, drop on a
    // non-target). For files dragged in from the OS it shouldn't normally fire on `window`, but if a custom source ever
    // does we still want to clear state.
    window.addEventListener('dragend', () => {
      dragDepth = 0;
      setDragging(false);
    });

    // `?music=<url.zip>` / `?skin=<url.zip>` auto-load: fetch + expand the archives at boot and run them through the
    // same pipeline as a drag-drop, so the select screen lists the archive's charts (with any skin already applied).
    // Sequenced after the initial mount so it doesn't race the Pixi host's first-time renderer init.
    const urlParams = parseUrlMediaParams(window.location.href);
    // `?skin=` is on hold with the other extra skins.
    const mediaParams = EXTRA_SKINS_ENABLED ? urlParams : { ...urlParams, skinUrl: undefined };
    // Difficulty tables imported in an earlier visit are imported again, after the URL load so their stages match it.
    const storedCourseTables = readStoredCourseTableUrls();
    void initialSelectReady.then(async () => {
      if (mediaParams.musicUrl || mediaParams.skinUrl) await this.loadFromUrl(mediaParams);
      if (storedCourseTables.length > 0) await this.importCourseTables(storedCourseTables, false);
    });
  }

  private async ensureHostMounted(): Promise<void> {
    if (this.hostMounted) return;
    this.hostMounted = true;
    await this.sceneHost.mount(this.elements.stage, { resolution: this.guiState.renderResolution });
    this.wireCanvasFullscreen();
    this.wireTouchControls();
    this.sceneHost.app.ticker.add(this.syncGameplayShellState);
  }

  /** Last state {@link syncGameplayShellState} applied, so the per-frame check only touches the DOM on a change. */
  private shellGameplayState = '';

  /**
   * The on-screen pause / quit buttons phones and tablets get during play (they have no Space or Escape key). Pause
   * toggles; Quit, shown while paused, leaves the play the way Escape does.
   */
  private wireTouchControls(): void {
    const pause = document.querySelector<HTMLButtonElement>('#touch-pause');
    const quit = document.querySelector<HTMLButtonElement>('#touch-quit');
    pause?.addEventListener('click', () => this.gameplayView?.requestTogglePause());
    quit?.addEventListener('click', () => {
      const view = this.gameplayView;
      if (!view) return;
      // Resume first so the exit fade (which runs on the play clock) plays out instead of freezing on the pause.
      if (view.isPaused()) view.requestTogglePause();
      view.requestExit();
    });
  }

  /**
   * Marks the shell `in-gameplay` while a play screen is up, so the select-screen overlays (the floating Help button and
   * the search box) step aside instead of covering the skin's track plate. Checked every frame because the gameplay
   * views are created and torn down along many paths (and attach to the stage directly rather than through
   * `setScene`).
   */
  private readonly syncGameplayShellState = (): void => {
    const inGameplay = this.gameplayView !== undefined || this.beatorajaGameplayView !== undefined;
    // The built-in / LR2 play views take touch input and expose pause / exit for the touch controls.
    const touchPlay = this.gameplayView !== undefined;
    const paused = this.gameplayView?.isPaused() === true;
    // A skin drawing on its portrait stage needs no rotate prompt on a phone held upright.
    const portraitStage = this.sceneHost.getStageOrientation() === 'portrait';
    const searchInSkin = !inGameplay && this.search.skinHasBox;
    const state = `${inGameplay}/${touchPlay}/${paused}/${portraitStage}/${searchInSkin}`;
    if (state === this.shellGameplayState) return;
    this.shellGameplayState = state;
    const { shell } = this.elements;
    shell.classList.toggle('in-gameplay', inGameplay);
    // A skin with its own search box hides the field at the foot of the screen; the box opens it in place.
    shell.classList.toggle('search-in-skin', searchInSkin);
    shell.classList.toggle('touch-play', touchPlay);
    shell.classList.toggle('play-paused', paused);
    document.documentElement.classList.toggle('portrait-stage', portraitStage);
    // No pinch zoom while playing: a stray two-finger touch on the lanes would otherwise zoom the page.
    document
      .querySelector('meta[name="viewport"]')
      ?.setAttribute(
        'content',
        inGameplay
          ? 'width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no'
          : 'width=device-width, initial-scale=1.0, viewport-fit=cover',
      );
  };

  /**
   * Double-click the Pixi canvas to toggle the demo shell into (and out of) fullscreen.
   * Escape while fullscreen is consumed here so the active scene's Esc handler — quit play,
   * dismiss result, close a select folder — does not fire on the same keypress that leaves
   * fullscreen. Where the browser has Keyboard Lock (Chrome / Edge), Escape is locked while
   * fullscreen instead: a short press reaches the scene as it does windowed and the browser
   * leaves fullscreen on a long press, so nothing is consumed.
   */
  private wireCanvasFullscreen(): void {
    const canvas = this.sceneHost.app.canvas;
    let lastPointerType = 'mouse';
    let autoFullscreenTried = false;
    canvas.addEventListener('pointerdown', (event) => {
      lastPointerType = event.pointerType;
      // A phone gives the stage the whole screen on the first tap: the browser bars eat a large share of a landscape
      // phone's height, and the stage is fitted to that height. The whole page goes fullscreen (not just the shell) so the
      // Debug Menu stays reachable. Once only, so leaving fullscreen sticks. iPhone Safari has no element fullscreen and
      // simply stays windowed.
      if (deviceProfile.phone && event.pointerType === 'touch' && !autoFullscreenTried) {
        autoFullscreenTried = true;
        void enterTouchFullscreen(document.documentElement);
      }
    });
    canvas.addEventListener('dblclick', (event) => {
      event.preventDefault();
      // Double taps are lane presses during play, not a fullscreen toggle.
      if (lastPointerType !== 'mouse' && this.elements.shell.classList.contains('in-gameplay')) return;
      void toggleFullscreen(this.elements.shell);
    });
    // Every way in or out of fullscreen (double-click, the Debug Menu toggle, the phone's first tap, the browser's own
    // exit) fires `fullscreenchange`, so the lock follows it from here.
    const escapeLock = new FullscreenEscapeLock(navigator as KeyboardLockNavigatorLike, (error) =>
      fullscreenLog.debug('Escape key lock refused', error),
    );
    const syncEscapeLock = (): void => void escapeLock.sync(getFullscreenElement() !== null);
    document.addEventListener('fullscreenchange', syncEscapeLock);
    document.addEventListener('webkitfullscreenchange', syncEscapeLock);
    window.addEventListener(
      'keydown',
      (event) => {
        if (!shouldCaptureFullscreenEscape(event, document, escapeLock.isLocked())) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void exitFullscreen();
      },
      true,
    );
  }

  /**
   * Hide the per-stage `Key` / `BGM` / `Master` folder when it doesn't apply to the current state:
   *
   * - Compressor checkbox unchecked → bus is in `'off'` mode, every stage is bypassed already.
   * - `?compressor=legacy` → the legacy architecture has just one compressor; per-stage toggles don't map onto it.
   *
   * lil-gui's `show(false)` collapses the folder out of the panel entirely, matching the previous `display: none`
   * behavior.
   */
  /** Bus `CompressorParams` for every compressor, from the Debug Menu's tuning. */
  private resolveCompressorParamOverrides(): Record<TunableCompressor, CompressorParams> {
    return Object.fromEntries(
      TUNABLE_COMPRESSORS.map((compressor) => [
        compressor,
        paramsFromTuning(this.compressorTunings[compressor], DEFAULT_COMPRESSOR_PARAMS[compressor]),
      ]),
    ) as Record<TunableCompressor, CompressorParams>;
  }

  private refreshCompressorStageVisibility(): void {
    const visible = this.guiState.compressor && this.compressorMode === 'split';
    this.compressorStageFolder?.show(visible);
  }

  /**
   * One folder per compressor (key / BGM / master in split mode; the single legacy compressor only when the
   * `?compressor=legacy` architecture is active) with threshold, knee, ratio, attack, and release sliders and a reset.
   * Changes retune a running chart live and are remembered for the next visit.
   */
  private buildCompressorTuningGui(parent: GUI): void {
    const labels: Record<TunableCompressor, string> = {
      key: 'Key compressor',
      bgm: 'BGM compressor',
      master: 'Master compressor',
      legacy: 'Legacy compressor',
    };
    const compressors = TUNABLE_COMPRESSORS.filter((compressor) =>
      this.compressorMode === 'legacy' ? compressor === 'legacy' : compressor !== 'legacy',
    );
    for (const compressor of compressors) {
      const tuning = this.compressorTunings[compressor];
      const folder = parent.addFolder(labels[compressor]).close();
      const apply = () => {
        const params = paramsFromTuning(tuning, DEFAULT_COMPRESSOR_PARAMS[compressor]);
        this.gameplayView?.setAudioCompressorParams(compressor, params);
        this.beatorajaGameplayPrep?.audioBus.setCompressorParams(compressor, params);
        storeCompressorTunings(this.compressorTunings);
      };
      const controllers = [
        folder.add(tuning, 'thresholdDb', -60, 0, 0.5).name('Threshold (dB)'),
        folder.add(tuning, 'kneeDb', 0, 40, 0.5).name('Knee (dB)'),
        folder.add(tuning, 'ratio', 1, 20, 0.1).name('Ratio (x:1)'),
        folder.add(tuning, 'attackMs', 0, 200, 0.5).name('Attack (ms)'),
        folder.add(tuning, 'releaseMs', 0, 1000, 5).name('Release (ms)'),
      ];
      for (const controller of controllers) controller.onChange(apply);
      folder
        .add(
          {
            reset: () => {
              Object.assign(tuning, defaultCompressorTunings()[compressor]);
              for (const controller of controllers) controller.updateDisplay();
              apply();
            },
          },
          'reset',
        )
        .name('Reset to default');
    }
  }

  /**
   * Builds the floating lil-gui control panel and wires every controller to the gameplay / scene state. Centralizing
   * this in one method lets us bind handles to specific controllers (`recordController`, `compressorStageFolder`)
   * up-front, so runtime code can address them by name (renaming the record button when capture starts, hiding the
   * per-stage folder on compressor mode change) without re-querying the DOM.
   *
   * Layout (folder titles and default open states live in `debug-menu.ts`): the everyday controls sit at the top level
   * — status, loading, skin pick, capture — followed by the Play options and Audio folders (open by default), then the
   * skin detail, library, and developer folders (closed by default). Every folder remembers whether it was left open.
   */
  private buildGui(): void {
    // Start the panel itself collapsed so it doesn't cover the select-screen / gameplay canvas the moment a user lands
    // on the demo.
    const gui = new GUI({ title: 'Debug Menu', width: 280 });
    gui.close();
    this.gui = gui;
    const addFolder = (parent: GUI, folder: DebugMenuFolder): GUI => parent.addFolder(folder.title).open(folder.open);
    // Status row pinned to the top of the panel — first thing the user sees, so a glance at the GUI is enough to tell
    // whether a load is in flight, what's currently playing, or where a saved recording landed. Disabled so the field
    // reads as a passive read-out instead of an editable input. Updates are pushed explicitly via `setStatus`; cheaper
    // than lil-gui's `.listen()` polling and the only writer is this class anyway.
    this.statusController = gui.add(this.guiState, 'status').name('Status').disable();
    this.statusController.domElement.classList.add('status-row');
    gui.add(this.guiState, 'openFolder').name('Open folder');
    gui.add(this.guiState, 'openFiles').name('Open files (ZIP / play log)');
    // Folders in the order a session uses them: how to play (options, tempo, courses), how it looks and sounds, the
    // library, capturing a play, the Leaderboard, then the developer settings.
    this.buildPlayOptionsFolder(addFolder(gui, DEBUG_MENU_FOLDERS.playOptions));
    this.buildTempoFolder(addFolder(gui, DEBUG_MENU_FOLDERS.tempo));
    this.buildCourseFolder(addFolder(gui, DEBUG_MENU_FOLDERS.course));
    this.buildSkinFolder(addFolder(gui, DEBUG_MENU_FOLDERS.skin), addFolder);
    this.buildAudioFolder(addFolder(gui, DEBUG_MENU_FOLDERS.audio), addFolder);
    this.buildLibraryFolder(addFolder(gui, DEBUG_MENU_FOLDERS.library), addFolder);
    this.buildCaptureFolder(addFolder(gui, DEBUG_MENU_FOLDERS.capture));
    this.leaderboard.buildFolder(addFolder(gui, DEBUG_MENU_FOLDERS.leaderboard));
    this.buildDeveloperFolder(addFolder(gui, DEBUG_MENU_FOLDERS.developer));
    this.refreshCompressorStageVisibility();
    rememberFolderOpenStates(gui);
  }

  /** Capture: recording the play screen as a video in the chosen format, and screenshots. */
  private buildCaptureFolder(capture: GUI): void {
    this.recordController = capture.add(this.guiState, 'record').name(RECORD_LABEL);
    // The container and codec of the video: MP4 · H.264 unless the player picks another, remembered across visits.
    capture
      .add(this.guiState, 'recordingFormat', recordingFormatOptions())
      .name('Video format')
      .onChange((key: string) => storeRecordingFormat(key));
    // Screenshot button — captures the Pixi stage at its native size (= the renderer's current screen dimensions;
    // matches what the user sees in the canvas, downloaded as PNG). See `captureScreenshot` for the extract pipeline.
    capture.add(this.guiState, 'screenshot').name('📸 Screenshot');
  }

  /**
   * Play options — the playMode / chartOptions / assists / judge / gauge settings that get recorded into the play-log.
   * Two-way synced with the LR2 select scene's PLAY OPTION panel where a counterpart exists (the panel pushes user
   * edits back through `onPlayOptionsChange`; these controllers push through `setPlayOptions`). All of them are latched
   * at song start and DISABLED during a play — mid-song changes never apply.
   */
  /**
   * Options read when a play starts, which are disabled while one runs (`lockPlaylogOptionsForPlay`); returns the
   * controller.
   */
  private trackPlayOption(controller: Controller): Controller {
    this.playOptionControllers.push(controller);
    return controller;
  }

  /** How the player plays: auto play, hi-speed, gauge, lane options and assists. */
  private buildPlayOptionsFolder(folder: GUI): void {
    const trackPlayOption = (controller: Controller): Controller => this.trackPlayOption(controller);
    trackPlayOption(
      folder
        .add(this.guiState, 'autoPlay')
        .name('Auto play')
        .onChange((value: boolean) => {
          this.selectView?.setPlayOptions({ autoPlay: value });
        }),
    );
    trackPlayOption(
      folder
        .add(this.guiState, 'gauge', ['GROOVE', 'EASY', 'HARD', 'DEATH'])
        .name('Gauge')
        .onChange((value: DemoGuiState['gauge']) => {
          this.selectView?.setPlayOptions({ gauge1P: value });
        }),
    );
    trackPlayOption(
      folder
        .add(this.guiState, 'random1P', ['OFF', 'MIRROR', 'RANDOM', 'S-RANDOM', 'SCATTER'])
        .name('Random 1P')
        .onChange((value: DemoGuiState['random1P']) => {
          this.selectView?.setPlayOptions({ random1P: value });
        }),
    );
    trackPlayOption(
      folder
        .add(this.guiState, 'random2P', ['OFF', 'MIRROR', 'RANDOM', 'S-RANDOM', 'SCATTER'])
        .name('Random 2P')
        .onChange((value: DemoGuiState['random2P']) => {
          this.selectView?.setPlayOptions({ random2P: value });
        }),
    );
    trackPlayOption(
      folder
        .add(this.guiState, 'dpFlip')
        .name('DP flip')
        .onChange((value: boolean) => {
          this.selectView?.setPlayOptions({ dpFlip: value });
        }),
    );
    trackPlayOption(
      folder
        .add(this.guiState, 'autoScratch1P')
        .name('Auto scratch 1P')
        .onChange((value: boolean) => {
          this.selectView?.setPlayOptions({ autoScratch1P: value });
        }),
    );
    trackPlayOption(
      folder
        .add(this.guiState, 'autoScratch2P')
        .name('Auto scratch 2P')
        .onChange((value: boolean) => {
          this.selectView?.setPlayOptions({ autoScratch2P: value });
        }),
    );
    // Hi-speed — the same range and step as the in-game `ArrowUp` / `ArrowDown` keys. Unlike the options above it is
    // visual only, so it stays enabled during a play and applies to it live.
    this.hiSpeedController = folder
      .add(this.guiState, 'hiSpeed', HISPEED_MIN, HISPEED_MAX, HISPEED_STEP)
      .name('Hi-speed')
      .onChange((value: number) => this.rememberHiSpeed(value, 'menu'));
  }

  /**
   * The play tempo (-50 % .. +50 %) and how a tempo change sounds, for the song tempo and NONSTOP FIT stages alike.
   */
  private buildTempoFolder(folder: GUI): void {
    const trackPlayOption = (controller: Controller): Controller => this.trackPlayOption(controller);
    // The play tempo (-50 % .. +50 %) and how a tempo change sounds, for the song tempo and NONSTOP FIT stages alike.
    // Read when a play starts, so they are disabled during one; a play at another tempo is practice (not ranked, no
    // records).
    const rememberTempo = () => storePlayTempoSettings(this.guiState);
    trackPlayOption(
      folder
        .add(this.guiState, 'tempoPercent', TEMPO_PERCENT_MIN, TEMPO_PERCENT_MAX, 1)
        .name('Tempo (%)')
        .onChange(rememberTempo),
    );
    trackPlayOption(
      folder
        .add(this.guiState, 'tempoPitchMode', { 'Pitch follows tempo (LR2)': 'pitch', 'Keep pitch': 'keep-pitch' })
        .name('Pitch')
        .onChange(rememberTempo),
    );
    trackPlayOption(
      folder
        .add(this.guiState, 'tempoStretchAlgorithm', { 'Signalsmith Stretch': 'signalsmith', WSOLA: 'wsola' })
        .name('Keep-pitch stretcher')
        .onChange(rememberTempo),
    );
  }

  /**
   * Courses: whether stage results show, the player's own courses, the NONSTOP placement, and importing a difficulty
   * table's courses from its URL (remembered and imported again on load).
   */
  private buildCourseFolder(folder: GUI): void {
    const trackPlayOption = (controller: Controller): Controller => this.trackPlayOption(controller);
    folder
      .add(this.guiState, 'courseAutoAdvance')
      .name('Skip stage results')
      .onChange((value: boolean) => {
        this.guiState.courseAutoAdvance = value;
      });
    folder.add({ open: () => this.courseMakerPanel?.openManager() }, 'open').name('My courses…');
    trackPlayOption(
      folder
        .add(this.guiState, 'nonstopPlacement', ['intended', 'lr2'])
        .name('NONSTOP placement')
        .onChange((value: DemoGuiState['nonstopPlacement']) => {
          this.guiState.nonstopPlacement = value;
        }),
    );
    // Courses from a difficulty table's page (or header JSON) URL; the URL is remembered and imported again on load.
    const courseTable = {
      url: '',
      import: () => {
        const url = normalizeCourseTableUrl(courseTable.url);
        if (url === undefined) {
          this.setStatus('Enter a difficulty-table URL first');
          return;
        }
        void this.importCourseTables([url], true);
      },
    };
    folder.add(courseTable, 'url').name('Table URL');
    folder.add(courseTable, 'import').name('Import table courses');
  }

  /**
   * Volumes (master over every sound, then the keysound / BGM balance; all three apply live and are remembered for the
   * next visit), then the compressor: the master switch, the split-mode stage toggles, and every compressor's
   * parameters.
   */
  private buildAudioFolder(audio: GUI, addFolder: (parent: GUI, folder: DebugMenuFolder) => GUI): void {
    const rememberVolumes = () =>
      storeVolumes({
        masterVolume: this.guiState.masterVolume,
        keyVolume: this.guiState.keyVolume,
        bgmVolume: this.guiState.bgmVolume,
      });
    const onVolumeChange = (channel: 'key' | 'bgm') => (value: number) => {
      this.gameplayView?.setAudioVolume(channel, value / 100);
      this.beatorajaGameplayPrep?.audioBus.setBusVolume(channel, value / 100);
      rememberVolumes();
    };
    audio
      .add(this.guiState, 'masterVolume', 0, 100, 1)
      .name('Master (%)')
      .onChange((value: number) => {
        setMasterVolume(value / 100);
        rememberVolumes();
      });
    audio.add(this.guiState, 'keyVolume', 0, 100, 1).name('Key sound (%)').onChange(onVolumeChange('key'));
    audio.add(this.guiState, 'bgmVolume', 0, 100, 1).name('BGM (%)').onChange(onVolumeChange('bgm'));
    // Safari / iOS only (`navigator.audioSession`): elsewhere web audio has no silent switch to get past, so the row is
    // left out rather than shown disabled.
    if (supportsSystemAudioSession()) {
      const strings = SILENT_MODE_STRINGS[resolveSilentModeLanguage(navigator.language)];
      this.silentModeController = audio
        .add(this.guiState, 'playInSilentMode')
        .name(strings.label)
        .onChange((value: boolean) => this.setPlayInSilentMode(value));
      const note = document.createElement('div');
      note.className = 'gui-note';
      note.textContent = strings.note;
      audio.$children.append(note);
      // The same setting on the start card, so it can be chosen before the first sound.
      const startSection = document.querySelector<HTMLElement>('#start-silent-mode');
      if (startSection !== null) {
        this.startSilentModeOption = mountStartSilentModeOption({
          section: startSection,
          strings,
          checked: this.guiState.playInSilentMode,
          onChange: (value) => this.setPlayInSilentMode(value),
        });
      }
    }
    const compressor = addFolder(audio, DEBUG_MENU_FOLDERS.compressor);
    compressor
      .add(this.guiState, 'compressor')
      .name('Enabled')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressor(value);
        this.beatorajaGameplayPrep?.audioBus.setMode(value ? this.compressorMode : 'off');
        this.refreshCompressorStageVisibility();
      });
    const stages = addFolder(compressor, DEBUG_MENU_FOLDERS.compressorStages);
    this.compressorStageFolder = stages;
    stages
      .add(this.guiState, 'compressorKey')
      .name('Key')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('key', value);
        this.beatorajaGameplayPrep?.audioBus.setStageEnabled('key', value);
      });
    stages
      .add(this.guiState, 'compressorBgm')
      .name('BGM')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('bgm', value);
        this.beatorajaGameplayPrep?.audioBus.setStageEnabled('bgm', value);
      });
    stages
      .add(this.guiState, 'compressorMaster')
      .name('Master')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('master', value);
        this.beatorajaGameplayPrep?.audioBus.setStageEnabled('master', value);
      });
    this.buildCompressorTuningGui(compressor);
  }

  /** How the skins look and lay out, the loaded themes' pickers, the be-music skin's settings, and adding skins. */
  private buildSkinFolder(skin: GUI, addFolder: (parent: GUI, folder: DebugMenuFolder) => GUI): void {
    this.skinFolder = skin;
    // Skin family override — picks the active rendering family (LR2 / beatoraja / default) regardless of what's
    // loaded. First-time build seeds with `Auto` + `Default` only; `rebuildSkinFamilyPicker` swaps the option list
    // in place once a theme drop adds LR2 / beatoraja to the pool.
    this.rebuildSkinFamilyPicker();
    // Built-in (be-music) skin used whenever the default family renders — i.e. no LR2 / beatoraja theme covers the
    // scene. Persisted so a reload keeps the pick.
    const skinOptions = () => Object.fromEntries(BE_MUSIC_SKINS.skins.map((skin) => [skin.label, skin.id]));
    const skinPicker = skin
      .add(this.guiState, 'builtInSkin', skinOptions())
      .name('Built-in skin')
      .onChange((id: string) => {
        this.handleBuiltInSkinChange(id);
      });
    // Skins added at runtime join the picker (in place: re-adding the controller would stack a second handler).
    BE_MUSIC_SKINS.subscribe(() => skinPicker.options(skinOptions()).updateDisplay());
    skin
      .add(this.guiState, 'skinEffects', { Full: 'full', Reduced: 'reduced', Off: 'off' })
      .name('Skin effects')
      .onChange((level: 'full' | 'reduced' | 'off') => {
        try {
          window.localStorage.setItem(SKIN_EFFECTS_STORAGE_KEY, level);
        } catch {
          // Private windows / blocked storage: the pick still applies for this session.
        }
        this.handleSkinFamilyOverrideChange(this.guiState.skinFamilyOverride);
      });
    // Canvas pixels per CSS pixel, 1× up to the display's ratio. Lower trades sharpness for fill-rate (tablets drop
    // under 30 fps at 2×); applies from the next frame. `?resolution=` in the URL overrides it until a pick here.
    const resolutionSteps = renderResolutionSteps(window.devicePixelRatio || 1);
    this.resolutionPicker = skin
      .add(
        this.guiState,
        'renderResolution',
        Object.fromEntries(resolutionSteps.map((value) => [renderResolutionLabel(value), value])),
      )
      .name('Render resolution')
      .onChange((value: number) => {
        storeRenderResolution(value);
        this.sceneHost.setResolution(value);
      });
    // Measures the frame rate at each resolution on whatever screen is showing and keeps the highest that holds it.
    this.autoDetectResolutionControl = skin
      .add({ detect: () => void this.detectRenderResolution() }, 'detect')
      .name(AUTO_DETECT_RESOLUTION_LABEL);
    if (resolutionSteps.length < 2) this.autoDetectResolutionControl.hide();
    // Auto picks the touch layout on phones / tablets; applies from the next play.
    skin
      .add(this.guiState, 'playLayout', { Auto: 'auto', Desktop: 'standard', Touch: 'touch' })
      .name('Play layout')
      .onChange((choice: PlayLayoutChoice) => {
        try {
          window.localStorage.setItem(PLAY_LAYOUT_STORAGE_KEY, choice);
        } catch {
          // Private windows / blocked storage: the pick still applies for this session.
        }
      });
    // Picks between LR2 / beatoraja's "a judged note stays until its time" and "a judged note goes the moment it is
    // judged". Pushed live into the running gameplay view so a mid-song toggle takes effect on the very next paint — the
    // visibility check is a single per-frame branch with no backing state to rebuild.
    skin
      .add(this.guiState, 'judgedNoteDisplay', {
        'Keep until its time (LR2)': 'KEEP_SCROLLING',
        'Hide on judge': 'HIDE',
      })
      .name('Judged notes')
      .onChange((value: 'KEEP_SCROLLING' | 'HIDE') => {
        this.guiState.judgedNoteDisplay = value;
        this.gameplayView?.setJudgedNoteDisplay(value);
      });
    // The same toggle as double-clicking the playfield, for pointers where a double click is awkward.
    skin.add({ fullscreen: () => void toggleFullscreen(this.elements.shell) }, 'fullscreen').name('Toggle fullscreen');
    // "LR2 theme" (see `rebuildLr2ThemePicker`) slots in here, above the beatoraja pickers, once a drop carries themes.
    // Per-scene beatoraja skin picker, hidden until a beatoraja theme is dropped — `rebuildBeatorajaSkinPickers()`
    // re-populates it on each load. Selecting a non-default entry for a scene records it on
    // `beatorajaSkinOverridesByType`; the next mount picks it up via `pickBeatorajaSkinEntryWithOverride`.
    this.beatorajaSkinPickerFolder = addFolder(skin, DEBUG_MENU_FOLDERS.beatorajaSkins).hide();
    // The active be-music skin's own settings, built from its `settings` schema (rebuilt when the skin changes).
    this.skinSettingsFolder = addFolder(skin, DEBUG_MENU_FOLDERS.skinSettings);
    this.rebuildSkinSettingsFolder();
    // LR2 theme picker — added once a drop discovers a theme (see `rebuildLr2ThemePicker`).
    this.rebuildLr2ThemePicker();
    // Add skins: the bundled Lattice, or a skin module from a URL (its default export, built with the skin SDK).
    if (!EXTRA_SKINS_ENABLED) return;
    const addSkins = addFolder(skin, DEBUG_MENU_FOLDERS.addSkin);
    const skinSource = {
      url: '',
      addLattice: () => this.addBeMusicSkin(latticeSkin),
      addFromUrl: () => void this.addBeMusicSkinFromUrl(skinSource.url),
    };
    addSkins.add(skinSource, 'addLattice').name('Add Lattice');
    addSkins.add(skinSource, 'url').name('Skin module URL');
    addSkins.add(skinSource, 'addFromUrl').name('Add from URL');
  }

  /**
   * Loading from URLs (the same path as the `?music=` / `?skin=` parameters), the play-history and best-record stores,
   * and the BGA transcode settings that apply while charts load.
   */
  private buildLibraryFolder(library: GUI, addFolder: (parent: GUI, folder: DebugMenuFolder) => GUI): void {
    const urlParams = parseUrlMediaParams(window.location.href);
    const urls = {
      music: urlParams.musicUrl ?? '',
      skin: urlParams.skinUrl ?? '',
      load: () => {
        const musicUrl = urls.music.trim() || undefined;
        const skinUrl = urls.skin.trim() || undefined;
        if (!musicUrl && !skinUrl) {
          this.setStatus('Enter a music or skin ZIP URL first');
          return;
        }
        void this.loadFromUrl({ musicUrl, skinUrl });
      },
    };
    library.add(urls, 'music').name('Music ZIP URL');
    if (EXTRA_SKINS_ENABLED) library.add(urls, 'skin').name('Skin ZIP URL');
    library.add(urls, 'load').name('Load from URLs');
    // Play-history auto-save — OFF by default. When enabled, every finished play downloads its play-log
    // (`*.bmplay.json`, the raw input replay defined in `@be-music/player/playlog`) as soon as the result scene
    // mounts. The file feeds the `bms-playlog` CLI, which re-derives LR2 / beatoraja / IIDX scores from the replay.
    // The value is LATCHED at song start (`lockPlaylogOptionsForPlay`) and the controller is disabled while a song
    // is playing — playlog options cannot change mid-play.
    this.playlogSaveController = library
      .add(this.guiState, 'autoSavePlaylog')
      .name('Auto-save play history')
      .onChange((value: boolean) => {
        this.guiState.autoSavePlaylog = value;
      });
    library
      .add(
        {
          clear: () => {
            if (this.songRecords.size === 0) {
              this.setStatus('No best records to clear');
              return;
            }
            if (
              !window.confirm(`Clear the best records of ${this.songRecords.size} chart(s)? This cannot be undone.`)
            ) {
              return;
            }
            this.songRecords.clear();
            storeSongRecords(this.songRecords);
            this.setStatus('Best records cleared');
          },
        },
        'clear',
      )
      .name('Clear best records');
    // BGA video transcode controls. Both settings are seeded into the next `PixiGameplayView` constructor (see
    // `preloadGameplay` / `playSong` for the wiring), so changing them mid-session takes effect on the next chart mount
    // — no need to rebuild gameplay if the user is between songs. We don't push live into the running gameplay because
    // BGA assets are loaded once at chart- prepare time and the codec / resize decisions are encoded into the cached
    // video bytes.
    //
    // Both controls are dropdowns rather than free-form fields: the meaningful options cluster around standard video
    // heights (SD / 720p / 1080p / 4K) and a discrete codec pick. `0` in the resize dropdown is the magic "Off" value —
    // the consumer treats anything `≤ 0` as "preserve resolution". Earlier iterations split resize into a checkbox +
    // size pair, but users would change the size without realizing they also had to flip the checkbox — the resize was
    // silently a no-op. Folding both into one control with an explicit `Off` row removes that footgun.
    const transcode = addFolder(library, DEBUG_MENU_FOLDERS.bgaTranscode);
    // WebCodecs `VideoEncoder` is a browser feature; gate the checkbox on its existence so the user can't toggle a
    // state the runtime can't honor. On unsupported browsers (Safari < 17, older Firefox builds) the controller is
    // disabled and the seed value stays at `false`.
    const webCodecsSupported = typeof window !== 'undefined' && 'VideoEncoder' in window;
    const webCodecsController = transcode
      .add(this.guiState, 'bgaUseWebCodecs')
      .name(webCodecsSupported ? 'Use WebCodecs encoder' : 'Use WebCodecs encoder (unsupported)')
      .onChange((value: boolean) => {
        this.guiState.bgaUseWebCodecs = value;
      });
    if (!webCodecsSupported) {
      webCodecsController.disable();
    }
    transcode
      .add(this.guiState, 'bgaResizeMaxEdgePx', {
        'Off (preserve resolution)': 0,
        '256 px (BMS spec)': 256,
        '360 px (≈ SD)': 360,
        '480 px (SD)': 480,
        '512 px': 512,
        '720 px (HD)': 720,
        '1080 px (FHD)': 1080,
        '1440 px (QHD)': 1440,
        '2160 px (4K)': 2160,
      })
      .name('Resize')
      .onChange((value: number) => {
        this.guiState.bgaResizeMaxEdgePx = value;
      });
  }

  /** Diagnostics and session behaviour most players never touch, plus the reset for every remembered setting. */
  private buildDeveloperFolder(developer: GUI): void {
    // Judge-window ruleset — no in-skin counterpart; the Debug Menu is its only surface. Window widths only (note
    // selection / empty POOR / LN mechanics / gauge stay LR2-aligned — see docs/playlog.md).
    this.trackPlayOption(
      developer
        .add(this.guiState, 'judgeRuleset', { LR2: 'lr2', beatoraja: 'beatoraja', IIDX: 'iidx' })
        .name('Judge windows'),
    );

    developer
      .add(this.guiState, 'autoPauseOnBlur')
      .name('Auto pause on blur')
      .onChange((value: boolean) => {
        this.guiState.autoPauseOnBlur = value;
        // Push live so a chart already in flight starts honoring the new policy on its next visibility / blur event,
        // without forcing the user to restart the song.
        this.gameplayView?.setAutoPauseOnBlur(value);
      });
    // Chart-authoring debug overlay — paints invisible / keysound notes (BMS channels `3x` / `4x`) as thin green bars
    // in their playable lane. Live-toggleable — the gameplay view always extracts the invisible-note array and preloads
    // the green sprite, so flipping this flag flips the per-frame render branch on the very next paint.
    developer
      .add(this.guiState, 'showInvisibleNotes')
      .name('Show invisible notes')
      .onChange((value: boolean) => {
        this.guiState.showInvisibleNotes = value;
        this.gameplayView?.setShowInvisibleNotes(value);
      });
    // Renderer frame rate, sampled twice a second while the folder is on screen (no work while it's closed).
    const stats = { fps: '—' };
    const fpsController = developer.add(stats, 'fps').name('FPS').disable();
    window.setInterval(() => {
      if (!this.hostMounted || developer._closed || this.gui?._closed) return;
      stats.fps = this.sceneHost.app.ticker.FPS.toFixed(0);
      fpsController.updateDisplay();
    }, 500);
    developer
      .add(
        {
          reset: () => {
            if (
              !window.confirm(
                'Reset every Debug Menu setting (volumes, skins, skin settings, compressor tuning, folders) to its default and reload? Best records are kept.',
              )
            ) {
              return;
            }
            clearDemoSettings();
            window.location.reload();
          },
        },
        'reset',
      )
      .name('Reset settings and reload');
  }

  /**
   * Single chokepoint for status-text updates. Writes the new value into `guiState` and refreshes the lil-gui
   * controller so the read-only row repaints with the new text.
   */
  private setStatus(text: string): void {
    this.guiState.status = text;
    this.statusController?.updateDisplay();
  }

  /**
   * Filename base for the next saved recording. Derived from the currently-playing song's title (sanitized for
   * filesystem safety) or `gameplay-<timestamp>` when no song info is available. Updated on every `playSong` so
   * back-to-back recordings don't overwrite each other in the user's downloads folder.
   *
   * Read by `toggleRecording` (in `./recording-controller.ts`) when assembling the download filename; mutated in
   * `playSong` / `playSongBeatoraja` / `preloadGameplay` as each chart starts.
   */
  private recordingFilenameBase = 'gameplay';

  /**
   * Bundle the demo's recording-related fields into the `RecordingDeps` shape that
   * `./recording-controller.ts` consumes. Built as a getter-based bundle (rather than a structural copy of `this`) so
   * `RecordingDeps` can stay an interface of getter / setter functions — TypeScript otherwise refuses to satisfy a
   * structural `RecordingHost` from a class whose backing fields are `private`. Cheap to allocate per call; called at
   * most a handful of times per session (record toggle / screenshot / chart-end recording finalize).
   */
  private recordingDeps(): RecordingDeps {
    return {
      sceneHost: this.sceneHost,
      recordController: this.recordController,
      getActiveGameplay: () => this.gameplayView ?? this.beatorajaGameplayView,
      getAutoRecordArmed: () => this.autoRecordArmed,
      setAutoRecordArmed: (value) => {
        this.autoRecordArmed = value;
      },
      getRecordingFilenameBase: () => this.recordingFilenameBase,
      getRecordingFormat: () => this.recordingFormat,
      setStatus: (text) => this.setStatus(text),
    };
  }

  private async handleDrop(dataTransfer: DataTransfer): Promise<void> {
    // The "Drop a skin" prompt has done its job once something lands.
    document.querySelector<HTMLDialogElement>('#skin-drop')?.close();
    // Show the overlay before we even start enumerating files — walking a deep `webkitGetAsEntry` tree on a chart pack
    // with tens of thousands of WAVs visibly stalls the UI for several seconds, and we want the user to see "we're
    // working on it" immediately rather than after the slow phase finishes.
    showLoadingOverlay(this.elements);
    // Take the select scene offline for the duration of the load. `setVisible(false)` pauses BGM + the rAF tick + the
    // song list rendering, so:
    //
    // - the loaded LR2 theme's `select.wav` doesn't start the moment the (small) theme bundle finishes parsing while
    //   the (large) song collection is still being read,
    // - the song list doesn't visually shuffle as new entries land,
    // - and the user only sees the overlay until everything is ready — not a half-rendered scene behind it.
    //
    // `showSelect()` at the end of the try block re-enables the scene with the freshly populated state in one shot.
    this.selectView?.setVisible(false);
    try {
      const files = await readDroppedFiles(dataTransfer, {
        onProgress: (progress) => applyLoadProgress(this.elements, progress),
      });
      await this.processIncomingFiles(files);
    } finally {
      // Always tear the overlay down — even when one of the sub-loaders threw or `splitDroppedSongAndThemeFiles`
      // produced an empty bucket. Otherwise a failed drop would leave the UI permanently masked.
      hideLoadingOverlay(this.elements);
    }
  }

  /**
   * Shared post-enumeration pipeline for both drag-drop and the Debug Menu's "Open folder" / "Open files" pickers. Routes the incoming
   * file list through {@link splitDroppedSongAndThemeFiles}, dispatches theme + song loaders in parallel, then mounts
   * the freshly populated select view.
   *
   * The caller is responsible for showing / hiding the loading overlay and pausing the select view — both entry points
   * handle that around their own enumeration phase.
   *
   * `loadSongs` appends to the existing collection so a second / third invocation of this routine accumulates entries
   * rather than wiping the previous pack — the host can call this multiple times in succession (e.g. Open folder
   * pressed twice with two different folders) and every drop's charts stay uniquely addressable through the collection
   * per-source prefixing.
   */
  private async processIncomingFiles(files: BrowserDroppedFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    // Play-log files ride their own path: they are replay inputs, not chart / theme assets. They are peeled off
    // BEFORE the song/theme split so a stray `.bmplay.json` never classifies as a theme candidate — and handled
    // AFTER the split's loaders ran, so dropping a song folder together with its play-log loads the song first and
    // then starts the replay in one gesture.
    const playlogFiles = files.filter((file) => file.name.toLowerCase().endsWith(PLAYLOG_FILE_SUFFIX));
    files = files.filter((file) => !file.name.toLowerCase().endsWith(PLAYLOG_FILE_SUFFIX));
    if (files.length === 0 && playlogFiles.length > 0) {
      await this.startPlaylogReplayFromFile(playlogFiles[0]!);
      return;
    }
    // Course files (LR2 `.lr2crs`, beatoraja `course/*.json`) list charts by hash; they are read here and matched
    // against the collection once its songs are in.
    const courseFiles = files.filter((file) => isCourseFilePath(file.webkitRelativePath || file.name));
    files = files.filter((file) => !isCourseFilePath(file.webkitRelativePath || file.name));
    const courseGroupCount = this.courseGroups.length;
    await this.readCourseFiles(courseFiles);
    // A saved difficulty-table header stands in for a table whose site cannot be fetched from here.
    const tableHeaders = await this.readTableHeaderFiles(files.filter((file) => isTableHeaderFilePath(file.name)));
    files = files.filter((file) => !tableHeaders.has(file));
    courseFiles.push(...tableHeaders);
    if (files.length === 0 && courseFiles.length > 0) {
      if (this.courseGroups.length > courseGroupCount) {
        await this.refreshCourseFolders();
        await this.showSelect();
      }
      return;
    }
    const split = splitDroppedSongAndThemeFiles(files);
    const songFiles = split.songFiles;
    // Folder drops leave song-bundle files unopened; the theme side is opened up front by the drop walk, so this is
    // normally a pass-through that only narrows the type for the theme loaders.
    const themeFiles = await materializeDroppedFiles(split.themeFiles, {
      onError: (file, error) => dropLog.warn(`skipped (open failed): ${file.webkitRelativePath}`, error),
    });
    // `splitDroppedSongAndThemeFiles` routes any non-chart files outside a chart directory into `themeFiles`. That
    // includes stray `readme.txt` / `info.json` / album-art images sitting at the root of a BMS pack that isn't a real
    // theme bundle. Funnel the detection through `skinFamilyRegistry` so each family's `matchesThemeFile` predicate
    // owns its own decision — this keeps "what counts as an LR2 theme file?" colocated with the LR2 family metadata
    // (and the same for beatoraja). Adding a fourth family in the future is a one-line registry edit instead of an
    // edit here.
    const themeFamilies = skinFamilyRegistry.detectThemeFamilies(
      themeFiles.map((file) => file.webkitRelativePath || file.name),
    );
    // LR2 themes and beatoraja skins are on hold: their files are left out of the drop.
    const carriesLr2Theme = EXTRA_SKINS_ENABLED && themeFamilies.has('lr2');
    const carriesBeatorajaTheme = EXTRA_SKINS_ENABLED && themeFamilies.has('beatoraja');
    const themeMarkers = [...themeFamilies];
    dropLog.info(
      `received ${files.length} file(s) · theme=${themeFiles.length}${
        themeMarkers.length > 0 ? ` (${themeMarkers.join('+')})` : ' (no skin entry → preserving current theme)'
      } · songs=${songFiles.length}`,
    );
    // The songs already listed, so the select screen can open on what this drop added.
    const previousSongIds = new Set(this.collection.songs.map((song) => song.id));
    const tasks: Array<Promise<unknown>> = [];
    if (carriesLr2Theme) {
      tasks.push(this.loadTheme(themeFiles));
    }
    if (carriesBeatorajaTheme) {
      tasks.push(this.loadBeatorajaTheme(themeFiles));
    }
    if (songFiles.length > 0) {
      tasks.push(this.loadSongs(songFiles));
    }
    if (tasks.length === 0) {
      dropLog.warn('nothing to load — neither theme nor chart files matched');
      return;
    }
    await Promise.all(tasks);
    const playSkinSummary = summarizeLr2PlaySkins(this.playSkins);
    const beatorajaSummary = this.beatorajaTheme
      ? summarizeBeatorajaPlaySkins(this.beatorajaTheme.theme.playSkins) || 'none'
      : 'none';
    dropLog.info(
      `loaded · songs=${this.collection.songs.length} · errors=${
        this.collection.errors.length
      } · play-skins=${playSkinSummary || 'none'} · select-skin=${this.selectSkin?.name ?? 'none'}${
        this.beatorajaTheme ? ` · beatoraja-skins=${beatorajaSummary}` : ''
      }`,
    );
    if (this.collection.errors.length > 0) {
      dropLog.warn('parse errors:', this.collection.errors);
    }
    // Status panel stays terse on purpose — only show "loaded" when there's something to celebrate, and skip the
    // per-key-mode skin enumeration since the user can see the active skin in-canvas. "0 charts loaded" is suppressed
    // so a theme-only drop doesn't read like an error.
    if (this.collection.songs.length > 0) {
      this.setStatus(describeSongCollection(this.collection));
    } else if (this.selectSkin || this.resultSkin || Object.keys(this.playSkins).length > 0) {
      this.setStatus('Theme loaded');
    }
    await this.refreshCourseFolders();
    // Open what was dropped: its folder, or the folder list when the drop carried several.
    const dropped = navigationAfterDrop(this.collection.songs, previousSongIds);
    if (dropped !== undefined) this.lastSelectNavigation = dropped;
    await this.showSelect();
    // With LR2 / beatoraja skins on hold they are not loaded with the drop; ask instead whether to use the one it carried.
    if (!EXTRA_SKINS_ENABLED) await this.offerDroppedSkin(themeFamilies, themeFiles);
    if (playlogFiles.length > 0) {
      await this.startPlaylogReplayFromFile(playlogFiles[0]!);
    }
  }

  /**
   * Offers the LR2 or beatoraja skin a drop carried, once its songs are listed. Taking it loads the skin and switches the
   * scenes to its family; declining keeps the built-in skin. Only used while those skins are on hold
   * (`EXTRA_SKINS_ENABLED` off), where a drop does not load them by itself.
   */
  private async offerDroppedSkin(families: ReadonlySet<string>, themeFiles: File[]): Promise<void> {
    // A skin the player asked for through the Debug Menu is used without asking again.
    const asked = this.pendingSkinSystem;
    this.pendingSkinSystem = undefined;
    if (asked !== undefined && families.has(asked)) {
      await this.applyDroppedSkin(asked, themeFiles);
      return;
    }
    const offer = describeSkinOffer(
      families,
      families.has('lr2') ? discoverLr2Themes(themeFiles).map((theme) => theme.name) : [],
    );
    if (offer === undefined) return;
    // The question goes over the select screen, not the loading overlay.
    hideLoadingOverlay(this.elements);
    const family = await askSkinOffer(offer);
    if (family !== undefined) await this.applyDroppedSkin(family, themeFiles);
  }

  /** Loads the dropped skin of `family` and switches the scenes to that skin system. */
  private async applyDroppedSkin(family: OfferedSkinFamily, themeFiles: File[]): Promise<void> {
    showLoadingOverlay(this.elements);
    try {
      await (family === 'lr2' ? this.loadTheme(themeFiles) : this.loadBeatorajaTheme(themeFiles));
    } finally {
      hideLoadingOverlay(this.elements);
    }
    this.handleSkinFamilyOverrideChange(family);
  }

  /**
   * Asks for a drop of a skin of `family`, picked in the Debug Menu with none loaded: a drop-card-like prompt that any
   * drop closes. The skin it brings is then used without the "Use this skin?" question.
   */
  private promptSkinDrop(family: OfferedSkinFamily): void {
    const dialog = document.querySelector<HTMLDialogElement>('#skin-drop');
    if (dialog === null) return;
    this.pendingSkinSystem = family;
    const title = dialog.querySelector('h2');
    const hint = dialog.querySelector('[data-skin-drop-hint]');
    if (title !== null) title.textContent = family === 'lr2' ? 'Drop an LR2 skin' : 'Drop a beatoraja skin';
    if (hint !== null) {
      hint.innerHTML =
        family === 'lr2'
          ? 'Drop the folder that holds your LR2 theme (<code>LR2files/Theme/…</code>, with its <code>.lr2skin</code> files).'
          : 'Drop the folder that holds your beatoraja skin (its <code>.luaskin</code> or <code>.json</code> skin files).';
    }
    // Cancel or Escape withdraws the request; a drop closes the prompt but keeps it, for the drop to answer.
    const withdraw = () => {
      this.pendingSkinSystem = undefined;
    };
    dialog.oncancel = withdraw;
    const cancel = dialog.querySelector<HTMLButtonElement>('[data-skin-drop-cancel]');
    if (cancel !== null) {
      cancel.onclick = () => {
        withdraw();
        dialog.close();
      };
    }
    if (!dialog.open) dialog.showModal();
  }

  /**
   * Loads what the Debug Menu's "Open files" picker returned: chart archives (`.zip`) go to the song collection whole,
   * the way `?music=` archives do (the collection expands them itself), and anything else — play logs — takes the
   * drop pipeline, which starts the replay once the archives are listed.
   */
  private async loadPickedFiles(files: File[]): Promise<void> {
    const isZip = (file: File) => file.name.toLowerCase().endsWith('.zip');
    const archives = files.filter(isZip);
    const others = files.filter((file) => !isZip(file));
    if (archives.length > 0) {
      await this.loadSongs(archives);
      await this.showSelect();
      if (this.collection.songs.length > 0) {
        this.setStatus(describeSongCollection(this.collection));
      }
    }
    if (others.length > 0) {
      await this.processIncomingFiles(others);
    }
  }

  /**
   * Parses a dropped play-log file and starts replay playback when the matching song is loaded. Matching prefers
   * the exact `chartPath` the log recorded (`play.native.chartPath`); older logs without it fall back to a
   * title + artist match. When no match (or the chart's `#RANDOM` roll differs so the resolved notes can't be
   * re-aligned), the failure lands in the status row instead of throwing — a bad drop must never wedge the UI.
   */
  private async startPlaylogReplayFromFile(file: BrowserDroppedFile): Promise<void> {
    let playlog: BeMusicPlaylog;
    try {
      playlog = parsePlaylog(await file.text());
    } catch (error) {
      dropLog.warn('play-log parse failed', error);
      this.setStatus(`Replay: invalid play-log (${(error as Error).message})`);
      return;
    }
    const song = await this.findSongForPlaylog(playlog);
    if (!song) {
      this.setStatus(`Replay: song not loaded (${playlog.chart.title ?? 'untitled'})`);
      return;
    }
    this.setStatus(`Replaying: ${song.title}`);
    try {
      // Replay always drives the LR2/default gameplay path — the shared engine owns the playback either way, so
      // the recorded run reproduces regardless of which skin family recorded it.
      await this.playSong(song, { autoPlay: playlog.play.mode === 'auto', replay: playlog });
    } catch (error) {
      gameplayLog.warn('play-log replay failed', error);
      this.setStatus(`Replay failed: ${(error as Error).message}`);
      await this.showSelect();
    }
  }

  /**
   * Finds the loaded song a play-log belongs to. Chart-file SHA-256 first (`chart.sha256`), then the recorded
   * `chartPath`, then a title + artist heuristic for logs recorded before either rode along.
   */
  private async findSongForPlaylog(playlog: BeMusicPlaylog): Promise<BrowserSongEntry | undefined> {
    // Content hash first — stable across sessions, machines, and file moves.
    const sha256 = playlog.chart.sha256?.toLowerCase();
    if (sha256 !== undefined && sha256.length > 0) {
      for (const entry of this.collection.songs) {
        if ((await this.resolveChartSha256(entry)) === sha256) {
          return entry;
        }
      }
    }
    const nativeChartPath = playlog.play.native?.chartPath;
    if (typeof nativeChartPath === 'string' && nativeChartPath.length > 0) {
      const exact = this.collection.songs.find((entry) => entry.chartPath === nativeChartPath);
      if (exact) {
        return exact;
      }
    }
    const title = playlog.chart.title;
    if (title === undefined || title.length === 0) {
      return undefined;
    }
    return this.collection.songs.find(
      (entry) => entry.title === title && (playlog.chart.artist === undefined || entry.artist === playlog.chart.artist),
    );
  }

  /** Reads dropped course files into `courseGroups`; a file that holds no valid course is skipped with a warning. */
  /** Reads dropped `header.json` files that are difficulty-table headers into `courseGroups`; returns the ones read. */
  private async readTableHeaderFiles(files: readonly BrowserDroppedFile[]): Promise<Set<BrowserDroppedFile>> {
    const read = new Set<BrowserDroppedFile>();
    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      const folder = path.replaceAll('\\', '/').split('/').slice(-2, -1)[0] ?? 'table';
      const group = readTableHeaderFile(new TextDecoder().decode(await file.arrayBuffer()), folder);
      if (group === undefined) continue;
      this.courseGroups = mergeCourseGroup(this.courseGroups, group);
      read.add(file);
      dropLog.info(`table header: ${path} · ${group.label} · courses=${group.courses.length}`);
    }
    return read;
  }

  private async readCourseFiles(files: readonly BrowserDroppedFile[]): Promise<void> {
    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      try {
        const groups = readCourseFile(path, new Uint8Array(await file.arrayBuffer()));
        if (groups.length === 0) {
          dropLog.warn(`skipped (no course): ${path}`);
          continue;
        }
        this.courseGroups.push(...groups);
        for (const group of groups) {
          dropLog.info(
            `course file: ${path} · ${group.label} · courses=${group.courses.length} random=${group.randomCourses?.length ?? 0}`,
          );
        }
      } catch (error) {
        dropLog.warn(`skipped (course read failed): ${path}`, error);
      }
    }
  }

  /**
   * Imports the courses of difficulty tables by URL into `courseGroups` (replacing a group with the same label), then
   * matches them against the collection. With `remember`, a table that imported is stored to be imported again on load.
   */
  private async importCourseTables(urls: readonly string[], remember: boolean): Promise<void> {
    let imported = 0;
    for (const url of urls) {
      this.setStatus('Fetching course table…');
      try {
        const { group } = await importCourseTable(url);
        this.courseGroups = mergeCourseGroup(this.courseGroups, group);
        if (remember) rememberCourseTableUrl(url);
        imported += 1;
        dropLog.info(`course table: ${url} · ${group.label} · courses=${group.courses.length}`);
        this.setStatus(`Course table: ${group.label} (${group.courses.length} courses)`);
      } catch (error) {
        dropLog.warn(`course table import failed: ${url}`, error);
        this.setStatus(describeCourseTableImportError(error));
      }
    }
    if (imported === 0) return;
    await this.refreshCourseFolders();
    // Re-list the select screen so the new folders show; mid-play they show the next time it opens.
    const busy =
      this.elements.shell.classList.contains('playing') ||
      this.resultView !== undefined ||
      this.beatorajaResultScene !== undefined ||
      this.decideView !== undefined;
    if (!busy) await this.showSelect();
  }

  /**
   * Matches every dropped course's stages against the collection by chart-file hash and lists them as course folders.
   * Hashing the whole library is cheap (chart files are small) and cached per song.
   */
  private async refreshCourseFolders(): Promise<void> {
    const hashed = await Promise.all(
      this.collection.songs.map(async (song) => ({ song, ...(await this.resolveChartHashes(song)) })),
    );
    this.collection = {
      ...this.collection,
      courseFolders: [
        ...resolveCourseFolders(this.courseGroups, createSongHashLookup(hashed)),
        ...resolveCourseMakerFolders(this.courseMaker.courses, createSongHashLookup(hashed)),
      ],
    };
  }

  /**
   * Reacts to the course maker: redraws its card and the select skin for the course being made, and saves the courses
   * (and relists them) when they or the default connection change.
   */
  private async handleCourseMakerChange(change: 'draft' | 'courses' | 'settings'): Promise<void> {
    this.courseMakerPanel?.update();
    if (change === 'draft') {
      // Same collection: the select view only redraws (an LR2 skin's course-maker ops and texts).
      this.selectView?.setCollection(this.collection);
      return;
    }
    try {
      await saveMadeCourses({
        courses: [...this.courseMaker.courses],
        defaultConnection: this.courseMaker.defaultConnection,
      });
    } catch (error) {
      this.setStatus('Could not save your courses in this browser; they last until the page is closed');
      dropLog.warn('course save failed', error);
    }
    if (change === 'courses') await this.refreshMadeCourses();
    else this.selectView?.setCollection(this.collection);
  }

  /** Relists the course folders after the player's own courses changed, keeping the select screen where it was. */
  private async refreshMadeCourses(): Promise<void> {
    await this.refreshCourseFolders();
    if (this.beatorajaSelectScene !== undefined) {
      await this.showSelect();
      return;
    }
    const view = this.selectView;
    if (view === undefined) return;
    const navigation = view.getNavigation();
    view.setCollection(this.collection);
    view.setNavigation(navigation);
  }

  /**
   * While a course is being made, deciding a song adds it to the course instead of playing it, as LR2 does; deciding one
   * more once it holds five saves the course. Returns whether the song was taken.
   */
  private addSongToCourseBeingMade(song: BrowserSongEntry): boolean {
    const draft = this.courseMaker.draft;
    if (draft === undefined) return false;
    if (draft.stages.length >= LR2_COURSE_MAKER_MAX_STAGES) {
      const saved = this.courseMaker.finish();
      if (saved !== undefined) this.setStatus(`Saved the course "${saved.name}"`);
      return true;
    }
    void this.courseMaker.append(song).then((result) => {
      if (result.ok) {
        this.setStatus(`Added ${song.title} to the course (${this.courseMaker.draft?.stages.length ?? 0} / 5)`);
        return;
      }
      const reasons = {
        full: 'the course already has 5 songs',
        'key-mode': 'its key mode differs from the first song’s',
        'no-md5': 'its chart could not be hashed',
        'not-making': 'no course is being made',
      } as const;
      this.setStatus(`Could not add ${song.title}: ${reasons[result.reason]}`);
    });
    return true;
  }

  /**
   * Starts a course from its first stage. A beatoraja random course first draws its stages from the library (each
   * stage filter against the songs and their chart hashes); a stage that finds no chart leaves it unstarted.
   */
  private async startCourse(entry: BrowserCourseEntry, options: { autoPlay?: boolean } = {}): Promise<void> {
    // AUTO on a course bar plays every stage itself; PLAY follows the Debug Menu's auto play.
    this.courseAutoPlay = options.autoPlay;
    // A NEW COURSE bar starts making a course of its folder's kind; songs decided from now on join it.
    if (entry.newCourse === true) {
      this.courseMaker.start(entry.definition.kind);
      this.setStatus('Making a course: decide songs to add them, then save');
      return;
    }
    if (!entry.playable) return;
    this.courseReturnNavigation = this.selectView?.getNavigation() ?? this.lastSelectNavigation;
    let course = entry;
    if (entry.random !== undefined) {
      const candidates = await Promise.all(
        this.collection.songs.map(async (song) => ({ song, ...(await this.resolveChartHashes(song)) })),
      );
      const drawn = drawBrowserRandomCourse(entry, candidates, Math.random);
      if (!drawn.ok) {
        this.setStatus(
          `${entry.definition.name}: stage ${drawn.stage + 1} ${drawn.reason === 'no-candidates' ? 'matches no chart' : `has an invalid filter (${drawn.error ?? ''})`}`,
        );
        return;
      }
      course = drawn.course;
    }
    if (course.definition.kind === 'nonstop') {
      await this.startNonstopCourse(course, { decide: true });
      return;
    }
    const session = new CourseSession(course);
    this.courseSession = session;
    // LR2 shows the decide screen once, before the first stage (a stage after it starts from the previous result).
    const first = course.stages[0]?.song;
    if (first === undefined) {
      await this.playNextCourseStage();
      return;
    }
    // The splash names the selected bar, the course, as LR2's does; the first stage's chart supplies the rest.
    const { subtitle: _subtitle, artist: _artist, genre: _genre, ...stage } = first;
    await this.showDecide(
      { ...stage, title: course.definition.name },
      {},
      {
        start: () => this.playNextCourseStage(),
        cancel: () => {
          if (this.courseSession === session) this.courseSession = undefined;
        },
      },
    );
  }

  /**
   * Starts a NONSTOP course: its stages are stitched into one chart (`prepareNonstopCourse`) played from their own
   * files, as LR2 plays a NONSTOP course in one go. Quick retry stitches and plays it again.
   */
  private async startNonstopCourse(course: BrowserCourseEntry, options: { decide?: boolean } = {}): Promise<void> {
    const hashes = new Map<string, ChartFileHashes>();
    for (const stage of course.stages) {
      if (stage.song === undefined) continue;
      const found = await this.resolveChartHashes(stage.song);
      if (found !== undefined) hashes.set(stage.song.id, found);
    }
    const prepared = prepareNonstopCourse(course, {
      sourceOf: (song) => resolveSongSource(this.collection, song),
      hashesOf: (song) => hashes.get(song.id),
      chartFingerprintOf: courseStageChartFingerprint,
      placement: this.guiState.nonstopPlacement,
    });
    if (!prepared.ok) {
      const stage = prepared.stage !== undefined ? ` (stage ${prepared.stage + 1})` : '';
      this.setStatus(`${course.definition.name}: cannot stitch the NONSTOP course: ${prepared.reason}${stage}`);
      return;
    }
    // The stitched chart loads its assets from a composite source; keep one at a time.
    this.collection = {
      ...this.collection,
      sources: [
        ...this.collection.sources.filter((source) => !source.id.startsWith('nonstop:')),
        prepared.prepared.source,
      ],
    };
    const play = () =>
      this.playSong(prepared.prepared.song, {
        nonstop: { course, prepared: prepared.prepared },
        ...(this.courseAutoPlay !== undefined ? { autoPlay: this.courseAutoPlay } : {}),
      });
    // The decide screen names the course (the stitched song's title); a quick retry skips it, as LR2's does.
    if (options.decide === true) {
      await this.showDecide(prepared.prepared.song, {}, { start: play });
      return;
    }
    await play();
  }

  /** The course result of a NONSTOP run: its course log built from the stitched play, kept and shown as one run. */
  private async showNonstopCourseResult(
    nonstop: NonstopPlay,
    playlog: BeMusicPlaylog | undefined,
    fallback?: PixiGameplayResultData,
  ): Promise<void> {
    if (playlog === undefined) {
      await (fallback !== undefined ? this.showResult(fallback) : this.showSelect());
      return;
    }
    const courseLog = buildNonstopCoursePlaylog(nonstop.course, nonstop.prepared, playlog, {
      createdAt: new Date().toISOString(),
      recorder: PLAYLOG_RECORDER,
    });
    const native = courseLog.results?.native;
    if (native === undefined) {
      await (fallback !== undefined ? this.showResult(fallback) : this.showSelect());
      return;
    }
    // A run at another tempo is practice: no record.
    // An auto-played run or one at another tempo leaves the record alone.
    if (courseRunKeepsRecord(courseLog)) this.recordCourseResult(courseRecordKey(nonstop.course), native);
    this.maybeAutoSaveCoursePlaylog(courseLog);
    // Ranked as one course run: the Leaderboard stitches the stage charts again to check the stitched play.
    this.leaderboard.maybeSubmitCourse(
      courseLog,
      nonstop.course.stages.flatMap((stage) => (stage.song !== undefined ? [stage.song] : [])),
    );
    await this.showResult(buildCourseResultData(nonstop.course, native, courseLog, fallback), {
      course: resolveSceneCourseInfo(nonstop.course),
    });
  }

  /** Plays the running course's next stage, or shows the course result when it is over. */
  private async playNextCourseStage(): Promise<void> {
    const session = this.courseSession;
    const stage = session?.nextStage();
    if (session === undefined || stage === undefined) {
      await this.showCourseResult();
      return;
    }
    this.setStatus(`${session.course.definition.name}: stage ${stage.index + 1} / ${stage.stageCount}`);
    await this.playSong(stage.song, {
      courseStage: stage,
      ...(this.courseAutoPlay !== undefined ? { autoPlay: this.courseAutoPlay } : {}),
    });
  }

  /**
   * Called when a stage's result is dismissed during a course: the next stage starts, or the course result shows once
   * the course is over. Returns false outside a course.
   */
  private continueCourse(): boolean {
    if (this.courseSession === undefined) return false;
    void (this.courseSession.finished ? this.showCourseResult() : this.playNextCourseStage());
    return true;
  }

  /**
   * An LR2 skin for a course scene: the theme's skin parsed again with the course ops (290 + kind, 280-289 for a stage),
   * so its `#IF` blocks gated on them are taken as LR2 would. Falls back to the skin as mounted.
   */
  private courseLr2Skin(
    mounted: Lr2Skin | undefined,
    courseInfo: SceneCourseInfo,
    options: Omit<Parameters<Lr2ThemeSkins['loadSkin']>[0], 'parseOps'>,
  ): Lr2Skin | undefined {
    if (mounted === undefined || this.loadLr2ThemeSkin === undefined) return mounted;
    return this.loadLr2ThemeSkin({ ...options, parseOps: resolveLr2CourseOps(courseInfo) }) ?? mounted;
  }

  /**
   * The course result: the course play log built from the stages played, its native result shown on the result scene
   * as one run, saved (when auto-save is on) and kept as the course's best record.
   */
  private async showCourseResult(): Promise<void> {
    const session = this.courseSession;
    this.courseSession = undefined;
    if (session === undefined || session.stagesPlayed === 0) {
      await this.showSelect();
      return;
    }
    const courseLog = session.buildPlaylog(
      (song) => resolveChartRulesetFacts(song.chart, { laneModeExtension: song.chartPath }),
      {
        createdAt: new Date().toISOString(),
        recorder: PLAYLOG_RECORDER,
        chartFingerprintOf: courseStageChartFingerprint,
      },
    );
    const result = courseLog.results?.native;
    if (result === undefined) {
      await this.showSelect();
      return;
    }
    // An auto-played run keeps no record, nor does a run at another tempo, which is practice (and the Leaderboard
    // refuses it as `tempo`).
    if (courseRunKeepsRecord(courseLog)) this.recordCourseResult(courseRecordKey(session.course), result);
    this.maybeAutoSaveCoursePlaylog(courseLog);
    // The course is ranked as one run (its stages never go one by one); the rank lands in the status line.
    this.leaderboard.maybeSubmitCourse(courseLog, session.stageSongs());
    const courseInfo = resolveSceneCourseInfo(session.course);
    // A beatoraja theme shows the course result on its COURSE_RESULT skin (or its result skin).
    if (pickActiveFamilyForScene(this.familyDispatchState(), 'result') === 'beatoraja') {
      const mounted = await this.showBeatorajaResult(
        session.course.stages[0]!.song!,
        buildCourseResultSummary(result),
        result.maxCombo,
        // beatoraja's course result draws every stage's graph joined, each stage as wide as its chart is long.
        {
          ...joinCourseStageHistories(
            session.stageHistories,
            session.stageSongs().map((song) => createCourseSongRecord(song).length ?? 0),
          ),
          timingHistory: [],
        },
        { info: courseInfo, result: true },
      );
      if (mounted) {
        this.unlockPlaylogOptions();
        return;
      }
    }
    // LR2 (and the built-in result) shows the last stage's graph.
    await this.showResult(buildCourseResultData(session.course, result, courseLog, session.stageHistories.at(-1)), {
      course: courseInfo,
    });
  }

  /**
   * SHA-256 and MD5 (lowercase hex) of a song's source chart file, cached per entry id — the hashes feed the play-log
   * recording (`chart.sha256` / `chart.md5`) and dropped-log matching, and chart files are small enough that hashing
   * the whole library on a dropped log stays cheap.
   */
  private async resolveChartHashes(song: BrowserSongEntry): Promise<ChartFileHashes | undefined> {
    const cached = this.chartHashCache.get(song.id);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    const pending = this.chartHashPending.get(song.id);
    if (pending !== undefined) {
      return pending;
    }
    const lookup = computeChartFileHashes(resolveSongSource(this.collection, song), song.chartPath)
      .catch(() => undefined)
      .then((hashes) => {
        this.chartHashCache.set(song.id, hashes ?? null);
        return hashes;
      })
      .finally(() => this.chartHashPending.delete(song.id));
    this.chartHashPending.set(song.id, lookup);
    return lookup;
  }

  /** The SHA-256 half of {@link resolveChartHashes}. */
  private async resolveChartSha256(song: BrowserSongEntry): Promise<string | undefined> {
    return (await this.resolveChartHashes(song))?.sha256;
  }

  /**
   * A chart's best record for the select skin's `frame.songRecord`. Records are keyed by chart hash, which is only known
   * once the chart has been hashed: the first lookup starts hashing it and answers from the path key meanwhile (where a
   * chart that could not be hashed keeps its record), so a skin sees the record a frame or two later.
   */
  private lookupSongRecord(song: BrowserSongEntry): BeMusicSongRecord | undefined {
    if (this.songRecords.size === 0) {
      return undefined;
    }
    const hashes = this.chartHashCache.get(song.id);
    if (hashes === undefined) {
      void this.resolveChartHashes(song);
    }
    return this.songRecords.get(songRecordKey(song, hashes?.sha256));
  }

  /** Records the running play's result under its chart, when the play counts ({@link playRecordKey}). */
  private recordActivePlay(play: SongRecordPlay): void {
    if (this.activePlayRecordKey === undefined) return;
    this.recordSongResult(this.activePlayRecordKey, play);
    this.activePlayRecordKey = undefined;
  }

  /** Folds a finished play into its chart's best record and persists the records. */
  private recordSongResult(key: string, play: SongRecordPlay): void {
    this.songRecords.set(key, mergeSongRecord(this.songRecords.get(key), play));
    storeSongRecords(this.songRecords);
  }

  /** Keeps a course run's best lamp, EX score, course max combo and BP under the course's key. */
  private recordCourseResult(key: string, result: PlaylogCourseResult): void {
    const play = { lamp: result.lamp, exScore: result.exScore, maxCombo: result.maxCombo, missCount: result.missCount };
    this.songRecords.set(key, mergeSongRecord(this.songRecords.get(key), play));
    storeSongRecords(this.songRecords);
  }

  /**
   * Auto-loads a music and/or skin archive named by the `?music=` / `?skin=` URL parameters at boot, reusing the drop
   * pipeline so nothing about song listing or skin application is special-cased.
   *
   * - The skin archive is expanded into per-file `File`s and handed to {@link processIncomingFiles}, which detects the
   *   LR2 / beatoraja family and mounts it (it carries no charts, so it routes entirely to the theme loaders).
   * - The music archive is passed as a single `.zip` to {@link loadSongs}, letting the player-web loader expand it via
   *   its own guarded `unzipSync`; the select scene then lists every chart inside.
   *
   * Skin is loaded first so the select screen that follows is already themed. Failures (bad link, CORS, HTTP error)
   * surface as a status line rather than throwing, so a broken URL never wedges the boot.
   */
  private async loadFromUrl(params: { musicUrl: string | undefined; skinUrl: string | undefined }): Promise<void> {
    if (!params.musicUrl && !params.skinUrl) {
      return;
    }
    showLoadingOverlay(this.elements);
    this.selectView?.setVisible(false);
    try {
      if (params.skinUrl) {
        this.setStatus('Fetching skin…');
        await this.processIncomingFiles(await fetchZipAsFiles(params.skinUrl));
      }
      if (params.musicUrl) {
        this.setStatus('Fetching music…');
        await this.loadSongs([await fetchZipAsFile(params.musicUrl)]);
        if (this.courseGroups.length > 0) await this.refreshCourseFolders();
        await this.showSelect();
      }
      if (this.collection.songs.length > 0) {
        this.setStatus(describeSongCollection(this.collection));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dropLog.error('URL auto-load failed', error);
      this.setStatus(`URL load failed: ${message}`);
    } finally {
      hideLoadingOverlay(this.elements);
    }
  }

  private async loadSongs(files: BrowserDroppedFile[]): Promise<void> {
    this.setStatus('Loading songs...');
    // Append rather than replace so a second / third folder drop adds to the existing collection instead of wiping the
    // previous pack. The store re-prefixes source / song IDs so each drop's entries stay uniquely addressable. The
    // very first drop is just `append onto an empty collection`, which produces the same result as `loadFromFiles`
    // would have.
    this.collection = await this.collectionStore.appendFromFiles(files, {
      onProgress: (progress) => applyLoadProgress(this.elements, progress),
    });
    // Suppress the "0 charts loaded" reading — that text reads like a parse error to the user. The post-load status
    // text is set by `handleDrop` once both theme + songs land, so a mid-flight transient is plenty.
    if (this.collection.songs.length > 0) {
      this.setStatus(describeSongCollection(this.collection));
    }
  }

  private async loadTheme(files: File[]): Promise<void> {
    // Themes are discovered first so a multi-theme drop (e.g. `LR2files/Theme/{default,LITONE4}/...`) surfaces every
    // subtree to the picker. The picker UI then lets the user pick which one to mount; the rest of the dropped
    // files (Bgm / Sound under `LR2files/`) stay accessible to the selected theme via the loader's shared file map.
    const discovered = discoverLr2Themes(files);
    if (discovered.length === 0) {
      // Drop carried a `.lr2skin` but no `LR2files/Theme/<name>/` shape (rare — handcrafted bundle or zip flattened
      // without keeping the parent dirs). Fall back to "treat everything as one theme" so the legacy single-bundle
      // path keeps working — the picker stays empty in this case.
      this.availableLr2Themes = [];
      await this.mountLr2Theme(files, undefined);
      return;
    }
    // Accumulate themes across drops — mirrors how the song collection store appends rather than replaces. Newer
    // drops replace same-named entries (so the user can refresh a theme's files by re-dropping), older drops stay
    // visible in the picker. Without this the user would need to keep ALL themes in a single drop to switch
    // between them, defeating the picker's purpose.
    const mergedByName = new Map<string, Lr2DiscoveredTheme<File>>();
    for (const existing of this.availableLr2Themes) {
      mergedByName.set(existing.name, existing);
    }
    for (const incoming of discovered) {
      mergedByName.set(incoming.name, incoming);
    }
    this.availableLr2Themes = [...mergedByName.values()].sort((a, b) => a.name.localeCompare(b.name));
    // Pick the theme to mount this drop. Priority order:
    //   1. The currently-active theme if THIS drop covered it (= the user re-dropped to refresh its assets).
    //   2. The first theme from the new drop (alphabetic) — gives a sensible default for fresh drops.
    //   3. Fall back to whatever was active before this drop, in case the user dropped a non-active theme just to
    //      populate the picker without forcing a swap.
    const active = this.activeLr2ThemeName;
    const refreshedActive = active !== undefined ? discovered.find((theme) => theme.name === active) : undefined;
    const next = refreshedActive ?? discovered[0]!;
    // Union the theme's own files with shared LR2files siblings (`WallPaper/`, `Bgm/`, `Sound/`, etc.) so the loader
    // can resolve `#CUSTOMFILE`-style wildcard assets like `LR2files/WallPaper/Select/*.bmp` — those live OUTSIDE
    // `LR2files/Theme/<name>/` and are dropped by `discoverLr2Themes`, which intentionally scopes its return to the
    // theme subtree. Without this union the LR2 default select skin's main backdrop (decoded from `WallPaper/Select/`)
    // never reaches `skin.files`, so the wildcard `resolveLr2AssetBytes` lookup misses and the chrome paints with a
    // black background.
    const themeFileSet = new Set(next.files);
    const otherLr2Files = files.filter((file) => {
      if (themeFileSet.has(file)) return false;
      const lower = (file.webkitRelativePath || file.name).toLowerCase();
      // Keep anything under `lr2files/` that isn't under any theme subtree. We deliberately don't restrict to
      // `lr2files/{wallpaper,bgm,sound}/` so future LR2 shared-asset directories (e.g. a `Common/` folder some skins
      // reference) automatically come along.
      const idx = lower.indexOf('lr2files/');
      if (idx === -1) return false;
      const afterLr2Files = lower.slice(idx + 'lr2files/'.length);
      return !afterLr2Files.startsWith('theme/');
    });
    await this.mountLr2Theme([...next.files, ...otherLr2Files], next.name);
  }

  /**
   * Loads a specific LR2 theme's files through the underlying `loadLr2ThemeSkinsFromFiles` and stamps the result
   * onto the host's skin / BGM / system-sound slots. Centralised so both the initial drop path
   * ({@link loadTheme}) and the Debug Menu's theme-picker path go through the same wiring — without this split the
   * picker would have to re-implement the slot assignment block.
   */
  private async mountLr2Theme(files: ReadonlyArray<File>, themeName: string | undefined): Promise<void> {
    this.setStatus(themeName ? `Loading LR2 theme "${themeName}"...` : 'Loading LR2 theme...');
    const loadedTheme = await loadLr2ThemeSkinsFromFiles([...files], {
      onProgress: (progress) => applyLoadProgress(this.elements, progress),
    });
    for (const variant of Object.keys(this.playSkins) as Lr2PlayVariant[]) {
      delete this.playSkins[variant];
    }
    Object.assign(this.playSkins, loadedTheme.playSkins);
    this.selectSkin = loadedTheme.selectSkin;
    this.resultSkin = loadedTheme.resultSkin;
    this.courseResultSkin = loadedTheme.courseResultSkin;
    this.loadLr2ThemeSkin = loadedTheme.loadSkin;
    this.decideSkin = loadedTheme.decideSkin;
    this.selectBgmBytes = loadedTheme.selectBgm?.bytes;
    this.decideBgmBytes = loadedTheme.decideBgm?.bytes;
    this.clearBgmBytes = loadedTheme.clearBgm?.bytes;
    this.failBgmBytes = loadedTheme.failBgm?.bytes;
    this.resultBgmBytes = loadedTheme.resultBgm?.bytes;
    this.courseClearBgmBytes = loadedTheme.courseClearBgm?.bytes;
    this.courseFailBgmBytes = loadedTheme.courseFailBgm?.bytes;
    this.systemSoundBundle = {
      cursorMove: loadedTheme.systemSounds.cursorMove?.bytes,
      folderOpen: loadedTheme.systemSounds.folderOpen?.bytes,
      folderClose: loadedTheme.systemSounds.folderClose?.bytes,
      optionOpen: loadedTheme.systemSounds.optionOpen?.bytes,
      optionClose: loadedTheme.systemSounds.optionClose?.bytes,
      optionChange: loadedTheme.systemSounds.optionChange?.bytes,
    };
    this.activeLr2ThemeName = themeName;
    // BGM / decide / system-sound bytes are stashed on the host here, but NOT pushed onto the live select view yet —
    // that happens in `showSelect()` once every load task has resolved. Otherwise the small theme bundle would land
    // first and start BGM playing before the larger song collection has even finished parsing, which felt jarring with
    // a loading overlay still on screen.
    //
    // We deliberately don't paint a per-skin "Play: 7K=… / 14K=…" status here. The skin is observable in-canvas the
    // moment the user enters song-select; spelling it out in the toolbar status panel was redundant and made the
    // toolbar wider than it needed to be. `handleDrop` writes a terse "Theme loaded" / "N charts loaded" once
    // everything lands.
    // Refresh the Debug Menu's "Skin family" dropdown so the LR2 entry becomes selectable now that the theme has
    // contributed at least one LR2 skin asset. Also rebuild the LR2 theme picker so it reflects the new options.
    this.rebuildSkinFamilyPicker();
    this.rebuildLr2ThemePicker();
  }

  /**
   * Apply a user-picked LR2 theme. Disposes the persistent select view so it gets reconstructed against the new
   * skin on the next `showSelect`, mounts the theme into the slot fields, and returns to song-select.
   */
  private async applyLr2ThemeByName(name: string): Promise<void> {
    const theme = this.availableLr2Themes.find((entry) => entry.name === name);
    if (theme === undefined) return;
    if (this.lastSelectNavigation === undefined && this.selectView !== undefined) {
      this.lastSelectNavigation = this.selectView.getNavigation();
    }
    this.selectView?.dispose();
    this.selectView = undefined;
    await this.mountLr2Theme(theme.files, theme.name);
    await this.showSelect();
  }

  /**
   * Builds (or rebuilds in place) the Debug Menu's "LR2 theme" dropdown. Visible whenever at least one theme has
   * been discovered from the dropped tree — a single-theme drop still gets the picker (with one option) so the
   * user can SEE which theme is active, and subsequent drops that add more themes flip it into a real switcher
   * without the picker disappearing and reappearing.
   *
   * Implementation detail: lil-gui's `OptionController#options(values)` updates the option list in-place on an
   * existing option controller (returns the same instance, preserves the attached `onChange` listener). Same
   * pattern the skin-family picker uses — keeps the controller's position in the panel stable across rebuilds.
   */
  private rebuildLr2ThemePicker(): void {
    const folder = this.skinFolder;
    if (folder === undefined || !EXTRA_SKINS_ENABLED) return;
    const themes = this.availableLr2Themes;
    if (themes.length === 0) {
      // No discovered theme (drop didn't carry an `LR2files/Theme/<name>/` shape, OR LR2 isn't loaded at all).
      // Tear the controller down so the panel doesn't show a stale picker with options that no longer resolve.
      this.lr2ThemeController?.destroy();
      this.lr2ThemeController = undefined;
      return;
    }
    // `themes` is already alphabetised by `discoverLr2Themes`. Use the theme name as both the dropdown label and
    // the bound value — the picker proxy stores the name and `applyLr2ThemeByName` resolves it back to the files.
    const options: Record<string, string> = {};
    for (const theme of themes) {
      options[theme.name] = theme.name;
    }
    if (this.lr2ThemeController !== undefined) {
      this.lr2ThemeController.options(options).updateDisplay();
      return;
    }
    const proxy = { lr2Theme: this.activeLr2ThemeName ?? themes[0]!.name };
    this.lr2ThemeController = folder
      .add(proxy, 'lr2Theme', options)
      .name('LR2 theme')
      .onChange((value: string) => {
        // Hosting the proxy on a literal lets us re-read the picked name without leaking a separate `guiState`
        // field — the theme name is fully redundant with `activeLr2ThemeName`, which `mountLr2Theme` writes.
        // No-op when the user "picks" the already-active theme — `applyLr2ThemeByName` early-returns inside
        // `mountLr2Theme` since the same files re-mount to the same slots, but we still call through so a
        // hypothetical future code path that observes the picker change has a single chokepoint to subscribe to.
        void this.applyLr2ThemeByName(value);
      });
    // lil-gui appends; move the row up next to the beatoraja pickers so the theme pickers read as one group.
    const beatorajaFolder = this.beatorajaSkinPickerFolder?.domElement;
    if (beatorajaFolder?.parentElement === folder.$children) {
      folder.$children.insertBefore(this.lr2ThemeController.domElement, beatorajaFolder);
    }
  }

  /**
   * Load a beatoraja theme drop in parallel with the LR2 path. We currently parse the bundle and stash it on the
   * host for inspection; PixiJS rendering for beatoraja skins is implemented in a follow-up patch. The beatoraja
   * loader is independent of `loadTheme` — both states coexist so the user can drop both formats and switch between
   * them later.
   */
  private async loadBeatorajaTheme(files: File[]): Promise<void> {
    this.setStatus('Loading beatoraja theme...');
    try {
      const bundle = await loadBeatorajaThemeFromFiles(files, {
        onProgress: (progress) => applyLoadProgress(this.elements, progress),
      });
      // Drop the per-entry texture caches from the previous theme (we don't destroy individual
      // beatoraja textures in this session — see `beatorajaTextureCachesByEntry`'s field comment).
      // Clearing the map releases the only reference to the old theme's decoded bytes; the
      // underlying Pixi textures stay allocated until page reload, but they're unreachable from
      // the renderer once the new theme replaces `beatorajaTheme`.
      this.beatorajaTextureCachesByEntry.clear();
      this.disposeBeatorajaFontCaches();
      // Tear down the previous theme's audio player — its file-map cache references bytes from
      // the old bundle that we're about to replace. A fresh player gets created below tied to
      // the new bundle.
      this.beatorajaSkinAudio?.dispose();
      this.beatorajaSkinAudio = new BeatorajaSkinAudioPlayer({ files: bundle.files });
      // Probe the bundle for navigation system sounds (cursor / decide / cancel / folder /
      // option). The discovery walks well-known filenames inside the theme's `sound/` subdir
      // (and an LR2-compatible `LR2files/Sound/lr2/*.wav` fallback) — slots without a match
      // stay undefined and the select scene runs silent for those events. Beatoraja's own
      // engine reads these paths from `config.json`; the web port uses convention-based
      // probing instead since we don't load the user's beatoraja config.
      this.beatorajaSystemSoundPaths = discoverBeatorajaSystemSoundPaths(bundle.files);
      // Looping select BGM path. Probes the standard `Bgm/select.*` locations plus an LR2-
      // compatible fallback. Stays `undefined` for themes without a select BGM file (the
      // scene runs silent in the background then).
      this.beatorajaSelectBgmPath = discoverBeatorajaSelectBgmPath(bundle.files);
      this.beatorajaTheme = bundle;
      // Drop overrides from the previous theme — entryPaths from the old bundle will no longer
      // resolve against the new entries. Without this `pickBeatorajaSkinEntryWithOverride`'s
      // self-clearing fallback would still kick in, but the picker dropdowns would briefly show
      // stale labels until the user opened a scene that hit that fallback. Clearing eagerly keeps
      // the GUI honest.
      this.beatorajaSkinOverridesByType.clear();
      this.rebuildBeatorajaSkinPickers();
      // The beatoraja entry just became selectable in the top-level "Skin family" dropdown.
      this.rebuildSkinFamilyPicker();
      // Scan the dropped bundle for decide / clear / fail / result BGM. Heuristic by basename —
      // see `findBeatorajaThemeBgm` for the rules. Awaited because some entries are read lazily;
      // the load is small (<1 MiB) and serialized so it doesn't add visible latency.
      this.beatorajaThemeBgm = await findBeatorajaThemeBgm(bundle);
      const summary = summarizeBeatorajaPlaySkins(bundle.theme.playSkins) || 'none';
      const sceneSummary = [
        bundle.theme.selectSkin ? 'select' : null,
        bundle.theme.decideSkin ? 'decide' : null,
        bundle.theme.resultSkin ? 'result' : null,
        bundle.theme.courseResultSkin ? 'course-result' : null,
      ]
        .filter((s): s is string => s !== null)
        .join('+');
      dropLog.info(
        `beatoraja theme loaded · files=${bundle.files.size} · play=${summary}${sceneSummary ? ` · scenes=${sceneSummary}` : ''}${
          bundle.warnings.length > 0 ? ` · warnings=${bundle.warnings.length}` : ''
        }`,
      );
      if (bundle.warnings.length > 0) {
        for (const w of bundle.warnings) {
          dropLog.warn(`beatoraja skin warning: ${w.entryPath}: ${w.message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dropLog.warn(`beatoraja theme load failed: ${message}`);
    }
  }

  /**
   * Per-entry-path memoized texture caches. Never destroyed in this session — see `beatoraja-textures.ts` for
   * why disposing beatoraja textures and re-decoding the same bytes crashes PixiJS v8's bind-group cache.
   * The same hazard is technically present in the LR2 path but LR2's flow doesn't re-mount the same skin.
   */
  private readonly beatorajaTextureCachesByEntry = new Map<string, BeatorajaTextureCache>();
  /**
   * Per-entry skin font cache. Reused while the same theme is active, then disposed when a new
   * theme is dropped so `document.fonts` and Pixi's bitmap-font cache don't accumulate old entries.
   */
  private readonly beatorajaFontCachesByEntry = new Map<string, BeatorajaFontCache>();

  private disposeBeatorajaFontCaches(): void {
    for (const cache of this.beatorajaFontCachesByEntry.values()) {
      (cache as BeatorajaFontCache & { dispose?: () => void }).dispose?.();
    }
    this.beatorajaFontCachesByEntry.clear();
  }

  /**
   * Bundle the demo's theme / skin / override fields into the {@link FamilyDispatchState} shape consumed by
   * `./family-dispatch.ts`. Built per call (cheap — a half-dozen direct references) so the pure helpers can stay
   * unaware of the demo's private state layout.
   */
  private familyDispatchState(): FamilyDispatchState {
    return {
      beatorajaTheme: this.beatorajaTheme,
      selectSkin: this.selectSkin,
      decideSkin: this.decideSkin,
      resultSkin: this.resultSkin,
      playSkins: this.playSkins,
      skinFamilyOverride: this.guiState.skinFamilyOverride,
    };
  }

  /**
   * Rebuilds (or first-builds) the Debug Menu's "Skin family" dropdown. Called once during `buildGui` and again
   * after every theme load / wipe so the available options track the loaded asset state. When the user's
   * previously-selected override becomes unavailable, silently resets to `'auto'` before swapping options in so
   * the dropdown never displays a value that wouldn't actually be honoured.
   *
   * Implementation detail: lil-gui's `Controller#options(values)` destroys the underlying controller and
   * recreates it in place — same approach the beatoraja per-scene skin picker uses, see
   * `rebuildBeatorajaSkinPickers`. The replacement preserves insertion order, so the dropdown stays where
   * `buildGui` parked it (right after the `Open files` button).
   */
  private rebuildSkinFamilyPicker(): void {
    const gui = this.gui;
    if (gui === undefined) return;
    const lr2Available = hasAnyLr2Skin(this.familyDispatchState());
    const beatorajaAvailable = this.beatorajaTheme !== undefined;
    // Snap back to 'auto' BEFORE rebuilding options so the freshly-built controller initialises to a valid value.
    // Without this guard a user-picked LR2 / beatoraja override that became unavailable mid-session would render
    // as a phantom dropdown value the runtime silently ignored.
    const override = this.guiState.skinFamilyOverride;
    if ((override === 'lr2' && !lr2Available) || (override === 'beatoraja' && !beatorajaAvailable)) {
      this.guiState.skinFamilyOverride = EXTRA_SKINS_ENABLED ? 'auto' : 'default';
    }
    // The three skin systems are always listed; one without a loaded skin says so, and picking it asks for a drop.
    const options: Record<string, SkinFamilyOverride> = EXTRA_SKINS_ENABLED
      ? { 'Auto (prefer loaded theme)': 'auto' }
      : {};
    options['Built-in'] = 'default';
    options[lr2Available ? 'LR2' : 'LR2 (drop a skin)'] = 'lr2';
    options[beatorajaAvailable ? 'beatoraja' : 'beatoraja (drop a skin)'] = 'beatoraja';
    if (this.guiState.skinFamilyOverride === 'auto' && !EXTRA_SKINS_ENABLED)
      this.guiState.skinFamilyOverride = 'default';
    if (this.skinFamilyController !== undefined) {
      // `OptionController#options(values)` updates the option list **in place** on an existing option controller
      // (see lil-gui v0.21.0 source: the subclass override mutates `_values` / `_names` + replaces the `<option>`
      // DOM nodes, returning `this`). The previously-attached `onChange` listener stays bound to the same
      // controller instance — re-attaching here would stack a second handler and fire `handleSkinFamilyOverrideChange`
      // twice per user pick. `updateDisplay()` is enough to snap the visible label to whatever value
      // `rebuildSkinFamilyPicker` just settled on (e.g. the silent revert to `'auto'` when the prior pick became
      // unavailable).
      this.skinFamilyController.options(options).updateDisplay();
      return;
    }
    // First-time build (called from `buildGui` before any theme has been loaded).
    this.skinFamilyController = (this.skinFolder ?? gui)
      .add(this.guiState, 'skinFamilyOverride', options)
      .name('Skin system')
      .onChange((value: SkinFamilyOverride) => {
        const loaded =
          value === 'lr2'
            ? hasAnyLr2Skin(this.familyDispatchState())
            : value === 'beatoraja'
              ? this.beatorajaTheme !== undefined
              : true;
        if (!loaded) {
          // Nothing of that system is loaded: stay on the current one and ask for a drop of its skin.
          this.promptSkinDrop(value === 'lr2' ? 'lr2' : 'beatoraja');
          // Restored without `setValue`, which would run this handler again and rebuild the select screen for nothing.
          this.guiState.skinFamilyOverride = this.activeSkinSystem;
          this.skinFamilyController?.updateDisplay();
          return;
        }
        this.activeSkinSystem = value;
        this.handleSkinFamilyOverrideChange(value);
      });
  }

  /**
   * Apply a Debug Menu skin-family change. The persistent select scene needs an explicit dispose-and-rebuild
   * (the underlying class differs across families — `PixiSongSelectView` vs `DefaultPixiSongSelectView` vs the
   * beatoraja scene), then `showSelect` reconstructs whichever family the new override resolves to. The gameplay
   * / decide / result scenes pick up the new override on their next mount — they're transient and there's
   * nothing on screen to swap at the moment the user changes the dropdown (they'd have to be in song-select to
   * even reach the GUI).
   */
  /** The container and codec the Debug Menu's "Video format" asks recordings to be written in. */
  private get recordingFormat(): RecordingFormat {
    return parseRecordingFormatKey(this.guiState.recordingFormat);
  }

  /** The be-music skin the default-family scenes render with. */
  private get beMusicSkin() {
    return BE_MUSIC_SKINS.resolve(this.guiState.builtInSkin);
  }

  /** Registers `skin` (validated), loads its fonts, and switches to it; reports why when it is refused. */
  private addBeMusicSkin(skin: BeMusicSkin): void {
    const problems = BE_MUSIC_SKINS.add(skin);
    if (problems.length > 0) {
      this.setStatus(`Skin "${skin.id}" was not added: ${problems.join('; ')}`);
      return;
    }
    loadSkinFonts(skin);
    this.handleBuiltInSkinChange(skin.id);
    this.setStatus(`Added skin ${skin.label} ${skin.version} by ${skin.author.name}`);
  }

  /**
   * Imports a skin module from `url` and adds its default export. A skin is code that runs with this page's full
   * access, so the user confirms the source first.
   */
  private async addBeMusicSkinFromUrl(url: string): Promise<void> {
    const trimmed = url.trim();
    if (!trimmed) {
      this.setStatus('Enter the URL of a skin module first');
      return;
    }
    if (
      !window.confirm(
        `Load the skin at ${trimmed}?\n\nA skin is code that runs with full access to this page. Only load skins you trust.`,
      )
    ) {
      return;
    }
    try {
      const module = (await import(/* @vite-ignore */ trimmed)) as { default?: BeMusicSkin };
      if (!module.default) {
        this.setStatus('That module has no default export to use as a skin');
        return;
      }
      this.addBeMusicSkin(module.default);
    } catch (error) {
      this.setStatus(`Could not load the skin: ${(error as Error).message}`);
    }
  }

  /**
   * Apply a Debug Menu built-in skin change: persist it and rebuild the persistent select scene (the same dispose-and-
   * rebuild the skin-family override uses). Gameplay / result pick the skin up on their next mount.
   */
  private handleBuiltInSkinChange(id: string): void {
    this.guiState.builtInSkin = BE_MUSIC_SKINS.resolve(id).id;
    storeBuiltInSkinId(this.guiState.builtInSkin);
    this.rebuildSkinSettingsFolder();
    this.handleSkinFamilyOverrideChange(this.guiState.skinFamilyOverride);
  }

  /** The stored values for the active be-music skin's settings, as handed to its scenes (`beMusicSkinSettings`). */
  private get beMusicSkinSettings(): Readonly<Record<string, unknown>> | undefined {
    return this.skinSettings.get(this.beMusicSkin.id);
  }

  /**
   * Refills the "Skin settings" folder from the active be-music skin's `settings` schema — a dropdown per choice, a
   * slider per number, a checkbox per toggle — seeded with the stored values, and hides it when the skin declares none.
   * Every change is stored under the skin's id and reaches the scenes on screen at once.
   */
  private rebuildSkinSettingsFolder(): void {
    const folder = this.skinSettingsFolder;
    if (!folder) return;
    // `controllersRecursive` returns a copy, so destroying (which splices `folder.controllers`) is safe mid-loop.
    for (const controller of folder.controllersRecursive()) controller.destroy();
    const skin = this.beMusicSkin;
    const controllers = describeSkinSettingControllers(skin.settings);
    folder.show(controllers.length > 0);
    if (controllers.length === 0) return;
    const values: Record<string, unknown> = { ...resolveBeMusicSkinSettings(skin, this.skinSettings.get(skin.id)) };
    for (const controller of controllers) {
      const added =
        controller.kind === 'dropdown'
          ? folder.add(values, controller.id, controller.options)
          : controller.kind === 'slider'
            ? folder.add(values, controller.id, controller.min, controller.max, controller.step)
            : folder.add(values, controller.id);
      added.name(controller.name).onChange((value: string | number | boolean) => {
        setStoredSkinSetting(this.skinSettings, skin.id, controller.id, value);
        storeSkinSettings(this.skinSettings);
        this.applyBeMusicSkinSettings();
      });
    }
    folder
      .add(
        {
          reset: () => {
            this.skinSettings.delete(skin.id);
            storeSkinSettings(this.skinSettings);
            this.applyBeMusicSkinSettings();
            this.rebuildSkinSettingsFolder();
          },
        },
        'reset',
      )
      .name('Reset to defaults');
  }

  /** Hands the active be-music skin's settings to the scenes on screen, which draw with them from their next frame. */
  private applyBeMusicSkinSettings(): void {
    const settings = this.beMusicSkinSettings;
    this.selectView?.setBeMusicSkinSettings(settings);
    this.gameplayView?.setBeMusicSkinSettings(settings);
    this.resultView?.setBeMusicSkinSettings(settings);
    if (this.decideView instanceof DefaultPixiDecideView) this.decideView.setBeMusicSkinSettings(settings);
  }

  private handleSkinFamilyOverrideChange(value: SkinFamilyOverride): void {
    this.guiState.skinFamilyOverride = value;
    this.activeSkinSystem = value;
    this.skinFamilyController?.updateDisplay();
    if (this.lastSelectNavigation === undefined && this.selectView !== undefined) {
      this.lastSelectNavigation = this.selectView.getNavigation();
    }
    this.selectView?.dispose();
    this.selectView = undefined;
    if (this.beatorajaSelectScene !== undefined) {
      this.beatorajaSelectSnapshot = this.beatorajaSelectScene.captureSnapshot();
    }
    this.beatorajaSelectScene?.dispose();
    this.beatorajaSelectScene = undefined;
    void this.showSelect();
  }

  /**
   * Beatoraja gameplay flow. Mirrors the LR2 `playSong` lifecycle (mount + audio decode → run engine →
   * route exit / completion to result / select), but routes audio through `runEngineDriver` and the
   * scene through `PixiBeatorajaGameplayView` instead of the LR2 view's bespoke render pipeline.
   *
   * The view assumes pre-decoded audio + BGA — those come from `prepareBeatorajaGameplayChart`. Each
   * play awaits the prep promise before constructing the view; if the prep fails, we surface the
   * status and bail back to song select rather than silently falling back to LR2 (the user explicitly
   * opted into the beatoraja path).
   */
  private async playSongBeatoraja(
    song: BrowserSongEntry,
    overrides: { autoPlay?: boolean; courseStage?: CourseStagePlan },
  ): Promise<void> {
    const courseStage = overrides.courseStage;
    const bundle = this.beatorajaTheme;
    if (!bundle) return;
    // Chart-file hashes for the recorded play-log (matched back on a future play-log drop).
    const chartHashes = await this.resolveChartHashes(song);
    // **TWO distinct variants** flow into the gameplay scene:
    //   - `skinVariant`: which `play_*` skin file to load. The theme may not ship every
    //     variant (a popular 7-only theme lacks a `play_9` skin, etc.), so this falls back
    //     through `pickBeatorajaPlayableSkinVariant`'s chain (`9 → 7 → 14 → 5 → 10`).
    //   - `chartVariant`: what the chart ACTUALLY is. Drives the engine's lane mode
    //     (channel → lane mapping), the runtime adapter's lane-timer resolution, and the
    //     note layer's `channel → lane index` math. This MUST match what the chart's
    //     channels declare; falling back to the skin's variant here would route a 9-key
    //     chart's `f`/`v`/`g`/`b` inputs through the IIDX 7-key key bindings and the
    //     engine's IIDX free-zone clamp would drop the corresponding `scorableNotes`.
    //
    // Pre-fix the gameplay view received `skinVariant` for everything, so a 9-key
    // chart played on a 7-key skin had:
    //   - 7-key adapter `chartPlayVariant` → lanes 6..9 of channels 16/17/18/19
    //     misclassified as scratch / free-zone / 6key / 7key
    //   - 7-key note-layer `variant` → channel 16 routed to lane 7 (the IIDX scratch
    //     slot), channels 17 / 18 / 19 routed to lanes -1 / 5 / 6
    //   - engine's `laneModeExtension`-only fallback never reached `9-key` because
    //     `resolveLaneMode` only escalates to 9-key when the chart is `.pms` or
    //     `#PLAYER=3` with channel `17` — and most 9-key BMEs that authored f/v/g/b
    //     inputs satisfy neither
    // User report: 9 KEY charts wouldn't accept input on lanes 6-9 (f,v,g,b keys
    // unresponsive). c0da7b5 partially
    // addressed this by forwarding the chart's filename to the engine for the
    // extension-based heuristic, but skipped the variant separation here.
    const skinVariant = resolveBeatorajaSkinVariant(this.beatorajaTheme, song);
    if (skinVariant === undefined) return;
    const chartVariant = pickBeatorajaPlayableVariant(chartShapeFor(song));
    if (chartVariant === undefined) return;
    if (skinVariant !== chartVariant) {
      // Theme doesn't ship the chart's native skin variant (e.g. a 9-key chart on a
      // 7-keys-only theme). We load the fallback skin chrome but keep the engine /
      // adapter / note-layer pinned to the chart's variant so input + judging stay
      // correct; the visible mismatch is the SKIN's lane count differing from the
      // CHART's. Warn so the mismatch is visible in the console.
      gameplayLog.warn(
        `beatoraja gameplay: theme has no '${chartVariant}' skin — falling back to '${skinVariant}' (lane chrome may not match chart key count)`,
      );
    }
    // Alias retained to minimize churn in the rest of this function. Use `skinVariant` for
    // skin lookups (`playSkinTypeForVariant`, the skin entry pick chain) and `chartVariant`
    // for runtime-driving prop wiring (`variant` on the gameplay view).
    const variant = skinVariant;

    this.elements.shell.classList.add('playing');
    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    this.decideView?.dispose();
    this.decideView = undefined;
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    this.disposeBeatorajaGameplay();
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;

    // 1. Pick the actual skin entry for this variant, honoring any user override from the
    // Debug Menu's skin-picker dropdown. Falls back to `pickBeatorajaPlaySkin`'s discovery result.
    const playTypeCode = playSkinTypeForVariant(variant);
    const playCandidates = bundle.theme.entries.filter((entry) => entry.header.type === playTypeCode);
    const fallbackEntry = bundle.theme.playSkins[variant];
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(playTypeCode, playCandidates, fallbackEntry);
    if (selectedEntry === undefined) {
      gameplayLog.warn(`beatoraja gameplay: no skin entry for variant '${variant}'`);
      this.setStatus(`Beatoraja gameplay unavailable: no '${variant}' skin`);
      void this.showSelect();
      return;
    }

    // Two-pass evaluation — same contract as the select scene.
    const headerLoad = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files });
    if (!headerLoad.ok) {
      gameplayLog.warn(`beatoraja gameplay header: ${headerLoad.error.message}`);
      this.setStatus(`Beatoraja gameplay unavailable: ${headerLoad.error.message}`);
      void this.showSelect();
      return;
    }
    const config = this.resolveBeatorajaSkinConfig(selectedEntry.entryPath, headerLoad.header);
    // Gameplay skins don't crash without runtimeContext (the load-time `main_state.option`
    // pattern is unique to ModernChic decide; play scenes use op gates on destinations,
    // evaluated at render time with a fresh per-frame context). Skip the load-time
    // injection here — its earlier addition was "for consistency" and downstream gameplay
    // skins reacted unexpectedly to mid-load `main_state.option` returning chart-aware
    // values where they previously got `false`. Decide / result still inject because
    // ModernChic specifically pre-computes per-difficulty values during `main()`.
    const result = loadBeatorajaSkin({
      entryPath: selectedEntry.entryPath,
      files: bundle.files,
      skinConfig: config,
    });
    if (!result.ok || !result.skin) {
      const reason = result.ok ? 'skin payload missing' : result.error.message;
      gameplayLog.warn(`beatoraja gameplay: ${reason}`);
      this.setStatus(`Beatoraja gameplay unavailable: ${reason}`);
      void this.showSelect();
      return;
    }
    // Narrow the union by extracting the (now-known-defined) `skin` reference; subsequent uses
    // type-check without `!` operators.
    const skin = result.skin;
    const skinLoad = { entry: selectedEntry, skin };

    // 2. Texture cache for the skin variant — reuse if previously decoded.
    let textures = this.beatorajaTextureCachesByEntry.get(skinLoad.entry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: skinLoad.entry.entryPath,
        sources: (skinLoad.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
        filepathSchema: skinLoad.skin.filepath,
        filepathOverrides: config.file,
      });
      gameplayLog.info(
        `beatoraja gameplay source bundle: resolved=${sourceBundle.assets.length} unresolved=${sourceBundle.unresolved.length} (entry=${skinLoad.entry.entryPath})`,
      );
      for (const u of sourceBundle.unresolved) {
        gameplayLog.warn(`beatoraja gameplay unresolved source[${u.id}] '${u.path}': ${u.reason}`);
      }
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(skinLoad.entry.entryPath, textures);
    }

    // 2b. Skin font cache. Same per-entry memoization as textures — TTFs are tiny (≤ a few hundred KB)
    // and the registered FontFace outlives every scene anyway.
    let fonts = this.beatorajaFontCachesByEntry.get(skinLoad.entry.entryPath);
    if (fonts === undefined) {
      const fontDeclarations = normalizeBeatorajaFonts(skinLoad.skin.font);
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath: skinLoad.entry.entryPath,
        fonts: fontDeclarations,
      });
      gameplayLog.info(
        `beatoraja gameplay fonts: declared=${fontDeclarations.length} loaded=${fonts.values().length} (entry=${skinLoad.entry.entryPath})`,
      );
      this.beatorajaFontCachesByEntry.set(skinLoad.entry.entryPath, fonts);
    }

    // 3. Audio + BGA prep — owns the AudioContext for this play. The play tempo is read once, here, for the prep and the
    // engine alike.
    const tempoPercent = this.guiState.tempoPercent;
    const tempo = tempoFromPercent(tempoPercent);
    const source = resolveSongSource(this.collection, song);
    if (!source) {
      this.setStatus(`Beatoraja gameplay: no source for ${song.title}`);
      void this.showSelect();
      return;
    }
    let prep: PreparedBeatorajaGameplayChart;
    try {
      // Reuse the chart the decide scene resolved IFF it belongs to the song we're about to play, so decide and
      // gameplay show and play the same `#RANDOM` branches. When the cached chart is for a different `chartPath`
      // (= the player reached gameplay via a path that bypassed decide), the prep resolves the chart itself. A course
      // stage always resolves its own: its chart carries the course's long-note constraint (`CourseSession.stageSong`).
      const preResolved =
        courseStage === undefined && this.lastBeatorajaChart?.chartPath === song.chartPath
          ? this.lastBeatorajaChart.resolved
          : undefined;
      prep = await prepareBeatorajaGameplayChart({
        song,
        source,
        audioCompressorMode: this.guiState.compressor === false ? 'off' : this.compressorMode,
        audioBusOptions: {
          initialVolumes: { key: this.guiState.keyVolume / 100, bgm: this.guiState.bgmVolume / 100 },
          initialCompressorParams: this.resolveCompressorParamOverrides(),
          // The Debug Menu's per-stage compressor toggles, as the LR2 / default play takes them.
          initialStages: {
            key: this.guiState.compressorKey,
            bgm: this.guiState.compressorBgm,
            master: this.guiState.compressorMaster,
          },
        },
        ...(preResolved !== undefined ? { preResolved } : {}),
        bgaTranscode: {
          maxLongEdgePx: this.guiState.bgaResizeMaxEdgePx > 0 ? this.guiState.bgaResizeMaxEdgePx : undefined,
          useWebCodecs: this.guiState.bgaUseWebCodecs,
        },
        tempo,
        tempoPitchMode: this.guiState.tempoPitchMode,
        tempoStretchAlgorithm: this.guiState.tempoStretchAlgorithm,
      });
    } catch (error) {
      gameplayLog.warn('beatoraja prep failed', error);
      this.setStatus(`Beatoraja prep failed: ${(error as Error).message}`);
      void this.showSelect();
      return;
    }
    this.beatorajaGameplayPrep = prep;
    this.beatorajaGameplayPrepChartPath = song.chartPath;

    // Decode the chart's #STAGEFILE / #BACKBMP / #BANNER bitmaps so play-scene destinations
    // referencing the synthetic ids (-100 / -101 / -102) can paint them. ModernChic's lane
    // cover uses the stagefile as a frosted backdrop; default skin's loading panel anchors
    // on it during the intro chrome.
    const chartImages = await this.loadBeatorajaChartImages(song);

    // 4. Mount the gameplay view.
    const autoPlay = overrides.autoPlay ?? this.guiState.autoPlay;
    this.lastPlay = { song, overrides: { autoPlay } };
    // The same record rule as the LR2 / default play (`playRecordKey`).
    this.activePlayRecordKey = playRecordKey(song, chartHashes?.sha256, {
      autoPlay,
      replay: false,
      course: courseStage !== undefined,
      tempo,
    });
    // Set while ESC gives a course up: the engine's settling (`onComplete` / `onError`) then leaves the exit to `onExit`.
    let givingUp = false;
    this.beatorajaGameplayView = new PixiBeatorajaGameplayView({
      skin: skinLoad.skin,
      textures,
      fonts,
      skinConfig: config,
      // CHART variant drives the engine's lane mode + adapter's `chartPlayVariant` + note
      // layer's channel → lane math. Skin lookups above used `skinVariant` (= the fallback
      // chain pick) because the theme may not ship the chart's exact variant — but the
      // runtime stays pinned to the CHART so f/v/g/b stay bound to channels 16/17/18/19
      // on 9-key POPN charts even when the loaded skin chrome is a 7-key fallback.
      variant: chartVariant,
      chart: prep.chart,
      // The unresolved chart the play log's fingerprints describe (`prep.chart` is resolved and may be DP-flipped).
      sourceChart: song.chart,
      audio: prep.audio,
      skinAudio: this.beatorajaSkinAudio,
      mode: autoPlay ? 'auto' : 'manual',
      // DP flip — when the user enabled it via the Play options (Debug Menu / LR2 select panel, two-way synced
      // into `guiState`) AND the chart is a DP variant (10 / 14 keys), the chart's lane channels mirror at
      // construction. SP charts pass through unchanged because they have no 2P channels to swap with.
      dpFlip: this.guiState.dpFlip,
      initialHiSpeed: this.guiState.hiSpeed,
      onHiSpeedChange: (hiSpeed: number) => this.rememberHiSpeed(hiSpeed, 'play'),
      ...(courseStage !== undefined
        ? { courseInfo: courseStage.courseInfo, hiSpeedLocked: courseStage.hiSpeedLocked }
        : {}),
      // Judge-window ruleset + auto scratch + play-log extras ride the engine-options passthrough — the beatoraja
      // scene forwards them onto the shared engine and merges `recordPlaylog` with its own fields.
      engineOptions: {
        // The draws `prep.chart` was resolved with: the engine plays that chart as is and names them in its summary.
        randomDraws: prep.randomDraws,
        // The play tempo the prep readied the audio and BGA for; the engine judges in chart time.
        speed: tempo,
        judgeRuleset: this.guiState.judgeRuleset,
        autoScratch: this.guiState.autoScratch1P || this.guiState.autoScratch2P,
        gauge: this.guiState.gauge,
        ...(courseStage !== undefined ? { course: courseStage.course } : {}),
        recordPlaylog: {
          gauge: this.guiState.gauge,
          ...(chartHashes !== undefined ? { chartSha256: chartHashes.sha256, chartMd5: chartHashes.md5 } : {}),
          recorder: PLAYLOG_RECORDER,
        },
      },
      bgaTextures: prep.bga.textures,
      bgaVideoElements: prep.bga.videoElements,
      bgaCues: prep.bga.cues,
      chartImages,
      // Directory label drives `BEATORAJA_TEXT.DIRECTORY = 1000` on the play scene. The browser
      // song entry preserves the parent folder name through the dropped collection.
      directoryLabel: song.directoryLabel,
      // Chart filename — the gameplay view derives `laneModeExtension` from this for the engine,
      // so PMS / BME / BMS lane-mode resolution doesn't depend on the BMS content heuristic
      // (`#PLAYER 3` + channel 17). Without it a `#PLAYER 1` PMS chart routes to the IIDX 7-key
      // bindings instead of POPN-9, which silently drops lane 6+ keys.
      chartPath: song.chartPath,
      onExit: () => {
        // ESC gives a running course up: the run is kept as a failed one, with the stage given up recorded once the
        // engine settles (its play log carries `play.aborted`).
        const view = this.beatorajaGameplayView;
        if (courseStage !== undefined && this.courseSession !== undefined) {
          const session = this.courseSession;
          givingUp = true;
          const settled = Promise.race([
            view?.awaitCompletion()?.catch(() => undefined),
            new Promise((resolve) => setTimeout(resolve, 2000)),
          ]);
          void this.finishBeatorajaGameplayThen(async () => {
            await settled;
            session.giveUp(view?.getPlaylog());
            this.courseSession = session;
            await this.showCourseResult();
          });
          return;
        }
        void this.finishBeatorajaGameplayThen(() => this.showSelect());
      },
      onComplete: (summary, maxCombo, history) => {
        if (givingUp) return;
        // Result skin (`type = 7`) when the bundle ships one — otherwise jump back to select.
        // `finishBeatorajaGameplayThen` drops the gameplay scene first so the result scene gets a
        // clean stage; the result scene mounts in the `then` branch. `history` carries the
        // per-judge score / gauge polyline samples for the result skin's graph elements.
        // The play-log is captured HERE (while the gameplay view is guaranteed alive) — the finish
        // transition below disposes the scene before the result mounts.
        const playlog = this.beatorajaGameplayView?.getPlaylog();
        void this.finishBeatorajaGameplayThen(async () => {
          // A course stage: its play log carries the course on, and leaving its result plays the next stage.
          if (courseStage !== undefined && this.courseSession !== undefined) {
            const goesOn = this.courseSession.recordStage(playlog, history) === 'next';
            // With stage results skipped (or an auto-played stage the course goes on after, as LR2 skips it), go
            // straight on to the next stage (or the course result).
            const mounted =
              !skipsCourseStageResult({
                skipStageResults: this.guiState.courseAutoAdvance,
                autoPlay,
                courseGoesOn: goesOn,
              }) &&
              (await this.showBeatorajaResult(song, summary, maxCombo, history, {
                info: this.courseSession.courseInfo,
              }));
            if (!mounted) this.continueCourse();
            this.unlockPlaylogOptions();
            return;
          }
          this.recordActivePlay(songRecordPlayFromSummary(summary, maxCombo));
          const mounted = await this.showBeatorajaResult(song, summary, maxCombo, history);
          if (!mounted) await this.showSelect();
          // Auto-save fires even when the theme ships no result skin — falling back to select
          // shouldn't cost the user their replay file.
          this.maybeAutoSavePlaylog(playlog);
          this.leaderboard.maybeSubmit(playlog, song);
          this.unlockPlaylogOptions();
        });
      },
      onError: (error) => {
        // `PlayerInterruptedError` lands here for the ESC path — it's the expected exit for "user
        // pressed ESC mid-chart". Treat it as a clean exit.
        gameplayLog.info('beatoraja engine ended', { error: (error as Error).message });
        if (givingUp) return;
        void this.finishBeatorajaGameplayThen(() => this.showSelect());
      },
    });
    this.beatorajaGameplayView.root.zIndex = 0;
    // Track the live variant so the Debug Menu's "Play *K" dropdowns know whether their
    // type-code matches the active scene before triggering a live re-mount.
    this.currentBeatorajaPlayVariant = variant;
    await this.sceneHost.setScene(this.beatorajaGameplayView);
    this.setStatus(describePlayingStatus(song.title, { family: 'beatoraja', tempoPercent }));
    this.lockPlaylogOptionsForPlay();

    // Consume the "user pressed Record on the select screen" flag. Same flow as the LR2
    // gameplay path — `autoRecordArmed` is set when the user clicks the Record button
    // before picking a song; the next gameplay mount kicks the recorder off automatically.
    startArmedRecording(this.recordingDeps());

    // Skin-options panel for the play skin's `property[]` / `filepath[]`. Live edits flow through
    // `applyBeatorajaPlaySkinConfig` → `replaceSkin` so the chrome rebuilds without tearing down
    // the engine driver. The audio session, chart playback, and scoring all keep running.
    this.refreshBeatorajaSkinOptionsGui({
      title: `Skin Config (Play ${variant}K)`,
      entryPath: selectedEntry.entryPath,
      header: headerLoad.header,
      onApply: (nextConfig) => {
        void this.applyBeatorajaPlaySkinConfig(selectedEntry.entryPath, variant, nextConfig);
      },
    });
  }

  /**
   * Apply a fresh skin-config to the active beatoraja gameplay scene WITHOUT restarting the chart.
   * Re-loads the skin with the new options, rebuilds the per-entry texture cache, then calls
   * `replaceSkin` on the live gameplay view. The runtime adapter's `setBaseOps` handles the option
   * delta so per-side judge state / timer stamps / current frame all carry through unchanged.
   */
  private async applyBeatorajaPlaySkinConfig(
    entryPath: string,
    variant: BeatorajaPlayableVariant,
    config: BeatorajaSkinConfig,
  ): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (!bundle || !this.beatorajaGameplayView) return;
    // Load the SPECIFIC entry — different from the discovery's "best" pick when the user picked an
    // alternate skin from the Debug Menu's skin-picker dropdown.
    const result = loadBeatorajaSkin({ entryPath, files: bundle.files, skinConfig: config });
    if (!result.ok || !result.skin) return;
    this.beatorajaTextureCachesByEntry.delete(entryPath);
    const sourceBundle = bundleBeatorajaSources({
      files: bundle.files,
      entryPath,
      sources: (result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
      filepathSchema: result.skin.filepath,
      filepathOverrides: config.file,
    });
    const textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
    this.beatorajaTextureCachesByEntry.set(entryPath, textures);
    let fonts = this.beatorajaFontCachesByEntry.get(entryPath);
    if (fonts === undefined) {
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath,
        fonts: normalizeBeatorajaFonts(result.skin.font),
      });
      this.beatorajaFontCachesByEntry.set(entryPath, fonts);
    }
    this.beatorajaGameplayView.replaceSkin({ skin: result.skin, skinConfig: config, textures, fonts });

    this.refreshBeatorajaSkinOptionsGui({
      title: `Skin Config (Play ${variant}K)`,
      entryPath,
      header: result.header,
      onApply: (nextConfig) => {
        void this.applyBeatorajaPlaySkinConfig(entryPath, variant, nextConfig);
      },
    });
  }

  /**
   * Mount the beatoraja-skinned song select scene. Loads the theme's select skin (with a default
   * `skin_config.option` fill from `buildDefaultSkinConfigOptions`), reuses cached textures / fonts
   * when available, and hands the scene a callback that routes the chosen song through the existing
   * `showDecide` / `playSong` flow.
   */
  private async showBeatorajaSelect(): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return;

    // Pick the actual entry to mount — honor a user override from the Debug Menu's skin-picker dropdown
    // when one was set, otherwise fall back to the discovery's "best" pick (`theme.selectSkin`).
    const selectCandidates = bundle.theme.entries.filter(
      (entry) => entry.header.type === BEATORAJA_SKIN_TYPE.MUSIC_SELECT,
    );
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      BEATORAJA_SKIN_TYPE.MUSIC_SELECT,
      selectCandidates,
      bundle.theme.selectSkin,
    );
    if (selectedEntry === undefined) {
      gameplayLog.warn('beatoraja select: no select skin in theme');
      this.setStatus('Beatoraja select unavailable: no select skin');
      return;
    }

    // Two-pass evaluation — header pass picks up the skin's `property[]` schema, the second pass
    // re-runs `main()` with default option picks so dynamic `source[]` / `destination[]` populate.
    const headerLoad = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files });
    if (!headerLoad.ok) {
      gameplayLog.warn(`beatoraja select: ${headerLoad.error.message}`);
      this.setStatus(`Beatoraja select unavailable: ${headerLoad.error.message}`);
      return;
    }
    // Resolve cached skin config (or seed defaults from the header's property[] schema). The
    // skin-options panel mutates this object as the user picks options.
    const config = this.resolveBeatorajaSkinConfig(selectedEntry.entryPath, headerLoad.header);
    const result = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files, skinConfig: config });
    if (!result.ok || !result.skin) {
      const reason = result.ok ? 'skin payload missing' : result.error.message;
      gameplayLog.warn(`beatoraja select: ${reason}`);
      this.setStatus(`Beatoraja select unavailable: ${reason}`);
      return;
    }
    // Narrow the union by extracting the (now-known-defined) `skin` reference; subsequent uses
    // type-check without `!` operators.
    const skin = result.skin;
    const skinLoad = { entry: selectedEntry, skin };

    // Texture + font cache — same per-entry memoization as the gameplay path. The select skin lives
    // at a different `entryPath` than `play_*.luaskin` so the caches are naturally segregated.
    let textures = this.beatorajaTextureCachesByEntry.get(skinLoad.entry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: skinLoad.entry.entryPath,
        sources: (skinLoad.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
        filepathSchema: skinLoad.skin.filepath,
      });
      gameplayLog.info(
        `beatoraja select source bundle: resolved=${sourceBundle.assets.length} unresolved=${sourceBundle.unresolved.length} (entry=${skinLoad.entry.entryPath})`,
      );
      for (const u of sourceBundle.unresolved) {
        gameplayLog.warn(`beatoraja select unresolved source[${u.id}] '${u.path}': ${u.reason}`);
      }
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(skinLoad.entry.entryPath, textures);
    }
    let fonts = this.beatorajaFontCachesByEntry.get(skinLoad.entry.entryPath);
    if (fonts === undefined) {
      const fontDeclarations = normalizeBeatorajaFonts(skinLoad.skin.font);
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath: skinLoad.entry.entryPath,
        fonts: fontDeclarations,
      });
      this.beatorajaFontCachesByEntry.set(skinLoad.entry.entryPath, fonts);
    }

    // Capture the OUTGOING scene's state before disposing so the snapshot is fresh — covers
    // the rare hot-swap case where `showBeatorajaSelect` runs while a scene is already up
    // (e.g. theme reload). Normal PLAY → SELECT flow already captures via `playSongBeatoraja`
    // / `showDecide`, but doing it here defensively ensures the snapshot is never stale.
    if (this.beatorajaSelectScene !== undefined) {
      this.beatorajaSelectSnapshot = this.beatorajaSelectScene.captureSnapshot();
    }
    this.beatorajaSelectScene?.dispose();
    this.beatorajaSelectScene = new PixiBeatorajaSelectScene({
      skin: skinLoad.skin,
      // The page's search field (IME and all) does the typing; the scene only filters.
      externalSearch: true,
      textures,
      fonts,
      skinConfig: config,
      skinAudio: this.beatorajaSkinAudio,
      songs: this.collection.songs,
      ...(this.collection.courseFolders !== undefined ? { courseFolders: this.collection.courseFolders } : {}),
      onCoursePicked: (course: BrowserCourseEntry) => void this.startCourse(course),
      // Pass the collection so the scene's `ChartPreviewEngine` can resolve each focused
      // song's `BrowserSongAssetSource` and play `#PREVIEW` audio (or fall back to in-place
      // chart playback) on cursor settle. Without this, the beatoraja select runs silent on
      // cursor moves — same as the LR2 select did before the preview engine was added.
      collection: this.collection,
      // Theme-bundled navigation cues (cursor / decide / cancel / folder open-close /
      // option-change). Routed through the same `BeatorajaSkinAudioPlayer` the Lua audio_play
      // calls use — that way browsers cap a single AudioContext per scene rather than two.
      systemSoundPaths: this.beatorajaSystemSoundPaths,
      // Looping select-screen background music. Same audio backend as the navigation cues so
      // a single AudioContext mixes them down. The scene starts the loop on enter and stops
      // it on exit; transitioning into decide / play tears it down cleanly.
      selectBgmPath: this.beatorajaSelectBgmPath,
      // The bar's lamp comes from the persisted records every family writes (`lookupSongRecord`), lit through the
      // same lamp rule the other families' selects show.
      resolveSongLampOp: (song) => {
        const record = this.lookupSongRecord(song);
        return record !== undefined ? beatorajaClearLampOp(record.lamp) : undefined;
      },
      // A course bar's lamp comes from the course's record, kept under the course's key.
      resolveCourseLampOp: (course) => {
        const record = lookupCourseRecord(course, this.songRecords);
        return record !== undefined ? beatorajaClearLampOp(record.lamp) : undefined;
      },
      // Decoder for the focused song's chart-bitmap synthetic ids (`-100 STAGEFILE` /
      // `-101 BACKBMP` / `-102 BANNER`). The scene calls this on every focus change and
      // caches by song-id; default beatoraja's select.json paints `-102 BANNER` as the
      // per-song banner inside the chart-info panel.
      decodeChartImages: (song) => this.loadBeatorajaChartImages(song),
      // Restore the last cursor so coming back from gameplay lands on the same song.
      initialIndex: this.beatorajaSelectIndex,
      // Restore richer scene state captured before the previous tear-down — folder /
      // sort / filter / favorites / cursor stack. Takes precedence over `initialIndex` when
      // both are set (snapshot encodes the full position; bare index can't disambiguate
      // root vs. inside-folder). Cleared by `onExit` so a future fresh entry from the empty
      // drop screen starts at root.
      restoreSnapshot: this.beatorajaSelectSnapshot,
      onSongPicked: (song, opts) => {
        if (this.addSongToCourseBeingMade(song)) return;
        // Cache the index using the picked song's identity — survives the scene tear-down.
        this.beatorajaSelectIndex = this.collection.songs.indexOf(song);
        // Same flow as the LR2 select view: route to decide → gameplay. The decide branch in
        // `showDecide` already detects the beatoraja gameplay case and skips its splash.
        // Forward the `autoPlay` override (set by the skin's AUTO PLAY button click → act=16);
        // omitted otherwise so the user's global default applies.
        void this.showDecide(song, { autoPlay: opts?.autoPlay });
      },
      onExit: () => {
        // ESC from the beatoraja select returns to the empty drop screen. Clear the snapshot
        // because the user explicitly left — coming back via a fresh drop or theme reload
        // should start at root, not pick up wherever they were.
        this.elements.shell.classList.add('empty');
        void this.sceneHost.setScene(undefined);
        this.beatorajaSelectScene?.dispose();
        this.beatorajaSelectScene = undefined;
        this.beatorajaSelectSnapshot = undefined;
        this.beatorajaSkinOptionsGui?.clear();
      },
      onReadtextRequest: (song) => {
        // Skin's READTEXT button (act=17 — "readme" / "btn-text" etc.). Find the chart's
        // accompanying `.txt` next to its BMS file and show it in a transient browser dialog.
        // No persistence / styling — just enough to surface chart-author notes.
        void this.showBeatorajaReadtext(song);
      },
      onSkinConfigChange: (next) => {
        // Skin mutated its own config (currently only the `JUDGE_TIMING` button — note offset
        // ±1 ms per click). Persist back into the per-entry cache so the next mount /
        // `replaceSkin` keeps the adjustment, and re-apply through `applyBeatorajaSelectSkinConfig`
        // so the bottom-centre options panel re-renders with the new value.
        this.beatorajaSkinConfigByEntry.set(skinLoad.entry.entryPath, next);
        void this.applyBeatorajaSelectSkinConfig(skinLoad.entry.entryPath, next);
      },
    });
    await this.sceneHost.setScene(this.beatorajaSelectScene);
    this.setStatus(`Select (beatoraja): ${this.collection.songs.length} song(s)`);

    // Build the bottom-centre skin-options panel for this select skin's `property[]` / `filepath[]`.
    // User picks flow back through `onApply` → live `replaceSkin` on the active scene so chrome
    // changes (Play Side, Score Graph On/Off, etc.) take effect on the very next Pixi frame
    // without disposing / re-mounting the scene.
    this.refreshBeatorajaSkinOptionsGui({
      title: 'Skin Config (Select)',
      entryPath: selectedEntry.entryPath,
      header: headerLoad.header,
      onApply: (nextConfig) => {
        void this.applyBeatorajaSelectSkinConfig(selectedEntry.entryPath, nextConfig);
      },
    });
  }

  /**
   * Find the focused song's accompanying README / notes text and surface it in a transient
   * overlay. Searches the song's source for a `.txt` file in the same directory as the chart
   * (BMS convention: `myhardchart.bms` ↔ `myhardchart.txt` / `readme.txt` / etc.). When more
   * than one matches, picks alphabetically — chart-authors typically only ship one.
   *
   * The overlay is a lightweight `<dialog>` injected at runtime — no persistent UI, click
   * outside or hit Escape to dismiss. Falls back to a `console.log` notice when no `.txt` is
   * found so the user has a hint that the chart didn't ship readtext content.
   */
  private async showBeatorajaReadtext(song: BrowserSongEntry): Promise<void> {
    const source = resolveSongSource(this.collection, song);
    if (source === undefined) {
      gameplayLog.info('beatoraja readtext: source not found', { songId: song.id });
      return;
    }
    const chartDir = song.chartPath.includes('/') ? song.chartPath.slice(0, song.chartPath.lastIndexOf('/')) : '';
    // Match `.txt` files inside the chart's folder (or root when the chart is at the top).
    const textPaths: string[] = [];
    for (const path of source.files.keys()) {
      const lower = path.toLowerCase();
      if (!lower.endsWith('.txt')) continue;
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (dir.toLowerCase() !== chartDir.toLowerCase()) continue;
      textPaths.push(path);
    }
    textPaths.sort();
    const textPath = textPaths[0];
    if (textPath === undefined) {
      gameplayLog.info('beatoraja readtext: no .txt found', { dir: chartDir });
      return;
    }
    const entry = source.files.get(textPath);
    if (entry === undefined) return;
    const bytes = await loadAssetBytes(entry);
    if (bytes === undefined) return;
    // BMS-era authors typically ship Shift_JIS-encoded text. Try the BOM-aware UTF-8 first;
    // fall back to a Shift_JIS decode when the result contains replacement characters.
    let text = decodeText(bytes, 'utf-8');
    if (text.includes('�')) {
      try {
        text = decodeText(bytes, 'shift_jis');
      } catch {
        // some browsers don't expose 'shift_jis' decoder; keep the UTF-8 best-effort.
      }
    }
    showReadtextOverlay({
      title: `${song.title}${song.artist ? ` — ${song.artist}` : ''}`,
      filename: textPath.split('/').pop() ?? textPath,
      body: text,
    });
  }

  /**
   * Decode the focused chart's `#STAGEFILE` / `#BACKBMP` / `#BANNER` bitmaps to Pixi textures
   * for the beatoraja decide scene's synthetic-id destinations (`-100` / `-101` / `-102`).
   * Each entry is best-effort — missing or malformed bitmaps resolve to `undefined` and the
   * matching destinations stay hidden. Uses the same `loadTextureFromBytes` decoder the LR2
   * scenes use, so TGA / PNG / BMP / JPG all work transparently.
   */
  private async loadBeatorajaChartImages(song: BrowserSongEntry): Promise<{
    stageFile?: ChartImageTexture;
    backBmp?: ChartImageTexture;
    banner?: ChartImageTexture;
  }> {
    const source = resolveSongSource(this.collection, song);
    if (source === undefined) return {};
    const meta = song.chart.metadata;
    const out: { stageFile?: ChartImageTexture; backBmp?: ChartImageTexture; banner?: ChartImageTexture } = {};
    const decode = async (relPath: string | undefined): Promise<ChartImageTexture | undefined> => {
      if (relPath === undefined || relPath.length === 0) return undefined;
      // Resolve relative to the chart's directory — `#STAGEFILE foo.png` lives next to the BMS
      // unless the path starts with `/`. We strip any leading slash and join under the chart's
      // dirname for the lookup.
      const chartDir = song.chartPath.includes('/') ? song.chartPath.slice(0, song.chartPath.lastIndexOf('/')) : '';
      const normalized = relPath.replace(/^\/+/, '');
      const candidates = [chartDir.length > 0 ? `${chartDir}/${normalized}` : normalized, normalized];
      for (const candidate of candidates) {
        const entry = source.files.get(candidate);
        if (entry === undefined) continue;
        const bytes = await loadAssetBytes(entry);
        if (bytes === undefined) continue;
        try {
          return await loadTextureFromBytes(candidate, bytes);
        } catch (error) {
          gameplayLog.info('beatoraja decide chart-image decode failed', { path: candidate, error });
          return undefined;
        }
      }
      return undefined;
    };
    const [stageFile, backBmp, banner] = await Promise.all([
      decode(meta.stageFile),
      decode(meta.backBmp),
      decode(meta.banner),
    ]);
    if (stageFile !== undefined) out.stageFile = stageFile;
    if (backBmp !== undefined) out.backBmp = backBmp;
    if (banner !== undefined) out.banner = banner;
    return out;
  }

  /**
   * Apply a fresh skin-config to the active beatoraja select scene WITHOUT disposing / re-mounting.
   * Re-runs the skin's Lua `main()` (or re-parses the JSON) with the new options, refreshes the
   * texture cache (Lua skins emit different `source[]` lists per option set), then calls
   * `replaceSkin` on the live scene.
   */
  private async applyBeatorajaSelectSkinConfig(entryPath: string, config: BeatorajaSkinConfig): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (!bundle || !this.beatorajaSelectScene) return;
    // Load the SPECIFIC entry — different from the discovery's "best" pick when the user picked an
    // alternate skin from the Debug Menu's skin-picker dropdown.
    const result = loadBeatorajaSkin({ entryPath, files: bundle.files, skinConfig: config });
    if (!result.ok || !result.skin) return;
    // Drop and re-decode the texture cache for this entry — option changes can alter `source[]`.
    this.beatorajaTextureCachesByEntry.delete(entryPath);
    const sourceBundle = bundleBeatorajaSources({
      files: bundle.files,
      entryPath,
      sources: (result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
      filepathSchema: result.skin.filepath,
      filepathOverrides: config.file,
    });
    const textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
    this.beatorajaTextureCachesByEntry.set(entryPath, textures);
    let fonts = this.beatorajaFontCachesByEntry.get(entryPath);
    if (fonts === undefined) {
      // Per-entry font cache miss — fonts may differ between skins, so load fresh for this entry.
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath,
        fonts: normalizeBeatorajaFonts(result.skin.font),
      });
      this.beatorajaFontCachesByEntry.set(entryPath, fonts);
    }
    this.beatorajaSelectScene.replaceSkin({ skin: result.skin, skinConfig: config, textures, fonts });

    // Refresh the skin-options panel against the new entry's header so the property dropdowns
    // reflect the new skin's `property[]` schema.
    this.refreshBeatorajaSkinOptionsGui({
      title: 'Skin Config (Select)',
      entryPath,
      header: result.header,
      onApply: (nextConfig) => {
        void this.applyBeatorajaSelectSkinConfig(entryPath, nextConfig);
      },
    });
  }

  /**
   * Mount the beatoraja decide splash for `song`. Returns `true` when the splash actually mounted —
   * `false` falls through to the no-decide fast-path (the loaded theme didn't ship a decide skin,
   * the entry's header / payload failed to load, etc.). Both branches eventually call
   * `playSongBeatoraja`; the difference is whether the user sees an animated chrome between
   * select and gameplay.
   */
  private async showBeatorajaDecide(
    song: BrowserSongEntry,
    overrides: { autoPlay?: boolean },
    then?: DecideContinuation,
  ): Promise<boolean> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return false;

    // Decide skin discovery — same shape as select / play. Picks the user's override when set,
    // otherwise the discovery's "best" pick (`theme.decideSkin`). Falling back to
    // `decideCandidates[0]` here was the previous behaviour and a bug: that's whatever
    // happens to come first in the file-walk iteration order, NOT the preferred entry. So
    // when the user picked the discovery default in the Debug Menu (which CLEARS the
    // override per `rebuildBeatorajaSkinPickers`), the next decide mount fell back to
    // `decideCandidates[0]` and silently mounted whichever theme the file map iterated
    // first (typically GdbG_Skin instead of the requested default). The Debug Menu's
    // dropdown showed the right name but the wrong skin actually loaded.
    const decideCandidates = bundle.theme.entries.filter((entry) => entry.header.type === BEATORAJA_SKIN_TYPE.DECIDE);
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      BEATORAJA_SKIN_TYPE.DECIDE,
      decideCandidates,
      bundle.theme.decideSkin,
    );
    if (selectedEntry === undefined) return false;

    // Two-pass evaluation — same `loadBeatorajaSkin` contract as select / play. The first pass
    // gives us the header (used for `property[]` dropdown); the second runs the skin's `main()`
    // with the resolved option set so dynamic destinations populate. The phase-2 eval also
    // gets a `runtimeContext` populated with the chart's difficulty ops so themes that
    // pre-compute per-difficulty values at load time (e.g. ModernChic's
    // `CUSTOM.NUM.diffRGB()`) see a non-`nil` answer instead of crashing on `RGB[1]`.
    const headerLoad = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files });
    if (!headerLoad.ok) {
      gameplayLog.warn(`beatoraja decide: ${headerLoad.error.message}`);
      return false;
    }
    const config = this.resolveBeatorajaSkinConfig(selectedEntry.entryPath, headerLoad.header);
    const result = loadBeatorajaSkin({
      entryPath: selectedEntry.entryPath,
      files: bundle.files,
      skinConfig: config,
      runtimeContext: this.buildBeatorajaSkinLoadContext(song, config),
    });
    if (!result.ok || !result.skin) {
      const reason = result.ok ? 'skin payload missing' : result.error.message;
      gameplayLog.warn(`beatoraja decide: ${reason}`);
      return false;
    }

    // Texture + font cache lookup — reuse existing entries, decode + register fresh ones.
    let textures = this.beatorajaTextureCachesByEntry.get(selectedEntry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: selectedEntry.entryPath,
        sources: (result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
        filepathSchema: result.skin.filepath,
        filepathOverrides: config.file,
      });
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(selectedEntry.entryPath, textures);
    }
    let fonts = this.beatorajaFontCachesByEntry.get(selectedEntry.entryPath);
    if (fonts === undefined) {
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath: selectedEntry.entryPath,
        fonts: normalizeBeatorajaFonts(result.skin.font),
      });
      this.beatorajaFontCachesByEntry.set(selectedEntry.entryPath, fonts);
    }

    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    // Capture the select scene's state before disposing — the user picked a song and is
    // heading into decide → play. When they come back via the result scene's "back to
    // select" path we re-mount with this snapshot so they land in the same folder / cursor /
    // sort / filter / favorites state, not at the root with default sort.
    if (this.beatorajaSelectScene !== undefined) {
      this.beatorajaSelectSnapshot = this.beatorajaSelectScene.captureSnapshot();
    }
    this.beatorajaSelectScene?.dispose();
    this.beatorajaSelectScene = undefined;
    this.beatorajaDecideScene?.dispose();

    // Resolve `#IF` / `#RANDOM` once at decide entry so the decide skin's bpmgraph plots the SAME branches the
    // gameplay scene will play. The resolution (chart + draws) is cached on the demo and handed to
    // `prepareBeatorajaGameplayChart` as `preResolved` by `playSongBeatoraja`, so nothing draws a second time.
    const resolved = resolvePlayChart(song.chart);
    const resolvedChart = resolved.chart;
    // A course resolves each stage's chart itself when the stage starts.
    if (then === undefined) this.lastBeatorajaChart = { resolved, chartPath: song.chartPath };

    // Idempotency gate — `onContinue` and the auto-advance timer can race in theory; whichever
    // lands first wins. Same pattern as the LR2 decide path.
    let advanced = false;
    const advance = (then: () => void): void => {
      if (advanced) return;
      advanced = true;
      then();
    };

    // Resolve the chart's #STAGEFILE / #BACKBMP / #BANNER bitmaps to Pixi textures so the
    // decide skin's synthetic-id destinations (-100 / -101 / -102) can paint them. Loading is
    // best-effort — missing bitmaps just leave the matching destinations hidden.
    const chartImages = await this.loadBeatorajaChartImages(song);

    this.beatorajaDecideScene = new PixiBeatorajaDecideScene({
      skin: result.skin,
      textures,
      fonts,
      // Pass the resolved chart so the decide skin's bpmgraph element (when authored) plots the
      // BPM curve of the about-to-play chart.
      chart: resolvedChart,
      skinConfig: config,
      song,
      chartImages,
      bgmBytes: this.beatorajaThemeBgm.decide,
      skinAudio: this.beatorajaSkinAudio,
      onContinue: () =>
        advance(() => {
          // Drop the decide scene first so the gameplay scene gets a clean stage. `playSongBeatoraja`
          // handles the rest — host mount, audio prep, skin selection, etc.
          void this.sceneHost.setScene(undefined).then(() => {
            this.beatorajaDecideScene?.dispose();
            this.beatorajaDecideScene = undefined;
            // Through `playSong`, so the gameplay family is picked as on every other path (the decide skin's family
            // need not be the play's).
            void (then !== undefined ? then.start() : this.playSong(song, overrides));
          });
        }),
      onCancel: () =>
        advance(() => {
          // ESC from the splash returns to select — same fallback as LR2.
          void this.sceneHost.setScene(undefined).then(() => {
            this.beatorajaDecideScene?.dispose();
            this.beatorajaDecideScene = undefined;
            then?.cancel?.();
            void this.showSelect();
          });
        }),
    });
    await this.sceneHost.setScene(this.beatorajaDecideScene);
    this.setStatus(`Decide (beatoraja): ${song.title}`);
    return true;
  }

  /**
   * Mount the beatoraja result scene for `song` against the chart's final `summary`. Returns
   * `true` when the scene actually mounted — `false` falls through to the no-result fast-path
   * (no result skin in the bundle, or skin load failed). Same shape as `showBeatorajaDecide`.
   */
  private async showBeatorajaResult(
    song: BrowserSongEntry,
    summary: PlayerSummary,
    maxCombo: number,
    history: {
      scoreHistory: ReadonlyArray<{ progress: number; exScore: number }>;
      gaugeHistory: ReadonlyArray<{ progress: number; value: number }>;
      timingHistory: ReadonlyArray<{ deltaMs: number; kind: string }>;
    },
    course?: { info: SceneCourseInfo; result?: boolean },
  ): Promise<boolean> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return false;
    // The course result (`course.result`) shows on the theme's COURSE_RESULT skin, falling back to its result skin.
    const courseResult = course?.result === true;

    // Same fix as decide — fall back to the discovery's `theme.resultSkin` rather than
    // `resultCandidates[0]` (= file-walk iteration order), so picking the discovery default
    // in the Debug Menu (which clears the override) actually mounts the discovery default
    // instead of silently picking whatever theme happens to iterate first.
    const resultType =
      courseResult && bundle.theme.courseResultSkin !== undefined
        ? BEATORAJA_SKIN_TYPE.COURSE_RESULT
        : BEATORAJA_SKIN_TYPE.RESULT;
    const resultCandidates = bundle.theme.entries.filter((entry) => entry.header.type === resultType);
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      resultType,
      resultCandidates,
      resultType === BEATORAJA_SKIN_TYPE.COURSE_RESULT ? bundle.theme.courseResultSkin : bundle.theme.resultSkin,
    );
    if (selectedEntry === undefined) return false;

    const headerLoad = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files });
    if (!headerLoad.ok) {
      gameplayLog.warn(`beatoraja result: ${headerLoad.error.message}`);
      return false;
    }
    const config = this.resolveBeatorajaSkinConfig(selectedEntry.entryPath, headerLoad.header);
    // Phase-2 eval gets the chart's difficulty ops via `runtimeContext` so result themes that
    // pre-compute per-difficulty values at load time (mirroring the decide path's
    // ModernChic-style `diffRGB()` pattern) don't crash on `nil` indexing.
    const result = loadBeatorajaSkin({
      entryPath: selectedEntry.entryPath,
      files: bundle.files,
      skinConfig: config,
      runtimeContext: this.buildBeatorajaSkinLoadContext(song, config),
    });
    if (!result.ok || !result.skin) {
      const reason = result.ok ? 'skin payload missing' : result.error.message;
      gameplayLog.warn(`beatoraja result: ${reason}`);
      return false;
    }

    let textures = this.beatorajaTextureCachesByEntry.get(selectedEntry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: selectedEntry.entryPath,
        sources: (result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
        filepathSchema: result.skin.filepath,
        filepathOverrides: config.file,
      });
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(selectedEntry.entryPath, textures);
    }
    let fonts = this.beatorajaFontCachesByEntry.get(selectedEntry.entryPath);
    if (fonts === undefined) {
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath: selectedEntry.entryPath,
        fonts: normalizeBeatorajaFonts(result.skin.font),
      });
      this.beatorajaFontCachesByEntry.set(selectedEntry.entryPath, fonts);
    }

    await this.ensureHostMounted();
    this.beatorajaResultScene?.dispose();

    // Decode the chart's #STAGEFILE / #BACKBMP / #BANNER bitmaps so the result skin's
    // synthetic-id destinations (-100 / -101 / -102) can paint them. Reuses the same loader
    // as decide / play so all three scenes share one decoder path.
    const chartImages = await this.loadBeatorajaChartImages(song);

    let dismissed = false;
    // R on the result plays the same chart again — only offered when the recorded play start is this chart's, and
    // never in a course (beatoraja disables quick retry there).
    const retry = course === undefined && this.lastPlay?.song.id === song.id ? this.lastPlay : undefined;
    const cleared = summary.gauge?.cleared ?? false;
    this.beatorajaResultScene = new PixiBeatorajaResultScene({
      skin: result.skin,
      textures,
      fonts,
      skinConfig: config,
      song,
      // Pass the just-played chart so any `bpmgraph[]` element in the result skin can plot the
      // chart's BPM curve. The prep bundle is disposed at gameplay teardown, so the chart
      // reference is snapshot into `lastBeatorajaChart` for use here. We only forward when the
      // cached chart matches the song the result scene is rendering — otherwise the bpmgraph
      // would plot the wrong chart's BPM curve.
      chart:
        !courseResult && this.lastBeatorajaChart?.chartPath === song.chartPath
          ? this.lastBeatorajaChart.resolved.chart
          : undefined,
      summary,
      maxCombo,
      scoreHistory: history.scoreHistory,
      gaugeHistory: history.gaugeHistory,
      timingHistory: history.timingHistory,
      chartImages,
      // Pick the outcome-specific jingle when one was discovered, falling back to the generic
      // `result` slot. Beatoraja themes that ship a single result BGM authoredit as `result.*`,
      // while themes that distinguish clear / fail (most reference themes) ship dedicated tracks.
      // The course result plays `course_clear` / `course_fail`, falling back to the result ones as beatoraja does.
      bgmBytes:
        (courseResult
          ? cleared
            ? this.beatorajaThemeBgm.courseClear
            : this.beatorajaThemeBgm.courseFail
          : undefined) ??
        (cleared ? this.beatorajaThemeBgm.clear : this.beatorajaThemeBgm.fail) ??
        this.beatorajaThemeBgm.result,
      ...(course !== undefined ? { courseInfo: course.info } : {}),
      skinAudio: this.beatorajaSkinAudio,
      onContinue: () => {
        if (dismissed) return;
        dismissed = true;
        void this.sceneHost.setScene(undefined).then(() => {
          this.beatorajaResultScene?.dispose();
          this.beatorajaResultScene = undefined;
          if (!courseResult && this.continueCourse()) return;
          void this.showSelect();
        });
      },
      ...(retry !== undefined
        ? {
            onRetry: () => {
              if (dismissed) return;
              dismissed = true;
              void this.sceneHost.setScene(undefined).then(() => {
                this.beatorajaResultScene?.dispose();
                this.beatorajaResultScene = undefined;
                void this.playSong(retry.song, retry.overrides);
              });
            },
          }
        : {}),
    });
    await this.sceneHost.setScene(this.beatorajaResultScene);
    this.setStatus(
      `Result (beatoraja): ${courseResult ? course!.info.title : song.title} · score=${summary.score} ex=${summary.exScore} maxCombo=${maxCombo}`,
    );
    return true;
  }

  /**
   * Record an in-scene skin override and sync the Debug Menu dropdown's displayed value so the
   * two surfaces stay consistent. Called from the in-scene `BeatorajaSkinOptionsGui` callbacks
   * (the popup the user opens with the skin's authored "options" button); the Debug Menu's own
   * dropdown writes the override directly because its `onChange` is the source.
   *
   * Pass `entryPath = undefined` to clear the override (= fall back to the theme's discovery
   * default). The picker dropdown also resets to the default option in that case.
   */
  private setBeatorajaSkinOverride(typeCode: number, entryPath: string | undefined): void {
    if (entryPath === undefined) {
      this.beatorajaSkinOverridesByType.delete(typeCode);
    } else {
      this.beatorajaSkinOverridesByType.set(typeCode, entryPath);
    }
    // Mirror the change onto the Debug Menu dropdown when one exists for this type. lil-gui's
    // `setValue` writes to the underlying proxy AND repaints the option list to highlight the
    // matching entry; without this the dropdown would still show the previous selection until
    // the next `rebuildBeatorajaSkinPickers` call (= next theme drop).
    const controller = this.beatorajaSkinPickerControllers.get(typeCode);
    if (controller !== undefined) {
      const fallbackPath = this.beatorajaTheme?.theme.entries.find((e) => e.header.type === typeCode)?.entryPath;
      controller.setValue(entryPath ?? fallbackPath ?? '');
    }
  }

  /**
   * Pick the actual skin entry to mount for a scene, honoring the user's override when one was
   * recorded. Falls back to `fallback` (the discovery's "best" pick) when no override exists or
   * when the override no longer points at a valid entry (e.g., the user dropped a different theme).
   */
  private pickBeatorajaSkinEntryWithOverride(
    typeCode: number,
    candidates: ReadonlyArray<BeatorajaSkinEntry>,
    fallback: BeatorajaSkinEntry | undefined,
  ): BeatorajaSkinEntry | undefined {
    const override = this.beatorajaSkinOverridesByType.get(typeCode);
    if (override !== undefined) {
      const found = candidates.find((entry) => entry.entryPath === override);
      if (found !== undefined) return found;
      // Override stale (theme rotated) — drop it so the fallback takes over.
      this.beatorajaSkinOverridesByType.delete(typeCode);
    }
    return fallback;
  }

  /**
   * Repopulate the "Beatoraja skins" debug-menu folder with one dropdown per scene type that the
   * loaded theme actually ships an entry for. Called from `loadBeatorajaTheme` after each drop,
   * so the dropdowns always reflect the live `beatorajaTheme.entries` list.
   *
   * Each dropdown:
   *   - shows the scene's "best" entry (from theme discovery) as the default — selecting a
   *     different option sets `beatorajaSkinOverridesByType` and the next scene mount uses it
   *     via {@link pickBeatorajaSkinEntryWithOverride}.
   *   - labels options by `${header.name} (${entryPath})` so the user can disambiguate same-
   *     named skins from different folders.
   *   - is omitted entirely for scene types the loaded theme doesn't ship at all (so the panel
   *     stays compact). Single-entry types still get a dropdown so the user can see at a glance
   *     which file is mounted.
   */
  private rebuildBeatorajaSkinPickers(): void {
    const folder = this.beatorajaSkinPickerFolder;
    if (folder === undefined) return;
    // Tear down previous controllers so dropdown options match the current theme bundle. lil-gui
    // doesn't support live-updating an `add(target, prop, options)` controller's option list, so
    // recreating each time is the safe path.
    for (const controller of this.beatorajaSkinPickerControllers.values()) {
      controller.destroy();
    }
    this.beatorajaSkinPickerControllers.clear();
    const theme = this.beatorajaTheme?.theme;
    // Shown only while a beatoraja theme is loaded; an empty folder header would just be noise.
    folder.show(theme !== undefined);
    if (theme === undefined) return;
    // Order matters here — the folder lays controllers out in insertion order, so we keep the
    // play-variant types together (clustered by key count), then chrome scenes (select / decide
    // / result / etc.) below them.
    const sceneTypes: ReadonlyArray<{ typeCode: number; label: string; best?: BeatorajaSkinEntry }> = [
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_5KEYS, label: 'Play 5K', best: theme.playSkins['5'] },
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_7KEYS, label: 'Play 7K', best: theme.playSkins['7'] },
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_9KEYS, label: 'Play 9K', best: theme.playSkins['9'] },
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_10KEYS, label: 'Play 10K', best: theme.playSkins['10'] },
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_14KEYS, label: 'Play 14K', best: theme.playSkins['14'] },
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_24KEYS, label: 'Play 24K', best: theme.playSkins['24'] },
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_24KEYS_DOUBLE, label: 'Play 24K DP', best: theme.playSkins['24d'] },
      { typeCode: BEATORAJA_SKIN_TYPE.MUSIC_SELECT, label: 'Music Select', best: theme.selectSkin },
      { typeCode: BEATORAJA_SKIN_TYPE.DECIDE, label: 'Decide', best: theme.decideSkin },
      { typeCode: BEATORAJA_SKIN_TYPE.RESULT, label: 'Result', best: theme.resultSkin },
      { typeCode: BEATORAJA_SKIN_TYPE.COURSE_RESULT, label: 'Course Result', best: theme.courseResultSkin },
    ];
    for (const scene of sceneTypes) {
      const candidates = theme.entries.filter((entry) => entry.header.type === scene.typeCode);
      if (candidates.length === 0) continue;
      // Build a label → entryPath map. lil-gui shows the keys in the dropdown and writes the
      // matching value to the proxy. Using entryPath as the value lets us look up the entry on
      // change without keeping a separate index.
      const options: Record<string, string> = {};
      for (const entry of candidates) {
        const name = entry.header.name?.length ? entry.header.name : '(unnamed)';
        const label = `${name} (${entry.entryPath})`;
        options[label] = entry.entryPath;
      }
      // The proxy holds the currently-selected entryPath. Default to the discovery's best pick
      // so the dropdown reflects what would actually mount if no override is set.
      const proxy = { entryPath: scene.best?.entryPath ?? candidates[0]!.entryPath };
      const controller = folder
        .add(proxy, 'entryPath', options)
        .name(`${scene.label} (${candidates.length})`)
        .onChange((nextEntryPath: string) => {
          if (scene.best !== undefined && nextEntryPath === scene.best.entryPath) {
            // Picking the discovery default = "no override" — drop any prior override so future
            // theme rotations pick up the new "best" automatically.
            this.beatorajaSkinOverridesByType.delete(scene.typeCode);
          } else {
            this.beatorajaSkinOverridesByType.set(scene.typeCode, nextEntryPath);
          }
          // Live-apply: if the user's pick matches the currently-mounted scene type, re-mount it
          // immediately against the new entry. Without this the Debug Menu only takes effect on
          // the NEXT scene transition, which felt broken to the user (drop a theme, pick a skin,
          // nothing visible until you ESC and re-enter the scene).
          this.applyBeatorajaSkinSwitchIfActive(scene.typeCode, nextEntryPath, candidates);
        });
      this.beatorajaSkinPickerControllers.set(scene.typeCode, controller);
    }
  }

  /**
   * If the active scene's type-code matches `typeCode`, re-mount it against `entryPath`. Invoked
   * by the Debug Menu's skin-picker dropdown (the canonical surface for switching skins —
   * the bottom-centre `BeatorajaSkinOptionsGui` only exposes the picked skin's authored
   * `property[]` / `filepath[]` schema, not the picker itself). No-op when no matching scene is
   * active (e.g., user picks a Decide skin while the Select scene is on screen — the override
   * still gets recorded by the caller for the next mount, but nothing visible changes now).
   *
   * `candidates` carries the dropdown's source list so we can recover the entry's `header` for
   * config-defaults seeding without re-loading the skin to read it back. The header is also
   * needed by `applyBeatoraja*SkinConfig` indirectly via the cached config map.
   */
  private applyBeatorajaSkinSwitchIfActive(
    typeCode: number,
    entryPath: string,
    candidates: ReadonlyArray<BeatorajaSkinEntry>,
  ): void {
    const matched = candidates.find((entry) => entry.entryPath === entryPath);
    if (matched === undefined) return;
    const config = this.resolveBeatorajaSkinConfig(entryPath, matched.header);
    if (typeCode === BEATORAJA_SKIN_TYPE.MUSIC_SELECT && this.beatorajaSelectScene !== undefined) {
      void this.applyBeatorajaSelectSkinConfig(entryPath, config);
      return;
    }
    if (
      this.beatorajaGameplayView !== undefined &&
      this.currentBeatorajaPlayVariant !== undefined &&
      playSkinTypeForVariant(this.currentBeatorajaPlayVariant) === typeCode
    ) {
      void this.applyBeatorajaPlaySkinConfig(entryPath, this.currentBeatorajaPlayVariant, config);
    }
  }

  /**
   * Pick the cached skin config for an entry — falling back to a fresh defaults-fill from the
   * header's `property[]` schema. Mutating the returned object directly mutates the cache, but the
   * skin-options panel emits fresh copies on change so the cached state never becomes accidentally
   * shared with downstream consumers.
   */
  /**
   * Build a `BeatorajaLuaRuntimeContext` for skin-load time so themes that compute values via
   * `main_state.option(...)` inside `main()` see chart-aware ops. Without this:
   *
   *   ModernChic decide.lua's `lockonAnimation` calls `CUSTOM.NUM.diffRGB()` which does
   *   `main_state.option(MAIN.OP.DIFFICULTY1..)` → returns false → falls through to `nil` →
   *   `RGB[1]` index crashes the entire `main()` evaluation → the load fails silently and
   *   `showBeatorajaDecide` returns false (= the user's reported "no decide animation,
   *   the scene jumps straight to PLAY" symptom).
   *
   * The context's `option` reflects the same op set the scene would compute on mount, so any
   * pre-computed RGB / position / asset choice the skin makes at load time matches what would
   * render anyway. Surfacing the chart's difficulty + skin_config option picks is enough to
   * unblock the surveyed cases (ModernChic decide / result); other accessors stay
   * \`undefined\` and fall through to the stub defaults.
   */
  private buildBeatorajaSkinLoadContext(
    song: BrowserSongEntry | undefined,
    skinConfig: BeatorajaSkinConfig,
  ): BeatorajaLuaRuntimeContext {
    const ops = new Set(buildBaseOpSet(skinConfig.option));
    const difficulty = song?.chart.metadata.difficulty;
    switch (difficulty) {
      case 1:
        ops.add(BEATORAJA_OP.LEVEL_BEGINNER);
        ops.add(BEATORAJA_OP.DIFFICULTY_BEGINNER);
        break;
      case 2:
        ops.add(BEATORAJA_OP.LEVEL_NORMAL);
        ops.add(BEATORAJA_OP.DIFFICULTY_NORMAL);
        break;
      case 3:
        ops.add(BEATORAJA_OP.LEVEL_HYPER);
        ops.add(BEATORAJA_OP.DIFFICULTY_HYPER);
        break;
      case 4:
        ops.add(BEATORAJA_OP.LEVEL_ANOTHER);
        ops.add(BEATORAJA_OP.DIFFICULTY_ANOTHER);
        break;
      case 5:
        ops.add(BEATORAJA_OP.LEVEL_INSANE);
        ops.add(BEATORAJA_OP.DIFFICULTY_INSANE);
        break;
      default:
        ops.add(BEATORAJA_OP.DIFFICULTY_UNDEFINED);
        break;
    }
    const audio = this.beatorajaSkinAudio;
    return {
      option: (id) => ops.has(id),
      // Wire `main_state.audio_play / audio_loop / audio_stop` to the theme-bundle audio
      // player. ModernChic's `Root/customsound.lua` calls these from every panel-toggle /
      // song-change / confirm — without them the menu UI feels dead even though the eval
      // doesn't crash. Each callback returns false when the player isn't constructed (no
      // theme bundle yet) so the Lua side gracefully no-ops.
      audioPlay: audio === undefined ? undefined : (path, vol) => audio.play(path, vol),
      audioLoop: audio === undefined ? undefined : (path, vol) => audio.loop(path, vol),
      audioStop: audio === undefined ? undefined : (path) => audio.stop(path),
    };
  }

  private resolveBeatorajaSkinConfig(entryPath: string, header: BeatorajaSkinHeader): BeatorajaSkinConfig {
    let cached = this.beatorajaSkinConfigByEntry.get(entryPath);
    if (cached === undefined) {
      // Seed both `option` (from `property[].def`) AND `file` (from `filepath[].def`). Earlier
      // `file` started empty, which made the wildcard fallback inside `resolveSourcePath` pick
      // whichever filename happened to sort first instead of the author's authored default —
      // ModernChic's `key` filepath got `#default.png` instead of the intended `harf.png`,
      // its `bomb` filepath got `Kakabomb.png` instead of `diamond SCUROed..png`, etc.
      // `buildDefaultSkinConfigFiles` resolves each `filepath[].def` against the wildcard's
      // match set so first-time mounts pick the author-intended file rather than a sort-order
      // accident. The bundle's `files` map is the same one `loadBeatorajaSkin` consumed, so
      // the wildcard expansion sees identical candidates either way.
      const file =
        this.beatorajaTheme !== undefined
          ? buildDefaultSkinConfigFiles(header, this.beatorajaTheme.files, entryPath)
          : {};
      // `customOffset` starts empty — the GUI's per-slot zero-fill happens at panel build
      // time. Storing the empty object explicitly here means the config shape stays
      // consistent across the cache vs. the GUI emit path (both have a `customOffset` key,
      // even if empty), which keeps spread / deep-clone snapshots free of surprises.
      cached = { offset: 0, option: buildDefaultSkinConfigOptions(header), file, customOffset: {} };
      this.beatorajaSkinConfigByEntry.set(entryPath, cached);
    }
    return cached;
  }

  /**
   * Pre-resolve `filepath[]` candidate lists for the skin-options panel. Each entry's `path` field
   * is a wildcard relative to the skin directory; `expandBeatorajaWildcard` walks the dropped file
   * map and returns every match. The panel hands these to lil-gui as dropdown options so the user
   * can pick a specific file by name rather than guessing.
   */
  private collectBeatorajaFileCandidates(
    entryPath: string,
    header: BeatorajaSkinHeader,
  ): ReadonlyMap<string, ReadonlyArray<string>> {
    const map = new Map<string, ReadonlyArray<string>>();
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return map;
    for (const fp of header.filepath ?? []) {
      const matches = expandBeatorajaWildcard(bundle.files, entryPath, fp.path);
      map.set(fp.name, matches);
    }
    return map;
  }

  /**
   * Lazily instantiate the skin-options panel. Deferred from the constructor because the demo shell
   * (the parent the panel attaches to) doesn't exist until `app.innerHTML` materializes.
   */
  private ensureBeatorajaSkinOptionsGui(): BeatorajaSkinOptionsGui {
    if (this.beatorajaSkinOptionsGui === undefined) {
      this.beatorajaSkinOptionsGui = new BeatorajaSkinOptionsGui({ container: this.elements.shell });
    }
    return this.beatorajaSkinOptionsGui;
  }

  /**
   * Update the bottom-centre skin-options panel for a freshly-mounted beatoraja scene. Subsequent
   * user changes flow back through `onChange` → cache update → scene re-mount.
   *
   * Skin selection itself is handled by the Debug Menu, not this panel — the demo's
   * `setBeatorajaSkinOverride` + `applyBeatorajaPlaySkinConfig` cascade is invoked from there.
   */
  private refreshBeatorajaSkinOptionsGui(args: {
    title: string;
    entryPath: string;
    header: BeatorajaSkinHeader;
    onApply: (updatedConfig: BeatorajaSkinConfig) => void;
  }): void {
    const config = this.resolveBeatorajaSkinConfig(args.entryPath, args.header);
    const candidates = this.collectBeatorajaFileCandidates(args.entryPath, args.header);
    const gui = this.ensureBeatorajaSkinOptionsGui();
    gui.setSkin({
      title: args.title,
      // Forward the entry's stable path so `setSkin` can short-circuit when the same skin entry
      // is being reapplied (the round-trip after every controller tweak). Without this the GUI
      // tears down and rebuilds on every value change, snapping the panel back to its
      // initial collapsed state mid-edit.
      entryPath: args.entryPath,
      header: args.header,
      config,
      fileCandidates: candidates,
      onChange: (next) => {
        // Persist and notify the caller so it can re-mount the active scene with the new config.
        this.beatorajaSkinConfigByEntry.set(args.entryPath, next);
        args.onApply(next);
      },
    });
  }

  /** Tear down the active beatoraja gameplay view + its prep bundle. Idempotent. */
  private disposeBeatorajaGameplay(): void {
    this.beatorajaGameplayView?.dispose();
    this.beatorajaGameplayView = undefined;
    this.currentBeatorajaPlayVariant = undefined;
    if (this.beatorajaGameplayPrep) {
      // Refresh the cached chart with whatever the prep ended up using — this preserves the
      // `chartPath ⇒ chart` association even on the rare path where the prep had to fall back to
      // a fresh resolve (e.g. gameplay reached without going through decide). The audio / BGA
      // resources owned by `prep` still get released by `dispose()`.
      // Stamped with the path the prep was made for, never the previous cache's: a course stage of another chart must
      // not leave its chart under that chart's path.
      const chartPath = this.beatorajaGameplayPrepChartPath;
      if (chartPath !== undefined) {
        const { chart, randomDraws } = this.beatorajaGameplayPrep;
        this.lastBeatorajaChart = { resolved: { chart, randomDraws }, chartPath };
      }
      void this.beatorajaGameplayPrep.dispose();
      this.beatorajaGameplayPrep = undefined;
      this.beatorajaGameplayPrepChartPath = undefined;
    }
  }

  /** Sequence beatoraja-gameplay teardown → caller-supplied transition (mirrors `finishGameplayThen`). */
  private async finishBeatorajaGameplayThen(then: () => void | Promise<void>): Promise<void> {
    // As `finishGameplayThen`: an in-flight recording is saved before the scene (and its AudioContext) goes away.
    await finalizeRecordingIfActive(this.recordingDeps());
    await this.sceneHost.setScene(undefined);
    this.disposeBeatorajaGameplay();
    await then();
  }

  private async showSelect(): Promise<void> {
    // Back from a course: the cursor returns to the course bar it was started from.
    if (this.courseReturnNavigation !== undefined && this.courseSession === undefined) {
      this.lastSelectNavigation = this.courseReturnNavigation;
      this.courseReturnNavigation = undefined;
    }
    this.elements.shell.classList.remove('playing');
    this.unlockPlaylogOptions();
    // The `.empty` class drives the centered "Drop BMS folder…" hint. Toggle it off the moment we have charts to show,
    // and back on after a wipe / failed drop so the hint comes back instead of leaving the user staring at a blank
    // canvas.
    this.elements.shell.classList.toggle('empty', this.collection.songs.length === 0);
    await this.ensureHostMounted();
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    this.disposeBeatorajaGameplay();
    this.resultView?.dispose();
    this.resultView = undefined;
    // Decide splash is cleared too — Escape from the splash should land back on the select scene rather than leave the
    // splash drawing over it.
    this.decideView?.dispose();
    this.decideView = undefined;
    // Family dispatch. The Debug Menu's "Skin family" pick overrides the auto chain (beatoraja → LR2 → default);
    // when the user hasn't overridden, the auto branch matches the legacy behaviour. The select scene also
    // gates on `songs.length > 0` for the beatoraja path because the beatoraja select scene's chrome assumes a
    // non-empty library (it paints empty-state hints separately from the LR2 path).
    const activeFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'select');
    if (activeFamily === 'beatoraja' && this.collection.songs.length > 0) {
      // Hide / dispose the LR2 select view if it was up — only one select can own the scene host.
      this.selectView?.setVisible(false);
      await this.showBeatorajaSelect();
      return;
    }
    // Same teardown for the beatoraja select scene if we're falling back to LR2 (theme dropped, etc.).
    // Capture before disposing so a future beatoraja-theme reload (e.g. user re-drops the same
    // theme) restores the cursor / folder state. The snapshot is opaque data — harmless to retain
    // even when the user has switched away.
    if (this.beatorajaSelectScene !== undefined) {
      this.beatorajaSelectSnapshot = this.beatorajaSelectScene.captureSnapshot();
    }
    this.beatorajaSelectScene?.dispose();
    this.beatorajaSelectScene = undefined;
    // Decide / result splashes don't outlive a return to select either — the gameplay-skinned
    // chrome they paint would otherwise overlay the select scene.
    this.beatorajaDecideScene?.dispose();
    this.beatorajaDecideScene = undefined;
    this.beatorajaResultScene?.dispose();
    this.beatorajaResultScene = undefined;
    // The active family for this select mount. `'lr2'` flows the loaded LR2 select skin through, `'default'` strips
    // it so the underlying scene paints built-in chrome regardless of what's loaded. The beatoraja branch returned
    // earlier, so we only have these two cases here.
    const lr2SelectSkin = activeFamily === 'lr2' ? this.selectSkin : undefined;
    let carriedPlayOptions: PixiPlayOptions | undefined;
    if (this.selectView && lr2SelectSkin !== undefined && !(this.selectView instanceof PixiSongSelectView)) {
      // A theme dropped while the default-family scene is up: only the LR2 scene can adopt an LR2 skin, so rebuild it
      // below as the LR2 scene, carrying the cursor and the live play options across.
      this.lastSelectNavigation ??= this.selectView.getNavigation();
      carriedPlayOptions = this.selectView.getPlayOptions();
      this.selectView.dispose();
      this.selectView = undefined;
    }
    if (this.selectView) {
      // Push the latest theme assets onto the view BEFORE flipping it visible. Order matters — `setSelectBgm` no-ops
      // when the bytes haven't changed, so back-from-play is silent; on a fresh theme drop it stops the old loop, swaps
      // the bytes, and (because we're still hidden) defers the actual `start()` until `setVisible(true)` lands a moment
      // later. Doing it the other way round would briefly start the prior theme's BGM during the visibility flip.
      if (this.selectView instanceof PixiSongSelectView) {
        this.selectView.setSkin(lr2SelectSkin);
      }
      this.selectView.setSelectBgm(this.selectBgmBytes);
      this.selectView.setDecideBgm(this.decideBgmBytes);
      this.selectView.setSystemSounds(this.systemSoundBundle);
      this.selectView.setCollection(this.collection);
      this.selectView.setVisible(true);
      if (this.lastSelectNavigation) {
        this.selectView.setNavigation(this.lastSelectNavigation);
      }
      return;
    }
    // Pick the right family's select scene: when an LR2 select skin is loaded, use the LR2 scene; otherwise the
    // default family takes over (visually the built-in 640×480 chrome). The previous code constructed
    // `PixiSongSelectView` with `skin: this.selectSkin` and relied on the LR2 scene's internal `if (skin)` fallback —
    // now that "no skin" is its own family at the type level, the dispatch happens here and the LR2 scene type
    // signals to readers that a real LR2 skin is required to take this path.
    const selectSceneOptions = {
      selectBgm: this.selectBgmBytes,
      decideBgm: this.decideBgmBytes,
      systemSounds: this.systemSoundBundle,
      initialNavigation: this.lastSelectNavigation,
      // Seed the in-scene panel from the Debug Menu's "Play options" state (two-way sync: the panel's own edits
      // come back through `onPlayOptionsChange` below; lil-gui edits push through `setPlayOptions`).
      initialPlayOptions: {
        ...carriedPlayOptions,
        autoPlay: this.guiState.autoPlay,
        gauge1P: this.guiState.gauge,
        random1P: this.guiState.random1P,
        random2P: this.guiState.random2P,
        dpFlip: this.guiState.dpFlip,
        autoScratch1P: this.guiState.autoScratch1P,
        autoScratch2P: this.guiState.autoScratch2P,
        hiSpeed: this.guiState.hiSpeed,
      },
      onPlayOptionsChange: (options: PixiPlayOptions) => {
        // Mirror the in-skin PLAY OPTION panel's edits back into the Debug Menu state so both surfaces always
        // agree, then repaint the lil-gui controllers.
        this.guiState.autoPlay = options.autoPlay;
        this.guiState.gauge = options.gauge1P;
        this.guiState.random1P = options.random1P;
        this.guiState.random2P = options.random2P;
        this.guiState.dpFlip = options.dpFlip;
        this.guiState.autoScratch1P = options.autoScratch1P;
        this.guiState.autoScratch2P = options.autoScratch2P;
        if (options.hiSpeed !== this.guiState.hiSpeed) this.rememberHiSpeed(options.hiSpeed, 'select');
        this.refreshPlayOptionControllers();
      },
      resolveSongRecord: (song: BrowserSongEntry) => this.lookupSongRecord(song),
      resolveCourseRecord: (course: BrowserCourseEntry) => lookupCourseRecord(course, this.songRecords),
      onSongSelected: (song: BrowserSongEntry) => {
        if (this.addSongToCourseBeingMade(song)) return;
        // Fire the decide cue first — it plays through the select view's AudioContext which keeps running even after
        // the view is hidden, so the cue isn't cut by the gameplay mount.
        void this.selectView?.playDecideSound();
        void this.showDecide(song);
      },
      onSongAutoPlay: (song: BrowserSongEntry) => {
        if (this.addSongToCourseBeingMade(song)) return;
        // The skin's AUTOPLAY button forces the auto flag on for this session regardless of the toolbar checkbox state.
        // We DON'T mutate the checkbox here — the user might want to keep it off for the next manual play.
        void this.selectView?.playDecideSound();
        void this.showDecide(song, { autoPlay: true });
      },
      onCourseSelected: (course: BrowserCourseEntry) => {
        void this.selectView?.playDecideSound();
        void this.startCourse(course);
      },
      onCourseAutoPlay: (course: BrowserCourseEntry) => {
        void this.selectView?.playDecideSound();
        void this.startCourse(course, { autoPlay: true });
      },
      onSearchActivate: () => this.search.openFromPointer(),
      courseMaker: this.courseMaker,
      onCourseNameActivate: () => this.courseMakerPanel?.focusName(),
      onCourseDeleteRequest: (course: CourseDefinition) => this.courseMakerPanel?.confirmDelete(course),
    };
    this.selectView = lr2SelectSkin
      ? new PixiSongSelectView({ skin: lr2SelectSkin, ...selectSceneOptions })
      : new DefaultPixiSongSelectView({
          ...selectSceneOptions,
          beMusicSkin: this.beMusicSkin,
          beMusicEffects: this.guiState.skinEffects,
          beMusicSkinSettings: this.beMusicSkinSettings,
        });
    await this.selectView.mount(this.sceneHost);
    this.selectView.setCollection(this.collection);
    this.scheduleFirstRunResolutionDetect();
  }

  /**
   * Before the player has picked a render resolution (by hand or by an earlier benchmark), benchmarks the select screen
   * once, after it settles, to pick one for this device. Skipped where there's nothing to choose (a 1× display) and
   * when `?resolution=` pins it.
   */
  private scheduleFirstRunResolutionDetect(): void {
    if (this.firstRunResolutionScheduled) return;
    this.firstRunResolutionScheduled = true;
    if (readStoredRenderResolution() !== undefined) return;
    if (new URLSearchParams(window.location.search).has('resolution')) return;
    if (renderResolutionSteps(window.devicePixelRatio || 1).length < 2) return;
    const selectView = this.selectView;
    window.setTimeout(() => {
      // Gone on to a play already: measuring gameplay that just started would mislead, so wait for the next visit.
      if (this.selectView !== selectView || !selectView?.isVisible() || readStoredRenderResolution() !== undefined) {
        return;
      }
      void this.detectRenderResolution({ whileShowing: selectView });
    }, FIRST_RUN_RESOLUTION_DELAY_MS);
  }

  /**
   * Measures the frame rate at each resolution on the screen being shown and keeps (and stores) the highest that holds
   * it. With `whileShowing`, the run is dropped — nothing stored, the previous resolution back — once that view is no
   * longer the select screen; any run is dropped when the page is hidden, since a hidden page's frames are throttled.
   */
  private async detectRenderResolution(options: { whileShowing?: unknown } = {}): Promise<void> {
    const steps = renderResolutionSteps(window.devicePixelRatio || 1);
    if (this.detectingResolution || steps.length < 2) return;
    this.detectingResolution = true;
    const control = this.autoDetectResolutionControl;
    control?.disable();
    this.resolutionPicker?.disable();
    try {
      const result = await benchmarkRenderResolution({
        steps,
        apply: (value) => this.sceneHost.setResolution(value),
        nextFrame: () => new Promise((resolve) => requestAnimationFrame(resolve)),
        onStep: (value) => control?.name(`Measuring ${renderResolutionLabel(value)}…`),
        cancelled: () =>
          document.visibilityState !== 'visible' ||
          (options.whileShowing !== undefined &&
            (this.selectView !== options.whileShowing || this.selectView?.isVisible() !== true)),
      });
      this.guiState.renderResolution = result.chosen;
      storeRenderResolution(result.chosen);
      this.resolutionPicker?.updateDisplay();
      resolutionLog.info('picked', {
        chosen: result.chosen,
        baselineMs: result.baseline,
        results: result.results.map(
          ({ resolution, times }) => `${resolution}×: p50 ${times.p50.toFixed(1)} ms, p90 ${times.p90.toFixed(1)} ms`,
        ),
      });
      control?.name(`${AUTO_DETECT_RESOLUTION_LABEL} (picked ${renderResolutionLabel(result.chosen)})`);
    } catch (error) {
      if (!(error instanceof RenderResolutionBenchmarkCancelled)) resolutionLog.warn('auto-detect failed', error);
      this.sceneHost.setResolution(this.guiState.renderResolution);
      control?.name(AUTO_DETECT_RESOLUTION_LABEL);
    } finally {
      this.detectingResolution = false;
      control?.enable();
      this.resolutionPicker?.enable();
    }
  }

  /**
   * Mounts the decide-screen splash and routes the user into gameplay when it dismisses (auto-advance OR Enter / Space
   * / Escape input). Without a decide skin, falls straight through to `playSong` so themes that don't ship a Decide
   * directory still play the chart immediately. On the default family the splash is the be-music skin's own decide
   * screen, shown only when the skin declares one.
   *
   * The decide view runs alongside the select view's AudioContext — `playDecideSound` was already fired at song-pick
   * time, and the splash visually masks the chart-load + gameplay-mount window that comes next.
   */
  private async showDecide(
    song: BrowserSongEntry,
    overrides: { autoPlay?: boolean } = {},
    then?: DecideContinuation,
  ): Promise<void> {
    const start = then?.start ?? (() => this.playSong(song, overrides));
    // Family dispatch for the decide splash. Note this is decoupled from the gameplay family pick: a user can be
    // playing in LR2 mode and have a beatoraja-only decide skin, or vice versa. The decide splash is a one-shot
    // overlay so each scene transition consults the family helper afresh.
    const decideFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'decide', song);
    if (decideFamily === 'beatoraja') {
      const mounted = await this.showBeatorajaDecide(song, overrides, then);
      if (!mounted) await start();
      return;
    }
    // A be-music skin's decide screen hands over to the LR2 / default gameplay preloaded below, so it is skipped when
    // the play itself runs on a beatoraja theme.
    const playsOnBeatoraja = this.playsOnBeatoraja(song, {});
    const beMusicDecide = decideFamily === 'default' && this.beMusicSkin.decide !== undefined && !playsOnBeatoraja;
    if (!beMusicDecide && (decideFamily === 'default' || !this.decideSkin)) {
      // No decide splash: a be-music skin without one, or an LR2-only setup that didn't ship a decide skin. The select
      // view's `playDecideSound` already fired so the audio cue still plays.
      await start();
      return;
    }
    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    this.decideView?.dispose();
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    // Build the gameplay view eagerly and kick off its heavy load (chart parse, audio decode, BGA preload) IN PARALLEL
    // with the Decide animation. The Decide splash typically runs ~3 s; chart asset decoding is mostly done by the time
    // the splash auto-advances, so the hand-off to gameplay becomes instant instead of dropping a frozen frame.
    // A course starts its own play once the splash is done, so nothing is preloaded for it; nor for a play on the
    // beatoraja scene, which prepares its own chart once the splash is done (`playSong`).
    const preloaded = then === undefined && !playsOnBeatoraja ? this.preloadGameplay(song, overrides) : undefined;
    let advanced = false;
    const advance = (then: () => void): void => {
      // Idempotent — the auto-advance timer, key input, and pointer click can all race; whichever lands first wins and
      // re-entries no-op.
      if (advanced) return;
      advanced = true;
      then();
    };
    const callbacks = {
      onContinue: () =>
        advance(() => {
          if (preloaded === undefined) {
            this.decideView?.dispose();
            this.decideView = undefined;
            void start();
            return;
          }
          void this.startGameplayAfterDecide(song, preloaded, overrides);
        }),
      onCancel: () =>
        advance(() => {
          // User backed out of the splash — abandon the prepared gameplay scene before falling back to the select view.
          this.gameplayView?.dispose();
          this.gameplayView = undefined;
          then?.cancel?.();
          void this.showSelect();
        }),
    };
    const playOptions = this.selectView?.getPlayOptions();
    this.decideView = beMusicDecide
      ? new DefaultPixiDecideView({
          ...callbacks,
          beMusicSkin: this.beMusicSkin,
          beMusicEffects: this.guiState.skinEffects,
          beMusicSkinSettings: this.beMusicSkinSettings,
          ...(playOptions !== undefined
            ? { playOptions: { ...playOptions, autoPlay: overrides.autoPlay ?? this.guiState.autoPlay } }
            : {}),
        })
      : new PixiDecideView({ ...callbacks, skin: this.decideSkin });
    await this.decideView.mount(this.sceneHost, { song, collection: this.collection });
  }

  /**
   * Constructs a fresh `PixiGameplayView` with the current play-options snapshot and starts its `prepare()` against the
   * shared host. The returned promise resolves once chart audio is decoded — the host awaits it inside the Decide
   * `onContinue` handler before flipping the scene visible.
   *
   * Wired up here (rather than inline in `showDecide`) because the same option-marshalling + callback wiring is needed
   * whether we're going through Decide or the no-decide fast-path. `playSong` shares this construction shape.
   */
  private async preloadGameplay(song: BrowserSongEntry, overrides: { autoPlay?: boolean }): Promise<void> {
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;
    // Same family check as `playSong` — picking `'default'` from the Debug Menu strips the LR2 skin even when one
    // is loaded for this chart. Computing `gameplayFamily` here keeps the decide → gameplay preload path consistent
    // with the no-decide fast-path.
    const gameplayFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'gameplay', song);
    const playSkin = gameplayFamily === 'lr2' ? pickLr2PlaySkin(this.playSkins, song) : undefined;
    const chartHashes = await this.resolveChartHashes(song);
    this.gameplayView = this.buildLr2GameplayView(song, playSkin, { ...overrides, chartHashes });
    return this.gameplayView.prepare(this.sceneHost, song, resolveSongSource(this.collection, song));
  }

  /**
   * Constructs the LR2-family (or default-family fallback) gameplay scene for `song` with the current option snapshot.
   * Branches on `playSkin`:
   *
   * - **`Lr2Skin`** present → constructs {@link PixiGameplayView} with that skin. LR2 chrome paints from the skin.
   * - **`undefined`** (no LR2 theme dropped, or the dropped theme has no skin for this chart's key mode) →
   *   constructs {@link DefaultPixiGameplayView}. The default family's injected chrome renderer takes over.
   *
   * The two branches share every other option — pulling the option-marshalling into one helper avoids the previous
   * two-place duplication between `preloadGameplay` and `playSong` (LR2 fallback path).
   */
  private buildLr2GameplayView(
    song: BrowserSongEntry,
    playSkin: Lr2Skin | undefined,
    overrides: {
      autoPlay?: boolean;
      replay?: BeMusicPlaylog;
      chartHashes?: ChartFileHashes;
      courseStage?: CourseStagePlan;
      nonstop?: NonstopPlay;
    },
  ): PixiGameplayView | DefaultPixiGameplayView {
    const playOptions = this.selectView?.getPlayOptions();
    const replay = overrides.replay;
    const courseStage = overrides.courseStage;
    const nonstop = overrides.nonstop;
    const autoPlay = overrides.autoPlay ?? this.guiState.autoPlay;
    this.lastPlay = { song, overrides: { autoPlay, ...(replay !== undefined ? { replay } : {}) } };
    // Only a play the player actually played counts towards the chart's best record; a course stage counts for the
    // course instead.
    // A play at another tempo is practice: it is not ranked, and leaves the records alone too.
    const tempo = replay !== undefined ? (replay.play.tempo ?? 1) : tempoFromPercent(this.guiState.tempoPercent);
    this.activePlayRecordKey = playRecordKey(song, overrides.chartHashes?.sha256, {
      autoPlay,
      replay: replay !== undefined,
      course: courseStage !== undefined || nonstop !== undefined,
      tempo,
    });
    // A course limits the lane options to what its constraint allows (`grade` none, `grade_mirror` MIRROR, ...), a
    // NONSTOP course's stitched play included.
    const courseLane = (picked: typeof this.guiState.random1P): typeof this.guiState.random1P =>
      this.courseSession !== undefined && courseStage !== undefined
        ? this.courseSession.laneOption(picked)
        : nonstop !== undefined
          ? resolveCourseLaneOption(nonstop.course.definition.constraints, picked)
          : picked;
    const sharedOptions = {
      // The playlog-relevant options (auto play / random / DP flip / auto scratch / gauge / judge) read from
      // `guiState` — the Debug Menu's "Play options" folder and the LR2 select panel two-way sync into it, and it
      // is the surface that exists on every family (default / beatoraja selects have no LR2 PLAY OPTION panel).
      autoPlay,
      autoPauseOnBlur: this.guiState.autoPauseOnBlur,
      // The remembered hi-speed (two-way synced with the LR2 select panel's HS); in-play changes come back to be
      // remembered for the next play.
      initialHiSpeed: this.guiState.hiSpeed,
      onHiSpeedChange: (hiSpeed: number) => this.rememberHiSpeed(hiSpeed, 'play'),
      bga: playOptions?.bga,
      bgaSize: playOptions?.bgaSize,
      scoreGraph: playOptions?.scoreGraph,
      hsFix: playOptions?.hsFix,
      hiddenSudden1P: playOptions?.hiddenSudden1P,
      hiddenSudden2P: playOptions?.hiddenSudden2P,
      shutter: playOptions?.shutter,
      laneCover: playOptions?.laneCover,
      // Replay playback restores the RECORDED play setup: the log's auto-scratch / gauge / judge ruleset govern
      // judging and the gauge readout, and the lane transforms stay off because the view re-applies the recorded
      // arrangement directly (see `PixiGameplayViewOptions.replay`).
      autoScratch1P: replay !== undefined ? replay.play.autoScratch : this.guiState.autoScratch1P,
      autoScratch2P: replay !== undefined ? false : this.guiState.autoScratch2P,
      dpFlip: replay !== undefined ? false : this.guiState.dpFlip,
      random1P: replay !== undefined ? ('OFF' as const) : courseLane(this.guiState.random1P),
      random2P: replay !== undefined ? ('OFF' as const) : courseLane(this.guiState.random2P),
      gauge: replay !== undefined ? replay.play.gauge : this.guiState.gauge,
      ...(courseStage !== undefined
        ? { course: courseStage.course, courseInfo: courseStage.courseInfo, hiSpeedLocked: courseStage.hiSpeedLocked }
        : {}),
      ...(nonstop !== undefined
        ? {
            course: resolveCourseStageSettings(nonstop.course.definition),
            courseInfo: resolveSceneCourseInfo(nonstop.course, 0),
            nonstop: nonstop.prepared.map,
          }
        : {}),
      // A replay plays at the tempo its log recorded (the scene reads it from `replay`); the pitch setting applies to
      // the song tempo and NONSTOP FIT stages alike.
      tempo,
      tempoPitchMode: this.guiState.tempoPitchMode,
      tempoStretchAlgorithm: this.guiState.tempoStretchAlgorithm,
      ...(replay === undefined ? { judgeRuleset: this.guiState.judgeRuleset } : {}),
      ...(overrides.chartHashes !== undefined
        ? { chartSha256: overrides.chartHashes.sha256, chartMd5: overrides.chartHashes.md5 }
        : {}),
      playlogRecorder: PLAYLOG_RECORDER,
      replay,
      audioVolumes: { key: this.guiState.keyVolume / 100, bgm: this.guiState.bgmVolume / 100 },
      audioCompressorParams: this.resolveCompressorParamOverrides(),
      audioCompressor: this.guiState.compressor,
      audioCompressorMode: this.compressorMode,
      audioCompressorStages: {
        key: this.guiState.compressorKey,
        bgm: this.guiState.compressorBgm,
        master: this.guiState.compressorMaster,
      },
      bgaTranscodeMaxLongEdgePx: this.guiState.bgaResizeMaxEdgePx > 0 ? this.guiState.bgaResizeMaxEdgePx : undefined,
      bgaTranscodeUseWebCodecs: this.guiState.bgaUseWebCodecs,
      showInvisibleNotes: this.guiState.showInvisibleNotes,
      judgedNoteDisplay: this.guiState.judgedNoteDisplay,
      onExit: () => {
        // ESC gives a running course up: the run is kept as a failed one (as LR2 records it), with the stage given up
        // recorded once the engine hands its play log over.
        const view = this.gameplayView;
        if (courseStage !== undefined && this.courseSession !== undefined) {
          const session = this.courseSession;
          void this.finishGameplayThen(async () => {
            session.giveUp(await view?.waitForPlaylog());
            this.courseSession = session;
            await this.showCourseResult();
          });
          return;
        }
        if (nonstop !== undefined) {
          void this.finishGameplayThen(async () => {
            await this.showNonstopCourseResult(nonstop, await view?.waitForPlaylog());
          });
          return;
        }
        void this.finishGameplayThen(() => this.showSelect());
      },
      onChartFinished: (result: PixiGameplayResultData) => {
        if (nonstop !== undefined) {
          void this.finishGameplayThen(() => this.showNonstopCourseResult(nonstop, result.playlog, result));
          return;
        }
        // A course stage with stage results skipped (or an auto-played one the course goes on after, as LR2 skips it)
        // goes straight on to the next stage (or the course result).
        if (
          courseStage !== undefined &&
          this.courseSession !== undefined &&
          skipsCourseStageResult({
            skipStageResults: this.guiState.courseAutoAdvance,
            autoPlay,
            courseGoesOn: this.courseSession.goesOnAfter(result.playlog),
          })
        ) {
          void this.finishGameplayThen(async () => {
            this.courseSession?.recordStage(result.playlog, result);
            this.gameplayView?.dispose({ preserveAudioTail: true });
            this.gameplayView = undefined;
            this.unlockPlaylogOptions();
            this.continueCourse();
          });
          return;
        }
        void this.finishGameplayThen(() => this.showResult(result));
      },
      onRestart: () => {
        // A NONSTOP course allows quick retry, as LR2 does (OpenLR2 L2854): stitch and play it again.
        if (nonstop !== undefined) {
          void this.finishGameplayThen(() => this.startNonstopCourse(nonstop.course));
          return;
        }
        // F5 restarts a single chart; in a course it gives the course up, as quick retry is off there.
        if (courseStage !== undefined) {
          this.courseSession = undefined;
          void this.finishGameplayThen(() => this.showSelect());
          return;
        }
        void this.finishGameplayThen(() => this.playSong(song));
      },
    };
    if (playSkin === undefined) {
      // Default-family path: no LR2 skin loaded for this chart. `DefaultPixiGameplayView` strips the skin / invisible-
      // note-skin slots from its option shape, so neither value flows in here.
      return new DefaultPixiGameplayView({
        ...sharedOptions,
        beMusicSkin: this.beMusicSkin,
        beMusicEffects: this.guiState.skinEffects,
        layoutMode: resolvePlayLayoutMode(this.guiState.playLayout, deviceProfile),
        beMusicSkinSettings: this.beMusicSkinSettings,
      });
    }
    return new PixiGameplayView({
      ...sharedOptions,
      skin: playSkin,
      // Pass the loaded 9-keys play variant as the invisible-note sprite source — Pop'n's green wide note at index 3
      // is the sprite the gameplay view paints over each invisible note when
      // {@link DemoGuiState.showInvisibleNotes} is on. Falls back to a flat green rectangle when the dropped theme
      // didn't ship `play_9.lr2skin`. Only meaningful with an LR2 theme loaded — the default family wouldn't have
      // anywhere to source the sprite from.
      invisibleNoteSkin: this.playSkins['9'],
    });
  }

  /**
   * Tears the Decide splash down and hands the stage over to the (already-prepared) gameplay scene. Awaits the preload
   * promise: when the user dismisses Decide before chart audio has finished decoding, the splash's last frame stays on
   * screen until prepare resolves — visually a brief hold rather than the previous frozen-frame freeze.
   */
  private async startGameplayAfterDecide(
    song: BrowserSongEntry,
    preloaded: Promise<void>,
    overrides: { autoPlay?: boolean },
  ): Promise<void> {
    try {
      await preloaded;
    } catch (error) {
      gameplayLog.warn('preload failed; falling back to no-decide path', error);
      this.gameplayView?.dispose();
      this.gameplayView = undefined;
      this.decideView?.dispose();
      this.decideView = undefined;
      await this.playSong(song, overrides);
      return;
    }
    if (!this.gameplayView) return;
    this.elements.shell.classList.add('playing');
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    this.decideView?.dispose();
    this.decideView = undefined;
    this.setStatus(describePlayingStatus(song.title, { tempoPercent: this.guiState.tempoPercent }));
    this.lockPlaylogOptionsForPlay();
    this.gameplayView.start();
    startArmedRecording(this.recordingDeps());
  }

  /**
   * Whether a play of `song` runs on the beatoraja gameplay scene: the gameplay family says so, and the play is neither
   * a replay nor a stitched NONSTOP chart (those play on the LR2 / default scenes, which carry the play-log arrangement
   * remap and the per-stage audio and BGA). Every path into gameplay — `playSong`, and the decide splash deciding what
   * to preload — asks this one question.
   */
  private playsOnBeatoraja(
    song: BrowserSongEntry,
    overrides: { replay?: BeMusicPlaylog; nonstop?: NonstopPlay },
  ): boolean {
    return (
      pickActiveFamilyForScene(this.familyDispatchState(), 'gameplay', song) === 'beatoraja' &&
      overrides.replay === undefined &&
      overrides.nonstop === undefined
    );
  }

  private async playSong(
    song: BrowserSongEntry,
    overrides: {
      autoPlay?: boolean;
      replay?: BeMusicPlaylog;
      courseStage?: CourseStagePlan;
      nonstop?: NonstopPlay;
    } = {},
  ): Promise<void> {
    // Family dispatch for the gameplay scene. The Debug Menu's "Skin family" pick funnels through here so a user
    // override of `'lr2'` / `'default'` forces that family even when beatoraja is technically available, while
    // `'auto'` keeps the legacy preference (beatoraja → LR2 → default). Replay playback always stays on the
    // LR2/default path — that's where the play-log arrangement remap and `replayInputs` are wired.
    const gameplayFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'gameplay', song);
    if (this.playsOnBeatoraja(song, overrides)) {
      await this.playSongBeatoraja(song, overrides);
      return;
    }
    this.elements.shell.classList.add('playing');
    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    // Tear down the decide splash before mounting gameplay — both share the host stage, so leaving the decide layer
    // alive would draw the splash on top of the gameplay scene.
    this.decideView?.dispose();
    this.decideView = undefined;
    this.gameplayView?.dispose();
    this.disposeBeatorajaGameplay();
    // Refresh the recording filename base for the upcoming play — each session writes to a unique file in the user's
    // downloads folder rather than overwriting the previous one.
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;
    // Resolve the LR2 play skin only when the family pick actually says LR2 — overriding to `'default'` skips the
    // skin even if one is loaded. `buildLr2GameplayView` then constructs `DefaultPixiGameplayView` when the skin
    // is undefined and `PixiGameplayView` otherwise; see `preloadGameplay` for the matching call shape (both feed
    // the same helper so option marshalling stays in one place).
    const playSkin =
      gameplayFamily !== 'lr2'
        ? undefined
        : overrides.courseStage !== undefined || overrides.nonstop !== undefined
          ? this.courseLr2Skin(
              pickLr2PlaySkin(this.playSkins, song),
              overrides.courseStage?.courseInfo ?? resolveSceneCourseInfo(overrides.nonstop!.course, 0),
              { kind: 'play', playVariant: pickLr2PlaySkinVariant(this.playSkins, song) },
            )
          : pickLr2PlaySkin(this.playSkins, song);
    // Chart-file hash for the recorded play-log (skipped for replays — they record nothing — and for a stitched
    // NONSTOP chart, which has no file).
    const chartHashes =
      overrides.replay === undefined && overrides.nonstop === undefined
        ? await this.resolveChartHashes(song)
        : undefined;
    this.gameplayView = this.buildLr2GameplayView(song, playSkin, { ...overrides, chartHashes });
    // A replay plays at its recorded tempo.
    const tempoPercent =
      overrides.replay !== undefined
        ? Math.round(((overrides.replay.play.tempo ?? 1) - 1) * 100)
        : this.guiState.tempoPercent;
    this.setStatus(describePlayingStatus(song.title, { tempoPercent }));
    this.lockPlaylogOptionsForPlay();
    await this.gameplayView.mount(this.sceneHost, song, resolveSongSource(this.collection, song));
    // Consume the "user pressed Record on the select screen" flag now that gameplay is mounted — `startRecording`
    // requires the gameplay AudioContext to exist, which only happens after `mount`. Failing here is non-fatal: the
    // select-screen click already nudged the user that capture would start; if it doesn't (codec missing / no
    // MediaRecorder), the surfaced error replaces the armed status without breaking gameplay.
    startArmedRecording(this.recordingDeps());
  }

  /**
   * Closes out an in-flight recording (if any) and then runs the caller-supplied transition (`showSelect` /
   * `showResult` / `playSong`). Sequencing here is non-negotiable: every one of those transitions disposes the gameplay
   * view, which in turn closes the AudioContext the `MediaRecorder` is tapping. Doing the dispose first leaves
   * `MediaRecorder.stop()` waiting on a `'stop'` event that never fires because its source stream died — the user would
   * see the result screen pop up but never get the saved WebM. Awaiting `finalizeRecordingIfActive` first lets the
   * recorder flush + download cleanly before the graph it depends on goes away.
   */
  private async finishGameplayThen(transition: () => Promise<void>): Promise<void> {
    await finalizeRecordingIfActive(this.recordingDeps());
    await transition();
  }

  /**
   * Mounts the result scene for a play, or — with `mode.course` — for a whole course (the course result, shown on the
   * LR2 theme's course-result skin when it has one).
   */
  private async showResult(data: PixiGameplayResultData, mode: { course?: SceneCourseInfo } = {}): Promise<void> {
    await this.ensureHostMounted();
    this.resultView?.dispose();
    // A stage of a running course: its play log carries the course on, and dismissing its result plays the next stage.
    const courseStage = mode.course === undefined && this.courseSession !== undefined;
    if (courseStage) this.courseSession!.recordStage(data.playlog, data);
    // Family dispatch for result. We currently only model the LR2 / default split here — the beatoraja result
    // scene is constructed inside `playSongBeatoraja`'s onComplete handler, not via `showResult`, so this method
    // never sees the `'beatoraja'` family. Pick the LR2 result skin only when the family pick says so; defaulting
    // strips the slot even if the loaded theme has a result skin.
    const resultFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'result');
    // A course's results show the course on the skin (LR2 ops 280-293, texts 150-170): a stage's result at its stage,
    // the course result on the course-result skin, each parsed again with the course ops.
    const courseInfo = mode.course ?? (courseStage ? this.courseSession!.courseInfo : undefined);
    const mountedResultSkin = mode.course !== undefined ? (this.courseResultSkin ?? this.resultSkin) : this.resultSkin;
    const lr2ResultSkin =
      resultFamily !== 'lr2'
        ? undefined
        : courseInfo === undefined
          ? mountedResultSkin
          : this.courseLr2Skin(mountedResultSkin, courseInfo, {
              kind: mode.course !== undefined && this.courseResultSkin !== undefined ? 'courseResult' : 'result',
            });
    // R on the result plays the same chart again — only offered when the recorded play start is this chart's, and
    // never in a course (LR2 and beatoraja disable quick retry there).
    const retry =
      mode.course === undefined && !courseStage && this.lastPlay?.song.id === data.song.id ? this.lastPlay : undefined;
    const sharedResultOptions = {
      collection: this.collection,
      // The course result plays LR2's course jingles, falling back to the result ones.
      clearBgm: (mode.course !== undefined ? this.courseClearBgmBytes : undefined) ?? this.clearBgmBytes,
      failBgm: (mode.course !== undefined ? this.courseFailBgmBytes : undefined) ?? this.failBgmBytes,
      resultBgm: this.resultBgmBytes,
      onContinue: () => {
        if (courseStage && this.courseSession !== undefined) {
          // The next stage does not tear the result view down, and a live one would keep taking its clicks and keys
          // (Enter / Space / Escape) during that stage, starting it over: drop it first.
          this.resultView?.dispose();
          this.resultView = undefined;
          this.continueCourse();
          return;
        }
        void this.showSelect();
      },
      ...(retry !== undefined
        ? {
            onRetry: () => {
              // Straight back into the chart, skipping select and decide. `playSong` tears down gameplay / decide but
              // not the result view, so drop it (and its BGM) first.
              this.resultView?.dispose();
              this.resultView = undefined;
              void this.playSong(retry.song, retry.overrides);
            },
          }
        : {}),
    };
    this.resultView = lr2ResultSkin
      ? new PixiResultView({
          skin: lr2ResultSkin,
          ...sharedResultOptions,
          ...(courseInfo !== undefined ? { courseInfo } : {}),
        })
      : new DefaultPixiResultView({
          ...sharedResultOptions,
          beMusicSkin: this.beMusicSkin,
          beMusicEffects: this.guiState.skinEffects,
          beMusicSkinSettings: this.beMusicSkinSettings,
        });
    await this.resultView.mount(this.sceneHost, data);
    this.gameplayView?.dispose({ preserveAudioTail: true });
    this.gameplayView = undefined;
    this.setStatus(`Result: ${data.song.title}`);
    this.recordActivePlay(songRecordPlayFromResult(data));
    // A course's stages are saved and ranked as the course, not one by one.
    if (mode.course === undefined && !courseStage) {
      this.maybeAutoSavePlaylog(data.playlog);
      this.leaderboard.maybeSubmit(data.playlog, data.song);
    }
    this.unlockPlaylogOptions();
  }

  /**
   * Latches the playlog-related GUI options for the play that is about to start and disables their controllers.
   * Playlog options are per-play: the value in effect at song start governs the whole play, and mid-song changes
   * are rejected by keeping the controls disabled until {@link unlockPlaylogOptions} runs (result mounted or back
   * at select).
   */
  private lockPlaylogOptionsForPlay(): void {
    this.activePlayAutoSavePlaylog = this.guiState.autoSavePlaylog;
    this.playlogSaveController?.disable();
    this.leaderboard.lockForPlay();
    for (const controller of this.playOptionControllers) {
      controller.disable();
    }
  }

  /** Re-enables the playlog option controllers once no play is in flight. */
  private unlockPlaylogOptions(): void {
    this.playlogSaveController?.enable();
    this.leaderboard.unlock();
    for (const controller of this.playOptionControllers) {
      controller.enable();
    }
  }

  /**
   * Takes a new hi-speed from one surface — the Debug Menu slider, the LR2 select panel, or the running play's keys —
   * remembers it for the next play and mirrors it onto the others: the slider, the select panel, and (for a menu
   * change) the running play.
   */
  private rememberHiSpeed(value: number, source: 'menu' | 'select' | 'play'): void {
    const hiSpeed = snapHiSpeed(value);
    if (hiSpeed === undefined) return;
    this.guiState.hiSpeed = hiSpeed;
    storeHiSpeed(hiSpeed);
    if (source !== 'menu') this.hiSpeedController?.updateDisplay();
    if (source !== 'select') this.selectView?.setPlayOptions({ hiSpeed });
    if (source === 'menu') {
      this.gameplayView?.setHiSpeed(hiSpeed);
      this.beatorajaGameplayView?.setHiSpeed(hiSpeed);
    }
  }

  /** Repaints the "Play options" controllers after an external write (the LR2 select panel's edits). */
  private refreshPlayOptionControllers(): void {
    for (const controller of this.playOptionControllers) {
      controller.updateDisplay();
    }
  }

  /**
   * Downloads the play-log (`*.bmplay.json` input replay) when the "Auto-save play history" toggle was on at song
   * start (the latched value — the checkbox itself is disabled during a play). Called from both result paths
   * (LR2/default `showResult`, beatoraja `onComplete`) the moment the result presentation is up. Failures are
   * non-fatal — the result screen must never be blocked by a download hiccup.
   */
  /** Saves a course run's play log when play-log auto-save is on (`<course>-<timestamp>.bmcourse.json`). */
  private maybeAutoSaveCoursePlaylog(courseLog: BeMusicCoursePlaylog): void {
    if (!this.guiState.autoSavePlaylog) return;
    try {
      const blob = new Blob([serializeCoursePlaylog(courseLog)], { type: 'application/json' });
      downloadBlob(blob, resolveCoursePlaylogFilename(courseLog));
    } catch (error) {
      gameplayLog.warn('course play-log auto-save failed', error);
    }
  }

  private maybeAutoSavePlaylog(playlog: BeMusicPlaylog | undefined): void {
    if (!this.activePlayAutoSavePlaylog || playlog === undefined) {
      return;
    }
    try {
      const blob = new Blob([serializePlaylog(playlog)], { type: 'application/json' });
      downloadBlob(blob, resolvePlaylogFilename(playlog));
    } catch (error) {
      gameplayLog.warn('play-log auto-save failed', error);
    }
  }
}

// Browser compatibility probe runs first so the drop card paints the readiness verdict immediately on first render. We
// do this BEFORE constructing the demo app so that even a hard-fail (Pixi `Application.init()` throwing on a no-WebGL2
// browser) still leaves the user looking at the unsupported-browser message rather than a blank canvas.
renderBrowserCompatPanel(checkBrowserCompat());

// Phones and tablets: lighter chrome over the stage, touch play controls, and a rotate prompt on phones held upright
// (see the `html.touch-first` / `html.phone` rules in styles.css).
const deviceProfile = resolveDeviceProfile(readDeviceSignals());
document.documentElement.classList.toggle('touch-first', deviceProfile.touchFirst);
document.documentElement.classList.toggle('phone', deviceProfile.phone);

// Wire up the bottom-right Help button + unified Help / OSS modal. The acknowledgement list is rendered lazily on first
// open of the OSS tab, so the initial paint isn't blocked on rendering ~30 dependency cards.
wireHelpModal();

void waitForDefaultUiFonts().finally(() => {
  new PlayerWebDemoApp({
    stage: document.querySelector<HTMLDivElement>('#stage')!,
    shell: document.querySelector<HTMLDivElement>('.shell')!,
    songInput: document.querySelector<HTMLInputElement>('#songs')!,
    filesInput: document.querySelector<HTMLInputElement>('#files')!,
    searchInput: document.querySelector<HTMLInputElement>('#search')!,
    loadingOverlay: document.querySelector<HTMLDivElement>('#loading-overlay')!,
    loadingLabel: document.querySelector<HTMLDivElement>('#loading-label')!,
    loadingBarFill: document.querySelector<HTMLDivElement>('#loading-bar-fill')!,
    loadingCounter: document.querySelector<HTMLDivElement>('#loading-counter')!,
  }).start();
});
