// The result route: the result screen (`createResultScene`) of a play, a course stage, a course run or a NONSTOP run,
// on the LR2 theme's result (or course-result) skin, the be-music skin's, or the beatoraja theme's. The play behind it
// exits as it enters and goes once it shows, its last samples ringing out. It keeps the play's record, saves its play
// log and ranks it, and leads on: the next stage of a course, R's retry, or back to the select screen.

import type { ResolvedPlayChart } from '@be-music/player-engine';
import type { AudioService } from '@be-music/player-browser/audio';
import { resolveChartSource } from '@be-music/player-browser/collection';
import {
  createResultScene,
  type PlayScene,
  type ResultSceneKit,
  type SelectScene,
} from '@be-music/player-browser/host';
import type { BeMusicCourseReplay, BeMusicReplay, ReplayCourseResult } from '@be-music/player-engine/replay';
import { courseStageRecordPlayFromResult, recordPlayFromResult } from '@be-music/player-engine/records';
import {
  resolveResultJingle,
  resolveResultJingles,
  systemSoundSetFromBeatoraja,
  type CourseView,
  type LibraryChart,
  type PlayResult,
  type PlayRunKind,
} from '@be-music/player-scene-model';
import { activeCourseInfo, resolveResultRetry, type ActiveCourse } from '../../course-flow.ts';
import { resolveResultPresentation } from '../../course-result.ts';
import { pickActiveFamilyForScene } from '../../family-dispatch.ts';
import type { LeaderboardPanel } from '../../leaderboard-ui.ts';
import { resolveResultSoundSet, resolveResultViewJingles } from '../../result-jingles.ts';
import type { CourseRunService } from '../../services/courses.ts';
import type { LibraryService } from '../../services/library.ts';
import type { ReplayAutoSave } from '../../services/replays.ts';
import type { RecordsService } from '../../services/records.ts';
import type { BeatorajaThemeService } from '../../services/themes/beatoraja.ts';
import type { BuiltInThemeService } from '../../services/themes/built-in.ts';
import type { LR2ThemeService } from '../../services/themes/lr2.ts';
import { resultFromCourseLog, resultFromData, type TestHookRecorder } from '../../test-hook.ts';
import type { DemoScene } from '../../types.ts';
import type { FamilyKits } from '../family-kits.ts';
import type { PlayDispose, SceneRouter } from '../scene-router.ts';
import type { CourseRoute } from './course.ts';
import type { LastPlay } from './play.ts';

/** Ends a play whose result shows: it exited as the result entered, and its last samples ring out. */
export const disposeKeepingAudioTail: PlayDispose<PlayScene> = (play) => play.dispose({ preserveAudioTail: true });

