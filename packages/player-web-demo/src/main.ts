// Imports are split across `@be-music/player-web`'s entries (`./host`, `./skin`, `./collection`, `./audio`,
// `./recording`) so the dependency surface of this demo is explicit at the file top. The main `@be-music/player-web`
// entry is reserved for symbols that don't belong to any single entry (`logger`, `Rectangle`).
import {
  createDecideScene,
  createPlayScene,
  createResultScene,
  createSelectScene,
  PixiSceneHost,
  type BeatorajaKit,
  type BuiltInKit,
  type DecideScene,
  type DecideSceneKit,
  type PlayScene,
  type PlaySceneKit,
  type ResultScene,
  type ResultSceneKit,
  type SelectScene,
  type SelectSceneKit,
  type SelectStartEntry,
} from '@be-music/player-web/host';
import {
  DIFFICULTY_FILTER_CYCLE,
  HISPEED_MAX,
  HISPEED_MIN,
  HISPEED_STEP,
  KEYS_FILTER_CYCLE,
  resolveCourseView,
  resolveResultJingle,
  resolveResultJingles,
  snapHiSpeed,
  SORT_CYCLE,
  systemSoundSetFromBeatoraja,
  type BrowseSnapshot,
  type CourseView,
  type LibraryChart,
  type LibraryCourse,
  type PlayOptions,
  type PlayResult,
  type PlayRunKind,
  type SystemSoundSet,
} from '@be-music/scene-model';
import { resolveBeMusicSkinSettings, type BeMusicSkin, type BeMusicSongRecord } from '@be-music/skin-sdk';
import {
  latticeSkin,
  createBeatorajaSceneKitCaches,
  createBeatorajaSkinLoadContext,
  findBeatorajaThemeBgm,
  loadBeatorajaChartImages,
  loadBeatorajaSceneKit,
  loadBeatorajaThemeFromFiles,
  pickBeatorajaPlayableVariant,
  releaseBeatorajaSceneKitAssets,
  resolveBeatorajaSkinConfig,
  skinFamilyRegistry,
  summarizeBeatorajaPlaySkins,
  type BeatorajaChartImages,
  type BeatorajaPlayableVariant,
  type BeatorajaThemeBgm,
  type BeatorajaThemeBundle,
  type SkinFamilyId,
} from '@be-music/player-web/skin';
import {
  discoverBeatorajaSelectBgmPath,
  discoverBeatorajaSystemSoundPaths,
  type BeatorajaSystemSoundPaths,
} from '@be-music/beatoraja-skin/scene';
import {
  BrowserSongCollectionStore,
  checkBrowserCompat,
  computeChartFileHashes,
  describeSongCollection,
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
  CourseMaker,
  createCourseSongRecord,
  type BrowserDroppedFile,
  type BrowserSongCollection,
  type ChartFileHashes,
  type CourseDefinitionGroup,
} from '@be-music/player-web/collection';
import {
  createAudioService,
  parseCompressorMode,
  DEFAULT_COMPRESSOR_PARAMS,
  setMasterVolume,
  supportsSystemAudioSession,
  applySilentModePlayback,
  type AudioOwner,
  type AudioService,
  type CompressorMode,
  type CompressorParams,
  type TunableCompressor,
} from '@be-music/player-web/audio';
import { downloadBlob, type RecordingFormat } from '@be-music/player-web/recording';
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
import { resolveLr2CourseOps } from '@be-music/lr2-skin/state';
import {
  BEATORAJA_SKIN_TYPE,
  expandBeatorajaWildcard,
  type BeatorajaSkinConfig,
  type BeatorajaSkinEntry,
  type BeatorajaSkinHeader,
} from '@be-music/beatoraja-skin';
import { BeatorajaSkinOptionsGui } from './beatoraja-skin-options-gui.ts';
import {
  courseStageRecordKey,
  readStoredSongRecords,
  playRecordKey,
  rulesetRecordKey,
  rulesetRecords,
  songRecordKey,
  storeSongRecords,
} from './song-records.ts';
import {
  courseStageRecordPlayFromResult,
  mergeBestRecord,
  mergeCourseStageRecord,
  recordPlayFromResult,
  type RecordPlay,
} from '@be-music/player/records';
import { LeaderboardPanel } from './leaderboard-ui.ts';
import {
  describeSkinSettingControllers,
  readStoredSkinSettings,
  setStoredSkinSetting,
  storeSkinSettings,
} from './skin-settings.ts';
import type { ResolvedPlayChart } from '@be-music/player';
import { readStoredReplayView, storeReplayView } from './replay-view-settings.ts';
import { resolveResultSoundSet, resolveResultViewJingles } from './result-jingles.ts';
import {
  parsePlaylog,
  PLAYLOG_FILE_SUFFIX,
  resolveCoursePlaylogFilename,
  resolvePlaylogFilename,
  serializeCoursePlaylog,
  serializePlaylog,
  type BeMusicCoursePlaylog,
  type BeMusicPlaylog,
  type PlaylogCourseResult,
  type PlaylogRecorderInfo,
} from '@be-music/player/playlog';
import {
  buildCourseResultData,
  courseRecordKey,
  joinCourseStageHistories,
  resolveResultPresentation,
  lookupCourseRecord,
  skipsCourseStageResult,
} from './course-result.ts';
import {
  activeCourseInfo,
  courseDecideSong,
  courseStageHistories,
  describeNonstopPrepareFailure,
  describeRandomCourseDrawFailure,
  describeUnplayableCourse,
  planCourseStart,
  playAgainOverrides,
  resolveCourseRecordUpdate,
  resolveGameplayExit,
  resolveGameplayRestart,
  resolveResultRetry,
  nextCourseStagePlay,
  startCourseRun,
  type ActiveCourse,
  type CourseStagePlay,
} from './course-flow.ts';
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
import { prepareNonstopPlay, type PreparedNonstopPlay } from './nonstop-course.ts';
import {
  countLr2UnplayedStages,
  LR2_COURSE_MAKER_MAX_STAGES,
  LR2_MAX_PLAYED_STAGES,
  buildNonstopCoursePlaylog,
  resolveCourseStagePlaySettings,
  resolveCourseStageSettings,
} from '@be-music/player/course';
import { CourseMakerPanel } from './course-maker-panel.ts';
import { loadMadeCourses, saveMadeCourses } from './course-maker-store.ts';
import { SceneRouter, type PlayDispose, type SceneRouteToken } from './app/scene-router.ts';
import { settleDecidePreload, type DecidePreload } from './app/decide-handoff.ts';

/** A NONSTOP course being played as its stitched chart. */
interface NonstopPlay {
  course: LibraryCourse;
  prepared: PreparedNonstopPlay;
}
import demoPackageJson from '../package.json' with { type: 'json' };

const dropLog = logger('drop');
const gameplayLog = logger('gameplay');
const resolutionLog = logger('render-resolution');
const fullscreenLog = logger('fullscreen');

const AUTO_DETECT_RESOLUTION_LABEL = 'Auto-detect resolution';

/** Every screen the demo shows, each made by its `create*Scene`. */
type DemoScene = SelectScene | DecideScene | PlayScene | ResultScene;

/** What a play loading behind a decide screen is made with: the start's AUTO, and the chart as the screen drew it. */
interface DecidePlayOverrides {
  readonly autoPlay?: boolean;
  readonly preResolved: ResolvedPlayChart;
}

/** Ends a play whose result shows: it exited as the result entered, and its last samples ring out. */
const disposeKeepingAudioTail: PlayDispose<PlayScene> = (play) => play.dispose({ preserveAudioTail: true });

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
import { parseRecordingFormatKey, recordingFormatOptions } from './recording-format-choice.ts';
import { readStoredHiSpeed, storeHiSpeed } from './hi-speed-storage.ts';
import {
  allowsLiveTempo,
  describePlayingStatus,
  readStoredPlayTempoSettings,
  storePlayTempoSettings,
  TEMPO_PERCENT_MAX,
  TEMPO_PERCENT_MIN,
  tempoFromPercent,
  tempoPercentFromTempo,
} from './play-tempo-settings.ts';
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
  readDeviceSignals,
  resolvePlayLayoutMode,
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
import type { DemoGuiState, PlayerWebDemoElements, SkinFamilyOverride } from './types.ts';
import {
  readStoredBuiltInSkinId,
  readStoredPlayLayout,
  readStoredRecordingFormat,
  readStoredSkinEffects,
  readStoredVolumes,
  storeBuiltInSkinId,
  storePlayLayout,
  storeRecordingFormat,
  storeSkinEffects,
  storeVolumes,
} from './services/settings.ts';
import {
  BE_MUSIC_SKINS,
  EXTRA_BUILT_IN_SKINS_ENABLED,
  loadSkinFonts,
  waitForDefaultUiFonts,
} from './services/built-in-skins.ts';
import {
  describeBar,
  isTestHookEnabled,
  nameJingle,
  resultFromCourseLog,
  resultFromData,
  judgedOf,
  TestHookRecorder,
  type TestHookLiveState,
} from './test-hook.ts';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('missing #app');
}

app.innerHTML = DEMO_APP_HTML;

/** What a decide screen leads to instead of playing its song: a course's first stage, and what backing out undoes. */
interface DecideContinuation {
  start: () => Promise<void>;
  cancel?: () => void;
}

