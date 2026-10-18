// The play route: the play screen (`createPlayScene`), whichever family draws it. A chart plays at once (no decide
// screen, a retry, F5, a course stage, a NONSTOP run or a replay): the select screen goes off the stage, kept, the play
// takes it and loads there, then starts. The decide route (`decide.ts`) has the play made here and loads it behind its
// screen. Every play is made with the play options in force, and leads to its result (`result.ts`), to the next stage
// of a course, or back to the select screen.

import type { ResolvedPlayChart } from '@be-music/player';
import type { AudioService } from '@be-music/player-web/audio';
import { resolveSongSource, type ChartFileHashes } from '@be-music/player-web/collection';
import {
  createPlayScene,
  type PixiSceneHost,
  type PlayScene,
  type PlaySceneKit,
  type SelectScene,
} from '@be-music/player-web/host';
import type { BeMusicPlaylog, PlaylogRecorderInfo } from '@be-music/player/playlog';
import { courseStageRecordPlayFromResult } from '@be-music/player/records';
import { snapHiSpeed, type LibraryChart, type PlayOptions, type PlayResult } from '@be-music/scene-model';
import {
  playAgainOverrides,
  resolveGameplayExit,
  resolveGameplayRestart,
  type ActiveCourse,
  type CourseStagePlay,
} from '../../course-flow.ts';
import { skipsCourseStageResult } from '../../course-result.ts';
import { sanitizeFilenameStem } from '../../demo-utils.ts';
import { resolvePlayLayoutMode, type DeviceProfile } from '../../device-profile.ts';
import { storeHiSpeed } from '../../hi-speed-storage.ts';
import { allowsLiveTempo, describePlayingStatus, tempoPercentFromTempo } from '../../play-tempo-settings.ts';
import { startArmedRecording, type RecordingDeps } from '../../recording-controller.ts';
import type { CourseRunService } from '../../services/courses.ts';
import type { LibraryService } from '../../services/library.ts';
import type { PlayOptionsService } from '../../services/play-options.ts';
import type { RecordsService } from '../../services/records.ts';
import { courseStageRecordKey, playRecordKey } from '../../song-records.ts';
import type { TestHookRecorder } from '../../test-hook.ts';
import type { DemoGuiState, DemoScene, PlayerWebDemoElements } from '../../types.ts';
import type { DebugMenu } from '../../ui/debug-menu/index.ts';
import type { FamilyKits } from '../family-kits.ts';
import { resolvePlaySceneOptions, type PlaySceneGuiState } from '../play-scene-options.ts';
import type { SceneRouter } from '../scene-router.ts';
import type { CourseRoute } from './course.ts';
import { playingFamily } from './decide.ts';
import type { NonstopPlay, NonstopRoute } from './nonstop.ts';
import { disposeKeepingAudioTail, type ResultRoute } from './result.ts';
import type { SelectRoute } from './select.ts';

/** The chart and play mode of a play start: what R on its result plays again. */
export interface LastPlay {
  song: LibraryChart;
  overrides: { autoPlay: boolean; replay?: BeMusicPlaylog };
}

