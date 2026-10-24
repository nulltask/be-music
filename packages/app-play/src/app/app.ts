// Imports are split across `@be-music/player-browser`'s entries (`./host`, `./skin`, `./collection`, `./audio`,
// `./recording`) so the dependency surface of this demo is explicit at the file top. The main `@be-music/player-browser`
// entry is reserved for symbols that don't belong to any single entry (`logger`, `Rectangle`).
import { PixiSceneHost, type PlayScene, type SelectScene } from '@be-music/player-browser/host';
import type { BrowseSnapshot, PlayOptions } from '@be-music/player-scene-model';
import type { SkinFamilyId } from '@be-music/player-browser/skin';
import { createAudioService, setMasterVolume, type AudioService } from '@be-music/player-browser/audio';
import { downloadBlob } from '@be-music/player-browser/recording';
import { logger } from '@be-music/player-browser';
import { BeatorajaSkinOptionsPanel, type BeatorajaSkinOptionsPanelDeps } from '../ui/beatoraja-skin-options.ts';
import { LeaderboardPanel } from '../leaderboard-ui.ts';
import { SceneRouter } from './scene-router.ts';
import { DropTarget } from './drop-target.ts';
import { CourseRoute } from './routes/course.ts';
import { NonstopRoute } from './routes/nonstop.ts';
import { SelectRoute } from './routes/select.ts';
import { DecideRoute } from './routes/decide.ts';
import { PlayRoute } from './routes/play.ts';
import { ResultRoute } from './routes/result.ts';
import { ReplayRoute } from './routes/replay.ts';
import { DemoShell } from './shell.ts';
import { InlineSearch } from '../inline-search.ts';
import { DebugMenu, type DebugMenuDeps } from '../ui/debug-menu/index.ts';
import { confirmSkinDrop, promptSkinDrop } from '../ui/skin-drop-prompt.ts';
import { readDeviceSignals, type DeviceProfile } from '../device-profile.ts';
import { captureScreenshot, finalizeRecordingIfActive, toggleRecording } from '../recording-controller.ts';
import type { DemoGUIState, DemoScene, PlayerWebDemoElements, SkinFamilyOverride } from '../types.ts';
import { createDemoGUIState, resolveCompressorMode, storeBuiltInSkinId } from '../services/settings.ts';
import { BE_MUSIC_SKINS } from '../services/built-in-skins.ts';
import { SilentModeSetting } from '../services/silent-mode.ts';
import { playOptionsFromGUI, PlayOptionsService } from '../services/play-options.ts';
import { REPLAY_RECORDER, ReplayAutoSave } from '../services/replays.ts';
import { RecordingService } from '../services/recording.ts';
import { StatusLine } from '../services/status.ts';
import { CourseMakerService } from '../services/course-maker.ts';
import { LibraryService } from '../services/library.ts';
import { RecordsService } from '../services/records.ts';
import { CourseRunService } from '../services/courses.ts';
import { BeatorajaThemeService } from '../services/themes/beatoraja.ts';
import { BuiltInThemeService } from '../services/themes/built-in.ts';
import { LR2ThemeService } from '../services/themes/lr2.ts';
import { FamilyKits } from './family-kits.ts';
import type { TestHookRecorder } from '../test-hook.ts';
import { nameResultJingle, type LiveTestHookDeps } from '../services/test-hook.ts';

const gamereplay = logger('gameplay');

/** What the app is made with: the page's elements, the device it runs on, and the test hook's recorder when enabled. */
export interface PlayerWebDemoAppOptions {
  readonly elements: PlayerWebDemoElements;
  /** Phone or tablet, from the device's signals (`resolveDeviceProfile`). */
  readonly deviceProfile: DeviceProfile;
  /** `window.__beMusicTest`'s recorder (`?e2e=1` or a development build; `test-hook.ts`), or none. */
  readonly testHook: TestHookRecorder | undefined;
}

/**
 * The demo's composition root: it makes the services, the scene router and the routes, and wires them to each other,
 * the Debug Menu and the Leaderboard. `main.ts` makes it, installs the test hook over it and starts it.
 */
