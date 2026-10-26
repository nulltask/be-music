// The course route: a course bar started on the select screen (a NEW COURSE bar starting the course maker, a random
// course drawn first, a NONSTOP course handed to `nonstop.ts`), an EXPERT / GRADE course's decide screen, each of its
// stages in turn, and its course result. The run it acts on is the course run service's (`services/courses.ts`); the
// screens are the app's.

import {
  createCourseChartRecord,
  drawBrowserRandomCourse,
  type CourseMaker,
} from '@be-music/player-browser/collection';
import type { BeMusicCourseReplay, ReplayCourseResult, ReplayRecorderInfo } from '@be-music/player-engine/replay';
import {
  resolveCourseView,
  type BrowseSnapshot,
  type CourseView,
  type LibraryChart,
  type LibraryCourse,
  type PlayResult,
} from '@be-music/player-scene-model';
import {
  courseDecideSong,
  courseStageHistories,
  describeRandomCourseDrawFailure,
  describeUnplayableCourse,
  nextCourseStagePlay,
  planCourseStart,
  resolveCourseBestRecordUpdate,
  type CourseStagePlay,
} from '../../course-flow.ts';
import { buildCourseResultData, courseBestRecordKey, joinCourseStageHistories } from '../../course-result.ts';
import { pickActiveFamilyForScene } from '../../family-dispatch.ts';
import type { LeaderboardPanel } from '../../leaderboard-ui.ts';
import type { CourseRunService } from '../../services/courses.ts';
import type { LibraryService } from '../../services/library.ts';
import type { ReplayAutoSave } from '../../services/replays.ts';
import type { RecordsService } from '../../services/records.ts';
import type { FamilyKits } from '../family-kits.ts';

/** A course run's replay and native result, as its course result screen reports them. */
export interface CourseResultLog {
  log: BeMusicCourseReplay;
  native: ReplayCourseResult;
}

export interface CourseRouteDeps {
  /** The course run in progress. */
  readonly courses: CourseRunService;
  /** The library: the charts a random course draws its stages from. */
  readonly library: Pick<LibraryService, 'collection' | 'prepareDrawnCourse'>;
  /** The chart hashes a random course's stage filters match, and the course's best record. */
  readonly records: Pick<RecordsService, 'resolveChartHashes' | 'peekChartBestRecord' | 'recordCourseResult'>;
  /** The course maker, which a NEW COURSE bar starts. */
  readonly courseMaker: { readonly maker: Pick<CourseMaker, 'start'> };
  /** The course replay's auto-save, by the setting latched at the last stage's start. */
  readonly replayAutoSave: Pick<ReplayAutoSave, 'saveCourse'>;
  /** Ranks the course run as one. */
  readonly leaderboard: Pick<LeaderboardPanel, 'maybeSubmitCourse'>;
  /** The family the course result is drawn by. */
  readonly familyKits: Pick<FamilyKits, 'familyDispatchState'>;
  /** This app as the recorder of its replays (`recorder` in the course replay). */
  readonly replayRecorder: Omit<ReplayRecorderInfo, 'engine'>;
  /** Where the select screen is: its position on the stage or off it, else the one last kept. */
  readonly selectNavigation: () => BrowseSnapshot | undefined;
  readonly setStatus: (text: string) => void;
  /** Starts a NONSTOP course (`NonstopRoute`), with its decide screen when the course bar starts it. */
  readonly startNonstopCourse: (course: LibraryCourse, options: { decide?: boolean }) => Promise<void>;
  readonly showSelect: () => Promise<void>;
  /** Shows the decide screen for `song`, which leads to `then.start` instead of playing `song`. */
  readonly showDecide: (
    chartEntry: LibraryChart,
    overrides: { autoPlay?: boolean },
    then: { start: () => Promise<void>; cancel?: () => void; shown?: () => void },
  ) => Promise<void>;
  /** Plays a course stage, with the course's AUTO when it was started with one. */
  readonly playChart: (
    chartEntry: LibraryChart,
    overrides: { courseStage: CourseStagePlay; autoPlay?: boolean },
  ) => Promise<void>;
  /** Shows the course result on the LR2 or built-in result screen. */
  readonly showResult: (data: PlayResult, mode: { course: CourseView; courseLog?: CourseResultLog }) => Promise<void>;
  /**
   * Shows the course result on the beatoraja theme's course-result (or result) skin. Resolves `false` when the theme has
   * neither or it failed to load.
   */
  readonly showBeatorajaResult: (
    data: PlayResult,
    options: { run: 'course'; course: { info: CourseView; result?: CourseResultLog } },
  ) => Promise<boolean>;
  /** Re-enables the options a play latched, once its result shows. */
  readonly unlockReplayOptions: () => void;
}

