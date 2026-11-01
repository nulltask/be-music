// The player's Tweakpane "Debug Menu": its folders, the controllers the app reaches after building them, and the locks a
// play puts on them. Each folder is built in a module of its own (`play-options.ts`, `tempo.ts`, …) with the menu as
// `this`; the folder titles and the remembered open states are `folders.ts`'. The menu reaches the app only through
// `DebugMenuDeps`, which the app (`app/app.ts`) builds.
import type { BeatorajaSkinConfig, BeatorajaSkinHeader } from '@be-music/skin-beatoraja';
import type { LR2DiscoveredTheme } from '@be-music/skin-lr2';
import type { TunableCompressor } from '@be-music/player-browser/audio';
import { getBrowserWorkerCount } from '@be-music/player-browser/compute';
import type { PixiSceneHost, PlayScene, SelectScene } from '@be-music/player-browser/host';
import type { BeatorajaThemeBundle } from '@be-music/player-browser/skin';
import {
  formatGaugeLabel,
  isDuplicatedBattleChoice,
  resolveRandomModes,
  type PlayOptions,
} from '@be-music/player-scene-model';
import type { BeMusicSkin } from '@be-music/player-skin-sdk';
// Tweakpane injects its component stylesheet; the app themes it with public CSS variables.
import { Pane, type FolderApi, type BladeApi, type ButtonApi, type ListInputBindingApi } from 'tweakpane';
import { paneOptions, type PaneBinding } from '../../pane-controls.ts';
import { resolveGaugeTypes, type GaugeType } from '@be-music/player-engine/ruleset';
import { readStoredCompressorTunings, type CompressorTuning } from '../../compressor-tuning.ts';
import { readStoredCourseTableURLs } from '../../course-table-import.ts';
import { captureDebugMenuSettings } from '../../debug-menu-settings.ts';
import { debugMenuSettingsSync } from '../../debug-menu-settings-sync.ts';
import type { FamilyDispatchState } from '../../family-dispatch.ts';
import type { LeaderboardPanel } from '../../leaderboard-ui.ts';
import type { CourseMakerService } from '../../services/course-maker.ts';
import type { LibraryService } from '../../services/library.ts';
import type { RecordsService } from '../../services/records.ts';
import type { SilentModeSetting } from '../../services/silent-mode.ts';
import type { StoredSkinSettings } from '../../skin-settings.ts';
import type { PlayerGUIState, SkinFamilyOverride } from '../../types.ts';
import type { ActiveBeatorajaPlay } from '../beatoraja-skin-options.ts';
import type { SkinDropFamily } from '../skin-drop-prompt.ts';
import { buildAudioFolder } from './audio.ts';
import { buildCaptureFolder } from './capture.ts';
import {
  buildCompressorTuningGUI,
  refreshCompressorStageVisibility,
  resolveCompressorParamOverrides,
} from './compressor.ts';
import { buildCourseFolder } from './course.ts';
import { buildDeveloperFolder } from './developer.ts';
import { DEBUG_MENU_FOLDERS, readFolderOpenStates, rememberFolderOpenStates, type DebugMenuFolder } from './folders.ts';
import { buildLibraryFolder } from './library.ts';
import { PlayLock } from './play-lock.ts';
import { buildPlayOptionsFolder, buildReplayViewFolder } from './play-options.ts';
import { detectRenderResolution, scheduleFirstRunResolutionDetect } from './render-resolution.ts';
import { applyBeatorajaSkinSwitchIfActive, rebuildBeatorajaSkinPickers } from './skin-pickers.ts';
import { buildSkinFolder, rebuildLR2ThemePicker, rebuildSkinFamilyPicker, rebuildSkinSettingsFolder } from './skin.ts';
import { buildTempoFolder } from './tempo.ts';
/**
 * What the Debug Menu needs from the app: the settings and stores its controllers change, readers of what the app has
 * loaded and shows, and the app's actions its controllers start. The actions keep the names of the app's methods.
 */
