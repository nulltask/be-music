import { resolveChart } from '@be-music/chart-model';
import { isBmsonRecoveryDisabled } from '@be-music/player-engine/ruleset';
import { clampFloatingHiSpeed } from '@be-music/player-scene-model';
// The play route: the play screen (`createPlayScene`), whichever family draws it. A chart plays at once (no decide
// screen, a retry, F5, a course stage, a NONSTOP run or a replay): the select screen goes off the stage, kept, the play
// takes it and loads there, then starts. The decide route (`decide.ts`) has the play made here and loads it behind its
// screen. Every play is made with the play options in force, and leads to its result (`result.ts`), to the next stage
// of a course, or back to the select screen.

import type { ResolvedPlayChart } from '@be-music/player-engine';
import { resolvePlayChart } from '@be-music/player-engine/replay';
import type { AudioService } from '@be-music/player-browser/audio';
import { resolveChartSource, type ChartFileHashes } from '@be-music/player-browser/collection';
import {
  createPlayScene,
  PlayOptionMismatchError,
  type PixiSceneHost,
  type PlayScene,
  type SelectScene,
} from '@be-music/player-browser/host';
import type { BeMusicReplay, ReplayRecorderInfo } from '@be-music/player-engine/replay';
import { abortedRecordPlayFromResult, courseStageRecordPlayFromResult } from '@be-music/player-engine/records';
import { snapHiSpeed, type LibraryChart, type PlayOptions, type PlayResult } from '@be-music/player-scene-model';
import {
  courseGoesOnAfter,
  courseReplayStageGivenUp,
  playAgainOverrides,
  recordCourseStage,
  resolveGameplayExit,
  resolveGameplayRestart,
  type ActiveCourse,
  type CourseStagePlay,
} from '../../course-flow.ts';
import { skipsCourseStageResult } from '../../course-result.ts';
import { sanitizeFilenameStem } from '../../player-utils.ts';
import { resolvePlayLayoutMode, type DeviceProfile } from '../../device-profile.ts';
import { storeHiSpeed } from '../../hi-speed-storage.ts';
import { allowsLiveTempo, describePlayingStatus, tempoPercentFromTempo } from '../../play-tempo-settings.ts';
import { startArmedRecording, type RecordingDeps } from '../../recording-controller.ts';
import type { LeaderboardPanel } from '../../leaderboard-ui.ts';
import type { CourseRunService } from '../../services/courses.ts';
import type { LibraryService } from '../../services/library.ts';
import type { PlayOptionsService } from '../../services/play-options.ts';
import type { RecordsService } from '../../services/records.ts';
import type { BeatorajaPlayEntry, BeatorajaThemeService } from '../../services/themes/beatoraja.ts';
import { courseStageRecordKey, playRecordKey } from '../../chart-best-records.ts';
import type { TestHookRecorder } from '../../test-hook.ts';
import type { PlayerGUIState, PlayerScene, PlayerWebElements } from '../../types.ts';
import type { DebugMenu } from '../../ui/debug-menu/index.ts';
import type { FamilyKits, ResolvedPlayKit } from '../family-kits.ts';
import { resolvePlaySceneOptions, type PlaySceneGUIState } from '../play-scene-options.ts';
import type { SceneRouter } from '../scene-router.ts';
import type { CourseRoute } from './course.ts';
import { playingFamily } from './decide.ts';
import type { NonstopPlay, NonstopRoute } from './nonstop.ts';
import { disposeKeepingAudioTail, type ResultRoute } from './result.ts';
import type { SelectRoute } from './select.ts';

/** The chart and play mode of a play start: what R on its result plays again. */
export interface LastPlay {
  chart: LibraryChart;
  overrides: { autoPlay: boolean; replay?: BeMusicReplay };
}

/**
 * What a play puts in force as it takes the stage ({@link PlayRoute.latchPlay}), worked out as it is made: its start
 * (R's retry, the test hook's `play`), the record keys its result is kept under, and its beatoraja play entry.
 */
interface PlayLatches {
  readonly lastPlay: LastPlay;
  readonly playRecordKey: string | undefined;
  readonly stageRecordKey: string | undefined;
  readonly beatorajaPlay: BeatorajaPlayEntry | undefined;
}