/** The family a play's status line names: the beatoraja play's; the built-in and LR2 plays name none. */
function playingFamily(view: PlayScene): { family?: 'beatoraja' } {
  return view.identity.family === 'beatoraja' ? { family: 'beatoraja' } : {};
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
  /** Mounting {@link sceneHost} on the page, started as the first scene shows (`mountStage`). */
  private stageMount: Promise<void> | undefined;
  /**
   * The one owner of the scene on the stage (ADR 0006): every transition finalizes a video recording in progress, hands
   * the stage to the next scene (the one showing exits as it enters) and then disposes the scene that left, unless it is
   * the select scene, which it keeps across a decide, play and result. Transitions run one at a time, and a scene made
   * for a navigation a newer one replaced is disposed instead of shown.
   */
  private readonly router = new SceneRouter<DemoScene, PlayScene, SelectScene>({
    host: {
      setScene: async (scene) => {
        await this.mountStage();
        await this.sceneHost.setScene(scene);
      },
    },
    recorder: { finalize: () => finalizeRecordingIfActive(this.recordingDeps()) },
    // A navigation the scenes did not ask for (a drop, a skin or theme change, files or a play log loaded) ends the
    // course run, so the next single play is not taken for its next stage.
    onInterrupt: () => this.endCourseRun(),
  });
  private collection: BrowserSongCollection = { sources: [], charts: [], errors: [] };
  /**
   * Course files dropped so far (`.lr2crs`, beatoraja `course/*.json`) and courses imported from difficulty-table URLs,
   * resolved into `collection.courseFolders`.
   */
  private courseGroups: CourseDefinitionGroup[] = [];
  /** The EXPERT / GRADE course being played, between its stages. */
  private activeCourse: ActiveCourse | undefined;
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
   * Owns the skin sounds a beatoraja decide / result skin starts while its `main()` runs at load time
   * (`main_state.audio_*`, e.g. ModernChic's `Root/customsound.lua`). They play through the audio service, which reads
   * them from the theme's files; a new theme stops them with `stopOwned`.
   */
  private readonly themeOwner: AudioOwner = {};
  /**
   * System-sound paths discovered from the active theme bundle. Re-probed every theme load
   * via {@link discoverBeatorajaSystemSoundPaths}; the beatoraja select screen's sound set (`selectSoundSet`) plays
   * them for its cursor / decide / folder / option cues. Stays empty (`{}`)
   * for stripped LR2 themes that don't ship a `sound/` subdirectory.
   */
  private beatorajaSystemSoundPaths: BeatorajaSystemSoundPaths = {};
  /**
   * Looping select-scene BGM path discovered from the active theme bundle. Re-probed on
   * every theme load via {@link discoverBeatorajaSelectBgmPath}; the beatoraja select screen's sound set plays it as its
   * BGM, started on enter and stopped on exit. `undefined` for themes
   * that don't ship a select BGM (the scene runs silent in the background then, just chart
   * preview clips and navigation cues).
   */
  private beatorajaSelectBgmPath: string | undefined;
  /**
   * Loop-playable BGM bytes for the song-select scene (`LR2files/Bgm/<theme>/select.wav` from the dropped theme), handed
   * to the select screen in its sound set (`selectSoundSet`).
   */
  private selectBgmBytes: Uint8Array | undefined;
  /** LR2 result jingles (`clear` / `fail` / `result`); the result scene picks one per outcome (`resolveResultJingle`). */
  private clearBgmBytes: Uint8Array | undefined;
  private failBgmBytes: Uint8Array | undefined;
  private resultBgmBytes: Uint8Array | undefined;
  /** LR2 course-result jingles (`courseclear` / `coursefail`); the course result falls back to the clear / fail ones. */
  private courseClearBgmBytes: Uint8Array | undefined;
  private courseFailBgmBytes: Uint8Array | undefined;
  /**
   * One-shot song-decided sound bytes (`LR2files/Bgm/<theme>/decide.wav`): the select screen's decide jingle, played as a
   * chart or a course starts a play (`selectSoundSet`).
   */
  private decideBgmBytes: Uint8Array | undefined;
  /**
   * LR2 system sound-effect bundle (`LR2files/Sound/lr2/<name>.wav`): the select screen's cues, in its sound set
   * (`selectSoundSet`).
   */
  private systemSoundBundle: {
    cursorMove?: Uint8Array;
    folderOpen?: Uint8Array;
    folderClose?: Uint8Array;
    optionOpen?: Uint8Array;
    optionClose?: Uint8Array;
    optionChange?: Uint8Array;
  } = {};
  /** The select screen (`createSelectScene`), whichever family draws it, kept by the router across the other screens. */
  private get selectView(): SelectScene | undefined {
    return this.router.select;
  }
  /** The play (`createPlayScene`), whichever family draws it: loading behind a decide screen, or on the stage. */
  private get gameplayView(): PlayScene | undefined {
    return this.router.play;
  }
  /**
   * The beatoraja theme's play entry the play on the stage is drawn with, when it plays on a beatoraja theme: the Debug
   * Menu's "Play 7K / Play 5K / …" skin pickers and the skin-options panel apply to it while that play is up.
   */
  private activeBeatorajaPlay:
    | { readonly entryPath: string; readonly header: BeatorajaSkinHeader; readonly variant: BeatorajaPlayableVariant }
    | undefined;
  /**
   * The most recently resolved chart for a beatoraja run, paired with the song's `chartPath` so
   * subsequent stages can verify the cached chart still matches the song they're handling.
   *
   * A play on the beatoraja play screen stamps it from the chart it played (`PlayScene.resolved`, the decide screen's
   * draws when it went through one) as it finishes, so the result screen's bpmgraph plots the same branches.
   *
   * `resolved` holds the chart together with the `#RANDOM` / `#SWITCH` draws it was resolved with; both are plain
   * JSON, so retaining them is cheap.
   */
  private lastBeatorajaChart: { resolved: ResolvedPlayChart; chartPath: string } | undefined;
  /**
   * The beatoraja theme's select entry as last loaded (`loadBeatorajaSelectKit`): the select screen takes it again on
   * every return to it while the theme and the entry stay the same, rather than loading the skin again.
   */
  private beatorajaSelectKit:
    | {
        readonly bundle: BeatorajaThemeBundle;
        readonly entryPath: string;
        readonly kit: BeatorajaKit;
        readonly header: BeatorajaSkinHeader;
      }
    | undefined;
  /**
   * The search field: typed into in place over the skin's search box (built-in and LR2 skins), or at the foot of the
   * screen where the skin has none (beatoraja). It filters whichever select scene is on screen.
   */
  private readonly search = new InlineSearch({
    input: document.querySelector<HTMLInputElement>('#search')!,
    shell: document.querySelector<HTMLElement>('.shell')!,
    canvas: () => this.sceneHost?.app.canvas,
    fieldRect: () => this.selectView?.searchFieldRect(),
    setQuery: (query) => this.selectView?.setSearch(query),
    setEditing: (editing) => this.selectView?.setSearchEditing(editing),
    touch: () => document.documentElement.classList.contains('touch-first'),
  });
  /**
   * Bottom-right lil-gui panel exposing the active beatoraja skin's `property[]` / `filepath[]` /
   * note-offset for live editing. Lazily constructed once `start()` mounts the host (the panel is
   * absolute-positioned inside the demo shell so the shell needs to exist first).
   */
  private beatorajaSkinOptionsGui: BeatorajaSkinOptionsGui | undefined;
  /**
   * What each beatoraja skin entry is loaded with (`loadBeatorajaSceneKit`), keyed by its entry path:
   * - `textures`: never destroyed in this session — disposing beatoraja textures and re-decoding the same bytes
   *   crashes PixiJS v8's bind-group cache (see `textures.ts`). A new theme only forgets them.
   * - `fonts`: reused while the same theme is active, then disposed when a new theme is dropped so `document.fonts`
   *   and Pixi's bitmap-font cache don't accumulate old entries.
   * - `skinConfigs`: the config picks. The skin-options panel mutates these and the active scene re-mounts with the
   *   updated values. Survives scene transitions so navigating away and back preserves the user's choices for each
   *   skin (a select skin and a play skin can carry independent configs).
   */
  private readonly beatorajaKitCaches = createBeatorajaSceneKitCaches();
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
   * The chart and play mode of the most recent play start (LR2 / default and beatoraja alike), so the result screen's
   * R key can start the same chart again. `autoPlay` is resolved at play start so a retry keeps the mode the play ran
   * in even when the toggle changes on the result screen; the remaining play options are read from the GUI state as
   * on any play start.
   */
  private lastPlay: { song: LibraryChart; overrides: { autoPlay: boolean; replay?: BeMusicPlaylog } } | undefined;
  /**
   * The player's audio service (ADR 0007): one system AudioContext for the sounds of the screens built on it, the
   * built-in decide and result screens so far. The other screens still play on contexts of their own.
   */
  private readonly audio: AudioService = createAudioService();
  /**
   * Last-known cursor / folder state of the select view, captured before gameplay so returning to song select restores
   * the user's position.
   */
  private lastSelectNavigation: BrowseSnapshot | undefined;
  /**
   * Where the select screen was when a course started. A later stage starts with no select screen up, so the course
   * keeps this to put the cursor back on the course bar once it is over.
   */
  private courseReturnNavigation: BrowseSnapshot | undefined;
  /** Whether the status line describes a play or result, which a return to the select screen replaces. */
  private playStatusShown = false;
  /** The skin system the scenes run on, so a pick of one that is not loaded can be undone. */
  private activeSkinSystem: SkinFamilyOverride = 'auto';
  /** The skin system the "Drop a skin" prompt asked for, until a drop answers it or it is cancelled. */
  private pendingSkinSystem: 'lr2' | 'beatoraja' | undefined;
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
  /** The "Tempo (%)" slider — left enabled during a play whose tempo can change live (`allowsLiveTempo`). */
  private tempoController: Controller | undefined;
  /** Whether the running play takes the tempo slider live (`allowsLiveTempo` at its start). */
  private liveTempoPlay = false;
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
   * Record key of the running EXPERT / GRADE course stage's chart, latched at stage start ({@link courseStageRecordKey}):
   * as LR2 does, the stage also updates that chart's best EX score, max combo, BP and FULL COMBO lamp.
   */
  private activeStageRecordKey: string | undefined;
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
   * The Debug Menu's other skin controls that make the select screen again: Built-in skin, Skin effects and the Add
   * skin buttons. They, {@link skinFamilyController} and {@link lr2ThemeController} are disabled during a play
   * ({@link setSkinControlsLocked}), since going back to the select screen would end it.
   */
  private readonly skinControllers: Controller[] = [];
  /** Whether a play runs, so the skin controls are disabled ({@link setSkinControlsLocked}). */
  private skinControlsLocked = false;
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
  /** `window.__beMusicTest` for the end-to-end suite (`?e2e=1` or a development build; `test-hook.ts`). */
  private readonly testHook = isTestHookEnabled(window.location.href, import.meta.env.DEV)
    ? new TestHookRecorder()
    : undefined;
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
      // What a replay reproduces of the recorded view, remembered from the last visit.
      replayView: readStoredReplayView(),
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
      sort: 'OFF',
      keysFilter: 'ALL',
      difficultyFilter: 'ALL',
      hiSpeed: readStoredHiSpeed(),
      // Skin-family routing defaults to `'auto'`: beatoraja > LR2 > default, picked per-scene from what's loaded.
      // The Debug Menu's "Skin family" dropdown lets users force a specific family; LR2 / beatoraja entries appear
      // in the dropdown only when their theme is loaded (see {@link rebuildSkinFamilyPicker}).
      skinFamilyOverride: 'auto',
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
    this.testHook?.install(window, () => this.testHookState());
    this.buildGui();
    this.courseMakerPanel = new CourseMakerPanel(this.courseMaker, { onStatus: (text) => this.setStatus(text) });
    void loadMadeCourses().then(async (made) => {
      this.courseMaker.restore(made);
      if (made.courses.length > 0 && this.collection.charts.length > 0) await this.refreshMadeCourses();
    });
    // The first scene shown mounts the Pixi host (`mountStage`). Keep its promise so URL auto-load (below) drives its own
    // `showSelect` only once the first select screen is up.
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
        // shows progress too. Take the select scene off the stage up-front so its rendering / BGM stays paused while we
        // read + parse — the user shouldn't see the song list flicker mid-load.
        showLoadingOverlay(this.elements);
        await this.leaveSelect();
        try {
          // Route through the same post-enumeration pipeline as drag-drop so the picker's selection produces a theme +
          // songs split (handy when a user hand-picks a folder whose root carries both an LR2 theme and a BMS pack),
          // instead of the previous `loadSongs`-only path that quietly skipped any LR2 assets in the selection.
          await load(fileList);
        } finally {
          hideLoadingOverlay(this.elements);
          this.testHook?.recordLoad();
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
    // Sequenced after the first select screen shows.
    const urlParams = parseUrlMediaParams(window.location.href);
    const mediaParams = urlParams;
    // Difficulty tables imported in an earlier visit are imported again, after the URL load so their stages match it.
    const storedCourseTables = readStoredCourseTableUrls();
    void initialSelectReady.then(async () => {
      if (mediaParams.musicUrl || mediaParams.skinUrl) await this.loadFromUrl(mediaParams);
      if (storedCourseTables.length > 0) await this.importCourseTables(storedCourseTables, false);
    });
  }

  /**
   * Mounts the scene host on the page once, as the first scene shows (the router's stage); every later call waits on
   * that one mount, so no scene enters before the renderer exists.
   */
  private mountStage(): Promise<void> {
    this.stageMount ??= (async () => {
      await this.sceneHost.mount(this.elements.stage, { resolution: this.guiState.renderResolution });
      this.wireCanvasFullscreen();
      this.wireTouchControls();
      this.sceneHost.app.ticker.add(this.syncGameplayShellState);
    })();
    return this.stageMount;
  }

  /**
   * Takes the select scene off the stage when it is the one showing, leaving no scene up; any other scene stays. The
   * select scene goes off this way while files load (the router keeps it: its BGM, preview and drawing pause until it
   * shows again).
   */
  private leaveSelect(): Promise<boolean> {
    const select = this.router.select;
    return select !== undefined && this.router.current === select ? this.router.leave() : Promise.resolve(false);
  }

  /**
   * Takes the screen showing off the stage and disposes it (a result screen), then runs `next` (the next stage, a
   * retry) unless a newer navigation has begun meanwhile. `next` may take a while to show anything, and a live screen
   * would keep taking its keys and clicks meanwhile, starting it over. The result screen asks for it, so it carries
   * the run on.
   */
  private async leaveThen(next: () => unknown): Promise<void> {
    if (await this.router.leave({ continuesRun: true })) next();
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
   * views are created and torn down along many paths; a play being prepared behind a decide splash counts already.
   */
  private readonly syncGameplayShellState = (): void => {
    const inGameplay = this.gameplayView !== undefined;
    // The built-in / LR2 play views take touch input and expose pause / exit for the touch controls; a beatoraja skin
    // draws its own lanes and takes no touch.
    const touchPlay = this.gameplayView !== undefined && this.gameplayView.identity.family !== 'beatoraja';
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
    const playOptions = addFolder(gui, DEBUG_MENU_FOLDERS.playOptions);
    this.buildPlayOptionsFolder(playOptions);
    this.buildReplayViewFolder(addFolder(playOptions, DEBUG_MENU_FOLDERS.replayView));
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
    // The built-in and LR2 select screens' sort and filters (an LR2 skin's buttons change them too); the list keeps
    // the bar under the cursor.
    trackPlayOption(
      folder
        .add(this.guiState, 'sort', [...SORT_CYCLE])
        .name('Sort')
        .onChange((value: DemoGuiState['sort']) => {
          this.selectView?.setPlayOptions({ sort: value });
        }),
    );
    trackPlayOption(
      folder
        .add(this.guiState, 'keysFilter', [...KEYS_FILTER_CYCLE])
        .name('Key filter')
        .onChange((value: DemoGuiState['keysFilter']) => {
          this.selectView?.setPlayOptions({ keysFilter: value });
        }),
    );
    trackPlayOption(
      folder
        .add(this.guiState, 'difficultyFilter', [...DIFFICULTY_FILTER_CYCLE])
        .name('Difficulty filter')
        .onChange((value: DemoGuiState['difficultyFilter']) => {
          this.selectView?.setPlayOptions({ difficultyFilter: value });
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
  /**
   * Replay / ghost: which of what a play log recorded the player seeing a replay shows (the tempo, the hi-speed,
   * SUDDEN+ / HIDDEN+ and LIFT), the rest staying the player's own. Read when a play starts, so disabled during one.
   */
  private buildReplayViewFolder(folder: GUI): void {
    const remember = () => storeReplayView(this.guiState.replayView);
    const labels = { tempo: 'Tempo', hiSpeed: 'Hi-speed', covers: 'SUDDEN+ / HIDDEN+', lift: 'LIFT' } as const;
    for (const key of ['tempo', 'hiSpeed', 'covers', 'lift'] as const) {
      this.trackPlayOption(folder.add(this.guiState.replayView, key).name(labels[key]).onChange(remember));
    }
  }

  private buildTempoFolder(folder: GUI): void {
    const trackPlayOption = (controller: Controller): Controller => this.trackPlayOption(controller);
    // The play tempo (-50 % .. +50 %) and how a tempo change sounds, for the song tempo and NONSTOP FIT stages alike.
    // Read when a play starts, so they are disabled during one; a play at another tempo is practice (not ranked, no
    // records).
    // With the pitch following the tempo, the slider stays enabled during a play and changes its tempo live.
    const rememberTempo = () => storePlayTempoSettings(this.guiState);
    this.tempoController = trackPlayOption(
      folder
        .add(this.guiState, 'tempoPercent', TEMPO_PERCENT_MIN, TEMPO_PERCENT_MAX, 1)
        .name('Tempo (%)')
        .onChange(() => {
          rememberTempo();
          if (!this.liveTempoPlay) return;
          const tempo = tempoFromPercent(this.guiState.tempoPercent);
          this.gameplayView?.setTempo(tempo);
        }),
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
        this.refreshCompressorStageVisibility();
      });
    const stages = addFolder(compressor, DEBUG_MENU_FOLDERS.compressorStages);
    this.compressorStageFolder = stages;
    stages
      .add(this.guiState, 'compressorKey')
      .name('Key')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('key', value);
      });
    stages
      .add(this.guiState, 'compressorBgm')
      .name('BGM')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('bgm', value);
      });
    stages
      .add(this.guiState, 'compressorMaster')
      .name('Master')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('master', value);
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
    const skinEffects = skin
      .add(this.guiState, 'skinEffects', { Full: 'full', Reduced: 'reduced', Off: 'off' })
      .name('Skin effects')
      .onChange((level: 'full' | 'reduced' | 'off') => {
        storeSkinEffects(level);
        this.handleSkinFamilyOverrideChange(this.guiState.skinFamilyOverride);
      });
    // Both make the select screen again, so they wait for the play to end.
    this.skinControllers.push(skinPicker, skinEffects);
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
      .onChange((choice: PlayLayoutChoice) => storePlayLayout(choice));
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
    if (!EXTRA_BUILT_IN_SKINS_ENABLED) return;
    const addSkins = addFolder(skin, DEBUG_MENU_FOLDERS.addSkin);
    const skinSource = {
      url: '',
      addLattice: () => this.addBeMusicSkin(latticeSkin),
      addFromUrl: () => void this.addBeMusicSkinFromUrl(skinSource.url),
    };
    // Adding a skin switches to it, which makes the select screen again: the buttons wait for the play to end.
    this.skinControllers.push(addSkins.add(skinSource, 'addLattice').name('Add Lattice'));
    addSkins.add(skinSource, 'url').name('Skin module URL');
    this.skinControllers.push(addSkins.add(skinSource, 'addFromUrl').name('Add from URL'));
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
    library.add(urls, 'skin').name('Skin ZIP URL');
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
              !window.confirm(
                `Clear ${this.songRecords.size} best record(s), of every judge ruleset? This cannot be undone.`,
              )
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
    // BGA video transcode controls. Both settings are seeded into the next play scene's settings (see
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
        .name('Judge windows')
        // Each ruleset keeps its own best records: the select screen switches to the new ruleset's.
        .onChange(() => this.refreshSelectRecords()),
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
      if (this.stageMount === undefined || developer._closed || this.gui?._closed) return;
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
    this.playStatusShown = false;
    this.statusController?.updateDisplay();
    this.testHook?.recordStatus(text);
  }

  /** Shows a status about the play or result on screen, which the select screen replaces when it comes back. */
  private setPlayStatus(text: string): void {
    this.setStatus(text);
    this.playStatusShown = true;
  }

  /** What `window.__beMusicTest` reports now (`test-hook.ts`), read from the scenes up and the state kept here. */
  private testHookState(): TestHookLiveState {
    // The scene showing names itself; none shows between screens.
    const current = this.router.current;
    const scene: TestHookLiveState['scene'] =
      current === undefined ? { kind: 'none' } : { kind: current.identity.kind, family: current.identity.family };
    const select = scene.kind === 'select' && current === this.selectView ? this.selectView : undefined;
    const entry = select?.focused();
    // The select screen's browse position: its folders, sort, filters and search.
    const navigation = select?.snapshot();
    const play = scene.kind === 'play' ? this.lastPlay : undefined;
    // The play's running result, whichever family draws it.
    const progress = this.gameplayView?.progress();
    const active = this.activeCourse;
    const draft = this.courseMaker.draft;
    return {
      scene,
      status: this.guiState.status,
      loading: this.elements.loadingOverlay.classList.contains('visible'),
      library: {
        songs: this.collection.charts.length,
        courseFolders: (this.collection.courseFolders ?? []).map((folder) => folder.label),
      },
      cursor:
        scene.kind === 'select'
          ? {
              folderPath: [...(navigation?.folderPath ?? [])],
              bar:
                entry &&
                describeBar(
                  entry,
                  entry.kind === 'chart'
                    ? this.lookupSongRecord(entry.chart)
                    : entry.kind === 'course'
                      ? lookupCourseRecord(entry.course, this.songRecords, this.guiState.nonstopPlacement)
                      : undefined,
                ),
              list: navigation && {
                sort: navigation.list?.sort ?? 'OFF',
                keysFilter: navigation.list?.keysFilter ?? 'ALL',
                difficultyFilter: navigation.list?.difficultyFilter ?? 'ALL',
                search: navigation.searchText ?? '',
              },
            }
          : undefined,
      play: play && {
        title: play.song.title,
        autoPlay: play.overrides.autoPlay,
        replay: play.overrides.replay !== undefined,
        tempo: this.gameplayView?.getTempo() ?? 1,
        hiSpeed: this.gameplayView?.getHiSpeed(),
        seconds: progress?.playSeconds,
        judged: progress && judgedOf(progress.score),
        gauge: progress && { type: progress.gaugeType, value: progress.gauge },
        course: active && {
          name: active.course.definition.name,
          stage: active.run.stagesPlayed + 1,
          stageCount: active.run.stageCount,
        },
      },
      courseDraft: draft && { kind: draft.kind, stages: draft.stages.map((stage) => stage.title ?? stage.md5) },
    };
  }

  /** Which theme slot a result jingle came from (`lr2:courseClear`, `beatoraja:fail`, ...), for the test hook. */
  private nameResultJingle(bytes: Uint8Array | undefined): string | undefined {
    return nameJingle(bytes, {
      lr2: {
        clear: this.clearBgmBytes,
        fail: this.failBgmBytes,
        result: this.resultBgmBytes,
        courseClear: this.courseClearBgmBytes,
        courseFail: this.courseFailBgmBytes,
      },
      beatoraja: { ...this.beatorajaThemeBgm },
    });
  }

  /**
   * Filename base for the next saved recording. Derived from the currently-playing song's title (sanitized for
   * filesystem safety) or `gameplay-<timestamp>` when no song info is available. Updated on every `playSong` so
   * back-to-back recordings don't overwrite each other in the user's downloads folder.
   *
   * Read by `toggleRecording` (in `./recording-controller.ts`) when assembling the download filename; mutated in
   * `playSong` / `preloadGameplay` as each chart starts.
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
      getActiveGameplay: () => this.gameplayView?.recording,
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
    // Take the select scene off the stage for the duration of the load. Its exit pauses BGM + the rAF tick + the song
    // list rendering, so:
    //
    // - the loaded LR2 theme's `select.wav` doesn't start the moment the (small) theme bundle finishes parsing while
    //   the (large) song collection is still being read,
    // - the song list doesn't visually shuffle as new entries land,
    // - and the user only sees the overlay until everything is ready — not a half-rendered scene behind it.
    //
    // `showSelect()` at the end of the try block shows the scene again with the freshly populated state in one shot.
    // Not awaited: the drop's items must be read before this handler yields.
    void this.leaveSelect();
    try {
      const files = await readDroppedFiles(dataTransfer, {
        onProgress: (progress) => applyLoadProgress(this.elements, progress),
      });
      await this.processIncomingFiles(files);
    } finally {
      // Always tear the overlay down — even when one of the sub-loaders threw or `splitDroppedSongAndThemeFiles`
      // produced an empty bucket. Otherwise a failed drop would leave the UI permanently masked.
      hideLoadingOverlay(this.elements);
      this.testHook?.recordLoad();
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
    const carriesLr2Theme = themeFamilies.has('lr2');
    const carriesBeatorajaTheme = themeFamilies.has('beatoraja');
    const themeMarkers = [...themeFamilies];
    dropLog.info(
      `received ${files.length} file(s) · theme=${themeFiles.length}${
        themeMarkers.length > 0 ? ` (${themeMarkers.join('+')})` : ' (no skin entry → preserving current theme)'
      } · songs=${songFiles.length}`,
    );
    // The songs already listed, so the select screen can open on what this drop added.
    const previousSongIds = new Set(this.collection.charts.map((song) => song.id));
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
      `loaded · songs=${this.collection.charts.length} · errors=${
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
    if (this.collection.charts.length > 0) {
      this.setStatus(describeSongCollection(this.collection));
    } else if (this.selectSkin || this.resultSkin || Object.keys(this.playSkins).length > 0) {
      this.setStatus('Theme loaded');
    }
    await this.refreshCourseFolders();
    // Open what was dropped: its folder, or the folder list when the drop carried several.
    const dropped = navigationAfterDrop(this.collection.charts, previousSongIds);
    if (dropped !== undefined) this.lastSelectNavigation = dropped;
    await this.showSelect();
    // A skin the player asked for through the Debug Menu ("drop a skin") is switched to once the drop brings it.
    const asked = this.pendingSkinSystem;
    this.pendingSkinSystem = undefined;
    if (asked !== undefined && themeFamilies.has(asked)) this.handleSkinFamilyOverrideChange(asked);
    if (playlogFiles.length > 0) {
      await this.startPlaylogReplayFromFile(playlogFiles[0]!);
    }
  }

  /**
   * Asks for a drop of a skin of `family`, picked in the Debug Menu with none loaded: a drop-card-like prompt that any
   * drop closes. The skin it brings is then used without the "Use this skin?" question.
   */
  private promptSkinDrop(family: 'lr2' | 'beatoraja'): void {
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
      if (this.collection.charts.length > 0) {
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
    this.setPlayStatus(`Replaying: ${song.title}`);
    try {
      // A replay plays on the gameplay family's own play screen, whichever family recorded it: the play session
      // re-applies the recorded arrangement and the engine replays the inputs the same way on every family.
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
  private async findSongForPlaylog(playlog: BeMusicPlaylog): Promise<LibraryChart | undefined> {
    // Content hash first — stable across sessions, machines, and file moves.
    const sha256 = playlog.chart.sha256?.toLowerCase();
    if (sha256 !== undefined && sha256.length > 0) {
      for (const entry of this.collection.charts) {
        if ((await this.resolveChartSha256(entry)) === sha256) {
          return entry;
        }
      }
    }
    const nativeChartPath = playlog.play.native?.chartPath;
    if (typeof nativeChartPath === 'string' && nativeChartPath.length > 0) {
      const exact = this.collection.charts.find((entry) => entry.chartPath === nativeChartPath);
      if (exact) {
        return exact;
      }
    }
    const title = playlog.chart.title;
    if (title === undefined || title.length === 0) {
      return undefined;
    }
    return this.collection.charts.find(
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
        // A file dropped again replaces its folder instead of adding another.
        for (const group of groups) this.courseGroups = mergeCourseGroup(this.courseGroups, group);
        for (const group of groups) {
          dropLog.info(
            `course file: ${path} · ${group.label} · courses=${group.courses.length} random=${group.randomCourses?.length ?? 0}`,
          );
        }
        // LR2 plays only the first five stages of a course, so an `.lr2crs` course listing more is read cut short.
        const cutShort = groups
          .flatMap((group) => group.courses)
          .filter((course) => countLr2UnplayedStages(course) > 0);
        if (cutShort.length > 0) {
          const names = cutShort.map((course) => course.name || '(untitled)').join(', ');
          dropLog.warn(`course file: ${path} · read as the first ${LR2_MAX_PLAYED_STAGES} stages LR2 plays: ${names}`);
          this.setStatus(
            `${path}: ${cutShort.length} course(s) list more than ${LR2_MAX_PLAYED_STAGES} stages; LR2 plays only the first ${LR2_MAX_PLAYED_STAGES}, so the rest were left out`,
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
    const showing = this.router.current?.identity.kind;
    const busy = this.elements.shell.classList.contains('playing') || showing === 'result' || showing === 'decide';
    if (!busy) await this.showSelect();
  }

  /**
   * Matches every dropped course's stages against the collection by chart-file hash and lists them as course folders.
   * Hashing the whole library is cheap (chart files are small) and cached per song.
   */
  private async refreshCourseFolders(): Promise<void> {
    const hashed = await Promise.all(
      this.collection.charts.map(async (song) => ({ song, ...(await this.resolveChartHashes(song)) })),
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
      this.selectView?.setLibrary(this.collection);
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
    else this.selectView?.setLibrary(this.collection);
  }

  /** Relists the course folders after the player's own courses changed, keeping the select screen where it was. */
  private async refreshMadeCourses(): Promise<void> {
    await this.refreshCourseFolders();
    const view = this.selectView;
    if (view === undefined) return;
    const navigation = view.snapshot();
    view.setLibrary(this.collection);
    view.restore(navigation);
  }

  /**
   * While a course is being made, deciding a song adds it to the course instead of playing it, as LR2 does; deciding one
   * more once it holds five saves the course. Returns whether the song was taken.
   */
  private addSongToCourseBeingMade(song: LibraryChart): boolean {
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
  private async startCourse(entry: LibraryCourse, options: { autoPlay?: boolean } = {}): Promise<void> {
    // AUTO on a course bar plays every stage itself; PLAY follows the Debug Menu's auto play.
    this.courseAutoPlay = options.autoPlay;
    const plan = planCourseStart(entry);
    // A NEW COURSE bar starts making a course of its folder's kind; songs decided from now on join it.
    if (plan.action === 'make') {
      this.courseMaker.start(plan.kind);
      this.setStatus('Making a course: decide songs to add them, then save');
      return;
    }
    if (plan.action === 'unplayable') {
      this.setStatus(describeUnplayableCourse(entry));
      return;
    }
    this.courseReturnNavigation = this.selectView?.snapshot() ?? this.lastSelectNavigation;
    let course = entry;
    if (plan.action === 'draw') {
      const candidates = await Promise.all(
        this.collection.charts.map(async (song) => ({ song, ...(await this.resolveChartHashes(song)) })),
      );
      const drawn = drawBrowserRandomCourse(entry, candidates, Math.random);
      if (!drawn.ok) {
        this.setStatus(describeRandomCourseDrawFailure(entry.definition.name, drawn));
        return;
      }
      course = drawn.course;
    }
    if (planCourseStart(course).action === 'nonstop') {
      await this.startNonstopCourse(course, { decide: true });
      return;
    }
    const active = startCourseRun(course);
    this.activeCourse = active;
    // LR2 shows the decide screen once, before the first stage (a stage after it starts from the previous result).
    const first = course.stages[0]?.chart;
    if (first === undefined) {
      await this.playNextCourseStage();
      return;
    }
    await this.showDecide(
      courseDecideSong(course, first),
      {},
      {
        start: () => this.playNextCourseStage(),
        cancel: () => {
          if (this.activeCourse === active) this.activeCourse = undefined;
        },
      },
    );
  }

  /**
   * Starts a NONSTOP course: its stages are stitched into one chart (`prepareNonstopPlay`, on the shared NONSTOP
   * pipeline) played from their own files, as LR2 plays a NONSTOP course in one go. Quick retry stitches and plays it
   * again.
   */
  private async startNonstopCourse(course: LibraryCourse, options: { decide?: boolean } = {}): Promise<void> {
    const hashes = new Map<string, ChartFileHashes>();
    for (const stage of course.stages) {
      if (stage.chart === undefined) continue;
      const found = await this.resolveChartHashes(stage.chart);
      if (found !== undefined) hashes.set(stage.chart.id, found);
    }
    const prepared = prepareNonstopPlay(course, {
      sourceOf: (song) => resolveSongSource(this.collection, song),
      hashesOf: (song) => hashes.get(song.id),
      placement: this.guiState.nonstopPlacement,
    });
    if (!prepared.ok) {
      this.setStatus(describeNonstopPrepareFailure(course.definition.name, prepared));
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

  /**
   * The course result of a NONSTOP run: its course log built from the stitched play, kept and shown as one run, on a
   * beatoraja theme's result skin when the result family is beatoraja (with `resolved`, the stitched chart as played,
   * for its graphs), else on the LR2 or built-in result.
   */
  private async showNonstopCourseResult(
    nonstop: NonstopPlay,
    playlog: BeMusicPlaylog | undefined,
    fallback?: PlayResult,
    resolved?: ResolvedPlayChart,
  ): Promise<void> {
    this.testHook?.recordPlaylog(playlog);
    if (playlog === undefined) {
      await (fallback !== undefined ? this.showResult(fallback) : this.showSelect());
      return;
    }
    const courseLog = buildNonstopCoursePlaylog(nonstop.course.definition, nonstop.prepared.stitched, playlog, {
      createdAt: new Date().toISOString(),
      recorder: PLAYLOG_RECORDER,
    });
    const native = courseLog.results?.native;
    if (native === undefined) {
      await (fallback !== undefined ? this.showResult(fallback) : this.showSelect());
      return;
    }
    this.recordCourseResult(
      resolveCourseRecordUpdate(
        courseLog,
        native,
        courseRecordKey(nonstop.course, nonstop.prepared.stitched.placement),
      ),
    );
    this.maybeAutoSaveCoursePlaylog(courseLog);
    // Ranked as one course run: the Leaderboard stitches the stage charts again to check the stitched play.
    this.leaderboard.maybeSubmitCourse(
      courseLog,
      nonstop.course.stages.flatMap((stage) => (stage.chart !== undefined ? [stage.chart] : [])),
    );
    // As LR2 shows a NONSTOP run: on the result skin with the clear / fail jingles (no course-result step), and R
    // stitches and plays the course again.
    const result = buildCourseResultData(nonstop.course, native, courseLog, fallback);
    const info = resolveCourseView(nonstop.course);
    const retry = (): void => void this.startNonstopCourse(nonstop.course);
    if (pickActiveFamilyForScene(this.familyDispatchState(), 'result') === 'beatoraja') {
      const mounted = await this.showBeatorajaResult(result, {
        run: 'nonstop',
        course: { info },
        nonstopRetry: retry,
        ...(resolved !== undefined ? { playChart: resolved.chart } : {}),
      });
      if (mounted) {
        this.unlockPlaylogOptions();
        return;
      }
    }
    await this.showResult(result, { nonstop: { info, retry } });
  }

  /** Plays the running course's next stage, or shows the course result when it is over. */
  private async playNextCourseStage(): Promise<void> {
    const active = this.activeCourse;
    const stage = active !== undefined ? nextCourseStagePlay(active) : undefined;
    if (active === undefined || stage === undefined) {
      await this.showCourseResult();
      return;
    }
    this.setStatus(`${active.course.definition.name}: stage ${stage.index + 1} / ${stage.stageCount}`);
    await this.playSong(stage.stage, {
      courseStage: stage,
      ...(this.courseAutoPlay !== undefined ? { autoPlay: this.courseAutoPlay } : {}),
    });
  }

  /**
   * Called when a stage's result is dismissed during a course: the next stage starts, or the course result shows once
   * the course is over. Returns false outside a course.
   */
  private continueCourse(): boolean {
    if (this.activeCourse === undefined) return false;
    void (this.activeCourse.run.finished ? this.showCourseResult() : this.playNextCourseStage());
    return true;
  }

  /**
   * Ends the course run (EXPERT, GRADE or NONSTOP) when a navigation the scenes did not ask for takes over (the router's
   * `onInterrupt`: a drop, a skin or theme change, files or a play log loaded): the run is dropped unrecorded, so the
   * next single play is not taken for its next stage, and the select screen comes back where the course was started,
   * unless that navigation has put it somewhere already (a drop opens what it brought). Outside a run it does nothing.
   */
  private endCourseRun(): void {
    this.activeCourse = undefined;
    this.courseAutoPlay = undefined;
    if (this.courseReturnNavigation !== undefined) {
      this.lastSelectNavigation ??= this.courseReturnNavigation;
      this.courseReturnNavigation = undefined;
    }
  }

  /**
   * An LR2 skin for a course scene: the theme's skin parsed again with the course ops (290 + kind, 280-289 for a stage),
   * so its `#IF` blocks gated on them are taken as LR2 would. Falls back to the skin as mounted.
   */
  private courseLr2Skin(
    mounted: Lr2Skin | undefined,
    courseInfo: CourseView,
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
    const active = this.activeCourse;
    this.activeCourse = undefined;
    if (active === undefined || active.run.stagesPlayed === 0) {
      await this.showSelect();
      return;
    }
    const { course, run } = active;
    const courseLog = run.buildPlaylog({ createdAt: new Date().toISOString(), recorder: PLAYLOG_RECORDER });
    const result = courseLog.results?.native;
    if (result === undefined) {
      await this.showSelect();
      return;
    }
    this.recordCourseResult(resolveCourseRecordUpdate(courseLog, result, courseRecordKey(course)));
    this.maybeAutoSaveCoursePlaylog(courseLog);
    // The course is ranked as one run (its stages never go one by one); the rank lands in the status line.
    this.leaderboard.maybeSubmitCourse(courseLog, run.stages);
    const courseInfo = resolveCourseView(course);
    const histories = courseStageHistories(active);
    // A beatoraja theme shows the course result on its COURSE_RESULT skin (or its result skin).
    if (pickActiveFamilyForScene(this.familyDispatchState(), 'result') === 'beatoraja') {
      // The course run read as one play, as on the other families: beatoraja's course result sums the stages and draws
      // every stage's graph joined, each stage as wide as its chart is long.
      const joined = joinCourseStageHistories(
        histories,
        run.stages.map((song) => createCourseSongRecord(song).length ?? 0),
      );
      const runResult = buildCourseResultData(course, result, courseLog, joined, {
        playSeconds: run.playSeconds,
        stageHistories: histories,
      });
      const mounted = await this.showBeatorajaResult(runResult, {
        run: 'course',
        course: { info: courseInfo, result: { log: courseLog, native: result } },
      });
      if (mounted) {
        this.unlockPlaylogOptions();
        return;
      }
    }
    // LR2 (and the built-in result) shows the last stage's graph.
    const playSeconds = run.playSeconds;
    await this.showResult(buildCourseResultData(course, result, courseLog, histories.at(-1), { playSeconds }), {
      course: courseInfo,
      courseLog: { log: courseLog, native: result },
    });
  }

  /**
   * SHA-256 and MD5 (lowercase hex) of a song's source chart file, cached per entry id — the hashes feed the play-log
   * recording (`chart.sha256` / `chart.md5`) and dropped-log matching, and chart files are small enough that hashing
   * the whole library on a dropped log stays cheap.
   */
  private async resolveChartHashes(song: LibraryChart): Promise<ChartFileHashes | undefined> {
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
  private async resolveChartSha256(song: LibraryChart): Promise<string | undefined> {
    return (await this.resolveChartHashes(song))?.sha256;
  }

  /**
   * A chart's best record for the select skin's `frame.songRecord`. Records are keyed by chart hash, which is only known
   * once the chart has been hashed: the first lookup starts hashing it and answers from the path key meanwhile (where a
   * chart that could not be hashed keeps its record), so a skin sees the record a frame or two later.
   */
  private lookupSongRecord(song: LibraryChart): BeMusicSongRecord | undefined {
    if (this.songRecords.size === 0) {
      return undefined;
    }
    const hashes = this.chartHashCache.get(song.id);
    if (hashes === undefined) {
      void this.resolveChartHashes(song);
    }
    return this.songRecords.get(rulesetRecordKey(this.guiState.judgeRuleset, songRecordKey(song, hashes?.sha256)));
  }

  /** The best records of the current judge ruleset, by chart or course key: the ones the select screen shows. */
  private currentRulesetRecords(): { get(key: string): BeMusicSongRecord | undefined } {
    return rulesetRecords(this.songRecords, this.guiState.judgeRuleset);
  }

  /** Redraws the select screen in place with the records of the current judge ruleset, after it changed. */
  private refreshSelectRecords(): void {
    this.selectView?.setLibrary(this.collection);
  }

  /** Records the running play's result under its chart, when the play counts ({@link playRecordKey}). */
  private recordActivePlay(play: RecordPlay): void {
    if (this.activePlayRecordKey === undefined) return;
    this.recordSongResult(this.activePlayRecordKey, play);
    this.activePlayRecordKey = undefined;
  }

  /** Folds the running course stage into its chart's record ({@link mergeCourseStageRecord}), when the stage counts. */
  private recordActiveCourseStage(play: RecordPlay): void {
    const key = this.activeStageRecordKey;
    this.activeStageRecordKey = undefined;
    if (key === undefined) return;
    this.songRecords.set(key, mergeCourseStageRecord(this.songRecords.get(key), play));
    storeSongRecords(this.songRecords);
  }

  /** Folds a finished play into its chart's best record and persists the records. */
  private recordSongResult(key: string, play: RecordPlay): void {
    this.songRecords.set(key, mergeBestRecord(this.songRecords.get(key), play));
    storeSongRecords(this.songRecords);
  }

  /**
   * Keeps a course run's best lamp, EX score, course max combo and BP under the course's key, when the run keeps a
   * record ({@link resolveCourseRecordUpdate}).
   */
  private recordCourseResult(update: { key: string; play: RecordPlay } | undefined): void {
    if (update === undefined) return;
    this.songRecords.set(update.key, mergeBestRecord(this.songRecords.get(update.key), update.play));
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
    await this.leaveSelect();
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
      if (this.collection.charts.length > 0) {
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
    if (this.collection.charts.length > 0) {
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
      this.lastSelectNavigation = this.selectView.snapshot();
    }
    await this.router.dropSelect();
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
    if (folder === undefined) return;
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
    // A theme dropped during a play brings the picker in disabled, as the other skin controls are then.
    this.lr2ThemeController.enable(!this.skinControlsLocked);
    // lil-gui appends; move the row up next to the beatoraja pickers so the theme pickers read as one group.
    const beatorajaFolder = this.beatorajaSkinPickerFolder?.domElement;
    if (beatorajaFolder?.parentElement === folder.$children) {
      folder.$children.insertBefore(this.lr2ThemeController.domElement, beatorajaFolder);
    }
  }

  /**
   * Load a beatoraja theme drop in parallel with the LR2 path. The beatoraja loader is independent of `loadTheme` —
   * both states coexist so the user can drop both formats and switch between them later.
   */
  private async loadBeatorajaTheme(files: File[]): Promise<void> {
    this.setStatus('Loading beatoraja theme...');
    try {
      const bundle = await loadBeatorajaThemeFromFiles(files, {
        onProgress: (progress) => applyLoadProgress(this.elements, progress),
      });
      // Drop the per-entry texture caches from the previous theme (we don't destroy individual
      // beatoraja textures in this session — see `beatorajaKitCaches`'s field comment) and dispose its fonts.
      // Clearing the map releases the only reference to the old theme's decoded bytes; the
      // underlying Pixi textures stay allocated until page reload, but they're unreachable from
      // the renderer once the new theme replaces `beatorajaTheme`.
      releaseBeatorajaSceneKitAssets(this.beatorajaKitCaches);
      // Stop the skin sounds the previous theme's skins started at load time (a loop would otherwise keep playing).
      this.audio.stopOwned(this.themeOwner);
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
      // The skin sounds (`main_state.audio_*`) play through the audio service, which reads them from the theme's files:
      // those of the scenes made with `create*Scene` and those a skin starts at load time.
      this.audio.setTheme({ files: bundle.files });
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
      this.guiState.skinFamilyOverride = 'auto';
    }
    // The three skin systems are always listed; one without a loaded skin says so, and picking it asks for a drop.
    const options: Record<string, SkinFamilyOverride> = { 'Auto (prefer loaded theme)': 'auto' };
    options['Built-in'] = 'default';
    options[lr2Available ? 'LR2' : 'LR2 (drop a skin)'] = 'lr2';
    options[beatorajaAvailable ? 'beatoraja' : 'beatoraja (drop a skin)'] = 'beatoraja';
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
   * (its view is the family's — the LR2 or the built-in select view, or the beatoraja scene), then `showSelect`
   * reconstructs whichever family the new override resolves to. The gameplay
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

  /** The kit the built-in scenes draw with: the active be-music skin, its stored settings and the effect level. */
  private get builtInKit(): BuiltInKit {
    return {
      family: 'built-in',
      skin: this.beMusicSkin,
      settings: this.beMusicSkinSettings,
      effects: this.guiState.skinEffects,
    };
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

  /**
   * Hands the active be-music skin's settings to the scenes on screen (and to the select scene and a play loading off
   * it), which draw with them from their next frame.
   */
  private applyBeMusicSkinSettings(): void {
    for (const scene of new Set([this.router.select, this.router.play, this.router.current])) {
      if (scene?.identity.family === 'built-in') scene.updateKit(this.builtInKit);
    }
  }

  private handleSkinFamilyOverrideChange(value: SkinFamilyOverride): void {
    this.guiState.skinFamilyOverride = value;
    this.activeSkinSystem = value;
    this.skinFamilyController?.updateDisplay();
    if (this.lastSelectNavigation === undefined && this.selectView !== undefined) {
      this.lastSelectNavigation = this.selectView.snapshot();
    }
    // The select scene is made again for the family the pick gives.
    void this.router.dropSelect().then(() => this.showSelect());
  }

  /**
   * The beatoraja theme's play entry for `song`, loaded as a kit (`loadBeatorajaSceneKit`), with the entry the skin
   * pickers and the skin-options panel apply to; `undefined`, with the status saying why, when the theme has no play
   * skin for the chart or it fails to load.
   *
   * Two variants are in play: the skin's, which `play_*` entry to load (a theme without the chart's own falls back
   * through `pickBeatorajaPlayableSkinVariant`'s chain, `9 → 7 → 14 → 5 → 10`), and the chart's, which the play session
   * lays the lanes out for (`resolveLibraryChartPlayVariant`), so a 9 KEY chart keeps its POPN lanes on a 7 KEY
   * skin.
   */
  private async loadBeatorajaPlayKit(song: LibraryChart): Promise<
    | {
        readonly kit: BeatorajaKit;
        readonly entryPath: string;
        readonly header: BeatorajaSkinHeader;
        readonly variant: BeatorajaPlayableVariant;
      }
    | undefined
  > {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return undefined;
    const variant = resolveBeatorajaSkinVariant(bundle, song);
    const chartVariant = pickBeatorajaPlayableVariant(chartShapeFor(song));
    if (variant === undefined || chartVariant === undefined) {
      this.setStatus(`Beatoraja gameplay unavailable: no play skin for ${song.title}`);
      return undefined;
    }
    if (variant !== chartVariant) {
      // The skin's lane count differs from the chart's; the play keeps the chart's lanes.
      gameplayLog.warn(
        `beatoraja gameplay: theme has no '${chartVariant}' skin — falling back to '${variant}' (lane chrome may not match chart key count)`,
      );
    }
    // The entry for the variant, as the Debug Menu's skin picker overrides it.
    const playTypeCode = playSkinTypeForVariant(variant);
    const playCandidates = bundle.theme.entries.filter((entry) => entry.header.type === playTypeCode);
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      playTypeCode,
      playCandidates,
      bundle.theme.playSkins[variant],
    );
    if (selectedEntry === undefined) {
      gameplayLog.warn(`beatoraja gameplay: no skin entry for variant '${variant}'`);
      this.setStatus(`Beatoraja gameplay unavailable: no '${variant}' skin`);
      return undefined;
    }
    // Two-pass evaluation, as the select scene's; textures and fonts are reused when the entry's were decoded before. A
    // play skin's `main()` gets no load-time `main_state`: play skins gate on ops at draw time.
    const load = await loadBeatorajaSceneKit({
      files: bundle.files,
      entryPath: selectedEntry.entryPath,
      caches: this.beatorajaKitCaches,
      onSources: (sourceBundle) => {
        gameplayLog.info(
          `beatoraja gameplay source bundle: resolved=${sourceBundle.assets.length} unresolved=${sourceBundle.unresolved.length} (entry=${selectedEntry.entryPath})`,
        );
        for (const u of sourceBundle.unresolved) {
          gameplayLog.warn(`beatoraja gameplay unresolved source[${u.id}] '${u.path}': ${u.reason}`);
        }
      },
      onFonts: (loaded, declared) => {
        gameplayLog.info(
          `beatoraja gameplay fonts: declared=${declared} loaded=${loaded.values().length} (entry=${selectedEntry.entryPath})`,
        );
      },
    });
    if (!load.ok) {
      gameplayLog.warn(`beatoraja gameplay${load.stage === 'header' ? ' header' : ''}: ${load.message}`);
      this.setStatus(`Beatoraja gameplay unavailable: ${load.message}`);
      return undefined;
    }
    return {
      kit: { family: 'beatoraja', kit: load.kit },
      entryPath: selectedEntry.entryPath,
      header: load.header,
      variant,
    };
  }

  /**
   * The skin-options panel for the beatoraja play on the stage: its skin's `property[]` / `filepath[]`. A change reloads
   * the skin with the new options and hands it to the play (`applyBeatorajaPlaySkinConfig`), which carries on.
   */
  private refreshBeatorajaPlaySkinOptions(): void {
    const active = this.activeBeatorajaPlay;
    if (active === undefined || this.gameplayView?.identity.family !== 'beatoraja') return;
    this.refreshBeatorajaSkinOptionsGui({
      title: `Skin Config (Play ${active.variant}K)`,
      entryPath: active.entryPath,
      header: active.header,
      onApply: (nextConfig) => {
        void this.applyBeatorajaPlaySkinConfig(active.entryPath, nextConfig);
      },
    });
  }

  /**
   * Applies new skin options (or another play entry the Debug Menu picked) to the beatoraja play on the stage without
   * restarting the chart: the entry is loaded again with them (its textures decoded again, as an option can change
   * `source[]`) and handed to the play (`PlayScene.updateKit`), which rebuilds its skin and keeps its state.
   */
  private async applyBeatorajaPlaySkinConfig(entryPath: string, config: BeatorajaSkinConfig): Promise<void> {
    const bundle = this.beatorajaTheme;
    const view = this.gameplayView;
    const active = this.activeBeatorajaPlay;
    if (bundle === undefined || view === undefined || view.identity.family !== 'beatoraja' || active === undefined) {
      return;
    }
    const load = await loadBeatorajaSceneKit({
      files: bundle.files,
      entryPath,
      caches: this.beatorajaKitCaches,
      skinConfig: config,
      reloadTextures: true,
    });
    if (!load.ok || this.gameplayView !== view) return;
    view.updateKit({ family: 'beatoraja', kit: { ...load.kit, skinConfig: config } });
    this.activeBeatorajaPlay = { entryPath, header: load.header, variant: active.variant };
    this.refreshBeatorajaPlaySkinOptions();
  }

  /**
   * The beatoraja theme's select entry as a select kit, or `undefined` when there is none to show: no select skin in the
   * theme, or one that failed to load (the status says why). The player's pick in the Debug Menu wins over the
   * discovery's (`theme.selectSkin`). The entry is loaded with the player's options for it (`loadBeatorajaSceneKit`:
   * the header pass seeds them the first time), or the kit last loaded is taken again while the theme and the entry stay
   * the same.
   */
  private async loadBeatorajaSelectKit(): Promise<BeatorajaKit | undefined> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return undefined;
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
      return undefined;
    }
    const kept = this.beatorajaSelectKit;
    if (kept !== undefined && kept.bundle === bundle && kept.entryPath === selectedEntry.entryPath) return kept.kit;
    // The options' `filepath[]` picks (the header's default file of each wildcard the first time) choose the files of
    // `source[]`, as on the other screens.
    const load = await loadBeatorajaSceneKit({
      files: bundle.files,
      entryPath: selectedEntry.entryPath,
      caches: this.beatorajaKitCaches,
      onSources: (sourceBundle) => {
        gameplayLog.info(
          `beatoraja select source bundle: resolved=${sourceBundle.assets.length} unresolved=${sourceBundle.unresolved.length} (entry=${selectedEntry.entryPath})`,
        );
        for (const u of sourceBundle.unresolved) {
          gameplayLog.warn(`beatoraja select unresolved source[${u.id}] '${u.path}': ${u.reason}`);
        }
      },
    });
    if (!load.ok) {
      gameplayLog.warn(`beatoraja select: ${load.message}`);
      this.setStatus(`Beatoraja select unavailable: ${load.message}`);
      return undefined;
    }
    const kit: BeatorajaKit = { family: 'beatoraja', kit: load.kit };
    this.beatorajaSelectKit = { bundle, entryPath: selectedEntry.entryPath, kit, header: load.header };
    return kit;
  }

  /** The bottom-centre skin-options panel for the beatoraja select entry shown: its `property[]` / `filepath[]`. */
  private refreshBeatorajaSelectSkinOptions(): void {
    const shown = this.beatorajaSelectKit;
    if (shown === undefined) return;
    this.refreshBeatorajaSkinOptionsGui({
      title: 'Skin Config (Select)',
      entryPath: shown.entryPath,
      header: shown.header,
      onApply: (nextConfig) => {
        void this.applyBeatorajaSelectSkinConfig(shown.entryPath, nextConfig);
      },
    });
  }

  /**
   * Decode the chart's `#STAGEFILE` / `#BACKBMP` / `#BANNER` bitmaps to Pixi textures for the beatoraja scenes'
   * synthetic-id destinations (`-100` / `-101` / `-102`). Each is best-effort: a missing or malformed bitmap is left
   * out and the matching destinations stay hidden.
   */
  private loadBeatorajaChartImages(song: LibraryChart): Promise<BeatorajaChartImages> {
    return loadBeatorajaChartImages(song, resolveSongSource(this.collection, song));
  }

  /**
   * Applies the player's new options for a beatoraja select entry to the select screen shown, without making it again:
   * the skin's Lua `main()` runs again (or its JSON is parsed again) with them, its textures are decoded again (other
   * options can build another `source[]`), and the screen takes the kit (`updateKit`), keeping its place.
   */
  private async applyBeatorajaSelectSkinConfig(entryPath: string, config: BeatorajaSkinConfig): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (!bundle || this.selectView?.identity.family !== 'beatoraja') return;
    // Load the SPECIFIC entry — different from the discovery's "best" pick when the user picked an alternate skin from
    // the Debug Menu's skin-picker dropdown. A font cache miss (fonts may differ between skins) loads them fresh.
    const load = await loadBeatorajaSceneKit({
      files: bundle.files,
      entryPath,
      caches: this.beatorajaKitCaches,
      skinConfig: config,
      reloadTextures: true,
    });
    if (!load.ok || this.beatorajaTheme !== bundle) return;
    const kit: BeatorajaKit = { family: 'beatoraja', kit: load.kit };
    this.beatorajaSelectKit = { bundle, entryPath, kit, header: load.header };
    const select = this.selectView;
    if (select?.identity.family !== 'beatoraja') return;
    select.updateKit(kit);
    // The panel follows the entry's header, so its property dropdowns show the new skin's `property[]` schema.
    this.refreshBeatorajaSelectSkinOptions();
  }

  /**
   * The beatoraja theme's decide skin for `song`, loaded as a scene kit, or `undefined` when there is none to show: no
   * beatoraja theme, no decide skin in it, or one that failed to load. The player's pick in the Debug Menu wins over the
   * discovery's (`theme.decideSkin`, not `decideCandidates[0]`, which is only the first in the file walk).
   */
  private async loadBeatorajaDecideKit(song: LibraryChart): Promise<DecideSceneKit | undefined> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return undefined;
    const decideCandidates = bundle.theme.entries.filter((entry) => entry.header.type === BEATORAJA_SKIN_TYPE.DECIDE);
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      BEATORAJA_SKIN_TYPE.DECIDE,
      decideCandidates,
      bundle.theme.decideSkin,
    );
    if (selectedEntry === undefined) return undefined;
    // The skin's `main()` runs with the chart's difficulty ops, so themes that work out per-difficulty values as they
    // load (ModernChic's `CUSTOM.NUM.diffRGB()`) see one instead of crashing on `nil`. Textures and fonts reuse the
    // entry's cached ones or are decoded and registered fresh.
    const load = await loadBeatorajaSceneKit({
      files: bundle.files,
      entryPath: selectedEntry.entryPath,
      caches: this.beatorajaKitCaches,
      runtimeContext: (skinConfig) => this.buildBeatorajaSkinLoadContext(song, skinConfig),
    });
    if (!load.ok) {
      gameplayLog.warn(`beatoraja decide: ${load.message}`);
      return undefined;
    }
    return { family: 'beatoraja', kit: load.kit };
  }

  /**
   * The result of a play on the beatoraja play screen, on the theme's result skin: a course stage is recorded on the run
   * (its result shown unless the theme has no result skin, when the course goes straight on), a single play keeps its
   * record, saves its play log and goes to the Leaderboard. Without a result skin a single play goes back to select.
   */
  private async showBeatorajaPlayResult(data: PlayResult, courseStage: boolean): Promise<void> {
    this.testHook?.recordPlaylog(data.playlog);
    const active = this.activeCourse;
    if (courseStage && active !== undefined) {
      active.run.recordStage(data.playlog, data);
      this.recordActiveCourseStage(courseStageRecordPlayFromResult(data));
      const mounted = await this.showBeatorajaResult(data, {
        run: 'stage',
        course: { info: activeCourseInfo(active) },
      });
      if (!mounted) this.continueCourse();
      this.unlockPlaylogOptions();
      return;
    }
    this.recordActivePlay(recordPlayFromResult(data));
    const mounted = await this.showBeatorajaResult(data, { run: 'single' });
    if (!mounted) await this.showSelect();
    // Auto-save fires even when the theme ships no result skin, so going back to select costs no replay file.
    this.maybeAutoSavePlaylog(data.playlog);
    this.leaderboard.maybeSubmit(data.playlog, data.song);
    this.unlockPlaylogOptions();
  }

  /**
   * Mount the beatoraja result screen with `createResultScene`: `data`, a play's result (a single play, a replay or a
   * course stage on the beatoraja play screen), a NONSTOP run's (`run: 'nonstop'`, R stitching it again through
   * `options.nonstopRetry`) or, with `options.course.result`, a course run's, on the theme's result skin (its
   * course-result skin for a course run). `options.playChart` is the chart its graphs plot when it is not the last
   * beatoraja play's (`lastBeatorajaChart`): a NONSTOP run's stitched chart. Returns `true` when the screen actually
   * mounted, or a newer navigation took the stage first — `false` falls through to the no-result fast-path (no result
   * skin in the bundle, or skin load failed). The play behind it goes once the screen shows, its last samples ringing
   * out.
   */
  private async showBeatorajaResult(
    data: PlayResult,
    options: {
      run: PlayRunKind;
      course?: { info: CourseView; result?: { log: BeMusicCoursePlaylog; native: PlaylogCourseResult } };
      nonstopRetry?: () => void;
      playChart?: ResolvedPlayChart['chart'];
    },
  ): Promise<boolean> {
    const song = data.song;
    const course = options.course;
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return false;
    // The course result (`course.result`) shows on the theme's COURSE_RESULT skin, falling back to its result skin.
    const courseResult = course?.result !== undefined;

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

    // Phase-2 eval gets the chart's difficulty ops via `runtimeContext` so result themes that
    // pre-compute per-difficulty values at load time (mirroring the decide path's
    // ModernChic-style `diffRGB()` pattern) don't crash on `nil` indexing.
    const load = await loadBeatorajaSceneKit({
      files: bundle.files,
      entryPath: selectedEntry.entryPath,
      caches: this.beatorajaKitCaches,
      runtimeContext: (skinConfig) => this.buildBeatorajaSkinLoadContext(song, skinConfig),
    });
    if (!load.ok) {
      gameplayLog.warn(`beatoraja result: ${load.message}`);
      return false;
    }

    const run = options.run;
    const presentation = resolveResultPresentation(run);
    // The skin shows the course of the result: the stage's course, or the course run.
    const result: PlayResult =
      course !== undefined && data.course === undefined ? { ...data, course: course.info } : data;
    // The chart as the play played it, for any `bpmgraph[]` and note-kind graph of the result skin. The play is disposed
    // as the result shows, so the chart is kept in `lastBeatorajaChart`; it is only handed on when it is this song's, so a
    // graph never plots another chart. A course run's result plots none.
    const playChart =
      options.playChart ??
      (!courseResult && this.lastBeatorajaChart?.chartPath === song.chartPath
        ? this.lastBeatorajaChart.resolved.chart
        : undefined);
    // R on the result plays the same chart again — only offered when the recorded play start is this chart's, and
    // never in a course (beatoraja disables quick retry there); a NONSTOP run is stitched and played again.
    const lastPlay = this.lastPlay;
    const retryTarget = resolveResultRetry({
      quickRetry: presentation.quickRetry,
      ...(options.nonstopRetry !== undefined ? { nonstopRetry: options.nonstopRetry } : {}),
      songId: song.id,
      ...(lastPlay !== undefined ? { lastPlay: { songId: lastPlay.song.id, play: lastPlay } } : {}),
    });
    // beatoraja plays every result from its theme's one set: a course run's `course_clear` / `course_fail`, falling back
    // to the clear / fail ones, else the generic `result` one.
    const sounds = systemSoundSetFromBeatoraja({ bgm: this.beatorajaThemeBgm });
    const jingleBytes = resolveResultJingle(
      resolveResultJingles([sounds], presentation.courseJingles),
      result.cleared,
    )?.bytes;
    const onContinue = (): void => {
      // The next stage does not show at once, and a live result screen would keep taking its keys meanwhile: it goes
      // first.
      void this.leaveThen(() => {
        if (!courseResult && this.continueCourse()) return;
        void this.showSelect();
      });
    };
    const onRetry =
      retryTarget === undefined
        ? undefined
        : (): void => {
            // Straight back into the chart, the result screen gone first.
            void this.leaveThen(() => {
              if (retryTarget.kind === 'nonstop') retryTarget.retry();
              else void this.playSong(retryTarget.play.song, retryTarget.play.overrides);
            });
          };
    const resultScene = createResultScene(
      { family: 'beatoraja', kit: load.kit },
      {
        result,
        run,
        source: resolveSongSource(this.collection, song),
        ...(playChart !== undefined ? { playChart } : {}),
        sounds,
        audio: this.audio,
        on: { continue: onContinue, ...(onRetry !== undefined ? { retry: onRetry } : {}) },
      },
    );
    // The play exits as the result enters; its audio tail rings on until it is disposed (`preserveAudioTail`). The play
    // or the course asked for its result, so it carries the run on.
    const shown = await this.router.show(resultScene, {
      role: 'result',
      playDispose: disposeKeepingAudioTail,
      continuesRun: true,
    });
    if (!shown) return true;
    this.setPlayStatus(
      `Result (beatoraja): ${courseResult ? course!.info.title : song.title} · ex=${result.score.exScore} maxCombo=${result.maxCombo}`,
    );
    const jingle = this.nameResultJingle(jingleBytes);
    this.testHook?.recordResult(
      course?.result !== undefined
        ? resultFromCourseLog(course.result.log, course.result.native, { family: 'beatoraja', jingle })
        : resultFromData(result, run, 'beatoraja', jingle),
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
    const config = this.beatorajaSkinConfig(entryPath, matched.header);
    if (typeCode === BEATORAJA_SKIN_TYPE.MUSIC_SELECT && this.selectView?.identity.family === 'beatoraja') {
      void this.applyBeatorajaSelectSkinConfig(entryPath, config);
      return;
    }
    const play = this.activeBeatorajaPlay;
    if (
      this.gameplayView?.identity.family === 'beatoraja' &&
      play !== undefined &&
      playSkinTypeForVariant(play.variant) === typeCode
    ) {
      void this.applyBeatorajaPlaySkinConfig(entryPath, config);
    }
  }

  /**
   * Pick the cached skin config for an entry — falling back to a fresh defaults-fill from the
   * header's `property[]` / `filepath[]` schema (`resolveBeatorajaSkinConfig`). Mutating the returned object directly
   * mutates the cache, but the skin-options panel emits fresh copies on change so the cached state never becomes
   * accidentally shared with downstream consumers.
   */
  private beatorajaSkinConfig(entryPath: string, header: BeatorajaSkinHeader): BeatorajaSkinConfig {
    return resolveBeatorajaSkinConfig(
      this.beatorajaKitCaches,
      entryPath,
      header,
      this.beatorajaTheme?.files ?? new Map(),
    );
  }

  /**
   * The `main_state` a decide / result skin sees while its `main()` runs: the chart's difficulty ops and the skin
   * config's ops, with `main_state.audio_*` wired to the audio service's skin sounds, owned by the theme
   * (`createBeatorajaSkinLoadContext`).
   * ModernChic's decide.lua crashes its whole `main()` without the difficulty ops, and its `Root/customsound.lua` calls
   * the audio accessors from every panel toggle.
   */
  private buildBeatorajaSkinLoadContext(song: LibraryChart, skinConfig: BeatorajaSkinConfig) {
    return createBeatorajaSkinLoadContext({
      difficulty: song.chart.metadata.difficulty,
      skinConfig,
      skinAudio: this.audio.skinSounds.owned(this.themeOwner),
    });
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
    const config = this.beatorajaSkinConfig(args.entryPath, args.header);
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
        this.beatorajaKitCaches.skinConfigs.set(args.entryPath, next);
        args.onApply(next);
      },
    });
  }

  private async showSelect(): Promise<void> {
    // Back from a play or a result: the status line describes the library again instead of the play just left.
    if (this.playStatusShown) this.setStatus(describeSongCollection(this.collection));
    // Back from a course: the cursor returns to the course bar it was started from.
    if (this.courseReturnNavigation !== undefined && this.activeCourse === undefined) {
      this.lastSelectNavigation = this.courseReturnNavigation;
      this.courseReturnNavigation = undefined;
    }
    this.elements.shell.classList.remove('playing');
    this.unlockPlaylogOptions();
    // The `.empty` class drives the centered "Drop BMS folder…" hint. Toggle it off the moment we have charts to show,
    // and back on after a wipe / failed drop so the hint comes back instead of leaving the user staring at a blank
    // canvas.
    this.elements.shell.classList.toggle('empty', this.collection.charts.length === 0);
    // Family dispatch. The Debug Menu's "Skin family" pick overrides the auto chain (beatoraja → LR2 → default). The
    // beatoraja family draws the theme's select entry when the library has charts (an empty library shows the built-in
    // screen's drop hint); the LR2 family draws the loaded LR2 select skin when it has a bar list; otherwise the built-in
    // family draws the be-music skin.
    const activeFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'select');
    const beatorajaKit =
      activeFamily === 'beatoraja' && this.collection.charts.length > 0
        ? await this.loadBeatorajaSelectKit()
        : undefined;
    const lr2SelectSkin =
      activeFamily === 'lr2' && this.selectSkin !== undefined && this.selectSkin.barLayout.slots.length > 0
        ? this.selectSkin
        : undefined;
    const kit: SelectSceneKit =
      beatorajaKit ?? (lr2SelectSkin !== undefined ? { family: 'lr2', skin: lr2SelectSkin } : this.builtInKit);
    let carriedPlayOptions: PlayOptions | undefined;
    const current = this.selectView;
    if (current !== undefined && current.identity.family !== kit.family) {
      // The family changed (an LR2 or a beatoraja theme dropped while the built-in screen is up, or the other way
      // round): only that family's view draws it, so the screen is made again below, carrying the cursor and the live
      // play options across.
      this.lastSelectNavigation ??= current.snapshot();
      carriedPlayOptions = current.getPlayOptions();
      await this.router.dropSelect();
    }
    const sounds = this.selectSoundSet(kit.family);
    // Whatever shows (a play, a result, a decide splash, Escape from it included) exits as the select screen enters and
    // then goes, and so does a play loading behind a decide splash; the router keeps the select scene.
    const kept = this.selectView;
    if (kept) {
      // The latest theme's skin and sounds go onto the scene BEFORE it shows again: off the stage it only takes them, and
      // its BGM starts as it enters. The other way round, the previous theme's BGM would start for a moment.
      if (kit.family !== 'built-in') kept.updateKit(kit);
      kept.setSounds(sounds);
      kept.setLibrary(this.collection);
      if (!(await this.router.show(kept, { role: 'select' }))) return;
      if (this.lastSelectNavigation) kept.restore(this.lastSelectNavigation);
      if (kit.family === 'beatoraja') this.refreshBeatorajaSelectSkinOptions();
      return;
    }
    // Seed the screen's play options from the Debug Menu's "Play options" state (two-way sync: the screen's own edits
    // come back through `on.playOptions` below; lil-gui edits push through `setPlayOptions`).
    const playOptions: Partial<PlayOptions> = {
      ...carriedPlayOptions,
      autoPlay: this.guiState.autoPlay,
      gauge1P: this.guiState.gauge,
      random1P: this.guiState.random1P,
      random2P: this.guiState.random2P,
      dpFlip: this.guiState.dpFlip,
      autoScratch1P: this.guiState.autoScratch1P,
      autoScratch2P: this.guiState.autoScratch2P,
      sort: this.guiState.sort,
      keysFilter: this.guiState.keysFilter,
      difficultyFilter: this.guiState.difficultyFilter,
      hiSpeed: this.guiState.hiSpeed,
    };
    // The select session plays through the audio service; its decide jingle plays out through the decide screen into
    // the play.
    const scene = createSelectScene(kit, {
      library: this.collection,
      ...(this.lastSelectNavigation !== undefined ? { browse: this.lastSelectNavigation } : {}),
      playOptions,
      records: {
        chart: (song) => this.lookupSongRecord(song),
        course: (course) => lookupCourseRecord(course, this.currentRulesetRecords(), this.guiState.nonstopPlacement),
      },
      sounds,
      audio: this.audio,
      courseMaker: this.courseMaker,
      on: {
        start: (entry, { autoPlay }) => this.startFromSelect(entry, autoPlay),
        playOptions: (options) => {
          // Mirror the screen's play option edits (an LR2 panel, a skin's buttons) back into the Debug Menu state so
          // both surfaces always agree, then repaint the lil-gui controllers.
          this.guiState.autoPlay = options.autoPlay;
          this.guiState.gauge = options.gauge1P;
          this.guiState.random1P = options.random1P;
          this.guiState.random2P = options.random2P;
          this.guiState.dpFlip = options.dpFlip;
          this.guiState.autoScratch1P = options.autoScratch1P;
          this.guiState.autoScratch2P = options.autoScratch2P;
          this.guiState.sort = options.sort;
          this.guiState.keysFilter = options.keysFilter;
          this.guiState.difficultyFilter = options.difficultyFilter;
          if (options.hiSpeed !== this.guiState.hiSpeed) this.rememberHiSpeed(options.hiSpeed, 'select');
          this.refreshPlayOptionControllers();
        },
        search: () => this.search.openFromPointer(),
        // An LR2 skin's course name (text 170) and delete button (233): the panel names the course or confirms first.
        courseMaker: (action, course) => {
          if (action === 'name') this.courseMakerPanel?.focusName();
          else if (course !== undefined) this.courseMakerPanel?.confirmDelete(course.definition);
        },
        // A beatoraja skin's JUDGE TIMING button: the options are kept for the entry and the skin loaded again with
        // them, which also brings the skin-options panel's readout up to date.
        skinConfigChange: (config) => {
          const entryPath = this.beatorajaSelectKit?.entryPath;
          if (entryPath === undefined) return;
          this.beatorajaKitCaches.skinConfigs.set(entryPath, config);
          void this.applyBeatorajaSelectSkinConfig(entryPath, config);
        },
        // Escape at the root of a beatoraja select screen leaves it for the drop screen, as beatoraja's leaves the
        // player's select; coming back by a drop or a theme starts at the root.
        exit: () => {
          this.elements.shell.classList.add('empty');
          void this.router.dropSelect();
          this.lastSelectNavigation = undefined;
          this.beatorajaSkinOptionsGui?.clear();
        },
      },
    });
    if (!(await this.router.show(scene, { role: 'select' }))) return;
    if (kit.family === 'beatoraja') this.refreshBeatorajaSelectSkinOptions();
    this.scheduleFirstRunResolutionDetect();
  }

  /**
   * A chart or a course started on the select screen. While a course is being made, a chart joins it instead of playing
   * (as LR2 does); a course starts its run, or says why it cannot. Returns whether a play starts, so the screen plays
   * the decide jingle only then.
   */
  private startFromSelect(entry: SelectStartEntry, autoPlay: boolean): boolean {
    if (entry.kind === 'chart') {
      if (this.addSongToCourseBeingMade(entry.chart)) return false;
      // The skin's AUTOPLAY forces auto play for this play only; the Debug Menu's checkbox keeps its state.
      void this.showDecide(entry.chart, autoPlay ? { autoPlay: true } : {});
      return true;
    }
    void this.startCourse(entry.course, autoPlay ? { autoPlay: true } : {});
    return entry.course.playable;
  }

  /**
   * The select screen's sounds as a `SystemSoundSet` for the family drawing it: a beatoraja theme's cues and select BGM
   * (by path, read from the theme's files; its decide sound plays on its decide screen), or the LR2 theme's select BGM,
   * decide jingle and cues (by bytes); none without a theme.
   */
  private selectSoundSet(family: SelectSceneKit['family']): SystemSoundSet {
    if (family === 'beatoraja') {
      return systemSoundSetFromBeatoraja({
        paths: this.beatorajaSystemSoundPaths,
        ...(this.beatorajaSelectBgmPath !== undefined ? { selectBgmPath: this.beatorajaSelectBgmPath } : {}),
      });
    }
    const set: { -readonly [S in keyof SystemSoundSet]: SystemSoundSet[S] } = {};
    const add = (slot: keyof SystemSoundSet, bytes: Uint8Array | undefined): void => {
      if (bytes !== undefined) set[slot] = { bytes };
    };
    add('selectBgm', this.selectBgmBytes);
    add('decideBgm', this.decideBgmBytes);
    add('cursor', this.systemSoundBundle.cursorMove);
    add('folderOpen', this.systemSoundBundle.folderOpen);
    add('folderClose', this.systemSoundBundle.folderClose);
    add('optionOpen', this.systemSoundBundle.optionOpen);
    add('optionClose', this.systemSoundBundle.optionClose);
    add('optionChange', this.systemSoundBundle.optionChange);
    return set;
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
      if (
        this.selectView !== selectView ||
        selectView?.entered !== true ||
        readStoredRenderResolution() !== undefined
      ) {
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
            (this.selectView !== options.whileShowing || this.selectView?.entered !== true)),
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
   * directory still play the chart immediately. Every family's splash is `createDecideScene`'s: on the beatoraja family
   * the theme's decide entry, on the LR2 family the theme's decide skin, on the default family the be-music skin's own
   * decide screen, shown only when the skin declares one.
   *
   * The select screen's decide jingle, started as the chart was picked, plays on through the splash, which visually
   * masks the chart-load + gameplay-mount window that comes next. The beatoraja splash plays its theme's decide sound
   * itself.
   */
  private async showDecide(
    song: LibraryChart,
    overrides: { autoPlay?: boolean } = {},
    then?: DecideContinuation,
  ): Promise<void> {
    const start = then?.start ?? (() => this.playSong(song, overrides));
    // Family dispatch for the decide splash. Note this is decoupled from the gameplay family pick: a user can be
    // playing in LR2 mode and have a beatoraja-only decide skin, or vice versa. The decide splash is a one-shot
    // overlay so each scene transition consults the family helper afresh.
    const decideFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'decide', song);
    const playsOnBeatoraja = this.playsOnBeatoraja(song);
    const kit = await this.decideKitFor(decideFamily, song, playsOnBeatoraja);
    if (kit === undefined) {
      // No decide splash: a be-music skin without one, an LR2-only setup that didn't ship a decide skin, or a beatoraja
      // theme without a decide skin (or one that failed to load). The select screen's decide jingle still plays.
      await start();
      return;
    }
    // One navigation from here into the play: the play loading behind the splash, the splash and the play share it. A
    // course's splash (`then`) carries its run on; a chart's starts a run of its own.
    const token = this.router.begin({ continuesRun: then !== undefined });
    this.lastSelectNavigation = this.selectView?.snapshot();
    // The select screen goes off the stage (kept), and any decide splash or play left over goes.
    if (!(await this.router.leave({ token }))) return;
    // Build the gameplay view eagerly and kick off its heavy load (chart parse, audio decode, BGA preload) IN PARALLEL
    // with the Decide animation, off stage (`prepare` attaches nothing until the play is shown). The Decide splash
    // typically runs ~3 s; chart asset decoding is mostly done by the time the splash auto-advances, so the hand-off to
    // gameplay becomes instant instead of dropping a frozen frame.
    // A course starts its own play once the splash is done, so nothing is preloaded for it. The play is preloaded once the
    // decide screen is made, whichever family draws either, so it plays the `#RANDOM` branches the screen drew
    // (`DecideScene.resolved`).
    let preload: DecidePreload<PlayScene, DecidePlayOverrides> | undefined;
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
          // A course's play takes the stage from the splash as it starts.
          if (preload === undefined) {
            void start();
            return;
          }
          void this.startGameplayAfterDecide(song, preload, token);
        }),
      onCancel: () =>
        advance(() => {
          // User backed out of the splash: the select screen comes back, and the play prepared behind the splash goes.
          then?.cancel?.();
          void this.showSelect();
        }),
    };
    const playOptions = this.selectView?.getPlayOptions();
    const decide = createDecideScene(kit, {
      chart: song,
      ...(playOptions !== undefined
        ? { playOptions: { ...playOptions, autoPlay: overrides.autoPlay ?? this.guiState.autoPlay } }
        : {}),
      source: resolveSongSource(this.collection, song),
      // The LR2 / built-in select screen plays the theme's decide jingle as the chart is picked, and lets it ring on
      // into the play, so those screens play none of their own. The beatoraja screen plays its theme's decide sound.
      sounds: kit.family === 'beatoraja' ? systemSoundSetFromBeatoraja({ bgm: this.beatorajaThemeBgm }) : {},
      audio: this.audio,
      on: { continue: callbacks.onContinue, cancel: callbacks.onCancel },
    });
    if (then === undefined) {
      const options = { ...overrides, preResolved: decide.resolved };
      preload = { options, play: this.preloadGameplay(song, options, token) };
    }
    const shown = await this.router.show(decide, { role: 'decide', token });
    if (shown && kit.family === 'beatoraja') this.setStatus(`Decide (beatoraja): ${song.title}`);
  }

  /**
   * The kit the decide splash of `family` is drawn with, or `undefined` for no splash: the beatoraja theme's decide
   * entry, the LR2 theme's decide skin, or the be-music skin's decide screen. A be-music skin's decide screen hands over
   * to the LR2 / default gameplay preloaded behind it, so it is skipped when the play itself runs on a beatoraja theme.
   */
  private async decideKitFor(
    family: SkinFamilyId,
    song: LibraryChart,
    playsOnBeatoraja: boolean,
  ): Promise<DecideSceneKit | undefined> {
    switch (family) {
      case 'beatoraja':
        return this.loadBeatorajaDecideKit(song);
      case 'lr2':
        return this.decideSkin !== undefined ? { family: 'lr2', skin: this.decideSkin } : undefined;
      default:
        return this.beMusicSkin.decide !== undefined && !playsOnBeatoraja ? this.builtInKit : undefined;
    }
  }

  /**
   * Makes the play scene (`createPlayScene`) with the current play-options snapshot and has the router load it off
   * stage (`prepare`) for the navigation `token`. The returned promise resolves to that play once chart audio is decoded
   * (`undefined` when a newer navigation replaced it) — the host awaits it inside the Decide `onContinue` handler and
   * shows that play.
   *
   * Wired up here (rather than inline in `showDecide`) because the same option-marshalling + callback wiring is needed
   * whether we're going through Decide or the no-decide fast-path. `playSong` shares this construction shape.
   */
  private async preloadGameplay(
    song: LibraryChart,
    overrides: { autoPlay?: boolean; preResolved?: ResolvedPlayChart },
    token: SceneRouteToken,
  ): Promise<PlayScene | undefined> {
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;
    // The same kit as `playSong` picks, so the decide → gameplay preload path stays consistent with the no-decide
    // fast-path.
    const kit = await this.resolvePlayKit(song, {});
    if (kit === undefined) throw new Error(`no play skin for ${song.title}`);
    const chartHashes = await this.resolveChartHashes(song);
    const view = this.buildPlayScene(song, kit, { ...overrides, chartHashes });
    return (await this.router.prepare(view, { token })) ? view : undefined;
  }

  /**
   * The kit `song` plays with, for the gameplay family the Debug Menu's "Skin family" pick (or the auto chain) gives it:
   *
   * - **beatoraja** (`playsOnBeatoraja`, a replay and a stitched NONSTOP chart included) → the theme's play entry
   *   (`loadBeatorajaPlayKit`); `undefined` when it cannot be loaded.
   * - **LR2** with a play skin for the chart's key mode → an LR2 kit with that skin (parsed again with the course's ops
   *   for a course stage or a NONSTOP run), and the theme's 9-keys skin, whose Pop'n green wide note at index 3 is drawn
   *   over each invisible note when {@link DemoGuiState.showInvisibleNotes} is on.
   * - otherwise → the built-in kit with the active be-music skin.
   */
  private async resolvePlayKit(
    song: LibraryChart,
    overrides: { courseStage?: CourseStagePlay; nonstop?: NonstopPlay },
  ): Promise<PlaySceneKit | undefined> {
    if (this.playsOnBeatoraja(song)) {
      const loaded = await this.loadBeatorajaPlayKit(song);
      this.activeBeatorajaPlay =
        loaded !== undefined
          ? { entryPath: loaded.entryPath, header: loaded.header, variant: loaded.variant }
          : undefined;
      return loaded?.kit;
    }
    this.activeBeatorajaPlay = undefined;
    // Picking `'default'` from the Debug Menu strips the LR2 skin even when one is loaded for this chart.
    const gameplayFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'gameplay', song);
    const playSkin =
      gameplayFamily !== 'lr2'
        ? undefined
        : overrides.courseStage !== undefined || overrides.nonstop !== undefined
          ? this.courseLr2Skin(
              pickLr2PlaySkin(this.playSkins, song),
              overrides.courseStage?.courseInfo ?? resolveCourseView(overrides.nonstop!.course, 0),
              { kind: 'play', playVariant: pickLr2PlaySkinVariant(this.playSkins, song) },
            )
          : pickLr2PlaySkin(this.playSkins, song);
    if (playSkin === undefined) return this.builtInKit;
    const invisibleNoteSkin = this.playSkins['9'];
    return { family: 'lr2', skin: playSkin, ...(invisibleNoteSkin !== undefined ? { invisibleNoteSkin } : {}) };
  }

  /**
   * Makes the play scene for `song` with `kit` (`resolvePlayKit`: built-in, LR2 or beatoraja) and the current option
   * snapshot (`createPlayScene`). Every family shares every other option, so `preloadGameplay` and `playSong` marshal
   * them in one place.
   */
  private buildPlayScene(
    song: LibraryChart,
    kit: PlaySceneKit,
    overrides: {
      autoPlay?: boolean;
      replay?: BeMusicPlaylog;
      chartHashes?: ChartFileHashes;
      courseStage?: CourseStagePlay;
      nonstop?: NonstopPlay;
      preResolved?: ResolvedPlayChart;
    },
  ): PlayScene {
    const playOptions = this.selectView?.getPlayOptions();
    const replay = overrides.replay;
    const courseStage = overrides.courseStage;
    const nonstop = overrides.nonstop;
    const autoPlay = overrides.autoPlay ?? this.guiState.autoPlay;
    this.lastPlay = { song, overrides: { autoPlay, ...(replay !== undefined ? { replay } : {}) } };
    // A course limits the lane options (both sides and DP FLIP) to what its constraint allows (`grade` none,
    // `grade_mirror` MIRROR, ...), a NONSTOP course's stitched play included, and an LR2 GRADE course also turns off
    // what LR2 turns off when one starts (EASY gauge, HIDDEN / SUDDEN, auto scratch, FLIP, the tempo).
    const picked = {
      random1P: this.guiState.random1P,
      random2P: this.guiState.random2P,
      dpFlip: this.guiState.dpFlip,
      gauge: this.guiState.gauge,
      hiddenSudden1P: playOptions?.hiddenSudden1P ?? ('OFF' as const),
      hiddenSudden2P: playOptions?.hiddenSudden2P ?? ('OFF' as const),
      autoScratch1P: this.guiState.autoScratch1P,
      autoScratch2P: this.guiState.autoScratch2P,
      tempo:
        replay !== undefined && this.guiState.replayView.tempo
          ? (replay.play.tempo ?? 1)
          : tempoFromPercent(this.guiState.tempoPercent),
    };
    const lanes =
      this.activeCourse !== undefined && courseStage !== undefined
        ? this.activeCourse.run.playSettings(picked)
        : nonstop !== undefined
          ? resolveCourseStagePlaySettings(nonstop.course.definition, picked)
          : picked;
    const tempo = lanes.tempo;
    // Only a play the player actually played counts towards the chart's best record; a course stage counts for the
    // course instead.
    // A play at another tempo is practice: it is not ranked, and leaves the records alone too.
    // A play keeps the record of the judge ruleset it runs under (a replay keeps none).
    const judgeRuleset = this.guiState.judgeRuleset;
    this.activePlayRecordKey = playRecordKey(song, overrides.chartHashes?.sha256, {
      autoPlay,
      replay: replay !== undefined,
      course: courseStage !== undefined || nonstop !== undefined,
      tempo,
      judgeRuleset,
    });
    // An EXPERT / GRADE stage also updates its chart's record, as LR2 does (not a NONSTOP run's stitched play).
    this.activeStageRecordKey =
      courseStage !== undefined
        ? courseStageRecordKey(song, overrides.chartHashes?.sha256, {
            autoPlay,
            replay: replay !== undefined,
            tempo,
            judgeRuleset,
          })
        : undefined;
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
      hiddenSudden1P: lanes.hiddenSudden1P,
      hiddenSudden2P: lanes.hiddenSudden2P,
      shutter: playOptions?.shutter,
      laneCover: playOptions?.laneCover,
      // Replay playback restores the RECORDED play setup: the log's auto-scratch / gauge / judge ruleset govern
      // judging and the gauge readout, and the lane transforms stay off because the view re-applies the recorded
      // arrangement directly (see `PlaySceneOptions.replay`).
      autoScratch1P: replay !== undefined ? replay.play.autoScratch : lanes.autoScratch1P,
      autoScratch2P: replay !== undefined ? false : lanes.autoScratch2P,
      dpFlip: replay !== undefined ? false : lanes.dpFlip,
      random1P: replay !== undefined ? ('OFF' as const) : lanes.random1P,
      random2P: replay !== undefined ? ('OFF' as const) : lanes.random2P,
      gauge: replay !== undefined ? replay.play.gauge : lanes.gauge,
      ...(courseStage !== undefined
        ? { course: courseStage.course, courseInfo: courseStage.courseInfo, hiSpeedLocked: courseStage.hiSpeedLocked }
        : {}),
      ...(nonstop !== undefined
        ? {
            course: resolveCourseStageSettings(nonstop.course.definition),
            courseInfo: resolveCourseView(nonstop.course, 0),
            nonstop: nonstop.prepared.stitched.map,
          }
        : {}),
      // A replay plays at the tempo its log recorded (the scene reads it from `replay`); the pitch setting applies to
      // the song tempo and NONSTOP FIT stages alike.
      tempo,
      tempoPitchMode: this.guiState.tempoPitchMode,
      tempoStretchAlgorithm: this.guiState.tempoStretchAlgorithm,
      // A tempo change during the play (the tempo slider in pitch mode, or a replay following its log).
      onTempoChange: (changed: number) => this.followLiveTempo(changed),
      ...(replay === undefined ? { judgeRuleset: this.guiState.judgeRuleset } : {}),
      ...(overrides.chartHashes !== undefined
        ? { chartSha256: overrides.chartHashes.sha256, chartMd5: overrides.chartHashes.md5 }
        : {}),
      playlogRecorder: PLAYLOG_RECORDER,
      replay,
      // What the replay shows of the recorded view (the Debug Menu's "Replay / ghost" toggles, latched at song start).
      replayView: { ...this.guiState.replayView },
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
        const active = courseStage !== undefined ? this.activeCourse : undefined;
        const exit = resolveGameplayExit({ courseStage: active !== undefined, nonstop: nonstop !== undefined });
        if (exit === 'give-up-course') {
          void (async () => {
            const playlog = await view?.waitForPlaylog();
            this.testHook?.recordPlaylog(playlog);
            active!.run.giveUp(playlog);
            this.activeCourse = active;
            await this.showCourseResult();
          })();
          return;
        }
        if (exit === 'nonstop-result') {
          // The stitched chart as the play played it, for a beatoraja result skin's graphs.
          const resolved = view?.resolved;
          void (async () => {
            await this.showNonstopCourseResult(nonstop!, await view?.waitForPlaylog(), undefined, resolved);
          })();
          return;
        }
        void this.showSelect();
      },
      onChartFinished: (result: PlayResult) => {
        if (nonstop !== undefined) {
          const resolved = this.gameplayView?.resolved;
          void this.showNonstopCourseResult(nonstop, result.playlog, result, resolved);
          return;
        }
        // A course stage with stage results skipped (or an auto-played one the course goes on after, as LR2 skips it)
        // goes straight on to the next stage (or the course result).
        if (
          courseStage !== undefined &&
          this.activeCourse !== undefined &&
          skipsCourseStageResult({
            skipStageResults: this.guiState.courseAutoAdvance,
            autoPlay,
            courseGoesOn: this.activeCourse.run.goesOnAfter(result.playlog),
          })
        ) {
          void (async () => {
            this.testHook?.recordPlaylog(result.playlog);
            this.activeCourse?.run.recordStage(result.playlog, result);
            this.recordActiveCourseStage(courseStageRecordPlayFromResult(result));
            // No screen comes between the stages: the play leaves the stage, its last samples ringing out, and the next
            // stage (or the course result) shows.
            if (!(await this.router.leave({ playDispose: disposeKeepingAudioTail, continuesRun: true }))) return;
            this.unlockPlaylogOptions();
            this.continueCourse();
          })();
          return;
        }
        if (kit.family === 'beatoraja') {
          // The beatoraja result plots the chart as the play played it.
          const resolved = this.gameplayView?.resolved;
          if (resolved !== undefined) this.lastBeatorajaChart = { resolved, chartPath: song.chartPath };
          void this.showBeatorajaPlayResult(result, courseStage !== undefined);
          return;
        }
        void this.showResult(result);
      },
      onRestart: () => {
        // A NONSTOP course allows quick retry, as LR2 does (OpenLR2 L2854); in a course stage F5 gives the course up.
        const restart = resolveGameplayRestart({
          courseStage: courseStage !== undefined,
          nonstop: nonstop !== undefined,
        });
        if (restart === 'restitch') {
          void this.startNonstopCourse(nonstop!.course);
          return;
        }
        if (restart === 'abandon-course') {
          this.activeCourse = undefined;
          void this.showSelect();
          return;
        }
        // A single chart plays again as it was played: AUTO stays AUTO, a replay stays a replay (`playAgainOverrides`).
        void this.playSong(song, playAgainOverrides({ autoPlay, replay }));
      },
    };
    const {
      onExit,
      onChartFinished,
      onRestart,
      onHiSpeedChange,
      onTempoChange,
      replay: replayLog,
      course,
      courseInfo,
      ...settings
    } = sharedOptions;
    const source = resolveSongSource(this.collection, song);
    return createPlayScene(kit, {
      chart: song,
      ...(source !== undefined ? { source } : {}),
      settings:
        kit.family === 'built-in'
          ? { ...settings, layoutMode: resolvePlayLayoutMode(this.guiState.playLayout, deviceProfile) }
          : settings,
      ...(course !== undefined
        ? { course: { stage: course, ...(courseInfo !== undefined ? { view: courseInfo } : {}) } }
        : {}),
      ...(replayLog !== undefined ? { replay: replayLog } : {}),
      ...(overrides.preResolved !== undefined ? { preResolved: overrides.preResolved } : {}),
      audio: this.audio,
      host: this.sceneHost,
      ...(playOptions !== undefined ? { playOptions } : {}),
      on: {
        exit: onExit,
        finish: (result) => onChartFinished(result),
        restart: onRestart,
        hiSpeed: onHiSpeedChange,
        tempo: onTempoChange,
      },
    });
  }

  /**
   * Tears the Decide splash down and hands the stage over to the play prepared behind it (`preload`), that play and no
   * other. Awaits the preload: when the user dismisses Decide before chart audio has finished decoding, the splash's
   * last frame stays on screen until prepare resolves — visually a brief hold rather than the previous frozen-frame
   * freeze. A preload that failed makes the play again without one, with the splash's draws (`preResolved`).
   */
  private async startGameplayAfterDecide(
    song: LibraryChart,
    preload: DecidePreload<PlayScene, DecidePlayOverrides>,
    token: SceneRouteToken,
  ): Promise<void> {
    const handOff = await settleDecidePreload(preload, () => this.router.isCurrent(token));
    if (handOff.kind === 'stale') return;
    if (handOff.kind === 'reload') {
      // The play that failed to load is gone already; the splash goes as the play made again takes the stage.
      gameplayLog.warn('preload failed; falling back to no-decide path', handOff.error);
      await this.playSong(song, handOff.options);
      return;
    }
    const view = handOff.play;
    this.elements.shell.classList.add('playing');
    this.lastSelectNavigation = this.selectView?.snapshot();
    // The splash hands the stage over: it exits as the prepared play enters, then goes.
    if (!(await this.router.show(view, { role: 'play', token }))) return;
    this.setPlayStatus(
      describePlayingStatus(song.title, {
        ...playingFamily(view),
        tempoPercent: this.guiState.tempoPercent,
        replay: this.lastPlay?.overrides.replay !== undefined,
      }),
    );
    this.lockPlaylogOptionsForPlay(
      allowsLiveTempo(this.guiState, {
        replay: this.lastPlay?.overrides.replay !== undefined,
        tempo: view.getTempo(),
      }),
    );
    view.start();
    startArmedRecording(this.recordingDeps());
    this.refreshBeatorajaPlaySkinOptions();
  }

  /**
   * Whether a play of `song` runs on the beatoraja play screen: the gameplay family says so, whatever the play is (a
   * replay and a stitched NONSTOP chart included: the play session carries the play-log arrangement and the per-stage
   * audio for every family). Every path into gameplay — `playSong`, and the decide splash deciding what to preload — asks
   * this one question.
   */
  private playsOnBeatoraja(song: LibraryChart): boolean {
    return pickActiveFamilyForScene(this.familyDispatchState(), 'gameplay', song) === 'beatoraja';
  }

  private async playSong(
    song: LibraryChart,
    overrides: {
      autoPlay?: boolean;
      replay?: BeMusicPlaylog;
      courseStage?: CourseStagePlay;
      nonstop?: NonstopPlay;
      /** The chart as a decide screen drew it, for a play made again after its preload failed. */
      preResolved?: ResolvedPlayChart;
    } = {},
  ): Promise<void> {
    this.elements.shell.classList.add('playing');
    // A course stage or a NONSTOP run carries its course on; any other play (a replay dropped meanwhile included) starts
    // a run of its own.
    const token = this.router.begin({
      continuesRun: overrides.courseStage !== undefined || overrides.nonstop !== undefined,
    });
    this.lastSelectNavigation = this.selectView?.snapshot();
    // The select screen goes off the stage (kept) while the play is made. A decide splash goes before the play shows —
    // a live one would keep taking its keys and clicks — and so does a play being restarted (F5).
    if (!(await this.router.leave({ token }))) return;
    // Refresh the recording filename base for the upcoming play — each session writes to a unique file in the user's
    // downloads folder rather than overwriting the previous one.
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;
    // The kit for the gameplay family the Debug Menu's "Skin family" pick (or the auto chain, beatoraja → LR2 →
    // default) gives the chart, a replay and a NONSTOP run included (`playsOnBeatoraja`). `preloadGameplay` asks the
    // same.
    const kit = await this.resolvePlayKit(song, overrides);
    if (kit === undefined) {
      void this.showSelect();
      return;
    }
    // Chart-file hash for the recorded play-log (skipped for replays — they record nothing — and for a stitched
    // NONSTOP chart, which has no file).
    const chartHashes =
      overrides.replay === undefined && overrides.nonstop === undefined
        ? await this.resolveChartHashes(song)
        : undefined;
    const view = this.buildPlayScene(song, kit, { ...overrides, chartHashes });
    // A replay plays at its recorded tempo, unless the Replay / ghost options keep the viewer's own.
    const tempoPercent =
      overrides.replay !== undefined ? tempoPercentFromTempo(view.getTempo()) : this.guiState.tempoPercent;
    this.setPlayStatus(
      describePlayingStatus(song.title, {
        ...playingFamily(view),
        tempoPercent,
        replay: overrides.replay !== undefined,
      }),
    );
    this.lockPlaylogOptionsForPlay(
      allowsLiveTempo(this.guiState, { replay: overrides.replay !== undefined, tempo: view.getTempo() }),
    );
    // No splash covers the load window here: the play shows first, so `prepare` draws the playfield in its loading
    // state while the chart's audio decodes, then the play starts.
    if (!(await this.router.show(view, { role: 'play', token }))) return;
    if (!(await this.router.prepare(view, { token }))) return;
    view.start();
    // Consume the "user pressed Record on the select screen" flag now that gameplay is prepared — `startRecording`
    // requires the gameplay AudioContext to exist, which only happens after `prepare`. Failing here is non-fatal: the
    // select-screen click already nudged the user that capture would start; if it doesn't (codec missing / no
    // MediaRecorder), the surfaced error replaces the armed status without breaking gameplay.
    startArmedRecording(this.recordingDeps());
  }

  /**
   * Mounts the result scene for a play, or — with `mode.course` — for a whole course (the course result, shown on the
   * LR2 theme's course-result skin when it has one).
   */
  private async showResult(
    data: PlayResult,
    mode: {
      course?: CourseView;
      /** The course result's play log and native result (what the test hook reports of it). */
      courseLog?: { log: BeMusicCoursePlaylog; native: PlaylogCourseResult };
      nonstop?: { info: CourseView; retry: () => void };
    } = {},
  ): Promise<void> {
    // A stage of a running course: its play log carries the course on, and dismissing its result plays the next stage.
    const courseStage = mode.course === undefined && mode.nonstop === undefined && this.activeCourse !== undefined;
    const run =
      mode.course !== undefined ? 'course' : mode.nonstop !== undefined ? 'nonstop' : courseStage ? 'stage' : 'single';
    const presentation = resolveResultPresentation(run);
    if (courseStage) {
      this.activeCourse!.run.recordStage(data.playlog, data);
      this.recordActiveCourseStage(courseStageRecordPlayFromResult(data));
    }
    // Family dispatch for result. Only the LR2 / default split is modelled here — a play on the beatoraja play screen
    // shows its result on the beatoraja skin (`showBeatorajaPlayResult`), a NONSTOP run on a beatoraja theme too
    // (`showNonstopCourseResult`), and one whose theme has no result skin falls back to the built-in result with the
    // theme's jingles. Pick the LR2 result skin only when the family pick says so; defaulting strips the slot even if
    // the loaded theme has a result skin.
    const resultFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'result');
    // A course's results show the course on the skin (LR2 ops 280-293, texts 150-170): a stage's result at its stage,
    // the course result on the course-result skin, each parsed again with the course ops.
    const courseInfo =
      mode.course ?? mode.nonstop?.info ?? (courseStage ? activeCourseInfo(this.activeCourse!) : undefined);
    const mountedResultSkin = presentation.courseResultSkin
      ? (this.courseResultSkin ?? this.resultSkin)
      : this.resultSkin;
    const lr2ResultSkin =
      resultFamily !== 'lr2'
        ? undefined
        : courseInfo === undefined
          ? mountedResultSkin
          : this.courseLr2Skin(mountedResultSkin, courseInfo, {
              kind: presentation.courseResultSkin && this.courseResultSkin !== undefined ? 'courseResult' : 'result',
            });
    // R on the result plays the same chart again — only offered when the recorded play start is this chart's, and
    // never in a course (LR2 and beatoraja disable quick retry there), except that a NONSTOP run is stitched and played
    // again, as LR2 allows.
    const lastPlay = this.lastPlay;
    const retryTarget = resolveResultRetry({
      quickRetry: presentation.quickRetry,
      ...(mode.nonstop !== undefined ? { nonstopRetry: mode.nonstop.retry } : {}),
      songId: data.song.id,
      ...(lastPlay !== undefined ? { lastPlay: { songId: lastPlay.song.id, play: lastPlay } } : {}),
    });
    const retry =
      retryTarget?.kind === 'nonstop'
        ? retryTarget.retry
        : retryTarget?.kind === 'replay'
          ? () => void this.playSong(retryTarget.play.song, retryTarget.play.overrides)
          : undefined;
    // The active theme's jingles: a beatoraja theme's when its result falls back to this view (a NONSTOP course on a
    // theme without a result skin).
    const themeJingles = {
      lr2: {
        clear: this.clearBgmBytes,
        fail: this.failBgmBytes,
        result: this.resultBgmBytes,
        courseClear: this.courseClearBgmBytes,
        courseFail: this.courseFailBgmBytes,
      },
      beatoraja: this.beatorajaThemeBgm,
    };
    const jingles = resolveResultViewJingles(resultFamily, presentation.courseJingles, themeJingles);
    const onContinue = (): void => {
      if (courseStage && this.activeCourse !== undefined) {
        // The next stage does not show at once, and a live result screen would keep taking its clicks and keys (Enter /
        // Space / Escape) meanwhile, starting it over: it goes first.
        void this.leaveThen(() => this.continueCourse());
        return;
      }
      void this.showSelect();
    };
    const onRetry =
      retry === undefined
        ? undefined
        : (): void => {
            // Straight back into the chart, skipping select and decide: the result screen (and its jingle) goes first.
            void this.leaveThen(retry);
          };
    const kit: ResultSceneKit = lr2ResultSkin !== undefined ? { family: 'lr2', skin: lr2ResultSkin } : this.builtInKit;
    const resultScene = createResultScene(kit, {
      // The LR2 skin shows the course of the result (`result.course`): the stage's course, or the course run.
      result: lr2ResultSkin !== undefined && courseInfo !== undefined ? { ...data, course: courseInfo } : data,
      run,
      source: resolveSongSource(this.collection, data.song),
      sounds: resolveResultSoundSet(resultFamily, themeJingles),
      audio: this.audio,
      on: { continue: onContinue, ...(onRetry !== undefined ? { retry: onRetry } : {}) },
    });
    // The play exits as the result enters; its audio tail rings on until it is disposed (`preserveAudioTail`). The play
    // or the course asked for its result, so it carries the run on.
    const shown = await this.router.show(resultScene, {
      role: 'result',
      playDispose: disposeKeepingAudioTail,
      continuesRun: true,
    });
    // A newer navigation that took the stage first keeps its own status; the play is still kept, saved and ranked.
    if (shown) this.setPlayStatus(`Result: ${data.song.title}`);
    if (this.testHook !== undefined) {
      if (mode.course === undefined) this.testHook.recordPlaylog(data.playlog);
      const family = lr2ResultSkin !== undefined ? 'lr2' : 'built-in';
      const jingle = this.nameResultJingle(data.cleared ? jingles.clearBgm : jingles.failBgm);
      if (shown) {
        this.testHook.recordResult(
          mode.courseLog !== undefined
            ? resultFromCourseLog(mode.courseLog.log, mode.courseLog.native, {
                family,
                playSeconds: data.playSeconds,
                jingle,
              })
            : resultFromData(data, run, family, jingle),
        );
      }
    }
    this.recordActivePlay(recordPlayFromResult(data));
    // A course's stages are saved and ranked as the course, not one by one (a NONSTOP run's course log already was).
    if (presentation.quickRetry && mode.nonstop === undefined) {
      this.maybeAutoSavePlaylog(data.playlog);
      this.leaderboard.maybeSubmit(data.playlog, data.song);
    }
    this.unlockPlaylogOptions();
  }

  /**
   * Latches the playlog-related GUI options for the play that is about to start and disables their controllers.
   * Playlog options are per-play: the value in effect at song start governs the whole play, and mid-song changes
   * are rejected by keeping the controls disabled until {@link unlockPlaylogOptions} runs (result mounted or back
   * at select). The skin controls are disabled with them ({@link setSkinControlsLocked}).
   */
  private lockPlaylogOptionsForPlay(liveTempo = false): void {
    this.activePlayAutoSavePlaylog = this.guiState.autoSavePlaylog;
    this.playlogSaveController?.disable();
    this.leaderboard.lockForPlay();
    for (const controller of this.playOptionControllers) {
      controller.disable();
    }
    this.setSkinControlsLocked(true);
    // The tempo slider changes this play's tempo live (`allowsLiveTempo`).
    this.liveTempoPlay = liveTempo;
    if (liveTempo) this.tempoController?.enable();
  }

  /**
   * Follows a tempo change during the play: the status line shows the new tempo, and a play that ran at another tempo
   * at any point is practice, so it leaves the records alone (the Leaderboard refuses its log as `tempo`).
   */
  private followLiveTempo(tempo: number): void {
    const title = this.lastPlay?.song.title;
    if (title !== undefined) {
      this.setPlayStatus(
        describePlayingStatus(title, {
          ...(this.gameplayView !== undefined ? playingFamily(this.gameplayView) : {}),
          tempoPercent: tempoPercentFromTempo(tempo),
          replay: this.lastPlay?.overrides.replay !== undefined,
        }),
      );
    }
    if (tempo !== 1) {
      this.activePlayRecordKey = undefined;
      this.activeStageRecordKey = undefined;
    }
  }

  /** Re-enables the playlog option controllers, and the skin controls, once no play is in flight. */
  private unlockPlaylogOptions(): void {
    this.liveTempoPlay = false;
    this.playlogSaveController?.enable();
    this.leaderboard.unlock();
    for (const controller of this.playOptionControllers) {
      controller.enable();
    }
    this.setSkinControlsLocked(false);
  }

  /**
   * Disables the Debug Menu's skin controls for a play, or enables them again: Skin system, Built-in skin, Skin
   * effects, the LR2 theme picker and the Add skin buttons all make the select screen again, which would end the play.
   * A drop during a play still can; the router then ends the course run ({@link endCourseRun}).
   */
  private setSkinControlsLocked(locked: boolean): void {
    this.skinControlsLocked = locked;
    for (const controller of [this.skinFamilyController, this.lr2ThemeController, ...this.skinControllers]) {
      controller?.enable(!locked);
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