export interface ResultRouteDeps {
  /** The scene router: the result takes the stage from the play, and leaves it before the next stage or a retry. */
  readonly router: Pick<SceneRouter<DemoScene, PlayScene, SelectScene>, 'show' | 'leave'>;
  /** The library: the chart's asset source. */
  readonly library: Pick<LibraryService, 'collection'>;
  /** The best records the play, or the course stage, is kept in. */
  readonly records: Pick<RecordsService, 'recordActivePlay' | 'recordActiveCourseStage'>;
  /** The course run in progress: a stage's result records the stage on it. */
  readonly courses: Pick<CourseRunService, 'active'>;
  /** Plays a course's next stage, or shows its course result, once a stage's result is dismissed. */
  readonly courseRoute: Pick<CourseRoute, 'continueCourse'>;
  /** The family the result is drawn by. */
  readonly familyKits: Pick<FamilyKits, 'familyDispatchState'>;
  /** The LR2 theme's result and course-result skins, and its jingles. */
  readonly lr2: Pick<LR2ThemeService, 'resultSkin' | 'courseResultSkin' | 'courseLR2Skin' | 'resultJingles'>;
  /** The beatoraja theme's result entries, loaded as kits, and its jingles. */
  readonly beatoraja: Pick<BeatorajaThemeService, 'loadBeatorajaResultKit' | 'beatorajaThemeBGM'>;
  /** The be-music skin the built-in family draws with. */
  readonly builtIn: Pick<BuiltInThemeService, 'builtInKit'>;
  /** A single play's replay auto-save, by the setting latched at the play's start. */
  readonly replayAutoSave: Pick<ReplayAutoSave, 'savePlay'>;
  /** Ranks a single play. */
  readonly leaderboard: Pick<LeaderboardPanel, 'maybeSubmit'>;
  readonly audio: AudioService;
  /** `window.__beMusicTest`, when installed: every result screen shown, and the replay it shows. */
  readonly testHook: Pick<TestHookRecorder, 'recordReplay' | 'recordResult'> | undefined;
  /** The play last started: the chart R plays again. */
  readonly lastPlay: () => LastPlay | undefined;
  /** Which theme slot a result jingle came from, for the test hook. */
  readonly nameResultJingle: (bytes: Uint8Array | undefined) => string | undefined;
  /** Shows a status about the result, which the select screen replaces when it comes back. */
  readonly setPlayStatus: (text: string) => void;
  readonly showSelect: () => Promise<void>;
  /** Plays a chart again (R on the result). */
  readonly playChart: (
    chartEntry: LibraryChart,
    overrides: { autoPlay: boolean; replay?: BeMusicReplay },
  ) => Promise<void>;
  /** Re-enables the options a play latched, once its result shows. */
  readonly unlockReplayOptions: () => void;
}

/** A play's, a course's or a NONSTOP run's result screen, and where it leads. */
export class ResultRoute {
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
  public lastBeatorajaChart: { resolved: ResolvedPlayChart; chartPath: string } | undefined;
  private readonly router: ResultRouteDeps['router'];
  private readonly library: ResultRouteDeps['library'];
  private readonly records: ResultRouteDeps['records'];
  private readonly courses: ResultRouteDeps['courses'];
  private readonly courseRoute: ResultRouteDeps['courseRoute'];
  private readonly familyKits: ResultRouteDeps['familyKits'];
  private readonly lr2: ResultRouteDeps['lr2'];
  private readonly beatoraja: ResultRouteDeps['beatoraja'];
  private readonly builtIn: ResultRouteDeps['builtIn'];
  private readonly replayAutoSave: ResultRouteDeps['replayAutoSave'];
  private readonly leaderboard: ResultRouteDeps['leaderboard'];
  private readonly audio: ResultRouteDeps['audio'];
  private readonly testHook: ResultRouteDeps['testHook'];
  private readonly lastPlay: ResultRouteDeps['lastPlay'];
  private readonly nameResultJingle: ResultRouteDeps['nameResultJingle'];
  private readonly setPlayStatus: ResultRouteDeps['setPlayStatus'];
  private readonly showSelect: ResultRouteDeps['showSelect'];
  private readonly playChart: ResultRouteDeps['playChart'];
  private readonly unlockReplayOptions: ResultRouteDeps['unlockReplayOptions'];

  public constructor(deps: ResultRouteDeps) {
    this.router = deps.router;
    this.library = deps.library;
    this.records = deps.records;
    this.courses = deps.courses;
    this.courseRoute = deps.courseRoute;
    this.familyKits = deps.familyKits;
    this.lr2 = deps.lr2;
    this.beatoraja = deps.beatoraja;
    this.builtIn = deps.builtIn;
    this.replayAutoSave = deps.replayAutoSave;
    this.leaderboard = deps.leaderboard;
    this.audio = deps.audio;
    this.testHook = deps.testHook;
    this.lastPlay = deps.lastPlay;
    this.nameResultJingle = deps.nameResultJingle;
    this.setPlayStatus = deps.setPlayStatus;
    this.showSelect = deps.showSelect;
    this.playChart = deps.playChart;
    this.unlockReplayOptions = deps.unlockReplayOptions;
  }