export interface PlayRouteDeps {
  /** The scene router: the select scene it keeps, the play it holds, and the navigation a play shows in. */
  readonly router: Pick<
    SceneRouter<PlayerScene, PlayScene, SelectScene>,
    'select' | 'play' | 'begin' | 'isCurrent' | 'leave' | 'show' | 'prepare'
  >;
  /** The select route: where its screen was, for its next showing to come back to. */
  readonly selectRoute: Pick<SelectRoute, 'lastSelectNavigation'>;
  /** The page: the shell's `playing` class. */
  readonly elements: Pick<PlayerWebElements, 'shell'>;
  /** The library: the chart's asset source. */
  readonly library: Pick<LibraryService, 'collection'>;
  /** The chart hashes the play's log records, and the record keys of the play in flight. */
  readonly records: Pick<
    RecordsService,
    | 'resolveChartHashes'
    | 'lookupChartBestRecord'
    | 'activePlayRecordKey'
    | 'activeStageRecordKey'
    | 'recordActivePlay'
    | 'recordActiveCourseStage'
  >;
  /** The Leaderboard: a single play given up with ESC is sent as a failed play. */
  readonly leaderboard: Pick<LeaderboardPanel, 'maybeSubmit'>;
  /** The kit the play is drawn with. */
  readonly familyKits: Pick<FamilyKits, 'resolvePlayKit' | 'selectSoundSet'>;
  /** The beatoraja play entry in force, which the Debug Menu's skin pickers and the skin-options panel apply to. */
  readonly beatoraja: Pick<BeatorajaThemeService, 'activeBeatorajaPlay'>;
  /** The course run in progress: a stage's lane limits, and giving the course up. */
  readonly courses: Pick<CourseRunService, 'active' | 'giveUp' | 'abandonRun'>;
  /** A course's next stage, and its course result. */
  readonly courseRoute: Pick<CourseRoute, 'continueCourse' | 'showCourseResult'>;
  /** A NONSTOP run's result, and its restitch on F5. */
  readonly nonstopRoute: Pick<NonstopRoute, 'showNonstopCourseResult' | 'startNonstopCourse'>;
  /** The play's result, and the beatoraja chart its graphs plot. */
  readonly results: Pick<ResultRoute, 'lastBeatorajaChart' | 'showResult' | 'showBeatorajaPlayResult'>;
  /** The play options in force: the covers, HS-FIX, BGA and score graph the play is made with. */
  readonly playOptions: Pick<PlayOptionsService, 'current'> &
    Partial<Pick<PlayOptionsService, 'arrangementFor' | 'rememberArrangement'>>;
  /** The Debug Menu's state: the lane, gauge, tempo, audio and debug options the play is made with. */
  readonly guiState: PlaySceneGUIState & Pick<PlayerGUIState, 'courseAutoAdvance' | 'playLayout'>;
  /** The Debug Menu: the compressor's tuned parameters, and the hi-speed slider. */
  readonly debugMenu: DebugMenu;
  /** The compressor architecture every play mounts with (`?compressor=`). */
  readonly compressorMode: 'split' | 'legacy';
  /** The device: the built-in play's layout follows it. */
  readonly deviceProfile: DeviceProfile;
  readonly audio: AudioService;
  /** The host the play shows on: it builds its layers as it loads. */
  readonly sceneHost: PixiSceneHost;
  /** This app as the recorder of its replays. */
  readonly replayRecorder: Omit<ReplayRecorderInfo, 'engine'>;
  /** `window.__beMusicTest`, when installed: the replay of a stage that shows no result. */
  readonly testHook: Pick<TestHookRecorder, 'recordReplay'> | undefined;
  /** The video recording's deps: a recording armed on the select screen starts with the play. */
  readonly recordingDeps: () => RecordingDeps;
  /** Names the next saved recording after the chart. */
  readonly setRecordingFilenameBase: (base: string) => void;
  /** Shows a status about the play, which the select screen replaces when it comes back. */
  readonly setPlayStatus: (text: string) => void;
  /** Latches the options a play takes for it, and disables their controls. */
  readonly lockReplayOptionsForPlay: (liveTempo?: boolean) => void;
  /** Re-enables the options a play latched. */
  readonly unlockReplayOptions: () => void;
  readonly showSelect: () => Promise<void>;
  /** Names the selected options a chart cannot be played with; `onClose` runs once the player dismisses it. */
  readonly showPlayOptionMismatch: (options: readonly string[], onClose: () => void) => void;
  /** Keeps a play option for every screen and play, and pushes it to the select screen. */
  readonly setPlayOptions: (changes: Partial<PlayOptions>) => void;
}

