// The select route: the select screen (`createSelectScene`), whichever family draws it. The scene router keeps it across
// a decide screen, a play and its result; on a return it shows again with the latest theme's skin and sounds, the
// library and the cursor where it was, and it is made afresh when another family takes it over. A chart started on it
// goes to the decide route (`decide.ts`), or joins the course being made; a course bar goes to the course route
// (`course.ts`).

import type { AudioService } from '@be-music/player-browser/audio';
import { describeChartCollection } from '@be-music/player-browser/collection';
import {
  applyChartLevelEdits,
  chartLevelKey,
  readChartLevelEdits,
  stepChartLevel,
  writeChartLevelEdits,
} from '../../chart-level-edits.ts';
import { chartRankingURL } from '../../leaderboard.ts';
import {
  createSelectScene,
  type PlayScene,
  type SelectScene,
  type SelectSceneKit,
  type SelectStartEntry,
  type ControlSettings,
} from '@be-music/player-browser/host';
import {
  resolveLibraryChartPlayVariant,
  type BrowseSnapshot,
  type LibraryChart,
  type LibraryEntry,
} from '@be-music/player-scene-model';
import { lookupCourseBestRecord } from '../../course-result.ts';
import { pickActiveFamilyForScene } from '../../family-dispatch.ts';
import type { InlineSearch } from '../../inline-search.ts';
import type { CourseMakerService } from '../../services/course-maker.ts';
import type { CourseRunService } from '../../services/courses.ts';
import type { LibraryService } from '../../services/library.ts';
import { copyPlayOptionsToGUI, type GUIPlayOptions, type PlayOptionsService } from '../../services/play-options.ts';
import type { RecordsService } from '../../services/records.ts';
import type { ReplaySlotService } from '../../services/replay-slot-service.ts';
import type { ReplaySlotsPanel } from '../../replay-slots-panel.ts';
import type { BeatorajaThemeService } from '../../services/themes/beatoraja.ts';
import type { BuiltInThemeService } from '../../services/themes/built-in.ts';
import type { LR2ThemeService } from '../../services/themes/lr2.ts';
import type { PlayerGUIState, PlayerScene, PlayerWebElements } from '../../types.ts';
import type { BeatorajaSkinOptionsPanel } from '../../ui/beatoraja-skin-options.ts';
import type { OptionsDialog } from '../../ui/options/index.ts';
import type { FamilyKits } from '../family-kits.ts';
import type { SceneRouter } from '../scene-router.ts';
import type { CourseRoute } from './course.ts';