export interface DebugMenuDeps {
  /** The settings the controllers read and write (`createPlayerGUIState`), read by the app as each play starts. */
  readonly settings: PlayerGUIState;
  /** The scene host: "Render resolution" sets its resolution, and the Developer folder reads its frame rate. */
  readonly sceneHost: PixiSceneHost;
  /** "Play in silent mode": the Audio folder's checkbox and the start card's option drive it. */
  readonly silentMode: SilentModeSetting;
  /** The Leaderboard panel, which fills its own folder. */
  readonly leaderboard: Pick<LeaderboardPanel, 'buildFolder'>;
  /** The library service: "Import table courses" and "Load from URLs" add to the library through it. */
  readonly library: Pick<LibraryService, 'importCourseTables' | 'loadFromURL'>;
  /** The records service, whose best records "Clear best records" empties. */
  readonly records: Pick<RecordsService, 'chartBestRecords'>;
  /** The course-maker service, whose card "My courses…" opens. */
  readonly courseMaker: Pick<CourseMakerService, 'panel'>;
  /** Each be-music skin's stored settings by skin id, which the "Skin settings" folder edits. */
  readonly skinSettings: StoredSkinSettings;
  /** The beatoraja skin entry picked for each scene type (`SkinType`), which the "Beatoraja skins" pickers write. */
  readonly beatorajaSkinOverridesByType: Map<number, string>;
  /** The compressor architecture every play mounts with (`?compressor=`), read once at boot. */
  readonly compressorMode: 'split' | 'legacy';
  /** The player shell, which "Toggle fullscreen" takes fullscreen. */
  readonly shell: HTMLElement;
  /** The play: loading behind a decide screen, or on the stage. */
  gameplayView(): PlayScene | undefined;
  /** The select screen, on the stage or kept off it. */
  selectView(): SelectScene | undefined;
  /** The loaded skins and the skin family pick, which say whether an LR2 skin is loaded. */
  familyDispatchState(): FamilyDispatchState;
  /** The loaded beatoraja theme. */
  beatorajaTheme(): BeatorajaThemeBundle | undefined;
  /** The LR2 themes the drops so far discovered, by name. */
  availableLR2Themes(): ReadonlyArray<LR2DiscoveredTheme<File>>;
  /** The name of the LR2 theme mounted. */
  activeLR2ThemeName(): string | undefined;
  /** The be-music skin the built-in scenes draw with. */
  beMusicSkin(): BeMusicSkin;
  /** The beatoraja play entry the play on the stage is drawn with, when it plays on a beatoraja theme. */
  activeBeatorajaPlay(): ActiveBeatorajaPlay | undefined;
  /** The player's options for a beatoraja entry, or its header's defaults. */
  beatorajaSkinConfig(entryPath: string, header: BeatorajaSkinHeader): BeatorajaSkinConfig;
  /** Shows a status line. */
  setStatus(text: string): void;
  /** Keeps play options set from the menu for every screen and play, and hands them to the select screen. */
  reusePreviousArrangement?(): Partial<PlayOptions> | undefined;
  clearArrangement?(): void;
  setPlayOptions(changes: Partial<PlayOptions>): void;
  /** Remembers a hi-speed set on the menu's slider, and hands it to the running play. */
  rememberHiSpeed(value: number, source: 'menu'): void;
  /**
   * Has the select screen draw its records again, as they read now: those of the judge ruleset or the NONSTOP placement
   * just picked.
   */
  refreshSelectRecords(): void;
  /** Switches the scenes to another skin system (or the same one with other effects), making the select screen again. */
  handleSkinFamilyOverrideChange(value: SkinFamilyOverride): void;
  /** Switches the built-in scenes to another be-music skin. */
  handleBuiltInSkinChange(id: string): void;
  /** Adds a be-music skin and switches to it. */
  addBeMusicSkin(skin: BeMusicSkin): void;
  /** Imports a be-music skin module from a URL and adds it. */
  addBeMusicSkinFromURL(url: string): Promise<void>;
  /** Hands the be-music skin's settings, as stored, to the scenes drawing with it. */
  applyBeMusicSkinSettings(): void;
  /** Mounts another of the discovered LR2 themes. */
  applyLR2ThemeByName(name: string): Promise<void>;
  /** Asks for a drop of a skin of a skin system with none loaded (`promptSkinDrop`). */
  promptSkinDrop(family: SkinDropFamily): void;
  /** Loads the select entry again with other options and hands it to the beatoraja select screen. */
  applyBeatorajaSelectSkinConfig(entryPath: string, config: BeatorajaSkinConfig): Promise<void>;
  /** Loads a play entry again with other options and hands it to the beatoraja play on the stage. */
  applyBeatorajaPlaySkinConfig(entryPath: string, config: BeatorajaSkinConfig): Promise<void>;
}
/**
 * The Debug Menu (top-right, collapsed on arrival). {@link buildGUI} makes it; then the app reaches it through the
 * methods it calls on a change of its own: a theme load rebuilds the pickers, a status line repaints the status row, a
 * play locks the options it latched ({@link lockForPlay}) and its end unlocks them ({@link unlockAfterPlay}).
 *
 * The folders are built by functions in modules of their own, which run with the menu as `this`, so the controllers
 * and helpers they reach are public members.
 */
