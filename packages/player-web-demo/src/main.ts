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
  resolveCourseView,
  resolveResultJingle,
  resolveResultJingles,
  snapHiSpeed,
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
import type { BeMusicSkin } from '@be-music/skin-sdk';
import {
  createBeatorajaSceneKitCaches,
  createBeatorajaSkinLoadContext,
  findBeatorajaThemeBgm,
  loadBeatorajaSceneKit,
  loadBeatorajaThemeFromFiles,
  pickBeatorajaPlayableVariant,
  releaseBeatorajaSceneKitAssets,
  resolveBeatorajaSkinConfig,
  summarizeBeatorajaPlaySkins,
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
  checkBrowserCompat,
  describeSongCollection,
  resolveSongSource,
  drawBrowserRandomCourse,
  createCourseSongRecord,
  type BrowserDroppedFile,
  type ChartFileHashes,
} from '@be-music/player-web/collection';
import { createAudioService, setMasterVolume, type AudioOwner, type AudioService } from '@be-music/player-web/audio';
import { downloadBlob, type RecordingFormat } from '@be-music/player-web/recording';
import { logger } from '@be-music/player-web';
import {
  discoverLr2Themes,
  loadLr2ThemeSkinsFromFiles,
  pickLr2PlaySkin,
  pickLr2PlaySkinVariant,
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
import { BeatorajaSkinOptionsPanel, type BeatorajaSkinOptionsPanelDeps } from './ui/beatoraja-skin-options.ts';
import { courseStageRecordKey, playRecordKey } from './song-records.ts';
import { courseStageRecordPlayFromResult, recordPlayFromResult } from '@be-music/player/records';
import { LeaderboardPanel } from './leaderboard-ui.ts';
import { readStoredSkinSettings } from './skin-settings.ts';
import type { ResolvedPlayChart } from '@be-music/player';
import { resolveResultSoundSet, resolveResultViewJingles } from './result-jingles.ts';
import {
  parsePlaylog,
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
import { prepareNonstopPlay, type PreparedNonstopPlay } from './nonstop-course.ts';
import {
  buildNonstopCoursePlaylog,
  resolveCourseStagePlaySettings,
  resolveCourseStageSettings,
} from '@be-music/player/course';
import { SceneRouter, type PlayDispose, type SceneRouteToken } from './app/scene-router.ts';
import { DropTarget } from './app/drop-target.ts';
import { settleDecidePreload, type DecidePreload } from './app/decide-handoff.ts';

/** A NONSTOP course being played as its stitched chart. */
interface NonstopPlay {
  course: LibraryCourse;
  prepared: PreparedNonstopPlay;
}
import demoPackageJson from '../package.json' with { type: 'json' };

const dropLog = logger('drop');
const gameplayLog = logger('gameplay');
const fullscreenLog = logger('fullscreen');

/** Every screen the demo shows, each made by its `create*Scene`. */
type DemoScene = SelectScene | DecideScene | PlayScene | ResultScene;

/** What a play loading behind a decide screen is made with: the start's AUTO, and the chart as the screen drew it. */
interface DecidePlayOverrides {
  readonly autoPlay?: boolean;
  readonly preResolved: ResolvedPlayChart;
}

/** Ends a play whose result shows: it exited as the result entered, and its last samples ring out. */
const disposeKeepingAudioTail: PlayDispose<PlayScene> = (play) => play.dispose({ preserveAudioTail: true });

/** This app as the recorder of its play-logs (`recorder` in `*.bmplay.json`); the engine adds its own version. */
const PLAYLOG_RECORDER: Omit<PlaylogRecorderInfo, 'engine'> = {
  name: 'be-music-web',
  version: demoPackageJson.version,
  ...(__BE_MUSIC_BUILD__.length > 0 ? { build: __BE_MUSIC_BUILD__ } : {}),
  platform: 'web',
};
import { wireHelpModal } from './help-modal.ts';
import { DEMO_APP_HTML } from './dom-template.ts';
import { renderBrowserCompatPanel } from './compat-panel.ts';
import { InlineSearch } from './inline-search.ts';
import { parseRecordingFormatKey } from './recording-format-choice.ts';
import { storeHiSpeed } from './hi-speed-storage.ts';
import {
  allowsLiveTempo,
  describePlayingStatus,
  tempoFromPercent,
  tempoPercentFromTempo,
} from './play-tempo-settings.ts';
import { playSkinTypeForVariant, sanitizeFilenameStem } from './demo-utils.ts';
import { chartShapeFor, resolveBeatorajaSkinVariant } from './chart-shape.ts';
import { pickActiveFamilyForScene, type FamilyDispatchState } from './family-dispatch.ts';
import { applyLoadProgress } from './loading-overlay.ts';
import { DebugMenu, type DebugMenuDeps } from './ui/debug-menu/index.ts';
import { promptSkinDrop } from './ui/skin-drop-prompt.ts';
import {
  enterTouchFullscreen,
  exitFullscreen,
  FullscreenEscapeLock,
  getFullscreenElement,
  type KeyboardLockNavigatorLike,
  shouldCaptureFullscreenEscape,
  toggleFullscreen,
} from './fullscreen.ts';
import { readDeviceSignals, resolvePlayLayoutMode, resolveDeviceProfile } from './device-profile.ts';
import {
  captureScreenshot,
  finalizeRecordingIfActive,
  startArmedRecording,
  toggleRecording,
  type RecordingDeps,
} from './recording-controller.ts';
import type { DemoGuiState, PlayerWebDemoElements, SkinFamilyOverride } from './types.ts';
import { createDemoGuiState, resolveCompressorMode, storeBuiltInSkinId } from './services/settings.ts';
import { BE_MUSIC_SKINS, loadSkinFonts, waitForDefaultUiFonts } from './services/built-in-skins.ts';
import { SilentModeSetting } from './services/silent-mode.ts';
import { copyPlayOptionsToGui, playOptionsFromGui, PlayOptionsService } from './services/play-options.ts';
import { PlaylogAutoSave } from './services/playlog-auto-save.ts';
import { CourseMakerService } from './services/course-maker.ts';
import { LibraryService } from './services/library.ts';
import { RecordsService } from './services/records.ts';
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
  /** The charts and courses the select screen lists, and the drops, file picks and URL loads that add to them. */
  private readonly library: LibraryService;
  /** Files dragged onto the page or picked in the Debug Menu, read and handed to {@link library}. */
  private readonly dropTarget: DropTarget;
  /** The EXPERT / GRADE course being played, between its stages. */
  private activeCourse: ActiveCourse | undefined;
  /** Set when a course was started with AUTO (`true`), so its every stage plays itself; `undefined` follows the menu. */
  private courseAutoPlay: boolean | undefined;
  /** The player's own courses and the course being made (LR2's course maker), kept in IndexedDB, and its card. */
  private readonly courseMaker = new CourseMakerService({
    resolveChartHashes: (song) => this.records.resolveChartHashes(song),
    collection: () => this.library.collection,
    refreshMadeCourses: () => this.library.refreshMadeCourses(),
    selectView: () => this.selectView,
    setStatus: (text) => this.setStatus(text),
  });
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
  /** The Leaderboard's Debug Menu folder, account chip and play submission. */
  private readonly leaderboard = new LeaderboardPanel({
    // Read on use: `guiState` is initialized after this field.
    settings: () => this.guiState,
    setStatus: (text) => this.setStatus(text),
    warn: (message, error) => gameplayLog.warn(message, error),
    recorder: PLAYLOG_RECORDER,
  });
  /**
   * The play options in force, the full set: fed by the select screen (`on.playOptions`) and the Debug Menu
   * ({@link setPlayOptions}); every select screen starts from them, and a decide screen and a play take them.
   */
  private readonly playOptions: PlayOptionsService;
  /** The best records and the chart-file hashes they are keyed by, and the record keys of the play in flight. */
  private readonly records = new RecordsService({
    collection: () => this.library.collection,
    judgeRuleset: () => this.guiState.judgeRuleset,
  });
  /** Each be-music skin's `settings` values by skin id, persisted in `localStorage` and handed to its scenes. */
  private readonly skinSettings = readStoredSkinSettings();
  /**
   * Play-log auto-save, by `guiState.autoSavePlaylog` as it was when the current play STARTED: the result-screen
   * auto-save of a play, and of a course after its last stage, reads this latch, not the live checkbox (the checkbox is
   * disabled during gameplay anyway — the latch is the enforcement for any path that slips through).
   */
  private readonly playlogAutoSave = new PlaylogAutoSave({
    download: downloadBlob,
    warn: (message, error) => gameplayLog.warn(message, error),
  });
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
  /** "Play in silent mode": the setting, its checkboxes and its hint. */
  private readonly silentMode: SilentModeSetting;
  /** The Debug Menu (`ui/debug-menu/`), made once the settings and services it works with are. */
  private readonly debugMenu: DebugMenu;
  /** The skin-options panel for the beatoraja screen showing (`ui/beatoraja-skin-options.ts`). */
  private readonly beatorajaSkinOptions: BeatorajaSkinOptionsPanel;
  /** `window.__beMusicTest` for the end-to-end suite (`?e2e=1` or a development build; `test-hook.ts`). */
  private readonly testHook = isTestHookEnabled(window.location.href, import.meta.env.DEV)
    ? new TestHookRecorder()
    : undefined;
  private readonly elements: PlayerWebDemoElements;
  public constructor(elements: PlayerWebDemoElements) {
    this.elements = elements;
    this.guiState = createDemoGuiState({
      signals: readDeviceSignals(),
      devicePixelRatio: window.devicePixelRatio || 1,
      builtInSkinId: (stored) => BE_MUSIC_SKINS.resolve(stored).id,
      actions: {
        openFolder: () => this.elements.songInput.click(),
        openFiles: () => this.elements.filesInput.click(),
        record: () => {
          void toggleRecording(this.recordingDeps());
        },
        screenshot: () => {
          void captureScreenshot(this.recordingDeps());
        },
      },
    });
    // Every sound plays through the master volume; start from the remembered level.
    setMasterVolume(this.guiState.masterVolume / 100);
    this.playOptions = new PlayOptionsService(playOptionsFromGui(this.guiState));
    this.silentMode = new SilentModeSetting({ settings: this.guiState, touchFirst: deviceProfile.touchFirst });
    this.silentMode.install();
    // The `?compressor=split|legacy|off` URL flag, read once at boot.
    const compressor = resolveCompressorMode(window.location.href);
    this.compressorMode = compressor.mode;
    this.guiState.compressor = compressor.enabled;
    this.library = new LibraryService({
      elements,
      resolveChartHashes: (song) => this.records.resolveChartHashes(song),
      courseMaker: this.courseMaker.maker,
      selectView: () => this.selectView,
      showing: () => this.router.current?.identity.kind,
      setStatus: (text) => this.setStatus(text),
      showSelect: () => this.showSelect(),
      leaveSelect: () => this.leaveSelect(),
      browseTo: (navigation) => {
        this.lastSelectNavigation = navigation;
      },
      startPlaylogReplayFromFile: (file) => this.startPlaylogReplayFromFile(file),
      loadTheme: (files) => this.loadTheme(files),
      loadBeatorajaTheme: (files) => this.loadBeatorajaTheme(files),
      playSkins: () => this.playSkins,
      selectSkin: () => this.selectSkin,
      resultSkin: () => this.resultSkin,
      beatorajaTheme: () => this.beatorajaTheme,
      answerSkinDropPrompt: (themeFamilies) => this.answerSkinDropPrompt(themeFamilies),
    });
    this.dropTarget = new DropTarget({
      elements,
      leaveSelect: () => this.leaveSelect(),
      processIncomingFiles: (files) => this.library.processIncomingFiles(files),
      loadPickedFiles: (files) => this.library.loadPickedFiles(files),
      recordLoad: () => this.testHook?.recordLoad(),
    });
    this.debugMenu = new DebugMenu(this.debugMenuDeps());
    this.beatorajaSkinOptions = new BeatorajaSkinOptionsPanel(this.beatorajaSkinOptionsDeps());
  }

  /** What the Debug Menu reaches of the app: the settings and services, readers of the app's state, and its actions. */
  private debugMenuDeps(): DebugMenuDeps {
    return {
      settings: this.guiState,
      sceneHost: this.sceneHost,
      silentMode: this.silentMode,
      leaderboard: this.leaderboard,
      library: this.library,
      records: this.records,
      courseMaker: this.courseMaker,
      skinSettings: this.skinSettings,
      beatorajaSkinOverridesByType: this.beatorajaSkinOverridesByType,
      compressorMode: this.compressorMode,
      shell: this.elements.shell,
      gameplayView: () => this.gameplayView,
      selectView: () => this.selectView,
      stageMounted: () => this.stageMount !== undefined,
      familyDispatchState: () => this.familyDispatchState(),
      beatorajaTheme: () => this.beatorajaTheme,
      availableLr2Themes: () => this.availableLr2Themes,
      activeLr2ThemeName: () => this.activeLr2ThemeName,
      beMusicSkin: () => this.beMusicSkin,
      activeBeatorajaPlay: () => this.activeBeatorajaPlay,
      beatorajaSkinConfig: (entryPath, header) => this.beatorajaSkinConfig(entryPath, header),
      setStatus: (text) => this.setStatus(text),
      setPlayOptions: (changes) => this.setPlayOptions(changes),
      rememberHiSpeed: (value, source) => this.rememberHiSpeed(value, source),
      refreshSelectRecords: () => this.refreshSelectRecords(),
      handleSkinFamilyOverrideChange: (value) => this.handleSkinFamilyOverrideChange(value),
      handleBuiltInSkinChange: (id) => this.handleBuiltInSkinChange(id),
      addBeMusicSkin: (skin) => this.addBeMusicSkin(skin),
      addBeMusicSkinFromUrl: (url) => this.addBeMusicSkinFromUrl(url),
      applyBeMusicSkinSettings: () => this.applyBeMusicSkinSettings(),
      applyLr2ThemeByName: (name) => this.applyLr2ThemeByName(name),
      promptSkinDrop: (family) =>
        promptSkinDrop(family, (pending) => {
          this.pendingSkinSystem = pending;
        }),
      applyBeatorajaSelectSkinConfig: (entryPath, config) => this.applyBeatorajaSelectSkinConfig(entryPath, config),
      applyBeatorajaPlaySkinConfig: (entryPath, config) => this.applyBeatorajaPlaySkinConfig(entryPath, config),
    };
  }

  /** What the beatoraja skin-options panel reaches of the app: the screens showing, their entries' options, applying. */
  private beatorajaSkinOptionsDeps(): BeatorajaSkinOptionsPanelDeps {
    return {
      container: this.elements.shell,
      beatorajaKitCaches: this.beatorajaKitCaches,
      gameplayView: () => this.gameplayView,
      activeBeatorajaPlay: () => this.activeBeatorajaPlay,
      beatorajaSelectKit: () => this.beatorajaSelectKit,
      beatorajaSkinConfig: (entryPath, header) => this.beatorajaSkinConfig(entryPath, header),
      collectBeatorajaFileCandidates: (entryPath, header) => this.collectBeatorajaFileCandidates(entryPath, header),
      applyBeatorajaPlaySkinConfig: (entryPath, config) => this.applyBeatorajaPlaySkinConfig(entryPath, config),
      applyBeatorajaSelectSkinConfig: (entryPath, config) => this.applyBeatorajaSelectSkinConfig(entryPath, config),
    };
  }

  public start(): void {
    this.testHook?.install(window, () => this.testHookState());
    this.debugMenu.buildGui();
    this.courseMaker.start();
    // The first scene shown mounts the Pixi host (`mountStage`). Keep its promise so URL auto-load (below) drives its own
    // `showSelect` only once the first select screen is up.
    const initialSelectReady = this.showSelect();

    // The Debug Menu's file pickers, and files dragged onto the page.
    this.dropTarget.wire();

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

    // `?music=<url.zip>` / `?skin=<url.zip>` auto-load, then the difficulty tables imported in an earlier visit, once the
    // first select screen is up.
    void this.library.autoLoad(window.location.href, initialSelectReady);
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
   * Single chokepoint for status-text updates. Writes the new value into `guiState` and refreshes the lil-gui
   * controller so the read-only row repaints with the new text.
   */
  private setStatus(text: string): void {
    this.guiState.status = text;
    this.playStatusShown = false;
    this.debugMenu.refreshStatus();
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
    const draft = this.courseMaker.maker.draft;
    return {
      scene,
      status: this.guiState.status,
      loading: this.elements.loadingOverlay.classList.contains('visible'),
      library: {
        songs: this.library.collection.charts.length,
        courseFolders: (this.library.collection.courseFolders ?? []).map((folder) => folder.label),
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
                    ? this.records.lookupSongRecord(entry.chart)
                    : entry.kind === 'course'
                      ? lookupCourseRecord(entry.course, this.records.songRecords, this.guiState.nonstopPlacement)
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
      recordController: this.debugMenu.recordController,
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

  /** Switches to the skin the player asked for through the Debug Menu ("drop a skin") once a drop brings it. */
  private answerSkinDropPrompt(themeFamilies: ReadonlySet<SkinFamilyId>): void {
    const asked = this.pendingSkinSystem;
    this.pendingSkinSystem = undefined;
    if (asked !== undefined && themeFamilies.has(asked)) this.handleSkinFamilyOverrideChange(asked);
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
      for (const entry of this.library.collection.charts) {
        if ((await this.records.resolveChartSha256(entry)) === sha256) {
          return entry;
        }
      }
    }
    const nativeChartPath = playlog.play.native?.chartPath;
    if (typeof nativeChartPath === 'string' && nativeChartPath.length > 0) {
      const exact = this.library.collection.charts.find((entry) => entry.chartPath === nativeChartPath);
      if (exact) {
        return exact;
      }
    }
    const title = playlog.chart.title;
    if (title === undefined || title.length === 0) {
      return undefined;
    }
    return this.library.collection.charts.find(
      (entry) => entry.title === title && (playlog.chart.artist === undefined || entry.artist === playlog.chart.artist),
    );
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
      this.courseMaker.maker.start(plan.kind);
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
        this.library.collection.charts.map(async (song) => ({
          song,
          ...(await this.records.resolveChartHashes(song)),
        })),
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
      const found = await this.records.resolveChartHashes(stage.chart);
      if (found !== undefined) hashes.set(stage.chart.id, found);
    }
    const prepared = prepareNonstopPlay(course, {
      sourceOf: (song) => resolveSongSource(this.library.collection, song),
      hashesOf: (song) => hashes.get(song.id),
      placement: this.guiState.nonstopPlacement,
    });
    if (!prepared.ok) {
      this.setStatus(describeNonstopPrepareFailure(course.definition.name, prepared));
      return;
    }
    // The stitched chart loads its assets from a composite source; keep one at a time.
    this.library.collection = {
      ...this.library.collection,
      sources: [
        ...this.library.collection.sources.filter((source) => !source.id.startsWith('nonstop:')),
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
    this.records.recordCourseResult(
      resolveCourseRecordUpdate(
        courseLog,
        native,
        courseRecordKey(nonstop.course, nonstop.prepared.stitched.placement),
      ),
    );
    this.playlogAutoSave.saveCourse(courseLog);
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
    this.records.recordCourseResult(resolveCourseRecordUpdate(courseLog, result, courseRecordKey(course)));
    this.playlogAutoSave.saveCourse(courseLog);
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

  /** Redraws the select screen in place with the records of the current judge ruleset, after it changed. */
  private refreshSelectRecords(): void {
    this.selectView?.setLibrary(this.library.collection);
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
    this.debugMenu.rebuildSkinFamilyPicker();
    this.debugMenu.rebuildLr2ThemePicker();
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
      this.debugMenu.rebuildBeatorajaSkinPickers();
      // The beatoraja entry just became selectable in the top-level "Skin family" dropdown.
      this.debugMenu.rebuildSkinFamilyPicker();
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
    this.debugMenu.rebuildSkinSettingsFolder();
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
    this.debugMenu.showSkinSystem(value);
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
    this.beatorajaSkinOptions.refreshBeatorajaPlaySkinOptions();
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
    this.beatorajaSkinOptions.refreshBeatorajaSelectSkinOptions();
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
      this.records.recordActiveCourseStage(courseStageRecordPlayFromResult(data));
      const mounted = await this.showBeatorajaResult(data, {
        run: 'stage',
        course: { info: activeCourseInfo(active) },
      });
      if (!mounted) this.continueCourse();
      this.unlockPlaylogOptions();
      return;
    }
    this.records.recordActivePlay(recordPlayFromResult(data));
    const mounted = await this.showBeatorajaResult(data, { run: 'single' });
    if (!mounted) await this.showSelect();
    // Auto-save fires even when the theme ships no result skin, so going back to select costs no replay file.
    this.playlogAutoSave.savePlay(data.playlog);
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
        source: resolveSongSource(this.library.collection, song),
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

  private async showSelect(): Promise<void> {
    // Back from a play or a result: the status line describes the library again instead of the play just left.
    if (this.playStatusShown) this.setStatus(describeSongCollection(this.library.collection));
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
    this.elements.shell.classList.toggle('empty', this.library.collection.charts.length === 0);
    // Family dispatch. The Debug Menu's "Skin family" pick overrides the auto chain (beatoraja → LR2 → default). The
    // beatoraja family draws the theme's select entry when the library has charts (an empty library shows the built-in
    // screen's drop hint); the LR2 family draws the loaded LR2 select skin when it has a bar list; otherwise the built-in
    // family draws the be-music skin.
    const activeFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'select');
    const beatorajaKit =
      activeFamily === 'beatoraja' && this.library.collection.charts.length > 0
        ? await this.loadBeatorajaSelectKit()
        : undefined;
    const lr2SelectSkin =
      activeFamily === 'lr2' && this.selectSkin !== undefined && this.selectSkin.barLayout.slots.length > 0
        ? this.selectSkin
        : undefined;
    const kit: SelectSceneKit =
      beatorajaKit ?? (lr2SelectSkin !== undefined ? { family: 'lr2', skin: lr2SelectSkin } : this.builtInKit);
    const current = this.selectView;
    if (current !== undefined && current.identity.family !== kit.family) {
      // The family changed (an LR2 or a beatoraja theme dropped while the built-in screen is up, or the other way
      // round): only that family's view draws it, so the screen is made again below, carrying the cursor across (the
      // play options are the service's).
      this.lastSelectNavigation ??= current.snapshot();
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
      kept.setLibrary(this.library.collection);
      if (!(await this.router.show(kept, { role: 'select' }))) return;
      if (this.lastSelectNavigation) kept.restore(this.lastSelectNavigation);
      if (kit.family === 'beatoraja') this.beatorajaSkinOptions.refreshBeatorajaSelectSkinOptions();
      return;
    }
    // The screen starts from the play options in force (two-way sync: the screen's own edits come back through
    // `on.playOptions` below; lil-gui edits push through `setPlayOptions`).
    const playOptions = this.playOptions.current;
    // The select session plays through the audio service; its decide jingle plays out through the decide screen into
    // the play.
    const scene = createSelectScene(kit, {
      library: this.library.collection,
      ...(this.lastSelectNavigation !== undefined ? { browse: this.lastSelectNavigation } : {}),
      playOptions,
      records: {
        chart: (song) => this.records.lookupSongRecord(song),
        course: (course) =>
          lookupCourseRecord(course, this.records.currentRulesetRecords(), this.guiState.nonstopPlacement),
      },
      sounds,
      audio: this.audio,
      courseMaker: this.courseMaker.maker,
      on: {
        start: (entry, { autoPlay }) => this.startFromSelect(entry, autoPlay),
        playOptions: (options) => {
          // Keep the screen's play option edits (an LR2 panel, a skin's buttons) and mirror them into the Debug Menu
          // state so both surfaces always agree, then repaint the lil-gui controllers.
          this.playOptions.update(options);
          copyPlayOptionsToGui(options, this.guiState);
          if (options.hiSpeed !== this.guiState.hiSpeed) this.rememberHiSpeed(options.hiSpeed, 'select');
          this.debugMenu.refreshPlayOptionControllers();
        },
        search: () => this.search.openFromPointer(),
        // An LR2 skin's course name (text 170) and delete button (233): the panel names the course or confirms first.
        courseMaker: (action, course) => {
          if (action === 'name') this.courseMaker.panel?.focusName();
          else if (course !== undefined) this.courseMaker.panel?.confirmDelete(course.definition);
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
          this.beatorajaSkinOptions.clear();
        },
      },
    });
    if (!(await this.router.show(scene, { role: 'select' }))) return;
    if (kit.family === 'beatoraja') this.beatorajaSkinOptions.refreshBeatorajaSelectSkinOptions();
    this.debugMenu.scheduleFirstRunResolutionDetect();
  }

  /**
   * A chart or a course started on the select screen. While a course is being made, a chart joins it instead of playing
   * (as LR2 does); a course starts its run, or says why it cannot. Returns whether a play starts, so the screen plays
   * the decide jingle only then.
   */
  private startFromSelect(entry: SelectStartEntry, autoPlay: boolean): boolean {
    if (entry.kind === 'chart') {
      if (this.courseMaker.addSongToCourseBeingMade(entry.chart)) return false;
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
    const decide = createDecideScene(kit, {
      chart: song,
      playOptions: { ...this.playOptions.current, autoPlay: overrides.autoPlay ?? this.guiState.autoPlay },
      source: resolveSongSource(this.library.collection, song),
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
    const chartHashes = await this.records.resolveChartHashes(song);
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
    const playOptions = this.playOptions.current;
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
      hiddenSudden1P: playOptions.hiddenSudden1P,
      hiddenSudden2P: playOptions.hiddenSudden2P,
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
    this.records.activePlayRecordKey = playRecordKey(song, overrides.chartHashes?.sha256, {
      autoPlay,
      replay: replay !== undefined,
      course: courseStage !== undefined || nonstop !== undefined,
      tempo,
      judgeRuleset,
    });
    // An EXPERT / GRADE stage also updates its chart's record, as LR2 does (not a NONSTOP run's stitched play).
    this.records.activeStageRecordKey =
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
      bga: playOptions.bga,
      bgaSize: playOptions.bgaSize,
      scoreGraph: playOptions.scoreGraph,
      hsFix: playOptions.hsFix,
      hiddenSudden1P: lanes.hiddenSudden1P,
      hiddenSudden2P: lanes.hiddenSudden2P,
      shutter: playOptions.shutter,
      laneCover: playOptions.laneCover,
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
      audioCompressorParams: this.debugMenu.resolveCompressorParamOverrides(),
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
            this.records.recordActiveCourseStage(courseStageRecordPlayFromResult(result));
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
    const source = resolveSongSource(this.library.collection, song);
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
      playOptions,
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
    this.beatorajaSkinOptions.refreshBeatorajaPlaySkinOptions();
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
        ? await this.records.resolveChartHashes(song)
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
      this.records.recordActiveCourseStage(courseStageRecordPlayFromResult(data));
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
      source: resolveSongSource(this.library.collection, data.song),
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
    this.records.recordActivePlay(recordPlayFromResult(data));
    // A course's stages are saved and ranked as the course, not one by one (a NONSTOP run's course log already was).
    if (presentation.quickRetry && mode.nonstop === undefined) {
      this.playlogAutoSave.savePlay(data.playlog);
      this.leaderboard.maybeSubmit(data.playlog, data.song);
    }
    this.unlockPlaylogOptions();
  }

  /**
   * Latches the playlog-related GUI options for the play that is about to start and disables their controllers.
   * Playlog options are per-play: the value in effect at song start governs the whole play, and mid-song changes
   * are rejected by keeping the controls disabled until {@link unlockPlaylogOptions} runs (result mounted or back
   * at select). The Debug Menu disables its skin controls with them (`DebugMenu.lockForPlay`).
   */
  private lockPlaylogOptionsForPlay(liveTempo = false): void {
    this.playlogAutoSave.latch(this.guiState.autoSavePlaylog);
    this.leaderboard.lockForPlay();
    this.debugMenu.lockForPlay(liveTempo);
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
      this.records.activePlayRecordKey = undefined;
      this.records.activeStageRecordKey = undefined;
    }
  }

  /** Re-enables the playlog option controllers, and the skin controls, once no play is in flight. */
  private unlockPlaylogOptions(): void {
    this.leaderboard.unlock();
    this.debugMenu.unlockAfterPlay();
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
    if (source !== 'menu') this.debugMenu.refreshHiSpeed();
    if (source !== 'select') this.setPlayOptions({ hiSpeed });
    if (source === 'menu') {
      this.gameplayView?.setHiSpeed(hiSpeed);
    }
  }

  /**
   * A play option set from the Debug Menu (or a hi-speed from the play): kept for every screen and play
   * ({@link playOptions}), and pushed to the select screen, on the stage or off it.
   */
  private setPlayOptions(changes: Partial<PlayOptions>): void {
    this.playOptions.update(changes);
    this.selectView?.setPlayOptions(changes);
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
