// The NONSTOP route: a NONSTOP course stitched into one chart and played in one go, as LR2 plays one (with its decide
// screen when the course bar starts it, without one on a quick retry), and its course result built from the stitched
// play. The AUTO the course was started with is the course run service's (`services/courses.ts`), kept through every
// restitch (F5 during the play, R on the result).

import { resolveChartSource, type ChartFileHashes } from '@be-music/player-browser/collection';
import type { ResolvedPlayChart } from '@be-music/player-engine';
import { buildNonstopCourseReplay } from '@be-music/player-engine/course';
import type { BeMusicCourseReplay, BeMusicReplay, ReplayRecorderInfo } from '@be-music/player-engine/replay';
import {
  resolveCourseView,
  type CourseView,
  type LibraryChart,
  type LibraryCourse,
  type PlayResult,
} from '@be-music/player-scene-model';
import { describeNonstopPrepareFailure, resolveCourseBestRecordUpdate } from '../../course-flow.ts';
import { buildCourseResultData, courseBestRecordKey } from '../../course-result.ts';
import { pickActiveFamilyForScene } from '../../family-dispatch.ts';
import type { LeaderboardPanel } from '../../leaderboard-ui.ts';
import { prepareNonstopPlay, type PreparedNonstopPlay } from '../../nonstop-course.ts';
import type { CourseRunService } from '../../services/courses.ts';
import type { LibraryService } from '../../services/library.ts';
import type { ReplayAutoSave } from '../../services/replays.ts';
import type { RecordsService } from '../../services/records.ts';
import type { ResultReplaySlots } from '../../services/replay-slot-service.ts';
import type { ResultRoute } from './result.ts';
import type { TestHookRecorder } from '../../test-hook.ts';
import type { PlayerGUIState } from '../../types.ts';
import type { FamilyKits } from '../family-kits.ts';

/** A NONSTOP course being played as its stitched chart. */
export interface NonstopPlay {
  course: LibraryCourse;
  prepared: PreparedNonstopPlay;
  /** Set when the run plays a NONSTOP course replay back: its stitched replay plays, and its course result shows. */
  replay?: BeMusicCourseReplay;
}

export interface NonstopRouteDeps {
  /** The course run in progress: the AUTO the course was started with. */
  readonly courses: Pick<CourseRunService, 'autoPlay'>;
  /** The library: the stages' sources, and the composite source the stitched chart loads from. */
  readonly library: Pick<LibraryService, 'collection'>;
  /** The stages' chart hashes, which their cut-out replays record, and the course's best record. */
  readonly records: Pick<RecordsService, 'resolveChartHashes' | 'recordCourseResult'>;
  /** Debug Menu → Course → NONSTOP placement. */
  readonly guiState: Pick<PlayerGUIState, 'nonstopPlacement'>;
  /** The course replay's auto-save, by the setting latched at the play's start. */
  readonly replayAutoSave: Pick<ReplayAutoSave, 'saveCourse'>;
  /** Ranks the NONSTOP run as one course run. */
  readonly leaderboard: Pick<LeaderboardPanel, 'maybeSubmitCourse'>;
  /** The family the result is drawn by. */
  readonly familyKits: Pick<FamilyKits, 'familyDispatchState'>;
  /** This app as the recorder of its replays (`recorder` in the course replay). */
  readonly replayRecorder: Omit<ReplayRecorderInfo, 'engine'>;
  /** `window.__beMusicTest`, when installed: the replay the run recorded. */
  readonly testHook: Pick<TestHookRecorder, 'recordReplay'> | undefined;
  readonly setStatus: (text: string) => void;
  readonly showSelect: () => Promise<void>;
  /** Shows the decide screen for the stitched song, which leads to `then.start` instead of playing it. */
  readonly showDecide: (
    chartEntry: LibraryChart,
    overrides: { autoPlay?: boolean },
    then: { start: () => Promise<void> },
  ) => Promise<void>;
  /** Plays the stitched chart, with the course's AUTO when it was started with one, or a run's recorded replay. */
  readonly playChart: (
    chartEntry: LibraryChart,
    overrides: { nonstop: NonstopPlay; autoPlay?: boolean; replay?: BeMusicReplay },
  ) => Promise<void>;
  /**
   * Shows the result on the LR2 or built-in result screen: the run's (`mode.nonstop`), or the play's own when the
   * stitched play left no course log.
   */
  readonly showResult: (
    data: PlayResult,
    mode?: { nonstop: { info: CourseView; retry: () => void }; replaySlots?: ResultReplaySlots },
  ) => Promise<void>;
  /** The run's replay slots (`ResultRoute.courseReplaySlots`). */
  readonly courseReplaySlots: ResultRoute['courseReplaySlots'];
  /** Shows the run's result on the beatoraja theme's result skin; `false` when the theme has none or it failed to load. */
  readonly showBeatorajaResult: (
    data: PlayResult,
    options: {
      run: 'nonstop';
      course: { info: CourseView };
      nonstopRetry: () => void;
      playChart?: ResolvedPlayChart['chart'];
      replaySlots?: ResultReplaySlots;
    },
  ) => Promise<boolean>;
  /** Re-enables the options a play latched, once its result shows. */
  readonly unlockReplayOptions: () => void;
}