export class DebugMenu {
  /** What the menu reaches of the app. */
  public readonly deps: DebugMenuDeps;
  /** The settings the controllers read and write ({@link DebugMenuDeps.settings}). */
  public readonly guiState: PlayerGUIState;
  public readonly sceneHost: PixiSceneHost;
  public readonly silentMode: SilentModeSetting;
  public readonly library: Pick<LibraryService, 'importCourseTables' | 'loadFromURL'>;
  public readonly records: Pick<RecordsService, 'chartBestRecords'>;
  public readonly courseMaker: Pick<CourseMakerService, 'panel'>;
  public readonly skinSettings: StoredSkinSettings;
  public readonly beatorajaSkinOverridesByType: Map<number, string>;
  public readonly compressorMode: 'split' | 'legacy';
  /**
   * Debug-menu folder hosting one dropdown per skin scene type (Play 5K / 7K / 9K / 10K / 14K /
   * 24K / 24Kdp / Music Select / Decide / Result / etc.). Empty until a beatoraja theme is
   * dropped — `rebuildBeatorajaSkinPickers` (re-)populates it from `beatorajaTheme.entries`.
   */
  public beatorajaSkinPickerFolder: FolderApi | undefined;
  /**
   * Active controllers inside {@link beatorajaSkinPickerFolder}, keyed by scene type. Cleared
   * and rebuilt on each `rebuildBeatorajaSkinPickers` call so dropdown options stay in sync with
   * the latest theme drop.
   */
  public readonly beatorajaSkinPickerControllers: Map<number, PaneBinding> = new Map();
  /** The skin system the scenes run on, so a pick of one that is not loaded can be undone. */
  public activeSkinSystem: SkinFamilyOverride = 'auto';
  /** The Debug Menu's "Render resolution" dropdown and "Auto-detect resolution" button. */
  public resolutionPicker: PaneBinding | undefined;
  public autoDetectResolutionControl: ButtonApi | undefined;
  /** Whether a render resolution benchmark is running. */
  public detectingResolution = false;
  /** Whether this visit already scheduled the first-run benchmark. */
  public firstRunResolutionScheduled = false;
  /**
   * Tweakpane handles for controllers we need to address by name after construction — toggling the per-stage folder
   * visibility, renaming the record button, and reflecting URL-driven compressor changes in the pane.
   */
  public gui: Pane | undefined;
  public compressorStageFolder: FolderApi | undefined;
  /** Compressor tuning in slider units, restored from the last visit; seeds every gameplay mount. */
  public readonly compressorTunings: Record<TunableCompressor, CompressorTuning> = readStoredCompressorTunings();
  public recordController: ButtonApi | undefined;
  /**
   * "Auto-save replays" checkbox controller. Held so the play-start path sets `disabled` for the duration
   * of a play — the replay options are latched when a song starts and cannot change mid-song — and the result /
   * select paths enable it again.
   */
  public replaySaveController: PaneBinding | undefined;
  /**
   * Every "Play options" folder controller (auto play / judge / gauge / random / DP flip / auto scratch). Disabled
   * together while a song is playing (`lockReplayOptionsForPlay`) and refreshed when the LR2 select panel pushes
   * a change (`refreshPlayOptionControllers`).
   */
  public readonly playOptionControllers: { disabled: boolean; refresh?: () => void }[] = [];
  /** The "Hi-speed" slider — left enabled during a play (it applies live) and repainted by {@link refreshHiSpeed}. */
  public hiSpeedController: PaneBinding | undefined;
  public judgeTimingController: PaneBinding | undefined;
  public judgeTimingAutoAdjustController: PaneBinding | undefined;
  public hsFixController: ListInputBindingApi<PlayOptions['hsFix']> | undefined;
  public fixedDisplayAreaController: PaneBinding | undefined;
  public floatingHiSpeedController: PaneBinding | undefined;
  public floatingSpeedController: PaneBinding | undefined;
  public classicHiSpeedController: PaneBinding | undefined;
  public normalHiSpeedController: PaneBinding | undefined;
  public normalHiSpeedLevelController: PaneBinding | undefined;
  public classicSpeedController: PaneBinding | undefined;
  public randomSeed1PController: PaneBinding | undefined;
  public randomSeed2PController: PaneBinding | undefined;
  public readonly randomSeedControllers: Array<{ hidden: boolean }> = [];
  public random1PController: ListInputBindingApi<PlayOptions['random1P']> | undefined;
  public random2PController: ListInputBindingApi<PlayOptions['random2P']> | undefined;
  public gaugeController: ListInputBindingApi<GaugeType> | undefined;
  public bottomShiftableGaugeController: ListInputBindingApi<PlayOptions['bottomShiftableGauge']> | undefined;
  public gaugeAutoShiftController: ListInputBindingApi<PlayOptions['gaugeAutoShift']> | undefined;
  public longNoteModifierController: ListInputBindingApi<PlayOptions['longNoteModifier']> | undefined;
  public longNoteRateController: PaneBinding | undefined;
  public sevenToNinePatternController: ListInputBindingApi<PlayOptions['sevenToNinePattern']> | undefined;
  public sevenToNineTypeController: ListInputBindingApi<PlayOptions['sevenToNineType']> | undefined;
  public battleModeController: ListInputBindingApi<PlayOptions['battleMode']> | undefined;
  public dBattleScratchController: PaneBinding | undefined;
  public gauge2PController: ListInputBindingApi<PlayOptions['gauge2P']> | undefined;
  public mRanControllers: PaneBinding[] = [];
  public lr2ExtraModeController: PaneBinding | undefined;
  public lr2ExtraLevelController: ListInputBindingApi<PlayOptions['lr2ExtraLevel']> | undefined;
  public extraNoteDepthController: PaneBinding | undefined;
  public customJudgeController: PaneBinding | undefined;
  /** PRACTICE toggle first, then its settings. */
  public practiceControllers: PaneBinding[] = [];
  public longNoteModeController: ListInputBindingApi<PlayOptions['longNoteMode']> | undefined;
  public customJudgeRateControllers: PaneBinding[] = [];
  public extraNoteScratchController: PaneBinding | undefined;
  public mineModifierController: ListInputBindingApi<PlayOptions['mineModifier']> | undefined;
  public scrollModifierController: ListInputBindingApi<PlayOptions['scrollModifier']> | undefined;
  public scrollSectionController: PaneBinding | undefined;
  public scrollRateController: PaneBinding | undefined;
  public judgeAlgorithmController: ListInputBindingApi<PlayOptions['judgeAlgorithm']> | undefined;
  /** The "Tempo (%)" slider — left enabled during a play whose tempo can change live (`allowsLiveTempo`). */
  public tempoController: PaneBinding | undefined;
  /** Debug Menu folder holding the active be-music skin's settings; hidden for a skin that declares none. */
  public skinSettingsFolder: FolderApi | undefined;
  /** The Debug Menu's "Skin & display" folder, with the common family and display controls. */
  public skinFolder: FolderApi | undefined;
  /** LR2 tab holding the discovered theme picker. */
  public lr2SkinPage: Pick<FolderApi, 'addBinding'> | undefined;
  /** Native list whose options follow loaded theme families without replacing its event handlers. */
  public skinFamilyController: ListInputBindingApi<SkinFamilyOverride> | undefined;
  /** Native theme list, refreshed as drops discover new themes. */
  public lr2ThemeController: ListInputBindingApi<string> | undefined;
  /**
   * The Debug Menu's skin controls that make the select screen again: Built-in skin, Skin effects, the Add skin
   * buttons and the LR2 theme picker. They are disabled during a play ({@link playLock}), since going back to the
   * select screen would end it. Skin system stays enabled: it swaps the play's family without leaving the chart.
   */
  public readonly skinControllers: BladeApi[] = [];
  /** The locks a play puts on the options it latched and on the skin controls, and whether one runs. */
  public readonly playLock: PlayLock = new PlayLock(() => ({
    replaySave: this.replaySaveController,
    playOptions: this.playOptionControllers,
    tempo: this.tempoController,
    skin: [this.lr2ThemeController, ...this.skinControllers],
  }));
  /** Read-only multiline monitor, refreshed immediately when the app posts status. */
  public statusController: PaneBinding | undefined;
  // The folders and the controls that follow what is loaded, each built in its own module with the menu as `this`.
  private readonly buildCaptureFolder = buildCaptureFolder;
  private readonly buildPlayOptionsFolder = buildPlayOptionsFolder;
  private readonly buildReplayViewFolder = buildReplayViewFolder;
  private readonly buildTempoFolder = buildTempoFolder;
  private readonly buildCourseFolder = buildCourseFolder;
  private readonly buildAudioFolder = buildAudioFolder;
  private readonly buildSkinFolder = buildSkinFolder;
  private readonly buildLibraryFolder = buildLibraryFolder;
  private readonly buildDeveloperFolder = buildDeveloperFolder;
  public readonly buildCompressorTuningGUI = buildCompressorTuningGUI;
  public readonly refreshCompressorStageVisibility = refreshCompressorStageVisibility;
  /** Bus `CompressorParams` for every compressor, from the tuning: what each play mounts with. */
  public readonly resolveCompressorParamOverrides = resolveCompressorParamOverrides;
  /** Rebuilds the Skin system picker's options: on every theme load. */
  public readonly rebuildSkinFamilyPicker = rebuildSkinFamilyPicker;
  /** Refills the "Skin settings" folder: when the be-music skin changes. */
  public readonly rebuildSkinSettingsFolder = rebuildSkinSettingsFolder;
  /** Rebuilds the LR2 theme picker: on every LR2 theme load. */
  public readonly rebuildLR2ThemePicker = rebuildLR2ThemePicker;
  /** Rebuilds the "Beatoraja skins" pickers: on every beatoraja theme load. */
  public readonly rebuildBeatorajaSkinPickers = rebuildBeatorajaSkinPickers;
  public readonly applyBeatorajaSkinSwitchIfActive = applyBeatorajaSkinSwitchIfActive;
  /** Benchmarks the render resolution once, the first time the select screen shows. */
  public readonly scheduleFirstRunResolutionDetect = scheduleFirstRunResolutionDetect;
  public readonly detectRenderResolution = detectRenderResolution;
  public constructor(deps: DebugMenuDeps) {
    this.deps = deps;
    this.guiState = deps.settings;
    this.sceneHost = deps.sceneHost;
    this.silentMode = deps.silentMode;
    this.library = deps.library;
    this.records = deps.records;
    this.courseMaker = deps.courseMaker;
    this.skinSettings = deps.skinSettings;
    this.beatorajaSkinOverridesByType = deps.beatorajaSkinOverridesByType;
    this.compressorMode = deps.compressorMode;
  }
  /** The play: loading behind a decide screen, or on the stage. */
  public get gameplayView(): PlayScene | undefined {
    return this.deps.gameplayView();
  }
  /** The select screen, on the stage or kept off it. */
  public get selectView(): SelectScene | undefined {
    return this.deps.selectView();
  }
  /** Shows a status line ({@link DebugMenuDeps.setStatus}). */
  public setStatus(text: string): void {
    this.deps.setStatus(text);
  }
  /** A play option set from the menu ({@link DebugMenuDeps.setPlayOptions}). */
  public setPlayOptions(changes: Partial<PlayOptions>): void {
    this.deps.setPlayOptions(changes);
  }
  /** The header gear follows this pane, including a click on the pane's own title. */
  private reportExpanded: ((open: boolean) => void) | undefined;
  /** Reports when the existing pane opens or closes. */
  public watchExpanded(report: (open: boolean) => void): void {
    this.reportExpanded = report;
  }
  /** Opens the existing Debug Menu when it is closed, and closes it when it is open. No second panel. */
  public toggle(): void {
    if (this.gui !== undefined) this.gui.expanded = !this.gui.expanded;
  }
  /**
   * Builds the floating Tweakpane control panel and wires every controller to the gameplay / scene state. Centralizing
   * this in one method lets us bind handles to specific controllers (`recordController`, `compressorStageFolder`)
   * up-front, so runtime code can address them by name (renaming the record button when capture starts, hiding the
   * per-stage folder on compressor mode change) without re-querying the DOM.
   *
   * Layout (folder titles and default open states live in `folders.ts`): the everyday controls sit at the top level
   * — status, loading, skin pick, capture — followed by the Play options and Audio folders (open by default), then the
   * skin detail, library, and developer folders (closed by default). Every folder remembers whether it was left open.
   */
  public buildGUI(): void {
    // Start the panel itself collapsed so it doesn't cover the select-screen / gameplay canvas the moment a user lands
    // on the player.
    const container = document.createElement('div');
    container.className = 'debug-pane-container';
    // The shell is the fullscreen element (double-click and "Toggle fullscreen"). A menu on `document.body` sits
    // outside that top layer, so the browser hides it until fullscreen ends. The shell does not create a fixed
    // containing block, so the windowed top-right position is unchanged.
    this.deps.shell.append(container);
    const gui = new Pane({ title: 'Debug Menu', container, expanded: false });
    gui.element.classList.add('debug-pane');
    gui.element.dataset.pane = 'debug';
    gui.expanded = false;
    this.gui = gui;
    gui.on('fold', (event) => this.reportExpanded?.(event.expanded));
    const addFolder = (parent: Pick<FolderApi, 'addFolder'>, folder: DebugMenuFolder): FolderApi =>
      parent.addFolder({ title: folder.title, expanded: folder.open });
    // The native read-only monitor shows long load and playback messages without making them editable.
    // Status changes also refresh it immediately through `setStatus`.
    this.statusController = gui.addBinding(this.guiState, 'status', {
      label: 'Status',
      readonly: true,
      multiline: true,
      rows: 3,
    });
    this.statusController.element.classList.add('status-row');
    gui.addButton({ title: 'Open folder' }).on('click', () => this.guiState['openFolder']());
    gui.addButton({ title: 'Open files (ZIP / replay)' }).on('click', () => this.guiState['openFiles']());
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
    this.deps.leaderboard.buildFolder(addFolder(gui, DEBUG_MENU_FOLDERS.leaderboard));
    this.buildDeveloperFolder(addFolder(gui, DEBUG_MENU_FOLDERS.developer));
    this.refreshCompressorStageVisibility();
    rememberFolderOpenStates(gui, undefined, () => this.scheduleSettingsSave());
    gui.on('change', (event) => {
      const key = 'key' in event.target ? event.target.key : undefined;
      if (key === 'status' || key === 'fps') return;
      this.scheduleSettingsSave();
    });
  }
  /**
   * Writes every Debug Menu setting locally immediately; remote publishing is debounced for slider changes.
   * Status and the FPS graph are not settings and do not come through here.
   */
  public scheduleSettingsSave(): void {
    const document = captureDebugMenuSettings(this.guiState, {
      compressorTuning: this.compressorTunings,
      skinSettings: this.skinSettings,
      courseTableURLs: readStoredCourseTableURLs(),
      folders: readFolderOpenStates(),
      workerCount: getBrowserWorkerCount(),
    });
    debugMenuSettingsSync.save(document);
  }
  /**
   * Options read when a play starts, which are disabled while one runs (`lockReplayOptionsForPlay`); returns the
   * controller.
   */
  public trackPlayOption<T extends { disabled: boolean; refresh?: () => void }>(controller: T): T {
    this.playOptionControllers.push(controller);
    return controller;
  }
  /** Repaints the status row with the status line just set. */
  public refreshStatus(): void {
    this.statusController?.refresh();
  }
  /** Repaints the "Hi-speed" slider with a hi-speed set elsewhere (the select screen, the play's keys). */
  public refreshJudgeTiming(): void {
    this.judgeTimingController?.refresh();
  }