export interface SelectRouteDeps {
  /** The player's keys the screen reads its control buttons by (`ControlSettings`), as it opens. */
  readonly controls: () => ControlSettings;
  /** Asks whether to leave the select screen (the exit menu, `ui/exit-menu.ts`), then calls back with the answer. */
  readonly closeWindow: () => void;
  readonly showExitMenu: (onChoice: (choice: 'leave' | 'cancel') => void) => void;
  /** The scene router: the select scene it keeps, shown again on a return, or dropped when another family draws it. */
  readonly router: Pick<SceneRouter<PlayerScene, PlayScene, SelectScene>, 'select' | 'show' | 'dropSelect'>;
  /** The page: the shell's `playing` and `empty` classes. */
  readonly elements: Pick<PlayerWebElements, 'shell'>;
  /** The library the screen lists. */
  readonly library: Pick<LibraryService, 'collection' | 'reloadCharts'>;
  /** The best records the screen shows on its bars. */
  readonly records: Pick<
    RecordsService,
    'lookupChartBestRecord' | 'currentRulesetRecords' | 'currentDanRanks' | 'resolveChartHashes'
  >;
  /** The course run: where the cursor goes back to once a course is over. */
  readonly courses: Pick<CourseRunService, 'takeReturnNavigation'>;
  /** Starts a course bar's run. */
  readonly courseRoute: Pick<CourseRoute, 'startCourse'>;
  /** The course being made, which a chart started on the screen joins, and its card. */
  readonly courseMaker: Pick<CourseMakerService, 'maker' | 'panel' | 'addChartToCourseBeingMade'>;
  /** The family that draws the screen, and its sounds. */
  readonly familyKits: Pick<FamilyKits, 'familyDispatchState' | 'selectSoundSet'>;
  /** The LR2 theme's select skin. */
  readonly lr2: Pick<LR2ThemeService, 'selectSkin'>;
  /** The beatoraja theme's select entry (loaded once, and handed again while it stays the same) and its options. */
  readonly beatoraja: Pick<
    BeatorajaThemeService,
    'loadBeatorajaSelectKit' | 'beatorajaSelectKit' | 'beatorajaKitCaches' | 'applyBeatorajaSelectSkinConfig'
  >;
  /** The Be-Music Skin the built-in family draws with. */
  readonly builtIn: Pick<BuiltInThemeService, 'builtInKit'>;
  /** The play options in force: every select screen starts from them, and its own edits go back to them. */
  readonly playOptions: Pick<PlayOptionsService, 'current' | 'update'>;
  /** The Options dialog's state: its play options, which mirror the screen's, and the NONSTOP placement. */
  readonly guiState: GUIPlayOptions & Pick<PlayerGUIState, 'nonstopPlacement'>;
  readonly audio: AudioService;
  /** The search field, which a skin's search box opens. */
  readonly search: Pick<InlineSearch, 'openFromPointer'>;
  /** The Options dialog: its play option controllers, and the render-resolution check on the first select screen. */
  readonly optionsDialog: OptionsDialog;
  /** The skin-options panel of the beatoraja screen showing. */
  readonly beatorajaSkinOptions: Pick<BeatorajaSkinOptionsPanel, 'refreshBeatorajaSelectSkinOptions' | 'clear'>;
  /** Whether the status line describes a play or result, which the select screen replaces with the library's. */
  readonly playStatusShown: () => boolean;
  readonly setStatus: (text: string) => void;
  /** Re-enables the options a play latched. */
  readonly unlockReplayOptions: () => void;
  /** Remembers a hi-speed set on the screen for the next play, and mirrors it onto the Options dialog. */
  readonly rememberHiSpeed: (value: number, source: 'select') => void;
  /** Shows the decide screen for a chart started on the screen (`DecideRoute`). */
  readonly showDecide: (chartEntry: LibraryChart, overrides: { autoPlay?: boolean }) => Promise<void>;
  /**
   * Starts loading the play of a chart picked on the screen as it is picked, through the skin's launch outro
   * (`DecideRoute.preloadOnLaunch`); `showDecide` follows once the outro has played.
   */
  readonly preloadOnLaunch?: (chartEntry: LibraryChart, overrides: { autoPlay?: boolean }) => void;
  /**
   * With PRACTICE on, opens the chart's score to pick the bars to loop (`PracticeBarsDialog`); resolves whether the
   * player started (`true`) or backed out.
   */
  readonly pickPracticeBars?: (chartEntry: LibraryChart) => Promise<boolean>;
  /**
   * The replay slots: which slots a bar has, and the card that lists them on the skins without a replay-slot UI of
   * their own (every family but beatoraja).
   */
  readonly replaySlots: Pick<ReplaySlotService, 'exists' | 'targetOf'>;
  readonly replaySlotsPanel: Pick<ReplaySlotsPanel, 'showSelect'>;
  /** Plays a bar's replay slot (`ReplayRoute.startReplayFromSlot`); returns whether a play starts. */
  readonly startReplayFromSlot: (entry: Exclude<LibraryEntry, { kind: 'folder' }>, slot: number) => boolean;
}