export class PlayerWebDemoApp {
  /** The LR2 theme: every theme the drops brought, the one mounted, and its skins, BGM and system sounds. */
  private readonly lr2: LR2ThemeService;
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
    recorder: { finalize: () => finalizeRecordingIfActive(this.recording.deps()) },
    // A navigation the scenes did not ask for (a drop, a skin or theme change, files or a replay loaded) ends the
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
  /** A course from its course bar to its course result (`app/routes/course.ts`). */
  private readonly courseRoute: CourseRoute;
  /** A NONSTOP course from its start, or a restitch, to its result (`app/routes/nonstop.ts`). */
  private readonly nonstopRoute: NonstopRoute;
  /** The player's own courses and the course being made (LR2's course maker), kept in IndexedDB, and its card. */
  private readonly courseMaker = new CourseMakerService({
    resolveChartHashes: (chartEntry) => this.records.resolveChartHashes(chartEntry),
    collection: () => this.library.collection,
    refreshMadeCourses: () => this.library.refreshMadeCourses(),
    selectView: () => this.selectView,
    setStatus: (text) => this.status.set(text),
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
    nativeSearch: () =>
      this.selectView?.ownsSearchInput
        ? {
            focus: () => {
              this.selectView?.focusSearch();
            },
          }
        : undefined,
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
  /** A replay played back from a file (`app/routes/replay.ts`). */
  private readonly replayRoute: ReplayRoute;
  /** Where the select screen was, for its next showing to come back to (the select route's). */
  private get lastSelectNavigation(): BrowseSnapshot | undefined {
    return this.selectRoute.lastSelectNavigation;
  }
  private set lastSelectNavigation(navigation: BrowseSnapshot | undefined) {
    this.selectRoute.lastSelectNavigation = navigation;
  }
  /** The status line: the Debug Menu's Status row, and whether it describes a play or result. */
  private readonly status: StatusLine;
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
   * GUI state object the Tweakpane controllers read / write. Held on the instance so the GUI build code and the runtime
   * handlers (`toggleRecording` etc.) share a single source of truth — programmatic updates go through `state.foo = …`
   * + `controller.updateDisplay()`.
   */
  private readonly guiState: DemoGUIState;
  /** The Leaderboard's Debug Menu folder, account chip and play submission. */
  private readonly leaderboard = new LeaderboardPanel({
    // Read on use: `guiState` is initialized after this field.
    settings: () => this.guiState,
    setStatus: (text) => this.status.set(text),
    warn: (message, error) => gamereplay.warn(message, error),
    recorder: REPLAY_RECORDER,
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
   * Replay auto-save, by `guiState.autoSaveReplay` as it was when the current play STARTED: the result-screen
   * auto-save of a play, and of a course after its last stage, reads this latch, not the live checkbox (the checkbox is
   * disabled during gameplay anyway — the latch is the enforcement for any path that slips through).
   */
  private readonly replayAutoSave = new ReplayAutoSave({
    download: downloadBlob,
    warn: (message, error) => gamereplay.warn(message, error),
  });
  /** The Capture folder's video recording and screenshots: the record armed, the next file name, the format. */
  private readonly recording: RecordingService;
  /** "Play in silent mode": the setting, its checkboxes and its hint. */
  private readonly silentMode: SilentModeSetting;
  /** The Debug Menu (`ui/debug-menu/`), made once the settings and services it works with are. */
  private readonly debugMenu: DebugMenu;
  /** The skin-options panel for the beatoraja screen showing (`ui/beatoraja-skin-options.ts`). */
  private readonly beatorajaSkinOptions: BeatorajaSkinOptionsPanel;
  /** `window.__beMusicTest` for the end-to-end suite (`?e2e=1` or a development build; `test-hook.ts`). */
  private readonly testHook: TestHookRecorder | undefined;
  /** The page around the stage: its gameplay state, fullscreen and touch controls (`app/shell.ts`). */
  private readonly shell: DemoShell;
  private readonly elements: PlayerWebDemoElements;
  public constructor({ elements, deviceProfile, testHook }: PlayerWebDemoAppOptions) {
    this.elements = elements;
    this.testHook = testHook;
    this.guiState = createDemoGUIState({
      signals: readDeviceSignals(),
      devicePixelRatio: window.devicePixelRatio || 1,
      builtInSkinId: (stored) => BE_MUSIC_SKINS.resolve(stored).id,
      actions: {
        openFolder: () => this.elements.chartInput.click(),
        openFiles: () => this.elements.filesInput.click(),
        record: () => {
          void toggleRecording(this.recording.deps());
        },
        screenshot: () => {
          void captureScreenshot(this.recording.deps());
        },
      },
    });
    this.status = new StatusLine({
      settings: this.guiState,
      refresh: () => this.debugMenu.refreshStatus(),
      record: (text) => this.testHook?.recordStatus(text),
    });
    this.recording = new RecordingService({
      sceneHost: this.sceneHost,
      recordController: () => this.debugMenu.recordController,
      activeGameplay: () => this.gameplayView?.recording,
      settings: this.guiState,
      setStatus: (text) => this.status.set(text),
    });
    // Every sound plays through the master volume; start from the remembered level and mute state.
    setMasterVolume(this.guiState.muted ? 0 : this.guiState.masterVolume / 100);
    this.playOptions = new PlayOptionsService(playOptionsFromGUI(this.guiState));
    this.silentMode = new SilentModeSetting({ settings: this.guiState, touchFirst: deviceProfile.touchFirst });
    this.silentMode.install();
    // The `?compressor=split|legacy|off` URL flag, read once at boot.
    const compressor = resolveCompressorMode(window.location.href);
    this.compressorMode = compressor.mode;
    this.guiState.compressor = compressor.enabled;
    this.lr2 = new LR2ThemeService({
      elements,
      setStatus: (text) => this.status.set(text),
      rebuildSkinFamilyPicker: () => this.debugMenu.rebuildSkinFamilyPicker(),
      rebuildLR2ThemePicker: () => this.debugMenu.rebuildLR2ThemePicker(),
    });
    this.beatoraja = new BeatorajaThemeService({
      elements,
      audio: this.audio,
      setStatus: (text) => this.status.set(text),
      selectView: () => this.selectView,
      gameplayView: () => this.gameplayView,
      rebuildBeatorajaSkinPickers: () => this.debugMenu.rebuildBeatorajaSkinPickers(),
      rebuildSkinFamilyPicker: () => this.debugMenu.rebuildSkinFamilyPicker(),
      refreshBeatorajaPlaySkinOptions: () => this.beatorajaSkinOptions.refreshBeatorajaPlaySkinOptions(),
      refreshBeatorajaSelectSkinOptions: () => this.beatorajaSkinOptions.refreshBeatorajaSelectSkinOptions(),
    });
    this.builtIn = new BuiltInThemeService({
      guiState: this.guiState,
      setStatus: (text) => this.status.set(text),
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
      resolveChartHashes: (chartEntry) => this.records.resolveChartHashes(chartEntry),
      courseMaker: this.courseMaker.maker,
      selectView: () => this.selectView,
      showing: () => this.router.current?.identity.kind,
      setStatus: (text) => this.status.set(text),
      showSelect: () => this.showSelect(),
      leaveSelect: () => this.leaveSelect(),
      browseTo: (navigation) => {
        this.lastSelectNavigation = navigation;
      },
      startReplayReplayFromFile: (file) => this.replayRoute.startReplayReplayFromFile(file),
      loadTheme: (files) => this.lr2.loadTheme(files),
      loadBeatorajaTheme: (files) => this.beatoraja.loadBeatorajaTheme(files),
      playSkins: () => this.lr2.playSkins,
      selectSkin: () => this.lr2.selectSkin,
      resultSkin: () => this.lr2.resultSkin,
      beatorajaTheme: () => this.beatoraja.beatorajaTheme,
      confirmSkinDrop: (families) => {
        const preferred = this.pendingSkinSystem;
        this.pendingSkinSystem = undefined;
        return confirmSkinDrop(families, preferred);
      },
      applyDroppedSkin: (family) => this.applyDroppedSkin(family),
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
      replayAutoSave: this.replayAutoSave,
      leaderboard: this.leaderboard,
      familyKits: this.familyKits,
      replayRecorder: REPLAY_RECORDER,
      testHook: this.testHook,
      setStatus: (text) => this.status.set(text),
      showSelect: () => this.showSelect(),
      showDecide: (chartEntry, overrides, then) => this.decideRoute.showDecide(chartEntry, overrides, then),
      playChart: (chartEntry, overrides) => this.playRoute.playChart(chartEntry, overrides),
      showResult: (data, mode) => this.resultRoute.showResult(data, mode),
      showBeatorajaResult: (data, options) => this.resultRoute.showBeatorajaResult(data, options),
      unlockReplayOptions: () => this.unlockReplayOptions(),
    });
    this.courseRoute = new CourseRoute({
      courses: this.courses,
      library: this.library,
      records: this.records,
      courseMaker: this.courseMaker,
      replayAutoSave: this.replayAutoSave,
      leaderboard: this.leaderboard,
      familyKits: this.familyKits,
      replayRecorder: REPLAY_RECORDER,
      selectNavigation: () => this.selectView?.snapshot() ?? this.lastSelectNavigation,
      setStatus: (text) => this.status.set(text),
      startNonstopCourse: (course, options) => this.nonstopRoute.startNonstopCourse(course, options),
      showSelect: () => this.showSelect(),
      showDecide: (chartEntry, overrides, then) => this.decideRoute.showDecide(chartEntry, overrides, then),
      playChart: (chartEntry, overrides) => this.playRoute.playChart(chartEntry, overrides),
      showResult: (data, mode) => this.resultRoute.showResult(data, mode),
      showBeatorajaResult: (data, options) => this.resultRoute.showBeatorajaResult(data, options),
      unlockReplayOptions: () => this.unlockReplayOptions(),
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
      playStatusShown: () => this.status.playShown,
      setStatus: (text) => this.status.set(text),
      unlockReplayOptions: () => this.unlockReplayOptions(),
      rememberHiSpeed: (value, source) => this.playRoute.rememberHiSpeed(value, source),
      showDecide: (chartEntry, overrides) => this.decideRoute.showDecide(chartEntry, overrides),
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
      recordingDeps: () => this.recording.deps(),
      setRecordingFilenameBase: (base) => this.recording.setFilenameBase(base),
      setStatus: (text) => this.status.set(text),
      setPlayStatus: (text) => this.status.setPlay(text),
      lockReplayOptionsForPlay: (liveTempo) => this.lockReplayOptionsForPlay(liveTempo),
      showSelect: () => this.showSelect(),
      playChart: (chartEntry, overrides) => this.playRoute.playChart(chartEntry, overrides),
      buildPlayScene: (chartEntry, kit, overrides) => this.playRoute.buildPlayScene(chartEntry, kit, overrides),
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
      replayAutoSave: this.replayAutoSave,
      leaderboard: this.leaderboard,
      audio: this.audio,
      testHook: this.testHook,
      lastPlay: () => this.playRoute.lastPlay,
      nameResultJingle: (bytes) => nameResultJingle(bytes, { lr2: this.lr2, beatoraja: this.beatoraja }),
      setPlayStatus: (text) => this.status.setPlay(text),
      showSelect: () => this.showSelect(),
      playChart: (chartEntry, overrides) => this.playRoute.playChart(chartEntry, overrides),
      unlockReplayOptions: () => this.unlockReplayOptions(),
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
      replayRecorder: REPLAY_RECORDER,
      testHook: this.testHook,
      recordingDeps: () => this.recording.deps(),
      setRecordingFilenameBase: (base) => this.recording.setFilenameBase(base),
      setPlayStatus: (text) => this.status.setPlay(text),
      lockReplayOptionsForPlay: (liveTempo) => this.lockReplayOptionsForPlay(liveTempo),
      unlockReplayOptions: () => this.unlockReplayOptions(),
      showSelect: () => this.showSelect(),
      setPlayOptions: (changes) => this.setPlayOptions(changes),
    });
    this.replayRoute = new ReplayRoute({
      library: this.library,
      records: this.records,
      setStatus: (text) => this.status.set(text),
      setPlayStatus: (text) => this.status.setPlay(text),
      playChart: (chartEntry, overrides) => this.playRoute.playChart(chartEntry, overrides),
      showSelect: () => this.showSelect(),
    });
    this.shell = new DemoShell({
      sceneHost: this.sceneHost,
      elements,
      search: this.search,
      deviceProfile,
      gameplayView: () => this.gameplayView,
      showing: () => this.router.current?.identity.kind,
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
      familyDispatchState: () => this.familyKits.familyDispatchState(),
      beatorajaTheme: () => this.beatoraja.beatorajaTheme,
      availableLR2Themes: () => this.lr2.availableLR2Themes,
      activeLR2ThemeName: () => this.lr2.activeLR2ThemeName,
      beMusicSkin: () => this.builtIn.beMusicSkin,
      activeBeatorajaPlay: () => this.beatoraja.activeBeatorajaPlay,
      beatorajaSkinConfig: (entryPath, header) => this.beatoraja.beatorajaSkinConfig(entryPath, header),
      setStatus: (text) => this.status.set(text),
      setPlayOptions: (changes) => this.setPlayOptions(changes),
      rememberHiSpeed: (value, source) => this.playRoute.rememberHiSpeed(value, source),
      refreshSelectRecords: () => this.refreshSelectRecords(),
      handleSkinFamilyOverrideChange: (value) => this.handleSkinFamilyOverrideChange(value),
      handleBuiltInSkinChange: (id) => this.handleBuiltInSkinChange(id),
      addBeMusicSkin: (skin) => this.builtIn.addBeMusicSkin(skin),
      addBeMusicSkinFromURL: (url) => this.builtIn.addBeMusicSkinFromURL(url),
      applyBeMusicSkinSettings: () => this.applyBeMusicSkinSettings(),
      applyLR2ThemeByName: (name) => this.applyLR2ThemeByName(name),
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

  /** What the test hook reads at each `state()` call: the scenes the router holds, and the services' state. */
  public testHookDeps(): LiveTestHookDeps {
    return {
      router: this.router,
      elements: this.elements,
      guiState: this.guiState,
      library: this.library,
      records: this.records,
      courses: this.courses,
      courseMaker: this.courseMaker,
      lastPlay: () => this.playRoute.lastPlay,
    };
  }

  public start(): void {
    this.debugMenu.buildGUI();
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
      this.shell.wireCanvasFullscreen();
      this.shell.wireTouchControls();
      this.sceneHost.app.ticker.add(this.shell.syncGameplayShellState);
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

  /** Applies the confirmed family before the library mounts the select scene. */
  private async applyDroppedSkin(family: SkinFamilyId): Promise<void> {
    if (family !== 'lr2' && family !== 'beatoraja') return;
    this.guiState.skinFamilyOverride = family;
    this.debugMenu.showSkinSystem(family);
    await this.selectRoute.dropSelect();
  }

  /** Redraws the select screen in place with the records of the current judge ruleset, after it changed. */
  private refreshSelectRecords(): void {
    this.selectView?.setLibrary(this.library.collection);
  }

  /**
   * Apply a user-picked LR2 theme. Disposes the persistent select view so it gets reconstructed against the new
   * skin on the next `showSelect`, mounts the theme into the slot fields, and returns to song-select.
   */
  private async applyLR2ThemeByName(name: string): Promise<void> {
    const theme = this.lr2.availableLR2Themes.find((entry) => entry.name === name);
    if (theme === undefined) return;
    await this.selectRoute.dropSelect();
    await this.lr2.mountLR2Theme(theme.files, theme.name);
    await this.showSelect();
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
   * Apply a Debug Menu skin-family change. While a play is on the stage, that play draws with the new family and keeps
   * its chart. Otherwise the persistent select scene is made again for the family the pick gives.
   */
  private handleSkinFamilyOverrideChange(value: SkinFamilyOverride): void {
    this.guiState.skinFamilyOverride = value;
    this.debugMenu.showSkinSystem(value);
    const play = this.gameplayView;
    if (play !== undefined && this.router.current === play) {
      void this.switchPlayFamily(play);
      return;
    }
    void this.selectRoute.dropSelect().then(() => this.showSelect());
  }

  /** Swaps the play on the stage to the family just picked, and shows that family's skin options when it has them. */
  private async switchPlayFamily(play: PlayScene): Promise<void> {
    await this.playRoute.switchPlayFamily(play);
    if (play.disposed || this.router.current !== play) return;
    if (play.identity.family === 'beatoraja') this.beatorajaSkinOptions.refreshBeatorajaPlaySkinOptions();
    else this.beatorajaSkinOptions.clear();
  }

  /** Shows the select screen (`SelectRoute.showSelect`): at start-up, and on every way back to it. */
  private showSelect(): Promise<void> {
    return this.selectRoute.showSelect();
  }

  /**
   * Latches the replay-related GUI options for the play that is about to start and disables their controllers.
   * Replay options are per-play: the value in effect at song start governs the whole play, and mid-song changes
   * are rejected by keeping the controls disabled until {@link unlockReplayOptions} runs (result mounted or back
   * at select). The Debug Menu disables its skin controls with them (`DebugMenu.lockForPlay`).
   */
  private lockReplayOptionsForPlay(liveTempo = false): void {
    this.replayAutoSave.latch(this.guiState.autoSaveReplay);
    this.leaderboard.lockForPlay();
    this.debugMenu.lockForPlay(liveTempo);
  }

  /** Re-enables the replay option controllers, and the skin controls, once no play is in flight. */
  private unlockReplayOptions(): void {
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