/** A play, from its start to where it leads. */
export class PlayRoute {
  /**
   * The chart and play mode of the most recent play start (LR2 / default and beatoraja alike), so the result screen's
   * R key can start the same chart again. `autoPlay` is resolved at play start so a retry keeps the mode the play ran
   * in even when the toggle changes on the result screen; the remaining play options are read from the GUI state as
   * on any play start. Set as the play takes the stage ({@link latchPlay}), not as it is made.
   */
  public lastPlay: LastPlay | undefined;
  /** What each play made and not yet on the stage puts in force once it takes it ({@link latchPlay}). */
  private readonly latches = new WeakMap<PlayScene, PlayLatches>();
  /**
   * The chart the latest play was made for, and the course it belongs to, so a family change during that play can
   * resolve the same chart's kit without starting the play again.
   */
  private liveDrawing:
    | {
        chart: LibraryChart;
        courseStage?: CourseStagePlay;
        nonstop?: NonstopPlay;
        preResolved?: ResolvedPlayChart;
        replay?: BeMusicReplay;
      }
    | undefined;
  private readonly router: PlayRouteDeps['router'];
  private readonly selectRoute: PlayRouteDeps['selectRoute'];
  private readonly elements: PlayRouteDeps['elements'];
  private readonly library: PlayRouteDeps['library'];
  private readonly records: PlayRouteDeps['records'];
  private readonly leaderboard: PlayRouteDeps['leaderboard'];
  private readonly familyKits: PlayRouteDeps['familyKits'];
  private readonly beatoraja: PlayRouteDeps['beatoraja'];
  private readonly courses: PlayRouteDeps['courses'];
  private readonly courseRoute: PlayRouteDeps['courseRoute'];
  private readonly nonstopRoute: PlayRouteDeps['nonstopRoute'];
  private readonly results: PlayRouteDeps['results'];
  private readonly playOptions: PlayRouteDeps['playOptions'];
  private readonly guiState: PlayRouteDeps['guiState'];
  private readonly debugMenu: PlayRouteDeps['debugMenu'];
  private readonly compressorMode: PlayRouteDeps['compressorMode'];
  private readonly deviceProfile: PlayRouteDeps['deviceProfile'];
  private readonly audio: PlayRouteDeps['audio'];
  private readonly sceneHost: PlayRouteDeps['sceneHost'];
  private readonly replayRecorder: PlayRouteDeps['replayRecorder'];
  private readonly testHook: PlayRouteDeps['testHook'];
  private readonly recordingDeps: PlayRouteDeps['recordingDeps'];
  private readonly setRecordingFilenameBase: PlayRouteDeps['setRecordingFilenameBase'];
  private readonly setPlayStatus: PlayRouteDeps['setPlayStatus'];
  private readonly lockReplayOptionsForPlay: PlayRouteDeps['lockReplayOptionsForPlay'];
  private readonly unlockReplayOptions: PlayRouteDeps['unlockReplayOptions'];
  private readonly showSelect: PlayRouteDeps['showSelect'];
  private readonly showPlayOptionMismatch: PlayRouteDeps['showPlayOptionMismatch'];
  private readonly setPlayOptions: PlayRouteDeps['setPlayOptions'];