/** The select screen, from its first showing to every return, and the starts made on it. */
export class SelectRoute {
  /**
   * Where the next showing of the select screen puts the cursor: where it was when a play or a decide screen started, the
   * course bar a course was started from, or what a drop brought. Taken once the screen shows; from then on the screen's
   * own cursor is the place, so a screen made again later for another family opens where the player has browsed since.
   */
  public lastSelectNavigation: BrowseSnapshot | undefined;
  /** The charts beatoraja's F10 has still to play in AUTO: each return to the screen starts the next one. */
  private autoPlaylist: LibraryChart[] = [];
  private readonly router: SelectRouteDeps['router'];
  private readonly controls: SelectRouteDeps['controls'];
  private readonly showExitMenu: SelectRouteDeps['showExitMenu'];
  private readonly closeWindow: SelectRouteDeps['closeWindow'];
  private readonly elements: SelectRouteDeps['elements'];
  private readonly library: SelectRouteDeps['library'];
  private readonly records: SelectRouteDeps['records'];
  private readonly courses: SelectRouteDeps['courses'];
  private readonly courseRoute: SelectRouteDeps['courseRoute'];
  private readonly courseMaker: SelectRouteDeps['courseMaker'];
  private readonly familyKits: SelectRouteDeps['familyKits'];
  private readonly lr2: SelectRouteDeps['lr2'];
  private readonly beatoraja: SelectRouteDeps['beatoraja'];
  private readonly builtIn: SelectRouteDeps['builtIn'];
  private readonly playOptions: SelectRouteDeps['playOptions'];
  private readonly guiState: SelectRouteDeps['guiState'];
  private readonly audio: SelectRouteDeps['audio'];
  private readonly search: SelectRouteDeps['search'];
  private readonly optionsDialog: SelectRouteDeps['optionsDialog'];
  private readonly beatorajaSkinOptions: SelectRouteDeps['beatorajaSkinOptions'];
  private readonly playStatusShown: SelectRouteDeps['playStatusShown'];
  private readonly setStatus: SelectRouteDeps['setStatus'];
  private readonly unlockReplayOptions: SelectRouteDeps['unlockReplayOptions'];
  private readonly rememberHiSpeed: SelectRouteDeps['rememberHiSpeed'];
  private readonly showDecide: SelectRouteDeps['showDecide'];
  private readonly preloadOnLaunch: SelectRouteDeps['preloadOnLaunch'];
  private readonly pickPracticeBars: SelectRouteDeps['pickPracticeBars'];
  private readonly replaySlots: SelectRouteDeps['replaySlots'];
  private readonly replaySlotsPanel: SelectRouteDeps['replaySlotsPanel'];
  private readonly startReplayFromSlot: SelectRouteDeps['startReplayFromSlot'];

  public constructor(deps: SelectRouteDeps) {
    this.replaySlots = deps.replaySlots;
    this.replaySlotsPanel = deps.replaySlotsPanel;
    this.startReplayFromSlot = deps.startReplayFromSlot;
    this.router = deps.router;
    this.controls = deps.controls;
    this.showExitMenu = deps.showExitMenu;
    this.closeWindow = deps.closeWindow;
    this.elements = deps.elements;
    this.library = deps.library;
    this.records = deps.records;
    this.courses = deps.courses;
    this.courseRoute = deps.courseRoute;
    this.courseMaker = deps.courseMaker;
    this.familyKits = deps.familyKits;
    this.lr2 = deps.lr2;
    this.beatoraja = deps.beatoraja;
    this.builtIn = deps.builtIn;
    this.playOptions = deps.playOptions;
    this.guiState = deps.guiState;
    this.audio = deps.audio;
    this.search = deps.search;
    this.optionsDialog = deps.optionsDialog;
    this.beatorajaSkinOptions = deps.beatorajaSkinOptions;
    this.playStatusShown = deps.playStatusShown;
    this.setStatus = deps.setStatus;
    this.unlockReplayOptions = deps.unlockReplayOptions;
    this.rememberHiSpeed = deps.rememberHiSpeed;
    this.showDecide = deps.showDecide;
    this.preloadOnLaunch = deps.preloadOnLaunch;
    this.pickPracticeBars = deps.pickPracticeBars;
  }

  /** The select screen (`createSelectScene`), whichever family draws it, kept by the router across the other screens. */
  private get selectView(): SelectScene | undefined {
    return this.router.select;
  }