export interface PlayRouteDeps {
  /** The scene router: the select scene it keeps, the play it holds, and the navigation a play shows in. */
  readonly router: Pick<
    SceneRouter<DemoScene, PlayScene, SelectScene>,
    'select' | 'play' | 'begin' | 'leave' | 'show' | 'prepare'
  >;
  /** The select route: where its screen was, for its next showing to come back to. */
  readonly selectRoute: Pick<SelectRoute, 'lastSelectNavigation'>;
  /** The page: the shell's `playing` class. */
  readonly elements: Pick<PlayerWebDemoElements, 'shell'>;
  /** The library: the chart's asset source. */
  readonly library: Pick<LibraryService, 'collection'>;
  /** The chart hashes the play's log records, and the record keys of the play in flight. */
  readonly records: Pick<
    RecordsService,
    'resolveChartHashes' | 'activePlayRecordKey' | 'activeStageRecordKey' | 'recordActiveCourseStage'
  >;
  /** The kit the play is drawn with. */
  readonly familyKits: Pick<FamilyKits, 'resolvePlayKit'>;
  /** The course run in progress: a stage's lane limits, and giving the course up. */
  readonly courses: Pick<CourseRunService, 'active' | 'giveUp' | 'abandonRun'>;
  /** A course's next stage, and its course result. */
  readonly courseRoute: Pick<CourseRoute, 'continueCourse' | 'showCourseResult'>;
  /** A NONSTOP run's result, and its restitch on F5. */
  readonly nonstopRoute: Pick<NonstopRoute, 'showNonstopCourseResult' | 'startNonstopCourse'>;
  /** The play's result, and the beatoraja chart its graphs plot. */
  readonly results: Pick<ResultRoute, 'lastBeatorajaChart' | 'showResult' | 'showBeatorajaPlayResult'>;
  /** The play options in force: the covers, HS-FIX, BGA and score graph the play is made with. */
  readonly playOptions: Pick<PlayOptionsService, 'current'>;
  /** The Debug Menu's state: the lane, gauge, tempo, audio and debug options the play is made with. */
  readonly guiState: PlaySceneGuiState & Pick<DemoGuiState, 'courseAutoAdvance' | 'playLayout'>;
  /** The Debug Menu: the compressor's tuned parameters, and the hi-speed slider. */
  readonly debugMenu: DebugMenu;
  /** The compressor architecture every play mounts with (`?compressor=`). */
  readonly compressorMode: 'split' | 'legacy';
  /** The device: the built-in play's layout follows it. */
  readonly deviceProfile: DeviceProfile;
  readonly audio: AudioService;
  /** The host the play shows on: it builds its layers as it loads. */
  readonly sceneHost: PixiSceneHost;
  /** This app as the recorder of its play logs. */
  readonly playlogRecorder: Omit<PlaylogRecorderInfo, 'engine'>;
  /** `window.__beMusicTest`, when installed: the play log of a stage that shows no result. */
  readonly testHook: Pick<TestHookRecorder, 'recordPlaylog'> | undefined;
  /** The video recording's deps: a recording armed on the select screen starts with the play. */
  readonly recordingDeps: () => RecordingDeps;
  /** Names the next saved recording after the chart. */
  readonly setRecordingFilenameBase: (base: string) => void;
  /** Shows a status about the play, which the select screen replaces when it comes back. */
  readonly setPlayStatus: (text: string) => void;
  /** Latches the options a play takes for it, and disables their controls. */
  readonly lockPlaylogOptionsForPlay: (liveTempo?: boolean) => void;
  /** Re-enables the options a play latched. */
  readonly unlockPlaylogOptions: () => void;
  readonly showSelect: () => Promise<void>;
  /** Keeps a play option for every screen and play, and pushes it to the select screen. */
  readonly setPlayOptions: (changes: Partial<PlayOptions>) => void;
}

/** A play, from its start to where it leads. */
export class PlayRoute {
  /**
   * The chart and play mode of the most recent play start (LR2 / default and beatoraja alike), so the result screen's
   * R key can start the same chart again. `autoPlay` is resolved at play start so a retry keeps the mode the play ran
   * in even when the toggle changes on the result screen; the remaining play options are read from the GUI state as
   * on any play start.
   */
  public lastPlay: LastPlay | undefined;
  private readonly router: PlayRouteDeps['router'];
  private readonly selectRoute: PlayRouteDeps['selectRoute'];
  private readonly elements: PlayRouteDeps['elements'];
  private readonly library: PlayRouteDeps['library'];
  private readonly records: PlayRouteDeps['records'];
  private readonly familyKits: PlayRouteDeps['familyKits'];
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
  private readonly playlogRecorder: PlayRouteDeps['playlogRecorder'];
  private readonly testHook: PlayRouteDeps['testHook'];
  private readonly recordingDeps: PlayRouteDeps['recordingDeps'];
  private readonly setRecordingFilenameBase: PlayRouteDeps['setRecordingFilenameBase'];
  private readonly setPlayStatus: PlayRouteDeps['setPlayStatus'];
  private readonly lockPlaylogOptionsForPlay: PlayRouteDeps['lockPlaylogOptionsForPlay'];
  private readonly unlockPlaylogOptions: PlayRouteDeps['unlockPlaylogOptions'];
  private readonly showSelect: PlayRouteDeps['showSelect'];
  private readonly setPlayOptions: PlayRouteDeps['setPlayOptions'];

