// The NONSTOP route: a NONSTOP course stitched into one chart and played in one go, as LR2 plays one (with its decide
// screen when the course bar starts it, without one on a quick retry), and its course result built from the stitched
// play. The AUTO the course was started with is the course run service's (`services/courses.ts`), kept through every
// restitch (F5 during the play, R on the result).

import { resolveSongSource, type ChartFileHashes } from '@be-music/player-web/collection';
import type { ResolvedPlayChart } from '@be-music/player';
import { buildNonstopCoursePlaylog } from '@be-music/player/course';
import type { BeMusicPlaylog, PlaylogRecorderInfo } from '@be-music/player/playlog';
import {
  resolveCourseView,
  type CourseView,
  type LibraryChart,
  type LibraryCourse,
  type PlayResult,
} from '@be-music/scene-model';
import { describeNonstopPrepareFailure, resolveCourseRecordUpdate } from '../../course-flow.ts';
import { buildCourseResultData, courseRecordKey } from '../../course-result.ts';
import { pickActiveFamilyForScene } from '../../family-dispatch.ts';
import type { LeaderboardPanel } from '../../leaderboard-ui.ts';
import { prepareNonstopPlay, type PreparedNonstopPlay } from '../../nonstop-course.ts';
import type { CourseRunService } from '../../services/courses.ts';
import type { LibraryService } from '../../services/library.ts';
import type { PlaylogAutoSave } from '../../services/playlogs.ts';
import type { RecordsService } from '../../services/records.ts';
import type { TestHookRecorder } from '../../test-hook.ts';
import type { DemoGuiState } from '../../types.ts';
import type { FamilyKits } from '../family-kits.ts';

/** A NONSTOP course being played as its stitched chart. */
export interface NonstopPlay {
  course: LibraryCourse;
  prepared: PreparedNonstopPlay;
}

export interface NonstopRouteDeps {
  /** The course run in progress: the AUTO the course was started with. */
  readonly courses: Pick<CourseRunService, 'autoPlay'>;
  /** The library: the stages' sources, and the composite source the stitched chart loads from. */
  readonly library: Pick<LibraryService, 'collection'>;
  /** The stages' chart hashes, which their cut-out play logs record, and the course's best record. */
  readonly records: Pick<RecordsService, 'resolveChartHashes' | 'recordCourseResult'>;
  /** Debug Menu → Course → NONSTOP placement. */
  readonly guiState: Pick<DemoGuiState, 'nonstopPlacement'>;
  /** The course play log's auto-save, by the setting latched at the play's start. */
  readonly playlogAutoSave: Pick<PlaylogAutoSave, 'saveCourse'>;
  /** Ranks the NONSTOP run as one course run. */
  readonly leaderboard: Pick<LeaderboardPanel, 'maybeSubmitCourse'>;
  /** The family the result is drawn by. */
  readonly familyKits: Pick<FamilyKits, 'familyDispatchState'>;
  /** This app as the recorder of its play logs (`recorder` in the course play log). */
  readonly playlogRecorder: Omit<PlaylogRecorderInfo, 'engine'>;
  /** `window.__beMusicTest`, when installed: the play log the run recorded. */
  readonly testHook: Pick<TestHookRecorder, 'recordPlaylog'> | undefined;
  readonly setStatus: (text: string) => void;
  readonly showSelect: () => Promise<void>;
  /** Shows the decide screen for the stitched song, which leads to `then.start` instead of playing it. */
  readonly showDecide: (
    song: LibraryChart,
    overrides: { autoPlay?: boolean },
    then: { start: () => Promise<void> },
  ) => Promise<void>;
  /** Plays the stitched chart, with the course's AUTO when it was started with one. */
  readonly playSong: (song: LibraryChart, overrides: { nonstop: NonstopPlay; autoPlay?: boolean }) => Promise<void>;
  /**
   * Shows the result on the LR2 or built-in result screen: the run's (`mode.nonstop`), or the play's own when the
   * stitched play left no course log.
   */
  readonly showResult: (data: PlayResult, mode?: { nonstop: { info: CourseView; retry: () => void } }) => Promise<void>;
  /** Shows the run's result on the beatoraja theme's result skin; `false` when the theme has none or it failed to load. */
  readonly showBeatorajaResult: (
    data: PlayResult,
    options: {
      run: 'nonstop';
      course: { info: CourseView };
      nonstopRetry: () => void;
      playChart?: ResolvedPlayChart['chart'];
    },
  ) => Promise<boolean>;
  /** Re-enables the options a play latched, once its result shows. */
  readonly unlockPlaylogOptions: () => void;
}