/** A course from its course bar to its course result. */
export class CourseRoute {
  private readonly courses: CourseRouteDeps['courses'];
  private readonly library: CourseRouteDeps['library'];
  private readonly records: CourseRouteDeps['records'];
  private readonly courseMaker: CourseRouteDeps['courseMaker'];
  private readonly replayAutoSave: CourseRouteDeps['replayAutoSave'];
  private readonly leaderboard: CourseRouteDeps['leaderboard'];
  private readonly familyKits: CourseRouteDeps['familyKits'];
  private readonly replayRecorder: CourseRouteDeps['replayRecorder'];
  private readonly selectNavigation: CourseRouteDeps['selectNavigation'];
  private readonly setStatus: CourseRouteDeps['setStatus'];
  private readonly startNonstopCourse: CourseRouteDeps['startNonstopCourse'];
  private readonly showSelect: CourseRouteDeps['showSelect'];
  private readonly showDecide: CourseRouteDeps['showDecide'];
  private readonly playChart: CourseRouteDeps['playChart'];
  private readonly showResult: CourseRouteDeps['showResult'];
  private readonly showBeatorajaResult: CourseRouteDeps['showBeatorajaResult'];
  private readonly unlockReplayOptions: CourseRouteDeps['unlockReplayOptions'];

  public constructor(deps: CourseRouteDeps) {
    this.courses = deps.courses;
    this.library = deps.library;
    this.records = deps.records;
    this.courseMaker = deps.courseMaker;
    this.replayAutoSave = deps.replayAutoSave;
    this.leaderboard = deps.leaderboard;
    this.familyKits = deps.familyKits;
    this.replayRecorder = deps.replayRecorder;
    this.selectNavigation = deps.selectNavigation;
    this.setStatus = deps.setStatus;
    this.startNonstopCourse = deps.startNonstopCourse;
    this.showSelect = deps.showSelect;
    this.showDecide = deps.showDecide;
    this.playChart = deps.playChart;
    this.showResult = deps.showResult;
    this.showBeatorajaResult = deps.showBeatorajaResult;
    this.unlockReplayOptions = deps.unlockReplayOptions;
  }

