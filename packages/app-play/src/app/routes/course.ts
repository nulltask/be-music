// The course route: a course bar started on the select screen (a NEW COURSE bar starting the course maker, a random
// course or a RANDOM MIX drawn first, a NONSTOP course handed to `nonstop.ts`), an EXPERT / GRADE course's decide screen, each of its
// stages in turn, and its course result. The run it acts on is the course run service's (`services/courses.ts`); the
// screens are the app's.

import {
  createCourseChartRecord,
  createDrawnRandomMixEntry,
  createRandomMixCandidate,
  createRandomMixEntry,
  drawBrowserRandomCourse,
  resolveRandomMixBPM,
  type CourseMaker,
} from '@be-music/player-browser/collection';
import {
  createRandomMixCourse,
  filterRandomMixCandidates,
  hasRandomMixFirstStage,
  isRandomMixKept,
  listRandomMixKeyModes,
  resolveRandomMixCount,
  type RandomMixConditions,
} from '@be-music/player-engine/course';
import { RandomMixDraw, type RandomMixPoolChart } from '../../random-mix-draw.ts';
import type { RandomMixDialogRequest, RandomMixDialogResult } from '../../ui/random-mix-dialog.ts';
import { playerText } from '../../player-copy.ts';
import type {
  BeMusicCourseReplay,
  BeMusicReplay,
  ReplayCourseResult,
  ReplayRecorderInfo,
} from '@be-music/player-engine/replay';
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
  endlessRandomMixEntry,
  prepareEndlessStage,
  settleEndlessCourse,
  describeUnplayableCourse,
  nextCourseStagePlay,
  planCourseStart,
  resolveCourseBestRecordUpdate,
  resolveCourseDanRankUpdate,
  type CourseStagePlay,
  type EndlessRandomMix,
} from '../../course-flow.ts';
import { buildCourseResultData, courseBestRecordKey, joinCourseStageHistories } from '../../course-result.ts';
import { pickActiveFamilyForScene } from '../../family-dispatch.ts';
import type { LeaderboardPanel } from '../../leaderboard-ui.ts';
import type { CourseRunService } from '../../services/courses.ts';
import type { LibraryService } from '../../services/library.ts';
import type { ReplayAutoSave } from '../../services/replays.ts';
import type { RecordsService } from '../../services/records.ts';
import type { ResultReplaySlots } from '../../services/replay-slot-service.ts';
import type { ResultRoute } from './result.ts';
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
  readonly records: Pick<
    RecordsService,
    'resolveChartHashes' | 'peekChartBestRecord' | 'recordCourseResult' | 'recordDanRank'
  >;
  /**
   * The course maker, which a NEW COURSE bar starts and which keeps a RANDOM MIX's conditions, LR2 settings and last
   * draw.
   */
  readonly courseMaker: {
    readonly maker: Pick<
      CourseMaker,
      | 'start'
      | 'keepRandomMix'
      | 'randomMixConditions'
      | 'setRandomMixConditions'
      | 'randomMixSettings'
      | 'setRandomMixSettings'
      | 'defaultConnection'
      | 'setDefaultConnection'
    >;
  };
  /** Opens the RANDOM MIX dialog: what it held when it closed and whether OK confirmed it. */
  readonly promptRandomMix: (request: RandomMixDialogRequest) => Promise<RandomMixDialogResult | undefined>;
  /** The source of chance a RANDOM MIX draws with. Default `Math.random`. */
  readonly random?: () => number;
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
  /** Plays a course stage, with the course's AUTO when it was started with one, or its recorded replay. */
  readonly playChart: (
    chartEntry: LibraryChart,
    overrides: { courseStage: CourseStagePlay; autoPlay?: boolean; replay?: BeMusicReplay },
  ) => Promise<void>;
  /** The course run's replay slots (`ResultRoute.courseReplaySlots`). */
  readonly courseReplaySlots: ResultRoute['courseReplaySlots'];
  /** Shows the course result on the LR2 or built-in result screen. */
  readonly showResult: (
    data: PlayResult,
    mode: { course: CourseView; courseLog?: CourseResultLog; replaySlots?: ResultReplaySlots },
  ) => Promise<void>;
  /**
   * Shows the course result on the beatoraja theme's course-result (or result) skin. Resolves `false` when the theme has
   * neither or it failed to load.
   */
  readonly showBeatorajaResult: (
    data: PlayResult,
    options: {
      run: 'course';
      course: { info: CourseView; result?: CourseResultLog };
      replaySlots?: ResultReplaySlots;
    },
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
  private readonly promptRandomMix: CourseRouteDeps['promptRandomMix'];
  private readonly random: () => number;
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
  private readonly courseReplaySlots: CourseRouteDeps['courseReplaySlots'];
  private readonly showBeatorajaResult: CourseRouteDeps['showBeatorajaResult'];
  private readonly unlockReplayOptions: CourseRouteDeps['unlockReplayOptions'];

  public constructor(deps: CourseRouteDeps) {
    this.courses = deps.courses;
    this.library = deps.library;
    this.records = deps.records;
    this.courseMaker = deps.courseMaker;
    this.promptRandomMix = deps.promptRandomMix;
    this.random = deps.random ?? Math.random;
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
    this.courseReplaySlots = deps.courseReplaySlots;
    this.showBeatorajaResult = deps.showBeatorajaResult;
    this.unlockReplayOptions = deps.unlockReplayOptions;
  }

  /**
   * Starts a course from its first stage. A beatoraja random course first draws its stages from the library (each
   * stage filter against the songs and their chart hashes); a stage that finds no chart leaves it unstarted.
   */
  public async startCourse(entry: LibraryCourse, options: { autoPlay?: boolean } = {}): Promise<void> {
    // AUTO on a course bar plays every stage itself; PLAY follows the Options dialog's auto play.
    this.courses.start(options.autoPlay);
    const plan = planCourseStart(entry);
    // A NEW COURSE bar starts making a course of its folder's kind; songs decided from now on join it.
    if (plan.action === 'make') {
      this.courseMaker.maker.start(plan.kind);
      this.setStatus(playerText().course.making);
      return;
    }
    if (plan.action === 'unplayable') {
      this.setStatus(describeUnplayableCourse(entry));
      return;
    }
    if (plan.action === 'random-mix') {
      await this.startRandomMix(plan.kind);
      return;
    }
    let course = entry;
    const navigation = this.selectNavigation();
    this.courses.leaveSelect(navigation);
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

  /**
   * A RANDOM MIX bar: the RANDOM MIX dialog asks which charts to draw from and how many stages, then one run is drawn
   * and played. Its result leads back to the select screen, as any course's does; deciding the bar again draws afresh. What the dialog held is kept for the next one, OK or not. Only the library's facts at hand are read to list the charts that fit; a
   * chart's BPMs are read once a draw walks it and its chart file hashed once it is drawn, so starting a mix costs the
   * same however large the library is.
   */
  private async startRandomMix(kind: 'expert' | 'nonstop'): Promise<void> {
    const pool = this.library.collection.charts.map(createRandomMixCandidate);
    const maker = this.courseMaker.maker;
    const closed = await this.promptRandomMix({
      kind,
      keyModes: listRandomMixKeyModes(pool),
      initial: maker.randomMixConditions,
      settings: maker.randomMixSettings,
      defaultConnection: maker.defaultConnection,
      countMatches: (asked) => filterRandomMixCandidates(pool, asked).length,
      canStart: (asked) =>
        hasRandomMixFirstStage(filterRandomMixCandidates(pool, asked.conditions), {
          settings: asked.settings,
          bpmOf: (candidate) => resolveRandomMixBPM(candidate.chart),
          allowBPMChanges: asked.conditions.allowBPMChanges,
        }),
    });
    if (closed === undefined) return;
    // What the dialog held is kept for the next one, confirmed or not.
    const { choice } = closed;
    const { conditions } = choice;
    maker.setRandomMixConditions(conditions);
    maker.setRandomMixSettings(choice.settings);
    if (kind === 'nonstop') maker.setDefaultConnection(choice.defaultConnection);
    if (!closed.confirmed) return;
    this.courses.leaveSelect(this.selectNavigation());
    await this.playRandomMix(kind, pool);
  }

  /**
   * Draws one RANDOM MIX run by the conditions last confirmed and plays it: a run of five stages or fewer is kept as its
   * folder's newest course, as LR2 keeps its draw; a longer or endless one is played without being kept. An endless
   * run draws each stage as it reaches it.
   */
  private async playRandomMix(kind: 'expert' | 'nonstop', pool: readonly RandomMixPoolChart[]): Promise<void> {
    const maker = this.courseMaker.maker;
    const conditions = maker.randomMixConditions;
    const count = resolveRandomMixCount(kind, conditions.count);
    const endless = count === 'infinity';
    const draw = new RandomMixDraw(filterRandomMixCandidates(pool, conditions), {
      settings: maker.randomMixSettings,
      bpmOf: resolveRandomMixBPM,
      md5Of: async (chartEntry) => (await this.records.resolveChartHashes(chartEntry))?.md5,
      random: this.random,
      allowBPMChanges: conditions.allowBPMChanges,
      endless,
    });
    const stages = await draw.take(endless ? 1 : count);
    const course = createRandomMixCourse(
      kind,
      stages.map((drawn) => drawn.stage),
      { defaultConnection: maker.defaultConnection },
    );
    if (course === undefined) {
      this.setStatus(playerText().course.randomMixNoMatch);
      await this.showSelect();
      return;
    }
    const kept = isRandomMixKept(count);
    if (kept) maker.keepRandomMix(course);
    // A kept draw is its folder's newest course, where the cursor comes back; otherwise the RANDOM MIX bar.
    const barId = kept ? `maker:${kind}#0` : createRandomMixEntry(kind).id;
    const navigation = this.courses.takeReturnNavigation() ?? this.selectNavigation();
    this.courses.leaveSelect(navigation !== undefined ? { ...navigation, focusKey: `course:${barId}` } : undefined);
    if (kind === 'nonstop') {
      await this.startNonstopCourse(createDrawnRandomMixEntry(course, stages), { decide: true });
      return;
    }
    const endlessMix: EndlessRandomMix | undefined = endless
      ? { next: () => draw.next(), stages: [...stages] }
      : undefined;
    if (endlessMix !== undefined) endlessMix.lookahead = draw.next();
    const entry =
      endlessMix !== undefined
        ? endlessRandomMixEntry(barId, course, stages, await endlessMix.lookahead)
        : { ...createDrawnRandomMixEntry(course, stages), id: barId };
    const active = this.courses.beginRun(entry, undefined, {
      ...(endlessMix !== undefined ? { endless: endlessMix } : {}),
      ...(kept ? {} : { unkept: true }),
    });
    await this.showDecide(
      courseDecideSong(entry, stages[0]!.chart),
      {},
      {
        start: () => this.playNextCourseStage(),
        cancel: () => this.courses.cancelRun(active),
      },
    );
  }

  /**
   * Plays a course replay back as a course run (`courseFromReplay` rebuilt its course from the log): its decide screen,
   * then each recorded stage in order with the state it carried in, each stage's result, and the course result, up to
   * where the recorded run stopped. Nothing is kept: no stage or course record, no saved replay, no Leaderboard run.
   */
  public async startCourseReplay(course: LibraryCourse, courseLog: BeMusicCourseReplay): Promise<void> {
    this.courses.start(undefined);
    this.courses.leaveSelect(this.selectNavigation());
    const active = this.courses.beginRun(course, courseLog);
    const first = course.stages[0]?.chart;
    if (first === undefined || active.replay?.stages.length === 0) {
      this.courses.cancelRun(active);
      this.setStatus(`${course.definition.name}: the course replay has no stage to play`);
      return;
    }
    await this.showDecide(
      courseDecideSong(course, first),
      {},
      { start: () => this.playNextCourseStage(), cancel: () => this.courses.cancelRun(active) },
    );
  }

  /** Plays the running course's next stage, or shows the course result when it is over. */
  private async playNextCourseStage(): Promise<void> {
    const active = this.courses.active;
    // An endless RANDOM MIX draws the stage it reaches now; no chart left to draw ends the run.
    if (active?.endless !== undefined && !(await prepareEndlessStage(active))) {
      if (this.courses.active === active) await this.showCourseResult();
      return;
    }
    if (this.courses.active !== active) return;
    const stage = active !== undefined ? nextCourseStagePlay(active) : undefined;
    if (active === undefined || stage === undefined) {
      await this.showCourseResult();
      return;
    }
    const replaying = stage.replay !== undefined ? ' (replay)' : '';
    const stageCount = active.endless !== undefined ? '∞' : stage.stageCount;
    this.setStatus(`${active.course.definition.name}: stage ${stage.index + 1} / ${stageCount}${replaying}`);
    // A course replay's stage plays its recorded replay (an AUTO stage as AUTO), as a dropped replay plays.
    if (stage.replay !== undefined) {
      await this.playChart(stage.stage, {
        courseStage: stage,
        replay: stage.replay,
        autoPlay: stage.replay.play.mode === 'auto',
      });
      return;
    }
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
    // An endless run's course is the stages it played, the one drawn ahead dropped.
    settleEndlessCourse(active);
    const { course, run } = active;
    // A course replay shows the run it recorded, and keeps nothing.
    const replay = active.replay !== undefined && !run.practice;
    const courseLog = run.practice
      ? undefined
      : replay
        ? active.replay!.log
        : run.buildReplay({ createdAt: new Date().toISOString(), recorder: this.replayRecorder });
    const result = run.practice
      ? run.buildPracticeResult()
      : (courseLog?.results?.native ?? (replay ? run.buildReplay().results?.native : undefined));
    if (result === undefined) {
      await this.showSelect();
      return;
    }
    let replaySlots: ResultReplaySlots | undefined;
    if (courseLog !== undefined && replay) {
      // A course replay shows its course's replay slots and saves into none, as a single replay does.
      replaySlots = this.courseReplaySlots(courseLog, result, undefined);
    }
    if (courseLog !== undefined && !replay && active.unkept === true) {
      // A RANDOM MIX run no bar lists keeps no course record and no replay slot; it is saved and ranked as any run.
      this.replayAutoSave.saveCourse(courseLog);
      this.leaderboard.maybeSubmitCourse(courseLog, run.stages);
    } else if (courseLog !== undefined && !replay) {
      const update = resolveCourseBestRecordUpdate(courseLog, result, courseBestRecordKey(course));
      const kept = this.records.recordCourseResult(update);
      // A cleared GRADE course named after a dan raises the player's dan rank in its key mode.
      this.records.recordDanRank(resolveCourseDanRankUpdate(course, courseLog, result));
      // The run saves into its course's replay slots only when it kept a record, as beatoraja's `CourseResult` does.
      replaySlots = this.courseReplaySlots(
        courseLog,
        result,
        update !== undefined && kept !== undefined ? { play: update.play, previous: kept.previous } : undefined,
      );
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
        fromReplay: active.replay !== undefined,
      });
      const mounted = await this.showBeatorajaResult(runResult, {
        run: 'course',
        course: {
          info: courseInfo,
          ...(courseLog !== undefined ? { result: { log: courseLog, native: result } } : {}),
        },
        ...(replaySlots !== undefined ? { replaySlots } : {}),
      });
      if (mounted) {
        this.unlockReplayOptions();
        return;
      }
    }
    // LR2 (and the built-in result) shows the last stage's graph.
    const playSeconds = run.playSeconds;
    await this.showResult(
      buildCourseResultData(course, result, courseLog, histories.at(-1), {
        playSeconds,
        practice: run.practice,
        fromReplay: active.replay !== undefined,
      }),
      {
        course: courseInfo,
        ...(courseLog !== undefined ? { courseLog: { log: courseLog, native: result } } : {}),
        ...(replaySlots !== undefined ? { replaySlots } : {}),
      },
    );
  }
}