  public constructor(deps: PlayRouteDeps) {
    this.router = deps.router;
    this.selectRoute = deps.selectRoute;
    this.elements = deps.elements;
    this.library = deps.library;
    this.records = deps.records;
    this.leaderboard = deps.leaderboard;
    this.familyKits = deps.familyKits;
    this.beatoraja = deps.beatoraja;
    this.courses = deps.courses;
    this.courseRoute = deps.courseRoute;
    this.nonstopRoute = deps.nonstopRoute;
    this.results = deps.results;
    this.playOptions = deps.playOptions;
    this.guiState = deps.guiState;
    this.debugMenu = deps.debugMenu;
    this.compressorMode = deps.compressorMode;
    this.deviceProfile = deps.deviceProfile;
    this.audio = deps.audio;
    this.sceneHost = deps.sceneHost;
    this.replayRecorder = deps.replayRecorder;
    this.testHook = deps.testHook;
    this.recordingDeps = deps.recordingDeps;
    this.setRecordingFilenameBase = deps.setRecordingFilenameBase;
    this.setPlayStatus = deps.setPlayStatus;
    this.lockReplayOptionsForPlay = deps.lockReplayOptionsForPlay;
    this.unlockReplayOptions = deps.unlockReplayOptions;
    this.showSelect = deps.showSelect;
    this.showPlayOptionMismatch = deps.showPlayOptionMismatch;
    this.setPlayOptions = deps.setPlayOptions;
  }

  /** The select screen (`createSelectScene`), whichever family draws it, kept by the router across the other screens. */
  private get selectView(): SelectScene | undefined {
    return this.router.select;
  }

  /** The play (`createPlayScene`), whichever family draws it: loading behind a decide screen, or on the stage. */
  private get gameplayView(): PlayScene | undefined {
    return this.router.play;
  }

  /** The EXPERT / GRADE course being played, between its stages (the course run service's). */
  private get activeCourse(): ActiveCourse | undefined {
    return this.courses.active;
  }