  /** The EXPERT / GRADE course being played, between its stages (the course run service's). */
  private get activeCourse(): ActiveCourse | undefined {
    return this.courses.active;
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

  /**
   * The result of a play on the beatoraja play screen, on the theme's result skin: a course stage is recorded on the run
   * (its result shown unless the theme has no result skin, when the course goes straight on), a single play keeps its
   * record, saves its replay and goes to the Leaderboard. Without a result skin a single play goes back to select.
   */
  public async showBeatorajaPlayResult(data: PlayResult, courseStage: boolean): Promise<void> {
    this.testHook?.recordReplay(data.replay);
    const active = this.activeCourse;
    if (courseStage && active !== undefined) {
      active.run.recordStage(data.replay, data);
      if (!data.practice) this.records.recordActiveCourseStage(courseStageRecordPlayFromResult(data));
      const mounted = await this.showBeatorajaResult(data, {
        run: 'stage',
        course: { info: activeCourseInfo(active) },
      });
      if (!mounted) this.courseRoute.continueCourse();
      this.unlockReplayOptions();
      return;
    }
    if (!data.practice) this.records.recordActivePlay(recordPlayFromResult(data));
    const mounted = await this.showBeatorajaResult(data, { run: 'single' });
    if (!mounted) await this.showSelect();
    // Auto-save fires even when the theme ships no result skin, so going back to select costs no replay file.
    if (!data.practice) {
      this.replayAutoSave.savePlay(data.replay);
      this.leaderboard.maybeSubmit(data.replay, data.chart);
    }
    this.unlockReplayOptions();
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
  public async showBeatorajaResult(
    data: PlayResult,
    options: {
      run: PlayRunKind;
      course?: { info: CourseView; result?: { log: BeMusicCourseReplay; native: ReplayCourseResult } };
      nonstopRetry?: () => void;
      playChart?: ResolvedPlayChart['chart'];
    },
  ): Promise<boolean> {
    const chartEntry = data.chart;
    const course = options.course;
    // The course result (`course.result`) shows on the theme's COURSE_RESULT skin, falling back to its result skin.
    const courseResult = course?.result !== undefined;
    const kit = await this.beatoraja.loadBeatorajaResultKit(chartEntry, courseResult);
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
      (!courseResult && this.lastBeatorajaChart?.chartPath === chartEntry.chartPath
        ? this.lastBeatorajaChart.resolved.chart
        : undefined);
    // R on the result plays the same chart again — only offered when the recorded play start is this chart's, and
    // never in a course (beatoraja disables quick retry there); a NONSTOP run is stitched and played again.
    const lastPlay = this.lastPlay();
    const retryTarget = resolveResultRetry({
      quickRetry: presentation.quickRetry,
      ...(options.nonstopRetry !== undefined ? { nonstopRetry: options.nonstopRetry } : {}),
      chartId: chartEntry.id,
      ...(lastPlay !== undefined ? { lastPlay: { chartId: lastPlay.chart.id, play: lastPlay } } : {}),
    });
    // beatoraja plays every result from its theme's one set: a course run's `course_clear` / `course_fail`, falling back
    // to the clear / fail ones, else the generic `result` one.
    const sounds = systemSoundSetFromBeatoraja({ bgm: this.beatoraja.beatorajaThemeBGM });
    const jingleBytes = resolveResultJingle(
      resolveResultJingles([sounds], presentation.courseJingles),
      result.cleared,
    )?.bytes;
    const onContinue = (): void => {
      // The next stage does not show at once, and a live result screen would keep taking its keys meanwhile: it goes
      // first.
      void this.leaveThen(() => {
        if (!courseResult && this.courseRoute.continueCourse()) return;
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
              else void this.playChart(retryTarget.play.chart, retryTarget.play.overrides);
            });
          };
    const resultScene = createResultScene(kit, {
      result,
      run,
      source: resolveChartSource(this.library.collection, chartEntry),
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
      `Result (beatoraja): ${courseResult ? course!.info.title : chartEntry.title} · ex=${result.score.exScore} maxCombo=${result.maxCombo}`,
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
   * Mounts the result scene for a play, or — with `mode.course` — for a whole course (the course result, shown on the
   * LR2 theme's course-result skin when it has one).
   */
  public async showResult(
    data: PlayResult,
    mode: {
      course?: CourseView;
      /** The course result's replay and native result (what the test hook reports of it). */
      courseLog?: { log: BeMusicCourseReplay; native: ReplayCourseResult };
      nonstop?: { info: CourseView; retry: () => void };
    } = {},
  ): Promise<void> {
    // A stage of a running course: its replay carries the course on, and dismissing its result plays the next stage.
    const courseStage = mode.course === undefined && mode.nonstop === undefined && this.activeCourse !== undefined;
    const run =
      mode.course !== undefined ? 'course' : mode.nonstop !== undefined ? 'nonstop' : courseStage ? 'stage' : 'single';
    const presentation = resolveResultPresentation(run);
    if (courseStage) {
      this.activeCourse!.run.recordStage(data.replay, data);
      if (!data.practice) this.records.recordActiveCourseStage(courseStageRecordPlayFromResult(data));
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
          : this.lr2.courseLR2Skin(mountedResultSkin, courseInfo, {
              kind:
                presentation.courseResultSkin && this.lr2.courseResultSkin !== undefined ? 'courseResult' : 'result',
            });
    // R on the result plays the same chart again — only offered when the recorded play start is this chart's, and
    // never in a course (LR2 and beatoraja disable quick retry there), except that a NONSTOP run is stitched and played
    // again, as LR2 allows.
    const lastPlay = this.lastPlay();
    const retryTarget = resolveResultRetry({
      quickRetry: presentation.quickRetry,
      ...(mode.nonstop !== undefined ? { nonstopRetry: mode.nonstop.retry } : {}),
      chartId: data.chart.id,
      ...(lastPlay !== undefined ? { lastPlay: { chartId: lastPlay.chart.id, play: lastPlay } } : {}),
    });
    const retry =
      retryTarget?.kind === 'nonstop'
        ? retryTarget.retry
        : retryTarget?.kind === 'replay'
          ? () => void this.playChart(retryTarget.play.chart, retryTarget.play.overrides)
          : undefined;
    // The active theme's jingles: a beatoraja theme's when its result falls back to this view (a NONSTOP course on a
    // theme without a result skin).
    const themeJingles = {
      lr2: this.lr2.resultJingles(),
      beatoraja: this.beatoraja.beatorajaThemeBGM,
    };
    const jingles = resolveResultViewJingles(resultFamily, presentation.courseJingles, themeJingles);
    const onContinue = (): void => {
      if (courseStage && this.activeCourse !== undefined) {
        // The next stage does not show at once, and a live result screen would keep taking its clicks and keys (Enter /
        // Space / Escape) meanwhile, starting it over: it goes first.
        void this.leaveThen(() => this.courseRoute.continueCourse());
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
      source: resolveChartSource(this.library.collection, data.chart),
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
    if (shown) this.setPlayStatus(`Result: ${data.chart.title}`);
    if (this.testHook !== undefined) {
      if (mode.course === undefined) this.testHook.recordReplay(data.replay);
      const family = lr2ResultSkin !== undefined ? 'lr2' : 'built-in';
      const jingle = this.nameResultJingle(data.cleared ? jingles.clearBGM : jingles.failBGM);
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
    if (!data.practice) this.records.recordActivePlay(recordPlayFromResult(data));
    // A course's stages are saved and ranked as the course, not one by one (a NONSTOP run's course log already was).
    if (!data.practice && presentation.quickRetry && mode.nonstop === undefined) {
      this.replayAutoSave.savePlay(data.replay);
      this.leaderboard.maybeSubmit(data.replay, data.chart);
    }
    this.unlockReplayOptions();
  }
}
