// Imports are split across `@be-music/player-web`'s entries (`./host`, `./skin`, `./collection`, `./audio`,
// `./recording`) so the dependency surface of this demo is explicit at the file top. The main `@be-music/player-web`
// entry is reserved for symbols that don't belong to any single entry (`logger`, `Rectangle`).
import {
  createDecideScene,
  createPlayScene,
  createResultScene,
  createSelectScene,
  PixiSceneHost,
  type DecideScene,
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
} from '@be-music/scene-model';
import type { SkinFamilyId } from '@be-music/player-web/skin';
import {
  checkBrowserCompat,
  describeSongCollection,
  resolveSongSource,
  drawBrowserRandomCourse,
  createCourseSongRecord,
  type BrowserDroppedFile,
  type ChartFileHashes,
} from '@be-music/player-web/collection';
import { createAudioService, setMasterVolume, type AudioService } from '@be-music/player-web/audio';
import { downloadBlob, type RecordingFormat } from '@be-music/player-web/recording';
import { logger } from '@be-music/player-web';
import { BeatorajaSkinOptionsPanel, type BeatorajaSkinOptionsPanelDeps } from './ui/beatoraja-skin-options.ts';
import { courseStageRecordKey, playRecordKey } from './song-records.ts';
import { courseStageRecordPlayFromResult, recordPlayFromResult } from '@be-music/player/records';
import { LeaderboardPanel } from './leaderboard-ui.ts';
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
import { sanitizeFilenameStem } from './demo-utils.ts';
import { pickActiveFamilyForScene } from './family-dispatch.ts';
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
import { BE_MUSIC_SKINS, waitForDefaultUiFonts } from './services/built-in-skins.ts';
import { SilentModeSetting } from './services/silent-mode.ts';
import { copyPlayOptionsToGui, playOptionsFromGui, PlayOptionsService } from './services/play-options.ts';
import { PlaylogAutoSave } from './services/playlog-auto-save.ts';
import { CourseMakerService } from './services/course-maker.ts';
import { LibraryService } from './services/library.ts';
import { RecordsService } from './services/records.ts';
import { BeatorajaThemeService } from './services/themes/beatoraja.ts';
import { BuiltInThemeService } from './services/themes/built-in.ts';
import { Lr2ThemeService } from './services/themes/lr2.ts';
import { FamilyKits } from './app/family-kits.ts';
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
  /** The LR2 theme: every theme the drops brought, the one mounted, and its skins, BGM and system sounds. */
  private readonly lr2: Lr2ThemeService;
  /** The beatoraja theme: its bundle, BGM and system sounds, and its entries loaded as scene kits. */
  private readonly beatoraja: BeatorajaThemeService;
  /** The be-music skin the built-in family draws with, the player's values for its settings, and the skins added. */
  private readonly builtIn: BuiltInThemeService;
  /** The family each screen is drawn by, and the kit it is drawn with, from the theme services and "Skin system". */
  private readonly familyKits: FamilyKits;
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
  /** The select screen (`createSelectScene`), whichever family draws it, kept by the router across the other screens. */
  private get selectView(): SelectScene | undefined {
    return this.router.select;
  }
  /** The play (`createPlayScene`), whichever family draws it: loading behind a decide screen, or on the stage. */
  private get gameplayView(): PlayScene | undefined {
    return this.router.play;
  }
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
    this.lr2 = new Lr2ThemeService({
      elements,
      setStatus: (text) => this.setStatus(text),
      rebuildSkinFamilyPicker: () => this.debugMenu.rebuildSkinFamilyPicker(),
      rebuildLr2ThemePicker: () => this.debugMenu.rebuildLr2ThemePicker(),
    });
    this.beatoraja = new BeatorajaThemeService({
      elements,
      audio: this.audio,
      setStatus: (text) => this.setStatus(text),
      selectView: () => this.selectView,
      gameplayView: () => this.gameplayView,
      rebuildBeatorajaSkinPickers: () => this.debugMenu.rebuildBeatorajaSkinPickers(),
      rebuildSkinFamilyPicker: () => this.debugMenu.rebuildSkinFamilyPicker(),
      refreshBeatorajaPlaySkinOptions: () => this.beatorajaSkinOptions.refreshBeatorajaPlaySkinOptions(),
      refreshBeatorajaSelectSkinOptions: () => this.beatorajaSkinOptions.refreshBeatorajaSelectSkinOptions(),
    });
    this.builtIn = new BuiltInThemeService({
      guiState: this.guiState,
      setStatus: (text) => this.setStatus(text),
      handleBuiltInSkinChange: (id) => this.handleBuiltInSkinChange(id),
    });
    this.familyKits = new FamilyKits({
      lr2: this.lr2,
      beatoraja: this.beatoraja,
      builtIn: this.builtIn,
      guiState: this.guiState,
    });
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
      loadTheme: (files) => this.lr2.loadTheme(files),
      loadBeatorajaTheme: (files) => this.beatoraja.loadBeatorajaTheme(files),
      playSkins: () => this.lr2.playSkins,
      selectSkin: () => this.lr2.selectSkin,
      resultSkin: () => this.lr2.resultSkin,
      beatorajaTheme: () => this.beatoraja.beatorajaTheme,
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
      skinSettings: this.builtIn.skinSettings,
      beatorajaSkinOverridesByType: this.beatoraja.beatorajaSkinOverridesByType,
      compressorMode: this.compressorMode,
      shell: this.elements.shell,
      gameplayView: () => this.gameplayView,
      selectView: () => this.selectView,
      stageMounted: () => this.stageMount !== undefined,
      familyDispatchState: () => this.familyKits.familyDispatchState(),
      beatorajaTheme: () => this.beatoraja.beatorajaTheme,
      availableLr2Themes: () => this.lr2.availableLr2Themes,
      activeLr2ThemeName: () => this.lr2.activeLr2ThemeName,
      beMusicSkin: () => this.builtIn.beMusicSkin,
      activeBeatorajaPlay: () => this.beatoraja.activeBeatorajaPlay,
      beatorajaSkinConfig: (entryPath, header) => this.beatoraja.beatorajaSkinConfig(entryPath, header),
      setStatus: (text) => this.setStatus(text),
      setPlayOptions: (changes) => this.setPlayOptions(changes),
      rememberHiSpeed: (value, source) => this.rememberHiSpeed(value, source),
      refreshSelectRecords: () => this.refreshSelectRecords(),
      handleSkinFamilyOverrideChange: (value) => this.handleSkinFamilyOverrideChange(value),
      handleBuiltInSkinChange: (id) => this.handleBuiltInSkinChange(id),
      addBeMusicSkin: (skin) => this.builtIn.addBeMusicSkin(skin),
      addBeMusicSkinFromUrl: (url) => this.builtIn.addBeMusicSkinFromUrl(url),
      applyBeMusicSkinSettings: () => this.applyBeMusicSkinSettings(),
      applyLr2ThemeByName: (name) => this.applyLr2ThemeByName(name),
      promptSkinDrop: (family) =>
        promptSkinDrop(family, (pending) => {
          this.pendingSkinSystem = pending;
        }),
      applyBeatorajaSelectSkinConfig: (entryPath, config) =>
        this.beatoraja.applyBeatorajaSelectSkinConfig(entryPath, config),
      applyBeatorajaPlaySkinConfig: (entryPath, config) =>
        this.beatoraja.applyBeatorajaPlaySkinConfig(entryPath, config),
    };
  }

  /** What the beatoraja skin-options panel reaches of the app: the screens showing, their entries' options, applying. */
  private beatorajaSkinOptionsDeps(): BeatorajaSkinOptionsPanelDeps {
    return {
      container: this.elements.shell,
      beatorajaKitCaches: this.beatoraja.beatorajaKitCaches,
      gameplayView: () => this.gameplayView,
      activeBeatorajaPlay: () => this.beatoraja.activeBeatorajaPlay,
      beatorajaSelectKit: () => this.beatoraja.beatorajaSelectKit,
      beatorajaSkinConfig: (entryPath, header) => this.beatoraja.beatorajaSkinConfig(entryPath, header),
      collectBeatorajaFileCandidates: (entryPath, header) =>
        this.beatoraja.collectBeatorajaFileCandidates(entryPath, header),
      applyBeatorajaPlaySkinConfig: (entryPath, config) =>
        this.beatoraja.applyBeatorajaPlaySkinConfig(entryPath, config),
      applyBeatorajaSelectSkinConfig: (entryPath, config) =>
        this.beatoraja.applyBeatorajaSelectSkinConfig(entryPath, config),
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
      lr2: this.lr2.resultJingles(),
      beatoraja: { ...this.beatoraja.beatorajaThemeBgm },
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
    if (pickActiveFamilyForScene(this.familyKits.familyDispatchState(), 'result') === 'beatoraja') {
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
    if (pickActiveFamilyForScene(this.familyKits.familyDispatchState(), 'result') === 'beatoraja') {
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

  /**
   * Apply a user-picked LR2 theme. Disposes the persistent select view so it gets reconstructed against the new
   * skin on the next `showSelect`, mounts the theme into the slot fields, and returns to song-select.
   */
  private async applyLr2ThemeByName(name: string): Promise<void> {
    const theme = this.lr2.availableLr2Themes.find((entry) => entry.name === name);
    if (theme === undefined) return;
    if (this.lastSelectNavigation === undefined && this.selectView !== undefined) {
      this.lastSelectNavigation = this.selectView.snapshot();
    }
    await this.router.dropSelect();
    await this.lr2.mountLr2Theme(theme.files, theme.name);
    await this.showSelect();
  }

  /** The container and codec the Debug Menu's "Video format" asks recordings to be written in. */
  private get recordingFormat(): RecordingFormat {
    return parseRecordingFormatKey(this.guiState.recordingFormat);
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

  /**
   * Hands the active be-music skin's settings to the scenes on screen (and to the select scene and a play loading off
   * it), which draw with them from their next frame.
   */
  private applyBeMusicSkinSettings(): void {
    for (const scene of new Set([this.router.select, this.router.play, this.router.current])) {
      if (scene?.identity.family === 'built-in') scene.updateKit(this.builtIn.builtInKit);
    }
  }

  /**
   * Apply a Debug Menu skin-family change. The persistent select scene needs an explicit dispose-and-rebuild
   * (its view is the family's — the LR2 or the built-in select view, or the beatoraja scene), then `showSelect`
   * reconstructs whichever family the new override resolves to. The gameplay
   * / decide / result scenes pick up the new override on their next mount — they're transient and there's
   * nothing on screen to swap at the moment the user changes the dropdown (they'd have to be in song-select to
   * even reach the GUI).
   */
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
    // The course result (`course.result`) shows on the theme's COURSE_RESULT skin, falling back to its result skin.
    const courseResult = course?.result !== undefined;
    const kit = await this.beatoraja.loadBeatorajaResultKit(song, courseResult);
    if (kit === undefined) return false;

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
    const sounds = systemSoundSetFromBeatoraja({ bgm: this.beatoraja.beatorajaThemeBgm });
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
    const resultScene = createResultScene(kit, {
      result,
      run,
      source: resolveSongSource(this.library.collection, song),
      ...(playChart !== undefined ? { playChart } : {}),
      sounds,
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
    const activeFamily = pickActiveFamilyForScene(this.familyKits.familyDispatchState(), 'select');
    const beatorajaKit =
      activeFamily === 'beatoraja' && this.library.collection.charts.length > 0
        ? await this.beatoraja.loadBeatorajaSelectKit()
        : undefined;
    const lr2SelectSkin =
      activeFamily === 'lr2' && this.lr2.selectSkin !== undefined && this.lr2.selectSkin.barLayout.slots.length > 0
        ? this.lr2.selectSkin
        : undefined;
    const kit: SelectSceneKit =
      beatorajaKit ?? (lr2SelectSkin !== undefined ? { family: 'lr2', skin: lr2SelectSkin } : this.builtIn.builtInKit);
    const current = this.selectView;
    if (current !== undefined && current.identity.family !== kit.family) {
      // The family changed (an LR2 or a beatoraja theme dropped while the built-in screen is up, or the other way
      // round): only that family's view draws it, so the screen is made again below, carrying the cursor across (the
      // play options are the service's).
      this.lastSelectNavigation ??= current.snapshot();
      await this.router.dropSelect();
    }
    const sounds = this.familyKits.selectSoundSet(kit.family);
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
          const entryPath = this.beatoraja.beatorajaSelectKit?.entryPath;
          if (entryPath === undefined) return;
          this.beatoraja.beatorajaKitCaches.skinConfigs.set(entryPath, config);
          void this.beatoraja.applyBeatorajaSelectSkinConfig(entryPath, config);
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
    const decideFamily = pickActiveFamilyForScene(this.familyKits.familyDispatchState(), 'decide', song);
    const playsOnBeatoraja = this.familyKits.playsOnBeatoraja(song);
    const kit = await this.familyKits.decideKitFor(decideFamily, song, playsOnBeatoraja);
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
      sounds: kit.family === 'beatoraja' ? systemSoundSetFromBeatoraja({ bgm: this.beatoraja.beatorajaThemeBgm }) : {},
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
    const kit = await this.familyKits.resolvePlayKit(song, {});
    if (kit === undefined) throw new Error(`no play skin for ${song.title}`);
    const chartHashes = await this.records.resolveChartHashes(song);
    const view = this.buildPlayScene(song, kit, { ...overrides, chartHashes });
    return (await this.router.prepare(view, { token })) ? view : undefined;
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
    const kit = await this.familyKits.resolvePlayKit(song, overrides);
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
    const resultFamily = pickActiveFamilyForScene(this.familyKits.familyDispatchState(), 'result');
    // A course's results show the course on the skin (LR2 ops 280-293, texts 150-170): a stage's result at its stage,
    // the course result on the course-result skin, each parsed again with the course ops.
    const courseInfo =
      mode.course ?? mode.nonstop?.info ?? (courseStage ? activeCourseInfo(this.activeCourse!) : undefined);
    const mountedResultSkin = presentation.courseResultSkin
      ? (this.lr2.courseResultSkin ?? this.lr2.resultSkin)
      : this.lr2.resultSkin;
    const lr2ResultSkin =
      resultFamily !== 'lr2'
        ? undefined
        : courseInfo === undefined
          ? mountedResultSkin
          : this.lr2.courseLr2Skin(mountedResultSkin, courseInfo, {
              kind:
                presentation.courseResultSkin && this.lr2.courseResultSkin !== undefined ? 'courseResult' : 'result',
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
      lr2: this.lr2.resultJingles(),
      beatoraja: this.beatoraja.beatorajaThemeBgm,
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
    const kit: ResultSceneKit =
      lr2ResultSkin !== undefined ? { family: 'lr2', skin: lr2ResultSkin } : this.builtIn.builtInKit;
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
