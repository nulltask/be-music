// The replay route: a replay dropped or picked (`*.bmplay.json`) played back on the play screen of the gameplay
// family, whichever family recorded it, once the chart it was recorded on is found in the library; and a course replay
// (`*.bmcourse.json`) played back as its course, once every stage's chart is.

import { computeChartFingerprint } from '@be-music/chart-model';
import { logger } from '@be-music/player-browser';
import type { BrowserDroppedFile } from '@be-music/player-browser/collection';
import {
  COURSE_REPLAY_FILE_SUFFIX,
  parseCourseReplay,
  parseReplay,
  type BeMusicCourseReplay,
  type BeMusicReplay,
} from '@be-music/player-engine/replay';
import type { LibraryChart, LibraryCourse } from '@be-music/player-scene-model';
import { courseFromReplay, describeCourseReplayStage, matchCourseReplayCharts } from '../../course-flow.ts';
import type { LibraryService } from '../../services/library.ts';
import type { RecordsService } from '../../services/records.ts';

const dropLog = logger('drop');
const gamereplay = logger('gameplay');

export interface ReplayRouteDeps {
  /** The library the log's chart is looked for in. */
  readonly library: Pick<LibraryService, 'collection'>;
  /** The charts' SHA-256 and MD5, which a replay records. */
  readonly records: Pick<RecordsService, 'resolveChartSHA256' | 'resolveChartHashes'>;
  readonly setStatus: (text: string) => void;
  /** Shows a status about the play, which the select screen replaces when it comes back. */
  readonly setPlayStatus: (text: string) => void;
  /** Plays the chart back from the log (`PlayRoute.playChart`). */
  readonly playChart: (
    chartEntry: LibraryChart,
    overrides: { autoPlay: boolean; replay: BeMusicReplay },
  ) => Promise<void>;
  readonly showSelect: () => Promise<void>;
  /** Plays an EXPERT / GRADE course replay back (`CourseRoute.startCourseReplay`). */
  readonly startCourseReplay: (course: LibraryCourse, courseLog: BeMusicCourseReplay) => Promise<void>;
  /** Plays a NONSTOP course replay back (`NonstopRoute.startNonstopCourse`). */
  readonly startNonstopCourse: (
    course: LibraryCourse,
    options: { decide?: boolean; replay?: BeMusicCourseReplay },
  ) => Promise<void>;
  /** Tells the player which stage charts a course replay needs that are not loaded; the replay does not start. */
  readonly showMissingCourseReplayCharts: (courseName: string, stages: readonly string[]) => void;
}

/** A replay played back from a file. */
export class ReplayRoute {
  private readonly library: ReplayRouteDeps['library'];
  private readonly records: ReplayRouteDeps['records'];
  private readonly setStatus: ReplayRouteDeps['setStatus'];
  private readonly setPlayStatus: ReplayRouteDeps['setPlayStatus'];
  private readonly playChart: ReplayRouteDeps['playChart'];
  private readonly showSelect: ReplayRouteDeps['showSelect'];
  private readonly startCourseReplay: ReplayRouteDeps['startCourseReplay'];
  private readonly startNonstopCourse: ReplayRouteDeps['startNonstopCourse'];
  private readonly showMissingCourseReplayCharts: ReplayRouteDeps['showMissingCourseReplayCharts'];

  public constructor(deps: ReplayRouteDeps) {
    this.library = deps.library;
    this.records = deps.records;
    this.setStatus = deps.setStatus;
    this.setPlayStatus = deps.setPlayStatus;
    this.playChart = deps.playChart;
    this.showSelect = deps.showSelect;
    this.startCourseReplay = deps.startCourseReplay;
    this.startNonstopCourse = deps.startNonstopCourse;
    this.showMissingCourseReplayCharts = deps.showMissingCourseReplayCharts;
  }

  /**
   * Parses a dropped replay file and starts replay playback when the matching song is loaded. Matching prefers
   * the exact `chartPath` the log recorded (`play.native.chartPath`); older logs without it fall back to a
   * title + artist match. When no match (or the chart's `#RANDOM` roll differs so the resolved notes can't be
   * re-aligned), the failure lands in the status row instead of throwing — a bad drop must never wedge the UI.
   */
  public async startReplayReplayFromFile(file: BrowserDroppedFile): Promise<void> {
    if (file.name.toLowerCase().endsWith(COURSE_REPLAY_FILE_SUFFIX)) {
      await this.startCourseReplayFromFile(file);
      return;
    }
    let replay: BeMusicReplay;
    try {
      replay = parseReplay(await file.text());
    } catch (error) {
      dropLog.warn('replay parse failed', error);
      this.setStatus(`Replay: invalid replay (${(error as Error).message})`);
      return;
    }
    const chartEntry = await this.findSongForReplay(replay);
    if (!chartEntry) {
      this.setStatus(`Replay: song not loaded (${replay.chart.title ?? 'untitled'})`);
      return;
    }
    this.setPlayStatus(`Replaying: ${chartEntry.title}`);
    try {
      // A replay plays on the gameplay family's own play screen, whichever family recorded it: the play session
      // re-applies the recorded arrangement and the engine replays the inputs the same way on every family.
      await this.playChart(chartEntry, { autoPlay: replay.play.mode === 'auto', replay: replay });
    } catch (error) {
      gamereplay.warn('replay replay failed', error);
      this.setStatus(`Replay failed: ${(error as Error).message}`);
      await this.showSelect();
    }
  }