  public refreshHiSpeed(): void {
    this.hiSpeedController?.refresh();
    this.floatingSpeedController?.refresh();
    this.floatingHiSpeedController?.refresh();
    this.refreshRulesetChoices();
    this.classicSpeedController?.refresh();
    this.normalHiSpeedLevelController?.refresh();
  }
  /** Shows `value` as the skin system the scenes run on, which a pick of one with no skin loaded goes back to. */
  public showSkinSystem(value: SkinFamilyOverride): void {
    this.activeSkinSystem = value;
    this.skinFamilyController?.refresh();
  }
  /**
   * Disables the options a play latches as it starts, so mid-song changes are rejected until {@link unlockAfterPlay}
   * runs (result mounted or back at select), and the skin controls with them ({@link playLock}). With `liveTempo`, the
   * tempo slider stays enabled and changes the play's tempo live.
   */
  public lockForPlay(liveTempo = false): void {
    this.playLock.lock(liveTempo);
  }
  /** Re-enables the replay option controllers, and the skin controls, once no play is in flight. */
  public unlockAfterPlay(): void {
    this.playLock.unlock();
  }
  /** Clears the local document and the server copy, then reloads. Best records stay. */
  public async resetSettings(): Promise<void> {
    if (
      !window.confirm(
        'Reset every Debug Menu setting to its default and reload? This includes the copy kept for this browser. Best records are kept.',
      )
    ) {
      return;
    }
    await debugMenuSettingsSync.reset();
    window.location.reload();
  }
  /** Repaints the "Play options" controllers after an external write (the LR2 select panel's edits). */
  public refreshRulesetChoices(): void {
    // Options that only transform the chart or the view are offered under every judge ruleset (#774): HS-FIX CONSTANT,
    // the measured hi-speed modes, automatic display timing, scroll and mine modifiers, both EXTRAs, 7-to-9, the battle
    // chart constructions and the source-specific lane options.
    if (this.hsFixController)
      this.hsFixController.options = paneOptions([
        'OFF',
        'MAXBPM',
        'MINBPM',
        'AVERAGE',
        'CONSTANT',
        'STARTBPM',
      ] as const);
    const floating = this.guiState.floatingHiSpeed;
    if (this.floatingSpeedController) this.floatingSpeedController.hidden = !floating;
    const normal = this.guiState.normalHiSpeedLevel > 0;
    if (this.normalHiSpeedLevelController) this.normalHiSpeedLevelController.hidden = !normal || floating;
    if (this.hiSpeedController) this.hiSpeedController.hidden = this.guiState.classicHiSpeed || normal || floating;
    if (this.hsFixController) this.hsFixController.hidden = this.guiState.classicHiSpeed || normal || floating;
    if (this.classicSpeedController) this.classicSpeedController.hidden = !this.guiState.classicHiSpeed || floating;
    const beatoraja = this.guiState.judgeRuleset === 'beatoraja';
    if (!beatoraja && this.guiState.longNoteModifier.startsWith('ADD_')) {
      this.guiState.longNoteModifier = 'OFF';
      this.setPlayOptions({ longNoteModifier: 'OFF' });
    }
    if (this.longNoteModifierController) {
      this.longNoteModifierController.options = paneOptions({
        OFF: 'OFF' as const,
        'LEGACY NOTE (AC 34)': 'LEGACY' as const,
        'LN REMOVE (beatoraja)': 'REMOVE' as const,
        ...(beatoraja
          ? {
              'ADD LN (beatoraja)': 'ADD_LN' as const,
              'ADD CN (beatoraja)': 'ADD_CN' as const,
              'ADD HCN (beatoraja)': 'ADD_HCN' as const,
              'ADD ALL (beatoraja)': 'ADD_ALL' as const,
            }
          : {}),
      });
      this.longNoteModifierController.refresh();
    }
    // BATTLE names LR2's two-player play and the beatoraja / ???? one-player copy, so it follows the ruleset; the other
    // chart constructions are offered under every ruleset.
    const battleChoices: Record<string, PlayOptions['battleMode']> = {
      OFF: 'OFF',
      'CHART HEADER': 'AUTO',
      ...(this.guiState.judgeRuleset === 'lr2'
        ? { BATTLE: 'TWO-PLAYER' as const, COUPLE: 'COUPLE' as const }
        : this.guiState.judgeRuleset === 'beatoraja'
          ? { BATTLE: 'BATTLE' as const }
          : { BATTLE: 'BATTLE' as const, '2P PLAY': 'TWO-PLAYER' as const }),
      'BATTLE AS': 'BATTLE-AS',
      'D-BATTLE': 'D-BATTLE',
      'SP TO DP': 'SP-TO-DP',
    };
    if (!Object.values(battleChoices).includes(this.guiState.battleMode)) {
      this.guiState.battleMode = 'OFF';
      this.setPlayOptions({ battleMode: 'OFF' });
    }
    if (this.battleModeController) {
      this.battleModeController.options = paneOptions(battleChoices);
      this.battleModeController.refresh();
    }
    if (this.dBattleScratchController) this.dBattleScratchController.hidden = this.guiState.battleMode !== 'D-BATTLE';
    const twoPlayer = ['TWO-PLAYER', 'COUPLE', 'AUTO'].includes(this.guiState.battleMode);
    if (this.gauge2PController) this.gauge2PController.hidden = !twoPlayer;
    for (const controller of this.mRanControllers) controller.hidden = !twoPlayer;
    if (this.lr2ExtraLevelController) this.lr2ExtraLevelController.hidden = !this.guiState.lr2ExtraMode;
    if (!beatoraja && this.guiState.longNoteMode !== 'LN') {
      this.guiState.longNoteMode = 'LN';
      this.setPlayOptions({ longNoteMode: 'LN' });
    }
    if (this.longNoteModeController) this.longNoteModeController.hidden = !beatoraja;
    if (!beatoraja && this.guiState.practice) {
      this.guiState.practice = false;
      this.setPlayOptions({ practice: false });
    }
    this.practiceControllers.forEach((controller, index) => {
      controller.hidden = !beatoraja || (index > 0 && !this.guiState.practice);
    });
    if (!beatoraja && this.guiState.customJudge) {
      this.guiState.customJudge = false;
      this.setPlayOptions({ customJudge: false });
    }
    if (this.customJudgeController) this.customJudgeController.hidden = !beatoraja;
    for (const controller of this.customJudgeRateControllers)
      controller.hidden = !beatoraja || !this.guiState.customJudge;
    if (this.longNoteRateController)
      this.longNoteRateController.hidden = !beatoraja || !this.guiState.longNoteModifier.startsWith('ADD_');
    for (const controller of this.randomSeedControllers) controller.hidden = !beatoraja;
    for (const side of ['1P', '2P'] as const) {
      const controller = side === '1P' ? this.randomSeed1PController : this.randomSeed2PController;
      if (controller) controller.hidden = !beatoraja || this.guiState[`random${side}`] === 'RANDOM_PLAYABLE';
    }
    if (!beatoraja && this.guiState.gaugeAutoShift !== 'NONE') {
      this.guiState.gaugeAutoShift = 'NONE';
      this.setPlayOptions({ gaugeAutoShift: 'NONE' });
    }
    if (this.gaugeAutoShiftController) this.gaugeAutoShiftController.hidden = !beatoraja;
    if (this.bottomShiftableGaugeController) this.bottomShiftableGaugeController.hidden = !beatoraja;
    if (this.scrollSectionController) this.scrollSectionController.hidden = this.guiState.scrollModifier !== 'ADD';
    if (this.scrollRateController) this.scrollRateController.hidden = this.guiState.scrollModifier !== 'ADD';
    if (!beatoraja && this.guiState.judgeAlgorithm !== 'combo') {
      this.guiState.judgeAlgorithm = 'combo';
      this.setPlayOptions({ judgeAlgorithm: 'combo' });
    }
    if (this.judgeAlgorithmController) {
      this.judgeAlgorithmController.options = beatoraja
        ? paneOptions({ Combo: 'combo' as const, Duration: 'duration' as const, Lowest: 'lowest' as const })
        : paneOptions({ 'Source default': 'combo' as const });
      this.judgeAlgorithmController.refresh();
    }
    for (const side of ['1P', '2P'] as const) {
      const randomModes = resolveRandomModes(
        this.guiState.judgeRuleset,
        side === '1P' && isDuplicatedBattleChoice(this.guiState.battleMode),
      );
      const key = `random${side}` as const;
      if (!randomModes.includes(this.guiState[key])) {
        this.guiState[key] = 'OFF';
        this.setPlayOptions({ [key]: 'OFF' });
      }
      const controller = side === '1P' ? this.random1PController : this.random2PController;
      if (controller) {
        controller.options = paneOptions(randomModes).map((item) =>
          item.value === 'SCATTER'
            ? { ...item, text: 'SCATTER (LR2 beta3)' }
            : item.value === 'SCATTER-CORRECTED'
              ? { ...item, text: 'SCATTER (9KEY corrected)' }
              : item.value === 'SYNCHRONIZE-RANDOM' || item.value === 'SYMMETRY-RANDOM'
                ? { ...item, text: item.value.replace('-', ' ') }
                : item,
        );
        controller.refresh();
      }
    }
    const choices = resolveGaugeTypes(this.guiState.judgeRuleset);
    if (!choices.includes(this.guiState.gauge)) {
      this.guiState.gauge = 'GROOVE';
      this.setPlayOptions({ gauge1P: 'GROOVE' });
    }
    if (!choices.includes(this.guiState.gauge2P)) {
      this.guiState.gauge2P = 'GROOVE';
      this.setPlayOptions({ gauge2P: 'GROOVE' });
    }
    for (const controller of [this.gaugeController, this.gauge2PController]) {
      if (!controller) continue;
      controller.options = paneOptions(choices).map((item) => ({
        ...item,
        text:
          item.value === 'ASSIST-EASY'
            ? this.guiState.judgeRuleset === '____'
              ? 'ASSISTED EASY'
              : 'ASSIST EASY'
            : item.value === 'DEATH' && this.guiState.judgeRuleset === 'beatoraja'
              ? 'HAZARD'
              : item.value === 'GROOVE' && this.guiState.judgeRuleset !== 'lr2'
                ? 'NORMAL'
                : (formatGaugeLabel(item.text) ?? item.text),
      }));
      controller.refresh();
    }
  }
  public refreshPlayOptionControllers(): void {
    for (const controller of this.playOptionControllers) {
      controller.refresh?.();
    }
    this.scheduleSettingsSave();
  }
}