/** A NONSTOP course from its start (or a restitch) to its result. */
export class NonstopRoute {
  private readonly courses: NonstopRouteDeps['courses'];
  private readonly library: NonstopRouteDeps['library'];
  private readonly records: NonstopRouteDeps['records'];
  private readonly guiState: NonstopRouteDeps['guiState'];
  private readonly replayAutoSave: NonstopRouteDeps['replayAutoSave'];
  private readonly leaderboard: NonstopRouteDeps['leaderboard'];
  private readonly familyKits: NonstopRouteDeps['familyKits'];
  private readonly replayRecorder: NonstopRouteDeps['replayRecorder'];
  private readonly testHook: NonstopRouteDeps['testHook'];
  private readonly setStatus: NonstopRouteDeps['setStatus'];
  private readonly showSelect: NonstopRouteDeps['showSelect'];
  private readonly showDecide: NonstopRouteDeps['showDecide'];
  private readonly playChart: NonstopRouteDeps['playChart'];
  private readonly showResult: NonstopRouteDeps['showResult'];
  private readonly courseReplaySlots: NonstopRouteDeps['courseReplaySlots'];
  private readonly showBeatorajaResult: NonstopRouteDeps['showBeatorajaResult'];
  private readonly unlockReplayOptions: NonstopRouteDeps['unlockReplayOptions'];

  public constructor(deps: NonstopRouteDeps) {
    this.courses = deps.courses;
    this.library = deps.library;
    this.records = deps.records;
    this.guiState = deps.guiState;
    this.replayAutoSave = deps.replayAutoSave;
    this.leaderboard = deps.leaderboard;
    this.familyKits = deps.familyKits;
    this.replayRecorder = deps.replayRecorder;
    this.testHook = deps.testHook;
    this.setStatus = deps.setStatus;
    this.showSelect = deps.showSelect;
    this.showDecide = deps.showDecide;
    this.playChart = deps.playChart;
    this.showResult = deps.showResult;
    this.courseReplaySlots = deps.courseReplaySlots;
    this.showBeatorajaResult = deps.showBeatorajaResult;
    this.unlockReplayOptions = deps.unlockReplayOptions;
  }

  /**
   * Starts a NONSTOP course: its stages are stitched into one chart (`prepareNonstopPlay`, on the shared NONSTOP
   * pipeline) played from their own files, as LR2 plays a NONSTOP course in one go. Quick retry stitches and plays it
   * again.
   *
   * With `replay`, a NONSTOP course replay plays back as LR2 replays a NONSTOP run, as one chart: the course is stitched
   * as the run recorded it (its placement, stitching rules and each stage's draws) and its stitched replay plays.
   */
  public async startNonstopCourse(
    course: LibraryCourse,
    options: { decide?: boolean; replay?: BeMusicCourseReplay } = {},
  ): Promise<void> {
    const run = options.replay?.nonstop;
    if (options.replay !== undefined && run === undefined) {
      this.setStatus(`${course.definition.name}: the course replay has no NONSTOP run to play`);
      return;
    }
    const hashes = new Map<string, ChartFileHashes>();
    for (const stage of course.stages) {
      if (stage.chart === undefined) continue;
      const found = await this.records.resolveChartHashes(stage.chart);
      if (found !== undefined) hashes.set(stage.chart.id, found);
    }
    const prepared = prepareNonstopPlay(course, {
      sourceOf: (chartEntry) => resolveChartSource(this.library.collection, chartEntry),
      hashesOf: (chartEntry) => hashes.get(chartEntry.id),
      ...(run !== undefined
        ? {
            placement: run.placement,
            stitch: run.stitch ?? 1,
            stageDraws: run.stages.map((stage) => stage.randomDraws),
          }
        : { placement: this.guiState.nonstopPlacement }),
    });
    if (!prepared.ok) {
      this.setStatus(describeNonstopPrepareFailure(course.definition.name, prepared));
      return;
    }
    // The stitched chart loads its assets from a composite source; keep one at a time.
    this.library.collection = {
      ...this.library.collection,
      sources: [
        ...this.library.collection.sources.filter((source) => !source.id.startsWith('nonstop:')),
        prepared.prepared.source,
      ],
    };
    const play = () =>
      run !== undefined
        ? this.playChart(prepared.prepared.chart, {
            nonstop: { course, prepared: prepared.prepared, replay: options.replay! },
            replay: run.replay,
            autoPlay: run.replay.play.mode === 'auto',
          })
        : this.playChart(prepared.prepared.chart, {
            nonstop: { course, prepared: prepared.prepared },
            ...(this.courses.autoPlay !== undefined ? { autoPlay: this.courses.autoPlay } : {}),
          });
    // The decide screen names the course (the stitched song's title); a quick retry skips it, as LR2's does.
    if (options.decide === true) {
      await this.showDecide(prepared.prepared.chart, {}, { start: play });
      return;
    }
    await play();
  }

