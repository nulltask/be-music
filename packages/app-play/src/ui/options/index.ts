// The player's Options dialog: its tabs and folders, the controllers the app reaches after building them, and the locks
// a play puts on them. Each folder is built in a module of its own (`play-options.ts`, `tempo.ts`, …) with the dialog as
// `this`; the tabs, the folder titles and the remembered open states are `folders.ts`'. The dialog reaches the app only
// through `OptionsDialogDeps`, which the app (`app/app.ts`) builds.
import type { BeatorajaSkinConfig, BeatorajaSkinHeader } from '@be-music/skin-beatoraja';
import type { LR2DiscoveredTheme } from '@be-music/skin-lr2';
import type { TunableCompressor } from '@be-music/player-browser/audio';
import { getBrowserWorkerCount } from '@be-music/player-browser/compute';
import type { PixiSceneHost, PlayScene, SelectScene } from '@be-music/player-browser/host';
import type { BeatorajaThemeBundle } from '@be-music/player-browser/skin';
import {
  formatGaugeLabel,
  isDuplicatedBattleChoice,
  keepPracticeGauge,
  type PlayOptions,
} from '@be-music/player-scene-model';
import type { BeMusicSkin } from '@be-music/player-skin-sdk';
import {
  OptionFolder,
  type OptionBinding,
  type OptionButton,
  type OptionContainer,
  type OptionRow,
} from '../options-controls.ts';
import { paneOptions, type PaneBinding } from '../../pane-controls.ts';
import {
  migrateOptionValue,
  practiceReadsJudgeRankAndTotal,
  resolveGaugeTypes,
  type GaugeType,
} from '@be-music/player-engine/ruleset';
import { readStoredCompressorTunings, type CompressorTuning } from '../../compressor-tuning.ts';
import { readStoredCourseTableURLs } from '../../course-table-import.ts';
import { captureOptionSettings } from '../../option-settings.ts';
import { optionSettingsSync } from '../../option-settings-sync.ts';
import type { FamilyDispatchState } from '../../family-dispatch.ts';
import type { LeaderboardPanel } from '../../leaderboard-ui.ts';
import type { CourseMakerService } from '../../services/course-maker.ts';
import {
  resolveGhostStatus,
  type GhostBarFacts,
  type GhostModeSetting,
  type GhostReplayFile,
  type GhostSourceSetting,
} from '../../services/ghost.ts';
import type { LibraryService } from '../../services/library.ts';
import type { RecordsService } from '../../services/records.ts';
import type { BGACameraService } from '../../services/bga-camera.ts';
import type { SilentModeSetting } from '../../services/silent-mode.ts';
import type { StoredSkinSettings } from '../../skin-settings.ts';
import type { PlayerGUIState, SkinFamilyOverride } from '../../types.ts';
import type { ActiveBeatorajaPlay } from '../beatoraja-skin-options.ts';
import type { SkinDropFamily } from '../skin-drop-prompt.ts';
import { buildAudioFolder } from './audio.ts';
import { buildBGACameraFolder } from './bga-camera.ts';
import { buildCaptureFolder } from './capture.ts';
import {
  buildCompressorTuningGUI,
  refreshCompressorStageVisibility,
  resolveCompressorParamOverrides,
} from './compressor.ts';
import { buildCourseFolder } from './course.ts';
import { buildDeveloperFolder } from './developer.ts';
import { OPTION_FOLDERS, OPTIONS_TABS, type OptionFolderSpec } from './folders.ts';
import { buildLibraryFolder } from './library.ts';
import { PlayLock } from './play-lock.ts';
import {
  battleModeItems,
  bottomShiftableGaugeItems,
  laneOptionItems,
  menuLaneCovers,
  practiceGaugeItems,
} from './play-option-items.ts';
import { buildPlayOptionsFolder, buildReplayViewFolder } from './play-options.ts';
import { buildQuickOptionsPanel, QUICK_OPTIONS_ENABLED } from './quick-options.ts';
import { detectRenderResolution, scheduleFirstRunResolutionDetect } from './render-resolution.ts';
import { applyBeatorajaSkinSwitchIfActive, rebuildBeatorajaSkinPickers } from './skin-pickers.ts';
import { buildSkinFolder, rebuildLR2ThemePicker, rebuildSkinFamilyPicker, rebuildSkinSettingsFolder } from './skin.ts';
import { OptionHelp } from './help.ts';
import { buildKeyConfigFolder } from './keys.ts';
import { relabelOptions } from './labels.ts';
import { buildTempoFolder } from './tempo.ts';
import { onPlayerLangChange, playerLang } from '../../player-copy.ts';
import { releaseFocusOnClose } from '../dialog-focus.ts';
/**
 * What the Options dialog needs from the app: the settings and stores its controllers change, readers of what the app has
 * loaded and shows, and the app's actions its controllers start. The actions keep the names of the app's methods.
 */