  /**
   * Makes the play scene for `song` with `kit` (`resolvePlayKit`: built-in, LR2 or beatoraja) and the current option
   * snapshot (`createPlayScene`). Every family shares every other option, so `preloadGameplay` and `playChart` marshal
   * them in one place. Making a play puts nothing in force: it may load behind a decide screen that is backed out of.
   * It does so as it takes the stage ({@link latchPlay}).
   */
  public buildPlayScene(
    chartEntry: LibraryChart,
    { kit, beatorajaPlay }: ResolvedPlayKit,
    overrides: {
      autoPlay?: boolean;
      replay?: BeMusicReplay;
      chartHashes?: ChartFileHashes;
      courseStage?: CourseStagePlay;
      nonstop?: NonstopPlay;
      preResolved?: ResolvedPlayChart;
    },
  ): PlayScene {
    this.liveDrawing = {
      chart: chartEntry,
      preResolved: overrides.preResolved,
      replay: overrides.replay,
      ...(overrides.courseStage !== undefined ? { courseStage: overrides.courseStage } : {}),
      ...(overrides.nonstop !== undefined ? { nonstop: overrides.nonstop } : {}),
    };
    const playOptions = this.playOptions.current;
    const replay = overrides.replay;
    const courseStage = overrides.courseStage;
    const nonstop = overrides.nonstop;
    // The Debug Menu's picks and the play options in force, with a course's lane limits, a replay's recorded setup and
    // the tempo chosen (`play-scene-options.ts`).
    const { autoPlay, tempo, settings, course } = resolvePlaySceneOptions({
      guiState: this.guiState,
      playOptions,
      autoPlay: overrides.autoPlay,
      replay,
      fixedArrangement:
        replay === undefined &&
        courseStage === undefined &&
        nonstop === undefined &&
        this.guiState.judgeRuleset === 'beatoraja'
          ? this.playOptions.arrangementFor?.(chartEntry.id)
          : undefined,
      chartHashes: overrides.chartHashes,
      courseStage,
      activeCourse: this.activeCourse,
      nonstop,
      audioCompressorParams: this.debugMenu.resolveCompressorParamOverrides(),
      audioCompressorMode: this.compressorMode,
      replayRecorder: this.replayRecorder,
    });
    // Only a play the player actually played counts towards the chart's best record; a course stage counts for the
    // course instead.
    // A play at another tempo is practice: it is not ranked, and leaves the records alone too.
    // A play keeps the record of the judge ruleset it runs under (a replay keeps none).
    const judgeRuleset = this.guiState.judgeRuleset;
    const latches: PlayLatches = {
      lastPlay: { chart: chartEntry, overrides: { autoPlay, ...(replay !== undefined ? { replay } : {}) } },
      playRecordKey: playRecordKey(chartEntry, overrides.chartHashes?.sha256, {
        autoPlay,
        replay: replay !== undefined,
        course: courseStage !== undefined || nonstop !== undefined,
        tempo,
        judgeRuleset,
      }),
      // An EXPERT / GRADE stage also updates its chart's record, as LR2 does (not a NONSTOP run's stitched play).
      stageRecordKey:
        courseStage !== undefined
          ? courseStageRecordKey(chartEntry, overrides.chartHashes?.sha256, {
              autoPlay,
              replay: replay !== undefined,
              tempo,
              judgeRuleset,
            })
          : undefined,
      beatorajaPlay,
    };
    // beatoraja PRACTICE plays a single chart's range over and over, saving nothing (the host's `practiceRange`).
    const practicing =
      this.playOptions.current.practice &&
      judgeRuleset === 'beatoraja' &&
      replay === undefined &&
      courseStage === undefined &&
      nonstop === undefined;
    const callbacks = {
      // In-play hi-speed changes come back to be remembered for the next play.
      onHiSpeedChange: (hiSpeed: number, normalLevel?: number, floating?: boolean) => {
        if (floating !== undefined) {
          this.setPlayOptions({ floatingHiSpeed: floating });
        }
        if (normalLevel !== undefined) {
          this.guiState.normalHiSpeedLevel = normalLevel;
          this.setPlayOptions({ normalHiSpeedLevel: normalLevel });
        }
        this.rememberHiSpeed(hiSpeed, 'play');
      },
      // A tempo change during the play (the tempo slider in pitch mode, or a replay following its log).
      onTempoChange: (changed: number) => this.followLiveTempo(changed),
      onExit: () => {
        // ESC gives a running course up: the run is kept as a failed one (as LR2 records it), with the stage given up
        // recorded once the engine hands its replay over.
        const view = this.gameplayView;
        const active = courseStage !== undefined ? this.activeCourse : undefined;
        // ESC stops a course replay where it is, as it stops a dropped replay: back to the select screen, no result.
        if (active?.replay !== undefined || nonstop?.replay !== undefined) {
          this.courses.abandonRun();
          void this.showSelect();
          return;
        }
        const exit = resolveGameplayExit({ courseStage: active !== undefined, nonstop: nonstop !== undefined });
        if (exit === 'give-up-course') {
          void (async () => {
            const replay = await view?.waitForReplay();
            this.testHook?.recordReplay(replay);
            this.courses.giveUp(active!, replay, view?.progress());
            await this.courseRoute.showCourseResult();
          })();
          return;
        }
        if (exit === 'nonstop-result') {
          // The stitched chart as the play played it, for a beatoraja result skin's graphs.
          const resolved = view?.resolved;
          void (async () => {
            await this.nonstopRoute.showNonstopCourseResult(
              nonstop!,
              await view?.waitForReplay(),
              view?.progress(),
              resolved,
            );
          })();
          return;
        }
        // A single play given up is saved as a failed play, as LR2 and beatoraja save one: its record (the notes it
        // never reached counted in its BP) and its Leaderboard entry. One that judged no note yet saves nothing. One
        // that keeps no record but is the player's own (at another tempo) still goes to the Leaderboard, which decides
        // whether it ranks; an AUTO play and a replay go nowhere.
        const source = this.gameplayView?.resolved?.chart;
        const total = source === undefined ? undefined : resolveChart(source).total;
        const recoveryDisabled =
          playOptions.bmsonTotalMode === 'spec' && total?.value === 0 && total.unit === 'percent';
        const keepsRecord = !practicing && !recoveryDisabled && this.records.activePlayRecordKey !== undefined;
        const sends = !practicing && !autoPlay && replay === undefined;
        const progress = keepsRecord || sends ? view?.progress() : undefined;
        const aborted =
          progress !== undefined && !progress.practice && progress.secondPlayer === undefined
            ? abortedRecordPlayFromResult(progress)
            : undefined;
        if (aborted !== undefined) {
          if (keepsRecord) this.records.recordActivePlay(aborted);
          if (sends) {
            void view?.waitForReplay().then((abortedReplay) => this.leaderboard.maybeSubmit(abortedReplay, chartEntry));
          }
        }
        void this.showSelect();
      },
      onChartFinished: (result: PlayResult) => {
        if (practicing) {
          // beatoraja returns a finished PRACTICE play to its practice setup, where START plays the range again.
          void this.playChart(chartEntry, playAgainOverrides({ autoPlay, replay }));
          return;
        }
        if (replay === undefined && courseStage === undefined && nonstop === undefined)
          this.playOptions.rememberArrangement?.(chartEntry.id, result.replay);
        if (nonstop !== undefined) {
          const resolved = this.gameplayView?.resolved;
          void this.nonstopRoute.showNonstopCourseResult(nonstop, result.replay, result, resolved);
          return;
        }
        // A course stage with stage results skipped (or an auto-played one the course goes on after, as LR2 skips it)
        // goes straight on to the next stage (or the course result). So does the stage a course replay's run gave up,
        // as the run did.
        if (
          courseStage !== undefined &&
          this.activeCourse !== undefined &&
          (courseReplayStageGivenUp(this.activeCourse) ||
            skipsCourseStageResult({
              skipStageResults: this.guiState.courseAutoAdvance,
              autoPlay,
              courseGoesOn: courseGoesOnAfter(this.activeCourse, result),
            }))
        ) {
          void (async () => {
            this.testHook?.recordReplay(result.replay);
            if (this.activeCourse !== undefined) recordCourseStage(this.activeCourse, result);
            if (
              !result.practice &&
              (result.replay === undefined ||
                !isBmsonRecoveryDisabled(result.replay.chart, result.replay.play.bmsonTotalMode))
            )
              this.records.recordActiveCourseStage(courseStageRecordPlayFromResult(result));
            // No screen comes between the stages: the play leaves the stage, its last samples ringing out, and the next
            // stage (or the course result) shows.
            if (!(await this.router.leave({ playDispose: disposeKeepingAudioTail, continuesRun: true }))) return;
            this.unlockReplayOptions();
            this.courseRoute.continueCourse();
          })();
          return;
        }
        if (kit.family === 'beatoraja') {
          // The beatoraja result plots the chart as the play played it.
          const resolved = this.gameplayView?.resolved;
          if (resolved !== undefined) this.results.lastBeatorajaChart = { resolved, chartPath: chartEntry.chartPath };
          void this.results.showBeatorajaPlayResult(result, courseStage !== undefined);
          return;
        }
        void this.results.showResult(result);
      },
      onRestart: () => {
        // A NONSTOP course allows quick retry, as LR2 does (OpenLR2 L2854); in a course stage F5 gives the course up.
        const restart = resolveGameplayRestart({
          courseStage: courseStage !== undefined,
          nonstop: nonstop !== undefined,
        });
        if (restart === 'restitch') {
          // A NONSTOP replay plays its recorded run again.
          void this.nonstopRoute.startNonstopCourse(
            nonstop!.course,
            nonstop!.replay !== undefined ? { replay: nonstop!.replay } : {},
          );
          return;
        }
        if (restart === 'abandon-course') {
          this.courses.abandonRun();
          void this.showSelect();
          return;
        }
        // A single chart plays again as it was played: AUTO stays AUTO, a replay stays a replay (`playAgainOverrides`).
        void this.playChart(chartEntry, playAgainOverrides({ autoPlay, replay }));
      },
    };
    const { onExit, onChartFinished, onRestart, onHiSpeedChange, onTempoChange } = callbacks;
    const source = resolveChartSource(this.library.collection, chartEntry);
    const view = createPlayScene(kit, {
      chart: chartEntry,
      allowSeek: 'practice',
      ...(source !== undefined ? { source } : {}),
      settings:
        kit.family === 'built-in'
          ? { ...settings, layoutMode: resolvePlayLayoutMode(this.guiState.playLayout, this.deviceProfile) }
          : settings,
      ...(course !== undefined
        ? { course: { ...course, ...(this.activeCourse?.run.practice === true ? { practice: true } : {}) } }
        : {}),
      ...(replay !== undefined ? { replay } : {}),
      ...(overrides.preResolved !== undefined ? { preResolved: overrides.preResolved } : {}),
      audio: this.audio,
      sounds: this.familyKits.selectSoundSet(kit.family),
      host: this.sceneHost,
      playOptions,
      scoreTargets: { bestEXScore: this.records.lookupChartBestRecord(chartEntry)?.exScore ?? 0 },
      on: {
        exit: onExit,
        finish: (result) => onChartFinished(result),
        restart: onRestart,
        hiSpeed: onHiSpeedChange,
        judgeTiming: (value) => {
          this.guiState.judgeTimingMs = value;
          this.debugMenu.refreshJudgeTiming?.();
          this.setPlayOptions({ judgeTimingMs: value });
          this.debugMenu.scheduleSettingsSave?.();
        },
        tempo: onTempoChange,
      },
    });
    this.latches.set(view, latches);
    return view;
  }