  /**
   * The course result of a NONSTOP run: its course log built from the stitched play, kept and shown as one run, on a
   * beatoraja theme's result skin when the result family is beatoraja (with `resolved`, the stitched chart as played,
   * for its graphs), else on the LR2 or built-in result.
   */
  public async showNonstopCourseResult(
    nonstop: NonstopPlay,
    replay: BeMusicReplay | undefined,
    fallback?: PlayResult,
    resolved?: ResolvedPlayChart,
  ): Promise<void> {
    this.testHook?.recordReplay(replay);
    if (nonstop.replay !== undefined && fallback?.practice !== true) {
      await this.showNonstopReplayResult(nonstop, nonstop.replay, fallback, resolved);
      return;
    }
    if (fallback?.practice) {
      const info = resolveCourseView(nonstop.course);
      const retry = (): void => void this.startNonstopCourse(nonstop.course);
      const result: PlayResult = { ...fallback, run: 'nonstop', course: info };
      if (pickActiveFamilyForScene(this.familyKits.familyDispatchState(), 'result') === 'beatoraja') {
        const mounted = await this.showBeatorajaResult(result, {
          run: 'nonstop',
          course: { info },
          nonstopRetry: retry,
          ...(resolved !== undefined ? { playChart: resolved.chart } : {}),
        });
        if (mounted) {
          this.unlockReplayOptions();
          return;
        }
      }
      await this.showResult(result, { nonstop: { info, retry } });
      return;
    }
    if (replay === undefined) {
      await (fallback !== undefined ? this.showResult(fallback) : this.showSelect());
      return;
    }
    const courseLog = buildNonstopCourseReplay(nonstop.course.definition, nonstop.prepared.stitched, replay, {
      createdAt: new Date().toISOString(),
      recorder: this.replayRecorder,
    });
    const native = courseLog.results?.native;
    if (native === undefined) {
      await (fallback !== undefined ? this.showResult(fallback) : this.showSelect());
      return;
    }
    const update = resolveCourseBestRecordUpdate(
      courseLog,
      native,
      courseBestRecordKey(nonstop.course, nonstop.prepared.stitched.placement),
    );
    const kept = this.records.recordCourseResult(update);
    // Saved into the course's replay slots only when the run kept a record, as beatoraja's `CourseResult` does.
    const replaySlots = this.courseReplaySlots(
      courseLog,
      native,
      update !== undefined && kept !== undefined ? { play: update.play, previous: kept.previous } : undefined,
    );
    this.replayAutoSave.saveCourse(courseLog);
    // Ranked as one course run: the Leaderboard stitches the stage charts again to check the stitched play.
    this.leaderboard.maybeSubmitCourse(
      courseLog,
      nonstop.course.stages.flatMap((stage) => (stage.chart !== undefined ? [stage.chart] : [])),
    );
    // As LR2 shows a NONSTOP run: on the result skin with the clear / fail jingles (no course-result step), and R
    // stitches and plays the course again.
    const result = buildCourseResultData(nonstop.course, native, courseLog, fallback);
    const info = resolveCourseView(nonstop.course);
    const retry = (): void => void this.startNonstopCourse(nonstop.course);
    if (pickActiveFamilyForScene(this.familyKits.familyDispatchState(), 'result') === 'beatoraja') {
      const mounted = await this.showBeatorajaResult(result, {
        run: 'nonstop',
        course: { info },
        nonstopRetry: retry,
        ...(resolved !== undefined ? { playChart: resolved.chart } : {}),
        replaySlots,
      });
      if (mounted) {
        this.unlockReplayOptions();
        return;
      }
    }
    await this.showResult(result, { nonstop: { info, retry }, replaySlots });
  }

  /**
   * The course result of a NONSTOP course replay played back: the run it recorded, shown as the live run's is, with
   * its replay flag on. Nothing is kept: no course record, no saved replay, no Leaderboard run. R plays it again.
   */
  private async showNonstopReplayResult(
    nonstop: NonstopPlay,
    courseLog: BeMusicCourseReplay,
    fallback?: PlayResult,
    resolved?: ResolvedPlayChart,
  ): Promise<void> {
    const native = courseLog.results?.native;
    if (native === undefined) {
      await (fallback !== undefined ? this.showResult(fallback) : this.showSelect());
      return;
    }
    const result: PlayResult = {
      ...buildCourseResultData(nonstop.course, native, courseLog, fallback),
      fromReplay: true,
    };
    const info = resolveCourseView(nonstop.course);
    const retry = (): void => void this.startNonstopCourse(nonstop.course, { replay: courseLog });
    if (pickActiveFamilyForScene(this.familyKits.familyDispatchState(), 'result') === 'beatoraja') {
      const mounted = await this.showBeatorajaResult(result, {
        run: 'nonstop',
        course: { info },
        nonstopRetry: retry,
        ...(resolved !== undefined ? { playChart: resolved.chart } : {}),
      });
      if (mounted) {
        this.unlockReplayOptions();
        return;
      }
    }
    await this.showResult(result, { nonstop: { info, retry } });
  }
}