  /**
   * Shows the select screen: the one the router keeps, brought up to date, or a new one when none is kept or another
   * family draws it now. The cursor comes back where it was, or to the course bar a course was started from.
   */
  public async showSelect(): Promise<void> {
    // beatoraja's F10: the folder's charts play in AUTO one after the other, each one's decide screen straight after the
    // last one's result.
    const next = this.autoPlaylist.shift();
    if (next !== undefined) {
      void this.showDecide(next, { autoPlay: true });
      return;
    }
    // Back from a play or a result: the status line describes the library again instead of the play just left.
    if (this.playStatusShown()) this.setStatus(describeChartCollection(this.library.collection));
    // Back from a course: the cursor returns to the course bar it was started from.
    const courseReturn = this.courses.takeReturnNavigation();
    if (courseReturn !== undefined) this.lastSelectNavigation = courseReturn;
    this.elements.shell.classList.remove('playing');
    this.unlockReplayOptions();
    // The `.empty` class drives the centered "Drop BMS folder…" hint. Toggle it off the moment we have charts to show,
    // and back on after a wipe / failed drop so the hint comes back instead of leaving the user staring at a blank
    // canvas.
    this.elements.shell.classList.toggle('empty', this.library.collection.charts.length === 0);
    // Family dispatch. The Options dialog's "Skin family" pick overrides the auto chain (beatoraja → LR2 → default). The
    // beatoraja family draws the theme's select entry when the library has charts (an empty library shows the built-in
    // screen's drop hint); the LR2 family draws the loaded LR2 select skin when it has a bar list; otherwise the built-in
    // family draws the Be-Music Skin.
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
    if (this.selectView !== undefined && this.selectView.identity.family !== kit.family) {
      // The family changed (an LR2 or a beatoraja theme dropped while the built-in screen is up, or the other way
      // round): only that family's view draws it, so the screen is made again below, carrying the cursor across (the
      // play options are the service's).
      await this.dropSelect();
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
      const navigation = this.lastSelectNavigation;
      this.lastSelectNavigation = undefined;
      if (navigation) kept.restore(navigation);
      if (kit.family === 'beatoraja') this.beatorajaSkinOptions.refreshBeatorajaSelectSkinOptions();
      return;
    }
    // The screen starts from the play options in force (two-way sync: the screen's own edits come back through
    // `on.playOptions` below; the Options dialog's edits push through `setPlayOptions`).
    const playOptions = this.playOptions.current;
    // The select session plays through the audio service; its decide jingle plays out through the decide screen into
    // the play.
    const scene = createSelectScene(kit, {
      controls: this.controls(),
      library: this.library.collection,
      ...(this.lastSelectNavigation !== undefined ? { browse: this.lastSelectNavigation } : {}),
      playOptions,
      records: {
        chart: (chartEntry) => this.records.lookupChartBestRecord(chartEntry),
        course: (course) =>
          lookupCourseBestRecord(course, this.records.currentRulesetRecords(), this.guiState.nonstopPlacement),
        danRanks: () => this.records.currentDanRanks(),
        replaySlots: (entry) => this.replaySlots.exists(entry),
      },
      sounds,
      audio: this.audio,
      courseMaker: this.courseMaker.maker,
      on: {
        start: (entry, { autoPlay, replaySlot }) =>
          replaySlot !== undefined
            ? this.startReplayFromSlot(entry, replaySlot)
            : this.startFromSelect(entry, autoPlay),
        // A chart that will go to its decide screen starts loading its play as it is picked, not after the outro.
        launch: (entry, { autoPlay, replaySlot }) => {
          if (replaySlot !== undefined || entry.kind !== 'chart') return;
          // A chart added to a course being made, or one whose practice bars are picked first, plays nothing yet.
          if (this.courseMaker.maker.draft !== undefined) return;
          if (this.playOptions.current.practice && this.pickPracticeBars !== undefined) return;
          this.preloadOnLaunch?.(entry.chart, autoPlay ? { autoPlay: true } : {});
        },
        // The card lists the bar's replays where the skin has no replay-slot UI (a beatoraja skin draws its own).
        focus: (entry) => {
          if (kit.family !== 'beatoraja') this.replaySlotsPanel.showSelect(entry);
          // "Ghost status" says whether a play of the bar would show the picked ghost.
          const chart = entry?.kind === 'chart' ? entry : undefined;
          const playFamily = pickActiveFamilyForScene(this.familyKits.familyDispatchState(), 'gameplay', chart?.chart);
          const target = chart !== undefined ? this.replaySlots.targetOf(chart) : undefined;
          // No bar, or a folder: nothing to say.
          this.optionsDialog.setGhostAvailability(
            entry === undefined || entry.kind === 'folder'
              ? undefined
              : {
                  family: playFamily === 'default' ? 'built-in' : playFamily,
                  ...(chart !== undefined ? { playVariant: resolveLibraryChartPlayVariant(chart.chart) } : {}),
                  course: entry.kind === 'course',
                  battle: this.playOptions.current.battleMode !== 'OFF',
                  ...(target !== undefined ? { target } : {}),
                  slotsKept: chart !== undefined ? this.replaySlots.exists(chart) : [],
                },
          );
        },
        playOptions: (options) => {
          // Keep the screen's play option edits (an LR2 panel, a skin's buttons) and mirror them into the Options dialog
          // state so both surfaces always agree, then repaint the Options dialog's controls.
          this.playOptions.update(options);
          copyPlayOptionsToGUI(options, this.guiState);
          if (options.hiSpeed !== this.guiState.hiSpeed) this.rememberHiSpeed(options.hiSpeed, 'select');
          this.optionsDialog.refreshPlayOptionControllers();
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
        // Escape at the root confirms closing the window. Cancel keeps the current library and cursor.
        // LR2's F8 and beatoraja's F2: the library's folders are read again, and the screen shows what they hold now.
        reload: () => {
          void this.library.reloadCharts();
        },
        // LR2's key 4 held: the chart's ranking on the Leaderboard (LR2's IR).
        ranking: (chart) => {
          window.open(chartRankingURL(chart, location.hostname), '_blank', 'noopener');
        },
        // LR2's F3 + the arrows: the player's own difficulty or level for the chart, kept for the next visit.
        levelEdit: (chart, part, step) => {
          const edit = stepChartLevel(chart, part, step);
          const edits = { ...readChartLevelEdits(globalThis.localStorage), [chartLevelKey(chart)]: edit };
          writeChartLevelEdits(globalThis.localStorage, edits);
          applyChartLevelEdits([chart], edits);
          this.library.collection = { ...this.library.collection, charts: [...this.library.collection.charts] };
          this.selectView?.setLibrary(this.library.collection);
        },
        // beatoraja's Ctrl+F3 / Ctrl+Shift+F3: the chart's MD5 or SHA-256 on the clipboard.
        copyChartHash: (chart, hash) => {
          void this.copyChartHash(chart, hash);
        },
        // beatoraja's F10: every chart of the folder in AUTO, the first one now.
        autoplayFolder: (charts) => {
          this.lastSelectNavigation = this.selectView?.snapshot();
          this.autoPlaylist = [...charts];
          void this.showSelect();
        },
        exitMenu: () => {
          this.showExitMenu((choice) => {
            if (choice === 'leave') this.closeWindow();
          });
        },
      },
    });
    if (!(await this.router.show(scene, { role: 'select' }))) return;
    this.lastSelectNavigation = undefined;
    if (kit.family === 'beatoraja') this.beatorajaSkinOptions.refreshBeatorajaSelectSkinOptions();
    this.optionsDialog.scheduleFirstRunResolutionDetect();
  }

  /**
   * Drops the select screen so that the next {@link showSelect} makes it again (another family draws it, or another LR2
   * theme was picked), keeping its cursor for that screen unless a drop or a course has put it somewhere already.
   */
  public async dropSelect(): Promise<void> {
    if (this.selectView !== undefined) this.lastSelectNavigation ??= this.selectView.snapshot();
    await this.router.dropSelect();
  }

  /**
   * A chart or a course started on the select screen. While a course is being made, a chart joins it instead of playing
   * (as LR2 does); a course starts its run, or says why it cannot. Returns whether a play starts, so the screen plays
   * the decide jingle only then.
   */
  /** Ends beatoraja's F10 run of AUTO plays: a play given up goes back to the select screen. */
  public endAutoPlaylist(): void {
    this.autoPlaylist = [];
  }

  private async copyChartHash(chart: LibraryChart, hash: 'md5' | 'sha256'): Promise<void> {
    const value = (await this.records.resolveChartHashes(chart))?.[hash];
    if (value === undefined) {
      this.setStatus(`${chart.title}: no ${hash === 'md5' ? 'MD5' : 'SHA-256'} to copy`);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      this.setStatus(`Copied the ${hash === 'md5' ? 'MD5' : 'SHA-256'} of ${chart.title}`);
    } catch {
      this.setStatus(`${chart.title}: the clipboard is not available`);
    }
  }

  private startFromSelect(entry: SelectStartEntry, autoPlay: boolean): boolean {
    if (entry.kind === 'chart') {
      if (this.courseMaker.addChartToCourseBeingMade(entry.chart)) return false;
      // The skin's AUTOPLAY forces auto play for this play only; the Options dialog's checkbox keeps its state.
      const overrides = autoPlay ? { autoPlay: true } : {};
      // PRACTICE first opens the chart's score to pick the bars to loop; the decide screen follows the start.
      if (this.playOptions.current.practice && this.pickPracticeBars !== undefined) {
        const chart = entry.chart;
        void this.pickPracticeBars(chart).then((start) => {
          if (start) void this.showDecide(chart, overrides);
        });
        return false;
      }
      void this.showDecide(entry.chart, overrides);
      return true;
    }
    void this.courseRoute.startCourse(entry.course, autoPlay ? { autoPlay: true } : {});
    return entry.course.playable;
  }
}
