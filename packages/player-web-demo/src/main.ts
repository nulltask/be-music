// Imports are split across `@be-music/player-web`'s entries (`./host`, `./skin`, `./collection`, `./audio`,
// `./recording`) so the dependency surface of this demo is explicit at the file top. The main `@be-music/player-web`
// entry is reserved for symbols that don't belong to any single entry (`logger`, `Rectangle`).
import { PixiSceneHost, type PlayScene, type SelectScene } from '@be-music/player-web/host';
import type { BrowseSnapshot, PlayOptions } from '@be-music/scene-model';
import type { SkinFamilyId } from '@be-music/player-web/skin';
import { checkBrowserCompat } from '@be-music/player-web/collection';
import { createAudioService, setMasterVolume, type AudioService } from '@be-music/player-web/audio';
import { downloadBlob, type RecordingFormat } from '@be-music/player-web/recording';
import { logger } from '@be-music/player-web';
import { BeatorajaSkinOptionsPanel, type BeatorajaSkinOptionsPanelDeps } from './ui/beatoraja-skin-options.ts';
import { LeaderboardPanel } from './leaderboard-ui.ts';
import type { PlaylogRecorderInfo } from '@be-music/player/playlog';
import { lookupCourseRecord } from './course-result.ts';
import type { ActiveCourse } from './course-flow.ts';
import { SceneRouter } from './app/scene-router.ts';
import { DropTarget } from './app/drop-target.ts';
import { CourseRoute } from './app/routes/course.ts';
import { NonstopRoute } from './app/routes/nonstop.ts';
import { SelectRoute } from './app/routes/select.ts';
import { DecideRoute } from './app/routes/decide.ts';
import { PlayRoute } from './app/routes/play.ts';
import { ResultRoute } from './app/routes/result.ts';
import { ReplayRoute } from './app/routes/replay.ts';
import demoPackageJson from '../package.json' with { type: 'json' };