export interface OptionsDialogDeps {
  /** The settings the controllers read and write (`createPlayerGUIState`), read by the app as each play starts. */
  readonly settings: PlayerGUIState;
  /** The replay file "Ghost replay file…" picks as a ghost. */
  readonly ghostReplayFile: GhostReplayFile;
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
  /** Each Be-Music Skin's stored settings by skin id, which the "Skin settings" folder edits. */
  readonly skinSettings: StoredSkinSettings;
  /** The beatoraja skin entry picked for each scene type (`SkinType`), which the "Beatoraja skins" pickers write. */
  readonly beatorajaSkinOverridesByType: Map<number, string>;
  /** The compressor architecture every play mounts with (`?compressor=`), read once at boot. */
  readonly compressorMode: 'split' | 'legacy';
  /**
   * The player shell. "Toggle fullscreen" covers the play surface inside it (`#main`), where this menu is mounted, so
   * the site header and the site footer stay outside fullscreen.
   */
  readonly shell: HTMLElement;
  /** The camera the play can show in its BGA frame, which the Camera tab sets up. */
  readonly bgaCamera: BGACameraService;
  /** The play: loading behind a decide screen, or on the stage. */
  gameplayView(): PlayScene | undefined;
  /** The select screen, on the stage or kept off it. */
  selectView(): SelectScene | undefined;
  /** The loaded skins and the skin family pick, which say whether an LR2 skin is loaded. */
  familyDispatchState(): FamilyDispatchState;
  hasPendingSkin?(family: 'lr2' | 'beatoraja'): boolean;
  /** The loaded beatoraja theme. */
  beatorajaTheme(): BeatorajaThemeBundle | undefined;
  /** The LR2 themes the drops so far discovered, by name. */
  availableLR2Themes(): ReadonlyArray<LR2DiscoveredTheme<File>>;
  /** The name of the LR2 theme mounted. */
  activeLR2ThemeName(): string | undefined;
  /** The Be-Music Skin the built-in scenes draw with. */
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
  /** Switches the built-in scenes to another Be-Music Skin. */
  handleBuiltInSkinChange(id: string): void;
  /** Adds a Be-Music Skin and switches to it. */
  addBeMusicSkin(skin: BeMusicSkin): void;
  /** Imports a Be-Music Skin module from a URL and adds it. */
  addBeMusicSkinFromURL(url: string): Promise<void>;
  /** Hands the Be-Music Skin's settings, as stored, to the scenes drawing with it. */
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
 * The Options dialog, opened from the header's Settings button. {@link buildGUI} makes it; then the app reaches it
 * through the methods it calls on a change of its own: a theme load rebuilds the pickers, a status line repaints the
 * status row, a play locks the options it latched ({@link lockForPlay}) and its end unlocks them ({@link unlockAfterPlay}).
 *
 * The folders are built by functions in modules of their own, which run with the dialog as `this`, so the controllers
 * and helpers they reach are public members.
 */
export class OptionsDialog {
  /** What the menu reaches of the app. */
  public readonly deps: OptionsDialogDeps;
  /** The settings the controllers read and write ({@link OptionsDialogDeps.settings}). */
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
   * Options folder hosting one dropdown per skin scene type (Play 5K / 7K / 9K / 10K / 14K /
   * 24K / 24Kdp / Music Select / Decide / Result / etc.). Empty until a beatoraja theme is
   * dropped — `rebuildBeatorajaSkinPickers` (re-)populates it from `beatorajaTheme.entries`.
   */
  public beatorajaSkinPickerFolder: OptionContainer | undefined;
  /**
   * Active controllers inside {@link beatorajaSkinPickerFolder}, keyed by scene type. Cleared
   * and rebuilt on each `rebuildBeatorajaSkinPickers` call so dropdown options stay in sync with
   * the latest theme drop.
   */
  public readonly beatorajaSkinPickerControllers: Map<number, PaneBinding> = new Map();
  /** The skin system the scenes run on, so a pick of one that is not loaded can be undone. */
  public activeSkinSystem: SkinFamilyOverride = 'auto';
  /** The Options dialog's "Render resolution" dropdown and "Auto-detect resolution" button. */
  public resolutionPicker: PaneBinding | undefined;
  public autoDetectResolutionControl: OptionButton | undefined;
  /** Whether a render resolution benchmark is running. */
  public detectingResolution = false;
  /** Whether this visit already scheduled the first-run benchmark. */
  public firstRunResolutionScheduled = false;
  /**
   * Handles for controllers we need to address by name after construction — toggling the per-stage folder
   * visibility, renaming the record button, and reflecting URL-driven compressor changes in the dialog.
   */
  public gui: OptionFolder | undefined;
  public compressorStageFolder: OptionContainer | undefined;
  /** Compressor tuning in slider units, restored from the last visit; seeds every gameplay mount. */
  public readonly compressorTunings: Record<TunableCompressor, CompressorTuning> = readStoredCompressorTunings();
  public recordController: OptionButton | undefined;
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
  public hsFixController: OptionBinding<PlayOptions['hsFix']> | undefined;
  public fixedDisplayAreaController: PaneBinding | undefined;
  public floatingHiSpeedController: PaneBinding | undefined;
  public floatingSpeedController: PaneBinding | undefined;
  public classicHiSpeedController: PaneBinding | undefined;
  public normalHiSpeedController: PaneBinding | undefined;
  public normalHiSpeedLevelController: PaneBinding | undefined;
  public classicSpeedController: PaneBinding | undefined;
  public randomSeed1PController: PaneBinding | undefined;
  public randomSeed2PController: PaneBinding | undefined;
  public random1PController: OptionBinding<PlayOptions['random1P']> | undefined;
  public random2PController: OptionBinding<PlayOptions['random2P']> | undefined;
  public gaugeController: OptionBinding<GaugeType> | undefined;
  /** The quick options panel (`quick-options.ts`), and the controls on it whose choices or visibility follow others. */
  public quickOptionsPanel: OptionFolder | undefined;
  public quickRandom1PController: OptionBinding<PlayOptions['random1P']> | undefined;
  public quickGaugeController: OptionBinding<GaugeType> | undefined;
  public quickHsFixController: OptionBinding<PlayOptions['hsFix']> | undefined;
  public quickHiSpeedController: PaneBinding | undefined;
  public bottomShiftableGaugeController: OptionBinding<PlayOptions['bottomShiftableGauge']> | undefined;
  public gaugeAutoShiftController: OptionBinding<PlayOptions['gaugeAutoShift']> | undefined;
  public longNoteModifierController: OptionBinding<PlayOptions['longNoteModifier']> | undefined;
  public longNoteRateController: PaneBinding | undefined;
  public sevenToNinePatternController: OptionBinding<PlayOptions['sevenToNinePattern']> | undefined;
  public sevenToNineTypeController: OptionBinding<PlayOptions['sevenToNineType']> | undefined;
  public battleModeController: OptionBinding<PlayOptions['battleMode']> | undefined;
  public dBattleScratchController: PaneBinding | undefined;
  public gauge2PController: OptionBinding<PlayOptions['gauge2P']> | undefined;
  public mRanControllers: PaneBinding[] = [];
  public lr2ExtraModeController: PaneBinding | undefined;
  public anyKeyController: PaneBinding | undefined;
  public lr2ExtraLevelController: OptionBinding<PlayOptions['lr2ExtraLevel']> | undefined;
  public extraNoteDepthController: PaneBinding | undefined;
  public customJudgeController: PaneBinding | undefined;
  /** PRACTICE toggle first, then its settings. */
  public practiceControllers: PaneBinding[] = [];
  /** PRACTICE's GAUGE TYPE: the judge ruleset's own gauges. */
  public practiceGaugeController: OptionBinding<PlayOptions['practiceGauge']> | undefined;
  /** PRACTICE's GAUGE CATEGORY, which only beatoraja has. */
  public practiceGaugeCategoryController: PaneBinding | undefined;
  /** PRACTICE's JUDGERANK and TOTAL, which That-Which-Must-Not-Be-Named does not read. */
  public practiceJudgeRankAndTotalControllers: PaneBinding[] = [];
  public longNoteModeController: OptionBinding<PlayOptions['longNoteMode']> | undefined;
  public customJudgeRateControllers: PaneBinding[] = [];
  public extraNoteScratchController: PaneBinding | undefined;
  public mineModifierController: OptionBinding<PlayOptions['mineModifier']> | undefined;
  public scrollModifierController: OptionBinding<PlayOptions['scrollModifier']> | undefined;
  public scrollSectionController: PaneBinding | undefined;
  public scrollRateController: PaneBinding | undefined;
  public judgeAlgorithmController: OptionBinding<PlayOptions['judgeAlgorithm']> | undefined;
  /** "Ghost" (Replay / ghost): which replay a ghost plays. Disabled during a play, and on a course bar. */
  public ghostController: OptionBinding<GhostSourceSetting> | undefined;
  /** "Ghost mode": how the ghost shows. Disabled with "Ghost". */
  public ghostModeController: OptionBinding<GhostModeSetting> | undefined;
  /** "Ghost status": whether the bar under the cursor would show the picked ghost, or why not. */
  public ghostStatusController: PaneBinding | undefined;
  /** What "Ghost status" shows. */
  public readonly ghostStatus = { text: '-' };
  /** Whether a play runs, which disables "Ghost" with the other play options. */
  public ghostLocked = false;
  /** What the select screen knows of the bar under the cursor ({@link setGhostAvailability}). */
  private ghostBar: GhostBarFacts | undefined;
  /** The "Tempo (%)" slider — left enabled during a play whose tempo can change live (`allowsLiveTempo`). */
  public tempoController: PaneBinding | undefined;
  /** Options dialog folder holding the active Be-Music Skin's settings; hidden for a skin that declares none. */
  public skinSettingsFolder: OptionContainer | undefined;
  /** The Options dialog's "Skin & display" folder, with the common family and display controls. */
  public skinFolder: OptionContainer | undefined;
  /** LR2 tab holding the discovered theme picker. */
  public lr2SkinPage: Pick<OptionContainer, 'addBinding'> | undefined;
  /** Native list whose options follow loaded theme families without replacing its event handlers. */
  public skinFamilyController: OptionBinding<SkinFamilyOverride> | undefined;
  /** Native theme list, refreshed as drops discover new themes. */
  public lr2ThemeController: OptionBinding<string> | undefined;
  /**
   * The Options dialog's skin controls that make the select screen again: Built-in skin, Skin effects, the Add skin
   * buttons and the LR2 theme picker. They are disabled during a play ({@link playLock}), since going back to the
   * select screen would end it. Skin system stays enabled: it swaps the play's family without leaving the chart.
   */
  public readonly skinControllers: OptionRow[] = [];
  /** The locks a play puts on the options it latched and on the skin controls, and whether one runs. */
  public readonly playLock: PlayLock = new PlayLock(() => ({
    replaySave: this.replaySaveController,
    playOptions: this.playOptionControllers,
    tempo: this.tempoController,
    skin: [this.lr2ThemeController, ...this.skinControllers],
  }));
  /** Read-only multiline monitor, refreshed immediately when the app posts status. */
  public statusController: PaneBinding | undefined;
  // The folders and the controls that follow what is loaded, each built in its own module with the dialog as `this`.
  private readonly buildCaptureFolder = buildCaptureFolder;
  private readonly buildBGACameraFolder = buildBGACameraFolder;
  private readonly buildPlayOptionsFolder = buildPlayOptionsFolder;
  private readonly buildReplayViewFolder = buildReplayViewFolder;
  private readonly buildKeyConfigFolder = buildKeyConfigFolder;
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
  /** Refills the "Skin settings" folder: when the Be-Music Skin changes. */
  public readonly rebuildSkinSettingsFolder = rebuildSkinSettingsFolder;
  /** Rebuilds the LR2 theme picker: on every LR2 theme load. */
  public readonly rebuildLR2ThemePicker = rebuildLR2ThemePicker;
  /** Rebuilds the "Beatoraja skins" pickers: on every beatoraja theme load. */
  public readonly rebuildBeatorajaSkinPickers = rebuildBeatorajaSkinPickers;
  public readonly applyBeatorajaSkinSwitchIfActive = applyBeatorajaSkinSwitchIfActive;
  /** Benchmarks the render resolution once, the first time the select screen shows. */
  public readonly scheduleFirstRunResolutionDetect = scheduleFirstRunResolutionDetect;
  public readonly detectRenderResolution = detectRenderResolution;
  public constructor(deps: OptionsDialogDeps) {
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
  /** Shows a status line ({@link OptionsDialogDeps.setStatus}). */
  public setStatus(text: string): void {
    this.deps.setStatus(text);
  }
  /**
   * SUDDEN+ / HIDDEN+ set from the menu (the Effect, Lane cover and Cover height of the View tab and the quick options
   * panel): stored, and handed to a running play as its covers.
   */
  public setCoverOptions(changes: Partial<PlayOptions>): void {
    this.setPlayOptions(changes);
    this.gameplayView?.controller.dispatch({
      type: 'cover',
      command: { type: 'cover-set', covers: menuLaneCovers(this.guiState) },
    });
  }
  /** Shows the quick options panel (on the select and play screens) or hides it. */
  public setQuickOptionsShown(shown: boolean): void {
    const dock = this.quickOptionsPanel?.element.parentElement;
    if (dock) dock.hidden = !shown;
    if (shown) this.quickOptionsPanel?.refresh();
  }
  /** A play option set from the menu ({@link OptionsDialogDeps.setPlayOptions}). */
  public setPlayOptions(changes: Partial<PlayOptions>): void {
    this.deps.setPlayOptions(changes);
  }
  /** The header gear follows the Options dialog: open, closed with its close button, Escape or a backdrop click. */
  private reportExpanded: ((open: boolean) => void) | undefined;
  /** Reports when the Options dialog opens or closes. */
  public watchExpanded(report: (open: boolean) => void): void {
    this.reportExpanded = report;
  }
  /** Opens the Options dialog when it is closed, and closes it when it is open. */
  public toggle(): void {
    if (this.gui !== undefined) this.gui.expanded = !this.gui.expanded;
  }
  /**
   * Builds the Options dialog (`#options-modal`) and wires every controller to the gameplay / scene state. Centralizing
   * this in one method lets us bind handles to specific controllers (`recordController`, `compressorStageFolder`)
   * up-front, so runtime code can address them by name (renaming the record button when capture starts, hiding the
   * per-stage folder on compressor mode change) without re-querying the DOM.
   *
   * Layout: one tab per area (`OPTIONS_TABS`), each holding its folders as sections, with the folders inside them as
   * sections of their own (`folders.ts`).
   */
  public buildGUI(): void {
    const dialog = document.querySelector<HTMLDialogElement>('#options-modal');
    const body = document.querySelector<HTMLElement>('#options-modal-body');
    if (dialog === null || body === null) return;
    const gui = OptionFolder.dialog(dialog, body, 'Options');
    this.gui = gui;
    // Help's own text for each control, beside it; rows made since the last opening (a theme's pickers) get theirs too.
    const help = new OptionHelp(dialog, playerLang);
    gui.on('fold', (event) => {
      if (event.expanded) {
        help.attach();
        relabelOptions(gui, playerLang());
      }
      this.reportExpanded?.(event.expanded);
    });
    // Closed, the keys go back to the play: left on the gear, Enter (meant to start the chart) would open it again.
    releaseFocusOnClose(dialog);
    dialog.querySelector('#options-modal-close')?.addEventListener('click', () => (gui.expanded = false));
    // Fullscreen covers the play surface and leaves the header out, so the surface has its own Options button then.
    document.querySelector('#options-open')?.addEventListener('click', () => (gui.expanded = true));
    // A click on the backdrop lands on the dialog itself.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) gui.expanded = false;
    });
    // Keys stay in the dialog, so the play behind it does not take them.
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
    const addSection = (parent: OptionContainer, folder: OptionFolderSpec): OptionFolder =>
      parent.addFolder({ title: folder.title });
    const addFolder = (parent: Pick<OptionContainer, 'addFolder'>, folder: OptionFolderSpec): OptionFolder =>
      parent.addFolder({ title: folder.title });
    const tabs = gui.addTab({ pages: OPTIONS_TABS.map((title) => ({ title })) });
    const [play, view, keys, skin, audio, cameraTab, library, leaderboard, advanced] = tabs.pages;
    if (!play || !view || !keys || !skin || !audio || !cameraTab || !library || !leaderboard || !advanced) return;
    // Tabs in the order a session uses them: how to play and what the lanes show, the keys, how it looks and sounds,
    // the camera in the BGA frame, the library (loading, records, the select screen's list, courses and capturing a play), the Leaderboard, then
    // the advanced settings. The sections are made first, top to bottom, since the Play options fill the View and
    // Select folders on other tabs.
    const playOptions = addSection(play, OPTION_FOLDERS.playOptions);
    const viewFolder = addSection(view, OPTION_FOLDERS.view);
    // The status line shows long load and playback messages read-only; `setStatus` refreshes it at once.
    this.statusController = library.addBinding(this.guiState, 'status', {
      label: 'Status',
      readonly: true,
      multiline: true,
      rows: 3,
    });
    this.statusController.element.classList.add('status-row');
    library.addButton({ title: 'Open folder' }).on('click', () => this.guiState['openFolder']());
    library.addButton({ title: 'Open files (ZIP / replay)' }).on('click', () => this.guiState['openFiles']());
    this.buildLibraryFolder(addSection(library, OPTION_FOLDERS.library), addFolder);
    const select = addSection(library, OPTION_FOLDERS.select);
    this.buildCourseFolder(addSection(library, OPTION_FOLDERS.course));
    this.buildCaptureFolder(addSection(library, OPTION_FOLDERS.capture));
    const { practice, replay } = this.buildPlayOptionsFolder(playOptions, viewFolder, select);
    this.buildTempoFolder(addFolder(practice, OPTION_FOLDERS.tempo));
    this.buildReplayViewFolder(addFolder(replay, OPTION_FOLDERS.replayView));
    this.buildKeyConfigFolder(addSection(keys, OPTION_FOLDERS.keys));
    this.buildSkinFolder(addSection(skin, OPTION_FOLDERS.skin), addFolder);
    this.buildAudioFolder(addSection(audio, OPTION_FOLDERS.audio), addFolder);
    this.buildBGACameraFolder(addSection(cameraTab, OPTION_FOLDERS.bgaCamera), this.deps.bgaCamera);
    this.deps.leaderboard.buildFolder(addSection(leaderboard, OPTION_FOLDERS.leaderboard));
    this.buildDeveloperFolder(addSection(advanced, OPTION_FOLDERS.advanced));
    this.refreshCompressorStageVisibility();
    gui.on('change', () => {
      this.scheduleSettingsSave();
      // The quick options panel reads the same values.
      this.quickOptionsPanel?.refresh();
    });
    const quickDock = document.querySelector<HTMLElement>('#quick-options');
    if (quickDock !== null && QUICK_OPTIONS_ENABLED) {
      this.quickOptionsPanel = buildQuickOptionsPanel.call(this, quickDock);
    }
    help.attach();
    // The labels in the player's language, and again when it changes (Help's language switch, the header's menu).
    relabelOptions(gui, playerLang());
    onPlayerLangChange(() => relabelOptions(gui, playerLang()));
  }
  /**
   * Writes every Options dialog setting locally immediately; remote publishing is debounced for slider changes.
   * Status and the FPS graph are not settings and do not come through here.
   */
  public scheduleSettingsSave(): void {
    const document = captureOptionSettings(this.guiState, {
      compressorTuning: this.compressorTunings,
      skinSettings: this.skinSettings,
      courseTableURLs: readStoredCourseTableURLs(),
      workerCount: getBrowserWorkerCount(),
    });
    optionSettingsSync.save(document);
  }
  /**
   * Options read when a play starts, which are disabled while one runs (`lockReplayOptionsForPlay`); returns the
   * controller.
   */
  public trackPlayOption<T extends { disabled: boolean; refresh?: () => void }>(controller: T): T {
    this.playOptionControllers.push(controller);
    return controller;
  }
  /**
   * Tells the menu about the bar under the cursor: "Ghost status" says whether a play of it would show the picked ghost
   * (`resolveGhostStatus`), and a course bar disables "Ghost" and "Ghost mode", their choices kept for the charts.
   */
  public setGhostAvailability(facts: GhostBarFacts | undefined): void {
    this.ghostBar = facts;
    this.refreshGhostAvailability();
  }
  /** Repaints "Ghost", "Ghost mode" and "Ghost status": disabled during a play and on a course bar. */
  public refreshGhostAvailability(): void {
    const disabled = this.ghostLocked || this.ghostBar?.course === true;
    if (this.ghostController) this.ghostController.disabled = disabled;
    if (this.ghostModeController) this.ghostModeController.disabled = disabled;
    this.ghostStatus.text = resolveGhostStatus(
      this.guiState.ghost,
      this.guiState.ghostMode,
      this.ghostBar,
      this.deps.ghostReplayFile,
    );
    this.ghostStatusController?.refresh();
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
    this.quickHiSpeedController?.refresh();
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
        'Reset every Options dialog setting to its default and reload? This includes the copy kept for this browser. Best records are kept.',
      )
    ) {
      return;
    }
    await optionSettingsSync.reset();
    window.location.reload();
  }
  /**
   * `value` when it is one of `choices`; a bare colliding value from before ADR 0019 as the judge ruleset's own
   * qualified one; `OFF` otherwise.
   */
  private keepChoice<T extends string>(value: T, choices: readonly T[]): T {
    if (choices.includes(value)) return value;
    const migrated = migrateOptionValue(value, this.guiState.judgeRuleset) as T;
    return choices.includes(migrated) ? migrated : ('OFF' as T);
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
    // A hi-speed mode's own controls stay in place while another mode is on, disabled rather than hidden.
    if (this.floatingSpeedController) this.floatingSpeedController.unavailable = !floating;
    const normal = this.guiState.normalHiSpeedLevel > 0;
    if (this.normalHiSpeedLevelController) this.normalHiSpeedLevelController.unavailable = !normal || floating;
    if (this.hiSpeedController) this.hiSpeedController.unavailable = this.guiState.classicHiSpeed || normal || floating;
    if (this.hsFixController) this.hsFixController.unavailable = this.guiState.classicHiSpeed || normal || floating;
    // The quick panel offers only the regular hi-speed and HS-FIX; a measured or classic mode is set in the dialog.
    if (this.quickHiSpeedController)
      this.quickHiSpeedController.unavailable = this.guiState.classicHiSpeed || normal || floating;
    if (this.quickHsFixController)
      this.quickHsFixController.unavailable = this.guiState.classicHiSpeed || normal || floating;
    if (this.classicSpeedController)
      this.classicSpeedController.unavailable = !this.guiState.classicHiSpeed || floating;
    if (this.anyKeyController) this.anyKeyController.hidden = this.guiState.judgeRuleset !== '____';
    const ruleset = this.guiState.judgeRuleset;
    const beatoraja = ruleset === 'beatoraja';
    // Long-note addition is offered under every ruleset (#774): the added long notes are judged as the ruleset's long
    // notes, so ADD CN / ADD HCN differ from ADD LN only under beatoraja rules.
    // BATTLE names LR2's two-player play and the beatoraja / ???? one-player copy, so each carries its source
    // (ADR 0019); the choices are grouped by source, the judge ruleset's own first.
    const battleChoices = battleModeItems(ruleset);
    const battleMode = this.keepChoice(
      this.guiState.battleMode,
      battleChoices.map((item) => item.value),
    );
    if (battleMode !== this.guiState.battleMode) {
      this.guiState.battleMode = battleMode;
      this.setPlayOptions({ battleMode });
    }
    if (this.battleModeController) {
      this.battleModeController.options = battleChoices;
      this.battleModeController.refresh();
    }
    if (this.dBattleScratchController) this.dBattleScratchController.hidden = this.guiState.battleMode !== 'D-BATTLE';
    const twoPlayer = ['TWO-PLAYER', 'COUPLE', 'AUTO'].includes(this.guiState.battleMode);
    if (this.gauge2PController) this.gauge2PController.hidden = !twoPlayer;
    for (const controller of this.mRanControllers) controller.hidden = !twoPlayer;
    if (this.lr2ExtraLevelController) this.lr2ExtraLevelController.unavailable = !this.guiState.lr2ExtraMode;
    if (!beatoraja && this.guiState.longNoteMode !== 'LN') {
      this.guiState.longNoteMode = 'LN';
      this.setPlayOptions({ longNoteMode: 'LN' });
    }
    if (this.longNoteModeController) this.longNoteModeController.hidden = !beatoraja;
    // PRACTICE is offered under every ruleset (#933): its gauge list is the judge ruleset's own gauges, GAUGE CATEGORY
    // is beatoraja's alone, and AC reads neither JUDGERANK nor TOTAL.
    const practice = this.guiState.practice;
    this.practiceControllers.forEach((controller, index) => {
      controller.hidden = index > 0 && !practice;
    });
    const practiceGauge = keepPracticeGauge(this.guiState.practiceGauge, ruleset);
    if (practiceGauge !== this.guiState.practiceGauge) {
      this.guiState.practiceGauge = practiceGauge;
      this.setPlayOptions({ practiceGauge });
    }
    if (this.practiceGaugeController) {
      this.practiceGaugeController.options = practiceGaugeItems(ruleset);
      this.practiceGaugeController.refresh();
    }
    if (this.practiceGaugeCategoryController) this.practiceGaugeCategoryController.hidden = !practice || !beatoraja;
    for (const controller of this.practiceJudgeRankAndTotalControllers)
      controller.hidden = !practice || !practiceReadsJudgeRankAndTotal(ruleset);
    if (!beatoraja && this.guiState.customJudge) {
      this.guiState.customJudge = false;
      this.setPlayOptions({ customJudge: false });
    }
    if (this.customJudgeController) this.customJudgeController.hidden = !beatoraja;
    // The rates belong to beatoraja's rules; under them they stay in place, disabled while CUSTOM JUDGE is off.
    for (const controller of this.customJudgeRateControllers) {
      controller.hidden = !beatoraja;
      controller.unavailable = !this.guiState.customJudge;
    }
    if (this.longNoteRateController)
      this.longNoteRateController.unavailable = !this.guiState.longNoteModifier.startsWith('ADD_');
    // Every ruleset seeds its lane randoms (#933); only the PMS playable randomizer ignores its seed, as in the source.
    for (const side of ['1P', '2P'] as const) {
      const controller = side === '1P' ? this.randomSeed1PController : this.randomSeed2PController;
      if (controller) controller.hidden = this.guiState[`random${side}`] === 'RANDOM_PLAYABLE';
    }
    // Gauge auto-shift is offered under every ruleset, along its own gauge ladder (#933). LR2 has no ASSIST EASY, so
    // its lowest auto-shift gauge starts at EASY.
    const bottomChoices = bottomShiftableGaugeItems(ruleset);
    if (!bottomChoices.some((item) => item.value === this.guiState.bottomShiftableGauge)) {
      this.guiState.bottomShiftableGauge = bottomChoices[0]!.value;
      this.setPlayOptions({ bottomShiftableGauge: this.guiState.bottomShiftableGauge });
    }
    if (this.bottomShiftableGaugeController) {
      this.bottomShiftableGaugeController.options = bottomChoices;
      this.bottomShiftableGaugeController.refresh();
    }
    if (this.scrollSectionController) this.scrollSectionController.unavailable = this.guiState.scrollModifier !== 'ADD';
    if (this.scrollRateController) this.scrollRateController.unavailable = this.guiState.scrollModifier !== 'ADD';
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
    // Every lane option is offered under every ruleset, grouped by source; S-RANDOM and CONVERGE once per source, and
    // RANDOM once for all (ADR 0019).
    for (const side of ['1P', '2P'] as const) {
      const items = laneOptionItems(ruleset, side === '1P' && isDuplicatedBattleChoice(this.guiState.battleMode));
      const key = `random${side}` as const;
      const mode = this.keepChoice(
        this.guiState[key],
        items.map((item) => item.value),
      );
      if (mode !== this.guiState[key]) {
        this.guiState[key] = mode;
        this.setPlayOptions({ [key]: mode });
      }
      const controllers =
        side === '1P' ? [this.random1PController, this.quickRandom1PController] : [this.random2PController];
      for (const controller of controllers) {
        if (!controller) continue;
        controller.options = items;
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
    for (const controller of [this.gaugeController, this.gauge2PController, this.quickGaugeController]) {
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
    this.quickOptionsPanel?.refresh();
    this.scheduleSettingsSave();
  }
}