  /**
   * The play `view` takes the stage (with no decide screen it loads there; after one it starts at once): what it was
   * made with goes into force — its start, which R on its result plays again and the test hook reports, the record
   * keys its result is kept under, and its beatoraja play entry. A play that never takes the stage, like one loading
   * behind a decide screen that is backed out of, leaves them as they were. Once per play.
   */
  /**
   * Draws `view` with the family the Debug Menu just picked, for the chart it is already playing. The play is not
   * started again. Nothing happens when `view` is not the play in flight.
   */
  public async switchPlayFamily(view: PlayScene): Promise<void> {
    const drawing = this.liveDrawing;
    if (drawing === undefined || this.router.play !== view || view.disposed) return;
    const resolved = await this.familyKits.resolvePlayKit(drawing.chart, {
      ...(drawing.preResolved ? { preResolved: drawing.preResolved } : {}),
      ...(drawing.replay ? { replay: drawing.replay } : {}),
      ...(drawing.courseStage !== undefined ? { courseStage: drawing.courseStage } : {}),
      ...(drawing.nonstop !== undefined ? { nonstop: { course: drawing.nonstop.course } } : {}),
    });
    if (resolved === undefined || this.router.play !== view || view.disposed) return;
    await view.replaceFamily(resolved.kit);
    if (view.disposed) return;
    this.beatoraja.activeBeatorajaPlay = resolved.beatorajaPlay;
  }