/** A NONSTOP course from its start (or a restitch) to its result. */
export class NonstopRoute {
  private readonly courses: NonstopRouteDeps['courses'];
  private readonly library: NonstopRouteDeps['library'];
  private readonly records: NonstopRouteDeps['records'];
  private readonly guiState: NonstopRouteDeps['guiState'];
  private readonly playlogAutoSave: NonstopRouteDeps['playlogAutoSave'];
  private readonly leaderboard: NonstopRouteDeps['leaderboard'];
  private readonly familyKits: NonstopRouteDeps['familyKits'];
  private readonly playlogRecorder: NonstopRouteDeps['playlogRecorder'];
  private readonly testHook: NonstopRouteDeps['testHook'];
  private readonly setStatus: NonstopRouteDeps['setStatus'];
  private readonly showSelect: NonstopRouteDeps['showSelect'];
  private readonly showDecide: NonstopRouteDeps['showDecide'];
  private readonly playSong: NonstopRouteDeps['playSong'];
  private readonly showResult: NonstopRouteDeps['showResult'];
  private readonly showBeatorajaResult: NonstopRouteDeps['showBeatorajaResult'];
  private readonly unlockPlaylogOptions: NonstopRouteDeps['unlockPlaylogOptions'];

  public constructor(deps: NonstopRouteDeps) {
    this.courses = deps.courses;
    this.library = deps.library;
    this.records = deps.records;
    this.guiState = deps.guiState;
    this.playlogAutoSave = deps.playlogAutoSave;
    this.leaderboard = deps.leaderboard;
    this.familyKits = deps.familyKits;
    this.playlogRecorder = deps.playlogRecorder;
    this.testHook = deps.testHook;
    this.setStatus = deps.setStatus;
    this.showSelect = deps.showSelect;
    this.showDecide = deps.showDecide;
    this.playSong = deps.playSong;
    this.showResult = deps.showResult;
    this.showBeatorajaResult = deps.showBeatorajaResult;
    this.unlockPlaylogOptions = deps.unlockPlaylogOptions;
  }

  /**
   * Starts a NONSTOP course: its stages are stitched into one chart (`prepareNonstopPlay`, on the shared NONSTOP
   * pipeline) played from their own files, as LR2 plays a NONSTOP course in one go. Quick retry stitches and plays it
   * again.
   */
  public async startNonstopCourse(course: LibraryCourse, options: { decide?: boolean } = {}): Promise<void> {
    const hashes = new Map<string, ChartFileHashes>();
    for (const stage of course.stages) {
      if (stage.chart === undefined) continue;
      const found = await this.records.resolveChartHashes(stage.chart);
      if (found !== undefined) hashes.set(stage.chart.id, found);
    }
    const prepared = prepareNonstopPlay(course, {
      sourceOf: (song) => resolveSongSource(this.library.collection, song),
      hashesOf: (song) => hashes.get(song.id),
      placement: this.guiState.nonstopPlacement,
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
      this.playSong(prepared.prepared.song, {
        nonstop: { course, prepared: prepared.prepared },
        ...(this.courses.autoPlay !== undefined ? { autoPlay: this.courses.autoPlay } : {}),
      });
    // The decide screen names the course (the stitched song's title); a quick retry skips it, as LR2's does.
    if (options.decide === true) {
      await this.showDecide(prepared.prepared.song, {}, { start: play });
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
    playlog: BeMusicPlaylog | undefined,
    fallback?: PlayResult,
    resolved?: ResolvedPlayChart,
  ): Promise<void> {
    this.testHook?.recordPlaylog(playlog);
    if (playlog === undefined) {
      await (fallback !== undefined ? this.showResult(fallback) : this.showSelect());
      return;
    }
    const courseLog = buildNonstopCoursePlaylog(nonstop.course.definition, nonstop.prepared.stitched, playlog, {
      createdAt: new Date().toISOString(),
      recorder: this.playlogRecorder,
    });
    const native = courseLog.results?.native;
    if (native === undefined) {
      await (fallback !== undefined ? this.showResult(fallback) : this.showSelect());
      return;
    }
    this.records.recordCourseResult(
      resolveCourseRecordUpdate(
        courseLog,
        native,
        courseRecordKey(nonstop.course, nonstop.prepared.stitched.placement),
      ),
    );
    this.playlogAutoSave.saveCourse(courseLog);
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
      });
      if (mounted) {
        this.unlockPlaylogOptions();
        return;
      }
    }
    await this.showResult(result, { nonstop: { info, retry } });
  }
}