  /**
   * Parses a dropped course replay and plays it back as its course, as LR2 and beatoraja replay a course: only when every
   * stage's chart is loaded (matched by the hashes the log records), else the missing charts are listed and nothing
   * starts. The log's source does not matter here: a course replay from elsewhere (the Leaderboard) plays the same way
   * through {@link startCourseReplayFromLog}.
   */
  public async startCourseReplayFromFile(file: BrowserDroppedFile): Promise<void> {
    let courseLog: BeMusicCourseReplay;
    try {
      courseLog = parseCourseReplay(await file.text());
    } catch (error) {
      dropLog.warn('course replay parse failed', error);
      // The drop took the select screen off the stage: it comes back, with the status.
      await this.showSelect();
      this.setStatus(`Course replay: invalid course replay (${(error as Error).message})`);
      return;
    }
    await this.startCourseReplayFromLog(courseLog);
  }

  /** Plays a parsed course replay back as its course, once every stage's chart is found in the library. */
  public async startCourseReplayFromLog(courseLog: BeMusicCourseReplay): Promise<void> {
    const matched = await matchCourseReplayCharts(
      courseLog,
      this.library.collection.charts,
      async (chartEntry, needFingerprint) => {
        const hashes = await this.records.resolveChartHashes(chartEntry);
        const chartFingerprint = needFingerprint ? fingerprintOf(chartEntry) : undefined;
        return { ...hashes, ...(chartFingerprint !== undefined ? { chartFingerprint } : {}) };
      },
    );
    const missing = matched.filter((stage) => stage.chart === undefined);
    if (missing.length > 0) {
      await this.showSelect();
      this.setStatus(`Course replay: ${missing.length} of ${matched.length} stage charts are not loaded`);
      this.showMissingCourseReplayCharts(
        courseLog.course.name,
        missing.map(({ stage }) => describeCourseReplayStage(stage)),
      );
      return;
    }
    const course = courseFromReplay(
      courseLog,
      matched.map((stage) => stage.chart),
    );
    this.setPlayStatus(`Replaying course: ${course.definition.name}`);
    try {
      if (course.definition.kind === 'nonstop') {
        await this.startNonstopCourse(course, { decide: true, replay: courseLog });
        return;
      }
      await this.startCourseReplay(course, courseLog);
    } catch (error) {
      gamereplay.warn('course replay failed', error);
      await this.showSelect();
      this.setStatus(`Course replay failed: ${(error as Error).message}`);
    }
  }

  /**
   * Finds the loaded song a replay belongs to. Chart-file SHA-256 first (`chart.sha256`), then the recorded
   * `chartPath`, then a title + artist heuristic for logs recorded before either rode along.
   */
  private async findSongForReplay(replay: BeMusicReplay): Promise<LibraryChart | undefined> {
    // Content hash first — stable across sessions, machines, and file moves.
    const sha256 = replay.chart.sha256?.toLowerCase();
    if (sha256 !== undefined && sha256.length > 0) {
      for (const entry of this.library.collection.charts) {
        if ((await this.records.resolveChartSHA256(entry)) === sha256) {
          return entry;
        }
      }
    }
    const nativeChartPath = replay.play.native?.chartPath;
    if (typeof nativeChartPath === 'string' && nativeChartPath.length > 0) {
      const exact = this.library.collection.charts.find((entry) => entry.chartPath === nativeChartPath);
      if (exact) {
        return exact;
      }
    }
    const title = replay.chart.title;
    if (title === undefined || title.length === 0) {
      return undefined;
    }
    return this.library.collection.charts.find(
      (entry) => entry.title === title && (replay.chart.artist === undefined || entry.artist === replay.chart.artist),
    );
  }
}

/** A loaded chart's Be-Music chart fingerprint, for a course replay stage named by it alone. */
function fingerprintOf(chartEntry: LibraryChart): string | undefined {
  try {
    return computeChartFingerprint(chartEntry.chart, { chartPath: chartEntry.chartPath });
  } catch {
    return undefined;
  }
}