  public latchPlay(view: PlayScene): void {
    const latches = this.latches.get(view);
    if (latches === undefined) return;
    this.latches.delete(view);
    this.lastPlay = latches.lastPlay;
    this.records.activePlayRecordKey = latches.playRecordKey;
    this.records.activeStageRecordKey = latches.stageRecordKey;
    this.beatoraja.activeBeatorajaPlay = latches.beatorajaPlay;
  }

  public async playChart(
    chartEntry: LibraryChart,
    overrides: {
      autoPlay?: boolean;
      replay?: BeMusicReplay;
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
    this.selectRoute.lastSelectNavigation = this.selectView?.snapshot();
    // The select screen goes off the stage (kept) while the play is made. A decide splash goes before the play shows —
    // a live one would keep taking its keys and clicks — and so does a play being restarted (F5).
    if (!(await this.router.leave({ token }))) return;
    // Refresh the recording filename base for the upcoming play — each session writes to a unique file in the user's
    // downloads folder rather than overwriting the previous one.
    this.setRecordingFilenameBase(sanitizeFilenameStem(chartEntry.title) || `gameplay-${Date.now()}`);
    // The kit for the gameplay family the Debug Menu's "Skin family" pick (or the auto chain, beatoraja → LR2 →
    // default) gives the chart, a replay and a NONSTOP run included (`playsOnBeatoraja`). `preloadGameplay` asks the
    // same.
    if (this.playOptions.current.battleMode === 'AUTO' && !overrides.replay && !overrides.preResolved)
      overrides = { ...overrides, preResolved: resolvePlayChart(chartEntry.chart) };
    const kit = await this.familyKits.resolvePlayKit(chartEntry, overrides);
    if (kit === undefined) {
      void this.showSelect();
      return;
    }
    // Chart-file hash for the recorded replay (skipped for replays — they record nothing — and for a stitched
    // NONSTOP chart, which has no file).
    const chartHashes =
      overrides.replay === undefined && overrides.nonstop === undefined
        ? await this.records.resolveChartHashes(chartEntry)
        : undefined;
    const view = this.buildPlayScene(chartEntry, kit, { ...overrides, chartHashes });
    // A replay plays at its recorded tempo, unless the Replay / ghost options keep the viewer's own.
    const tempoPercent =
      overrides.replay !== undefined
        ? tempoPercentFromTempo(view.getTempo())
        : this.guiState.tempoEnabled
          ? this.guiState.tempoPercent
          : 0;
    this.setPlayStatus(
      describePlayingStatus(chartEntry.title, {
        ...playingFamily(view),
        tempoPercent,
        replay: overrides.replay !== undefined,
      }),
    );
    this.lockReplayOptionsForPlay(
      allowsLiveTempo(this.guiState, { replay: overrides.replay !== undefined, tempo: view.getTempo() }),
    );
    // No splash covers the load window here: the play shows first, so `prepare` draws the playfield in its loading
    // state while the chart's audio decodes, then the play starts.
    if (!(await this.router.show(view, { role: 'play', token }))) return;
    this.latchPlay(view);
    try {
      if (!(await this.router.prepare(view, { token }))) return;
    } catch (error) {
      if (!(error instanceof PlayOptionMismatchError)) throw error;
      // The chart cannot be played with the selected options: say which, and go back to select to change them.
      if (overrides.courseStage !== undefined || overrides.nonstop !== undefined) this.courses.abandonRun();
      this.setPlayStatus(`Cannot play ${chartEntry.title} with ${error.options.join(', ')}`);
      this.showPlayOptionMismatch(error.options, () => {
        if (this.router.isCurrent(token)) void this.showSelect();
      });
      return;
    }
    view.start();
    // Consume the "user pressed Record on the select screen" flag now that gameplay is prepared — `startRecording`
    // requires the gameplay AudioContext to exist, which only happens after `prepare`. Failing here is non-fatal: the
    // select-screen click already nudged the user that capture would start; if it doesn't (codec missing / no
    // MediaRecorder), the surfaced error replaces the armed status without breaking gameplay.
    startArmedRecording(this.recordingDeps());
  }

  /**
   * Follows a tempo change during the play: the status line shows the new tempo, and a play that ran at another tempo
   * at any point is practice, so it leaves the records alone (the Leaderboard refuses its log as `tempo`).
   */
  private followLiveTempo(tempo: number): void {
    const title = this.lastPlay?.chart.title;
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

  /**
   * Takes a new hi-speed from one surface — the Debug Menu slider, the LR2 select panel, or the running play's keys —
   * remembers it for the next play and mirrors it onto the others: the slider, the select panel, and (for a menu
   * change) the running play.
   */
  public rememberHiSpeed(value: number, source: 'menu' | 'select' | 'play'): void {
    const hiSpeed = this.playOptions.current.floatingHiSpeed
      ? clampFloatingHiSpeed(value)
      : this.playOptions.current.classicHiSpeed || this.playOptions.current.normalHiSpeedLevel > 0
        ? Number.isFinite(value) && value > 0
          ? value
          : undefined
        : snapHiSpeed(value);
    if (hiSpeed === undefined) return;
    this.guiState.hiSpeed = hiSpeed;
    storeHiSpeed(hiSpeed);
    this.debugMenu.scheduleSettingsSave?.();
    if (source !== 'menu') this.debugMenu.refreshHiSpeed();
    if (source !== 'select') this.setPlayOptions({ hiSpeed });
    if (source === 'menu') {
      this.gameplayView?.setHiSpeed(hiSpeed);
    }
  }
}