const gameplayLog = logger('gameplay');
const fullscreenLog = logger('fullscreen');

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
import { readDeviceSignals, resolveDeviceProfile } from './device-profile.ts';
import {
  captureScreenshot,
  finalizeRecordingIfActive,
  toggleRecording,
  type RecordingDeps,
} from './recording-controller.ts';
import type { DemoGuiState, DemoScene, PlayerWebDemoElements, SkinFamilyOverride } from './types.ts';
import { createDemoGuiState, resolveCompressorMode, storeBuiltInSkinId } from './services/settings.ts';
import { BE_MUSIC_SKINS, waitForDefaultUiFonts } from './services/built-in-skins.ts';
import { SilentModeSetting } from './services/silent-mode.ts';
import { playOptionsFromGui, PlayOptionsService } from './services/play-options.ts';
import { PlaylogAutoSave } from './services/playlog-auto-save.ts';
import { CourseMakerService } from './services/course-maker.ts';
import { LibraryService } from './services/library.ts';
import { RecordsService } from './services/records.ts';
import { CourseRunService } from './services/courses.ts';
import { BeatorajaThemeService } from './services/themes/beatoraja.ts';
import { BuiltInThemeService } from './services/themes/built-in.ts';
import { Lr2ThemeService } from './services/themes/lr2.ts';
import { FamilyKits } from './app/family-kits.ts';
import {
  describeBar,
  isTestHookEnabled,
  nameJingle,
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
    onInterrupt: () => {
      // The select screen comes back where the course was started, unless that navigation has put it somewhere already.
      const courseReturn = this.courses.endRun();
      if (courseReturn !== undefined) this.lastSelectNavigation ??= courseReturn;
    },
  });
  /** The charts and courses the select screen lists, and the drops, file picks and URL loads that add to them. */
  private readonly library: LibraryService;
  /** Files dragged onto the page or picked in the Debug Menu, read and handed to {@link library}. */
  private readonly dropTarget: DropTarget;
  /** The course run in progress: the EXPERT / GRADE course between its stages, its AUTO and where it started from. */
  private readonly courses = new CourseRunService();
  /** The EXPERT / GRADE course being played, between its stages (the course run service's). */
  private get activeCourse(): ActiveCourse | undefined {
    return this.courses.active;
  }
  /** A course from its course bar to its course result (`app/routes/course.ts`). */
  private readonly courseRoute: CourseRoute;
  /** A NONSTOP course from its start, or a restitch, to its result (`app/routes/nonstop.ts`). */
  private readonly nonstopRoute: NonstopRoute;
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
   * The player's audio service (ADR 0007): one system AudioContext for the sounds of the screens built on it, the
   * built-in decide and result screens so far. The other screens still play on contexts of their own.
   */
  private readonly audio: AudioService = createAudioService();
  /** The select screen, from its first showing to every return, and the starts made on it (`app/routes/select.ts`). */
  private readonly selectRoute: SelectRoute;
  /** A start's decide screen, and the play it hands the stage to (`app/routes/decide.ts`). */
  private readonly decideRoute: DecideRoute;
  /** A play, from its start to where it leads (`app/routes/play.ts`). */
  private readonly playRoute: PlayRoute;
  /** A play's, a course's or a NONSTOP run's result screen, and where it leads (`app/routes/result.ts`). */
  private readonly resultRoute: ResultRoute;
  /** A play log played back from a file (`app/routes/replay.ts`). */
  private readonly replayRoute: ReplayRoute;
  /** Where the select screen was, for its next showing to come back to (the select route's). */
  private get lastSelectNavigation(): BrowseSnapshot | undefined {
    return this.selectRoute.lastSelectNavigation;
  }
  private set lastSelectNavigation(navigation: BrowseSnapshot | undefined) {
    this.selectRoute.lastSelectNavigation = navigation;
  }
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
      startPlaylogReplayFromFile: (file) => this.replayRoute.startPlaylogReplayFromFile(file),
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
    this.nonstopRoute = new NonstopRoute({
      courses: this.courses,
      library: this.library,
      records: this.records,
      guiState: this.guiState,
      playlogAutoSave: this.playlogAutoSave,
      leaderboard: this.leaderboard,
      familyKits: this.familyKits,
      playlogRecorder: PLAYLOG_RECORDER,
      testHook: this.testHook,
      setStatus: (text) => this.setStatus(text),
      showSelect: () => this.showSelect(),
      showDecide: (song, overrides, then) => this.decideRoute.showDecide(song, overrides, then),
      playSong: (song, overrides) => this.playRoute.playSong(song, overrides),
      showResult: (data, mode) => this.resultRoute.showResult(data, mode),
      showBeatorajaResult: (data, options) => this.resultRoute.showBeatorajaResult(data, options),
      unlockPlaylogOptions: () => this.unlockPlaylogOptions(),
    });
    this.courseRoute = new CourseRoute({
      courses: this.courses,
      library: this.library,
      records: this.records,
      courseMaker: this.courseMaker,
      playlogAutoSave: this.playlogAutoSave,
      leaderboard: this.leaderboard,
      familyKits: this.familyKits,
      playlogRecorder: PLAYLOG_RECORDER,
      selectNavigation: () => this.selectView?.snapshot() ?? this.lastSelectNavigation,
      setStatus: (text) => this.setStatus(text),
      startNonstopCourse: (course, options) => this.nonstopRoute.startNonstopCourse(course, options),
      showSelect: () => this.showSelect(),
      showDecide: (song, overrides, then) => this.decideRoute.showDecide(song, overrides, then),
      playSong: (song, overrides) => this.playRoute.playSong(song, overrides),
      showResult: (data, mode) => this.resultRoute.showResult(data, mode),
      showBeatorajaResult: (data, options) => this.resultRoute.showBeatorajaResult(data, options),
      unlockPlaylogOptions: () => this.unlockPlaylogOptions(),
    });
    this.debugMenu = new DebugMenu(this.debugMenuDeps());
    this.beatorajaSkinOptions = new BeatorajaSkinOptionsPanel(this.beatorajaSkinOptionsDeps());
    this.selectRoute = new SelectRoute({
      router: this.router,
      elements,
      library: this.library,
      records: this.records,
      courses: this.courses,
      courseRoute: this.courseRoute,
      courseMaker: this.courseMaker,
      familyKits: this.familyKits,
      lr2: this.lr2,
      beatoraja: this.beatoraja,
      builtIn: this.builtIn,
      playOptions: this.playOptions,
      guiState: this.guiState,
      audio: this.audio,
      search: this.search,
      debugMenu: this.debugMenu,
      beatorajaSkinOptions: this.beatorajaSkinOptions,
      playStatusShown: () => this.playStatusShown,
      setStatus: (text) => this.setStatus(text),
      unlockPlaylogOptions: () => this.unlockPlaylogOptions(),
      rememberHiSpeed: (value, source) => this.playRoute.rememberHiSpeed(value, source),
      showDecide: (song, overrides) => this.decideRoute.showDecide(song, overrides),
    });
    this.decideRoute = new DecideRoute({
      router: this.router,
      selectRoute: this.selectRoute,
      elements,
      library: this.library,
      records: this.records,
      familyKits: this.familyKits,
      beatoraja: this.beatoraja,
      playOptions: this.playOptions,
      guiState: this.guiState,
      audio: this.audio,
      beatorajaSkinOptions: this.beatorajaSkinOptions,
      lastPlay: () => this.playRoute.lastPlay,
      recordingDeps: () => this.recordingDeps(),
      setRecordingFilenameBase: (base) => {
        this.recordingFilenameBase = base;
      },
      setStatus: (text) => this.setStatus(text),
      setPlayStatus: (text) => this.setPlayStatus(text),
      lockPlaylogOptionsForPlay: (liveTempo) => this.lockPlaylogOptionsForPlay(liveTempo),
      showSelect: () => this.showSelect(),
      playSong: (song, overrides) => this.playRoute.playSong(song, overrides),
      buildPlayScene: (song, kit, overrides) => this.playRoute.buildPlayScene(song, kit, overrides),
      latchPlay: (view) => this.playRoute.latchPlay(view),
    });
    this.resultRoute = new ResultRoute({
      router: this.router,
      library: this.library,
      records: this.records,
      courses: this.courses,
      courseRoute: this.courseRoute,
      familyKits: this.familyKits,
      lr2: this.lr2,
      beatoraja: this.beatoraja,
      builtIn: this.builtIn,
      playlogAutoSave: this.playlogAutoSave,
      leaderboard: this.leaderboard,
      audio: this.audio,
      testHook: this.testHook,
      lastPlay: () => this.playRoute.lastPlay,
      nameResultJingle: (bytes) => this.nameResultJingle(bytes),
      setPlayStatus: (text) => this.setPlayStatus(text),
      showSelect: () => this.showSelect(),
      playSong: (song, overrides) => this.playRoute.playSong(song, overrides),
      unlockPlaylogOptions: () => this.unlockPlaylogOptions(),
    });
    this.playRoute = new PlayRoute({
      router: this.router,
      selectRoute: this.selectRoute,
      elements,
      library: this.library,
      records: this.records,
      familyKits: this.familyKits,
      beatoraja: this.beatoraja,
      courses: this.courses,
      courseRoute: this.courseRoute,
      nonstopRoute: this.nonstopRoute,
      results: this.resultRoute,
      playOptions: this.playOptions,
      guiState: this.guiState,
      debugMenu: this.debugMenu,
      compressorMode: this.compressorMode,
      deviceProfile,
      audio: this.audio,
      sceneHost: this.sceneHost,
      playlogRecorder: PLAYLOG_RECORDER,
      testHook: this.testHook,
      recordingDeps: () => this.recordingDeps(),
      setRecordingFilenameBase: (base) => {
        this.recordingFilenameBase = base;
      },
      setPlayStatus: (text) => this.setPlayStatus(text),
      lockPlaylogOptionsForPlay: (liveTempo) => this.lockPlaylogOptionsForPlay(liveTempo),
      unlockPlaylogOptions: () => this.unlockPlaylogOptions(),
      showSelect: () => this.showSelect(),
      setPlayOptions: (changes) => this.setPlayOptions(changes),
    });
    this.replayRoute = new ReplayRoute({
      library: this.library,
      records: this.records,
      setStatus: (text) => this.setStatus(text),
      setPlayStatus: (text) => this.setPlayStatus(text),
      playSong: (song, overrides) => this.playRoute.playSong(song, overrides),
      showSelect: () => this.showSelect(),
    });
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
      rememberHiSpeed: (value, source) => this.playRoute.rememberHiSpeed(value, source),
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
    const play = scene.kind === 'play' ? this.playRoute.lastPlay : undefined;
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

  /** Shows the select screen (`SelectRoute.showSelect`): at start-up, and on every way back to it. */
  private showSelect(): Promise<void> {
    return this.selectRoute.showSelect();
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

  /** Re-enables the playlog option controllers, and the skin controls, once no play is in flight. */
  private unlockPlaylogOptions(): void {
    this.leaderboard.unlock();
    this.debugMenu.unlockAfterPlay();
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