  /**
   * Starts a course from its first stage. A beatoraja random course first draws its stages from the library (each
   * stage filter against the songs and their chart hashes); a stage that finds no chart leaves it unstarted.
   */
  public async startCourse(entry: LibraryCourse, options: { autoPlay?: boolean } = {}): Promise<void> {
    // AUTO on a course bar plays every stage itself; PLAY follows the Debug Menu's auto play.
    this.courses.start(options.autoPlay);
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
    const navigation = this.selectNavigation();
    this.courses.leaveSelect(navigation);
    let course = entry;
    let rememberDraw: (() => void) | undefined;
    if (plan.action === 'draw') {
      const candidates = await Promise.all(
        this.library.collection.charts.map(async (chartEntry) => ({
          chart: chartEntry,
          ...(await this.records.resolveChartHashes(chartEntry)),
        })),
      );
      // The candidates are hashed by now, so each one's best record is found by its hash.
      const drawn = drawBrowserRandomCourse(entry, candidates, Math.random, (chartEntry) =>
        this.records.peekChartBestRecord(chartEntry),
      );
      if (!drawn.ok) {
        this.setStatus(describeRandomCourseDrawFailure(entry.definition.name, drawn));
        return;
      }
      const prepared = this.library.prepareDrawnCourse(drawn.course, navigation);
      course = prepared.course;
      rememberDraw = prepared.remember;
    }
    if (planCourseStart(course).action === 'nonstop') {
      await this.startNonstopCourse(course, { decide: true });
      return;
    }
    const active = this.courses.beginRun(course);
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
        cancel: () => this.courses.cancelRun(active),
        ...(rememberDraw !== undefined
          ? {
              shown: () => {
                if (this.courses.active !== active) return;
                rememberDraw();
                if (navigation !== undefined)
                  this.courses.leaveSelect({ ...navigation, focusKey: `course:${course.id}` });
              },
            }
          : {}),
      },
    );
  }

  /** Plays the running course's next stage, or shows the course result when it is over. */
  private async playNextCourseStage(): Promise<void> {
    const active = this.courses.active;
    const stage = active !== undefined ? nextCourseStagePlay(active) : undefined;
    if (active === undefined || stage === undefined) {
      await this.showCourseResult();
      return;
    }
    this.setStatus(`${active.course.definition.name}: stage ${stage.index + 1} / ${stage.stageCount}`);
    await this.playChart(stage.stage, {
      courseStage: stage,
      ...(this.courses.autoPlay !== undefined ? { autoPlay: this.courses.autoPlay } : {}),
    });
  }

  /**
   * Called when a stage's result is dismissed during a course: the next stage starts, or the course result shows once
   * the course is over. Returns false outside a course.
   */
  public continueCourse(): boolean {
    if (this.courses.active === undefined) return false;
    void (this.courses.active.run.finished ? this.showCourseResult() : this.playNextCourseStage());
    return true;
  }

  /**
   * The course result: the course replay built from the stages played, its native result shown on the result scene
   * as one run, saved (when auto-save is on) and kept as the course's best record.
   */
  public async showCourseResult(): Promise<void> {
    const active = this.courses.finishRun();
    if (active === undefined || active.run.stagesPlayed === 0) {
      await this.showSelect();
      return;
    }
    const { course, run } = active;
    const courseLog = run.practice
      ? undefined
      : run.buildReplay({ createdAt: new Date().toISOString(), recorder: this.replayRecorder });
    const result = run.practice ? run.buildPracticeResult() : courseLog?.results?.native;
    if (result === undefined) {
      await this.showSelect();
      return;
    }
    if (courseLog !== undefined) {
      this.records.recordCourseResult(resolveCourseBestRecordUpdate(courseLog, result, courseBestRecordKey(course)));
      this.replayAutoSave.saveCourse(courseLog);
      // The course is ranked as one run; a practice run has no replay and never reaches these writers.
      this.leaderboard.maybeSubmitCourse(courseLog, run.stages);
    }
    const courseInfo = resolveCourseView(course);
    const histories = courseStageHistories(active);
    // A beatoraja theme shows the course result on its COURSE_RESULT skin (or its result skin).
    if (pickActiveFamilyForScene(this.familyKits.familyDispatchState(), 'result') === 'beatoraja') {
      // The course run read as one play, as on the other families: beatoraja's course result sums the stages and draws
      // every stage's graph joined, each stage as wide as its chart is long.
      const joined = joinCourseStageHistories(
        histories,
        run.stages.map((chartEntry) => createCourseChartRecord(chartEntry).length ?? 0),
      );
      const runResult = buildCourseResultData(course, result, courseLog, joined, {
        playSeconds: run.playSeconds,
        stageHistories: histories,
        practice: run.practice,
      });
      const mounted = await this.showBeatorajaResult(runResult, {
        run: 'course',
        course: {
          info: courseInfo,
          ...(courseLog !== undefined ? { result: { log: courseLog, native: result } } : {}),
        },
      });
      if (mounted) {
        this.unlockReplayOptions();
        return;
      }
    }
    // LR2 (and the built-in result) shows the last stage's graph.
    const playSeconds = run.playSeconds;
    await this.showResult(
      buildCourseResultData(course, result, courseLog, histories.at(-1), { playSeconds, practice: run.practice }),
      {
        course: courseInfo,
        ...(courseLog !== undefined ? { courseLog: { log: courseLog, native: result } } : {}),
      },
    );
  }
}