  public constructor(deps: PlayRouteDeps) {
    this.router = deps.router;
    this.selectRoute = deps.selectRoute;
    this.elements = deps.elements;
    this.library = deps.library;
    this.records = deps.records;
    this.familyKits = deps.familyKits;
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
    this.playlogRecorder = deps.playlogRecorder;
    this.testHook = deps.testHook;
    this.recordingDeps = deps.recordingDeps;
    this.setRecordingFilenameBase = deps.setRecordingFilenameBase;
    this.setPlayStatus = deps.setPlayStatus;
    this.lockPlaylogOptionsForPlay = deps.lockPlaylogOptionsForPlay;
    this.unlockPlaylogOptions = deps.unlockPlaylogOptions;
    this.showSelect = deps.showSelect;
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
   * snapshot (`createPlayScene`). Every family shares every other option, so `preloadGameplay` and `playSong` marshal
   * them in one place.
   */
  public buildPlayScene(
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
    // The Debug Menu's picks and the play options in force, with a course's lane limits, a replay's recorded setup and
    // the tempo chosen (`play-scene-options.ts`).
    const { autoPlay, tempo, settings, course } = resolvePlaySceneOptions({
      guiState: this.guiState,
      playOptions,
      autoPlay: overrides.autoPlay,
      replay,
      chartHashes: overrides.chartHashes,
      courseStage,
      activeCourse: this.activeCourse,
      nonstop,
      audioCompressorParams: this.debugMenu.resolveCompressorParamOverrides(),
      audioCompressorMode: this.compressorMode,
      playlogRecorder: this.playlogRecorder,
    });
    this.lastPlay = { song, overrides: { autoPlay, ...(replay !== undefined ? { replay } : {}) } };
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
    const callbacks = {
      // In-play hi-speed changes come back to be remembered for the next play.
      onHiSpeedChange: (hiSpeed: number) => this.rememberHiSpeed(hiSpeed, 'play'),
      // A tempo change during the play (the tempo slider in pitch mode, or a replay following its log).
      onTempoChange: (changed: number) => this.followLiveTempo(changed),
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
            this.courses.giveUp(active!, playlog);
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
              await view?.waitForPlaylog(),
              undefined,
              resolved,
            );
          })();
          return;
        }
        void this.showSelect();
      },
      onChartFinished: (result: PlayResult) => {
        if (nonstop !== undefined) {
          const resolved = this.gameplayView?.resolved;
          void this.nonstopRoute.showNonstopCourseResult(nonstop, result.playlog, result, resolved);
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
            this.courseRoute.continueCourse();
          })();
          return;
        }
        if (kit.family === 'beatoraja') {
          // The beatoraja result plots the chart as the play played it.
          const resolved = this.gameplayView?.resolved;
          if (resolved !== undefined) this.results.lastBeatorajaChart = { resolved, chartPath: song.chartPath };
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
          void this.nonstopRoute.startNonstopCourse(nonstop!.course);
          return;
        }
        if (restart === 'abandon-course') {
          this.courses.abandonRun();
          void this.showSelect();
          return;
        }
        // A single chart plays again as it was played: AUTO stays AUTO, a replay stays a replay (`playAgainOverrides`).
        void this.playSong(song, playAgainOverrides({ autoPlay, replay }));
      },
    };
    const { onExit, onChartFinished, onRestart, onHiSpeedChange, onTempoChange } = callbacks;
    const source = resolveSongSource(this.library.collection, song);
    return createPlayScene(kit, {
      chart: song,
      ...(source !== undefined ? { source } : {}),
      settings:
        kit.family === 'built-in'
          ? { ...settings, layoutMode: resolvePlayLayoutMode(this.guiState.playLayout, this.deviceProfile) }
          : settings,
      ...(course !== undefined ? { course } : {}),
      ...(replay !== undefined ? { replay } : {}),
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

  public async playSong(
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
    this.selectRoute.lastSelectNavigation = this.selectView?.snapshot();
    // The select screen goes off the stage (kept) while the play is made. A decide splash goes before the play shows —
    // a live one would keep taking its keys and clicks — and so does a play being restarted (F5).
    if (!(await this.router.leave({ token }))) return;
    // Refresh the recording filename base for the upcoming play — each session writes to a unique file in the user's
    // downloads folder rather than overwriting the previous one.
    this.setRecordingFilenameBase(sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`);
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

  /**
   * Takes a new hi-speed from one surface — the Debug Menu slider, the LR2 select panel, or the running play's keys —
   * remembers it for the next play and mirrors it onto the others: the slider, the select panel, and (for a menu
   * change) the running play.
   */
  public rememberHiSpeed(value: number, source: 'menu' | 'select' | 'play'): void {
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
}
