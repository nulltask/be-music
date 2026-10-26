// The replay route: a replay dropped or picked (`*.bmplay.json`), or kept in a replay slot, played back on the play
// screen of the gameplay family, whichever family recorded it, once the chart it was recorded on is found in the
// library.

import { logger } from '@be-music/player-browser';
import type { BrowserDroppedFile } from '@be-music/player-browser/collection';
import { parseReplay, type BeMusicCourseReplay, type BeMusicReplay } from '@be-music/player-engine/replay';
import type { LibraryChart, LibraryCourse, LibraryEntry } from '@be-music/player-scene-model';
import type { ReplaySlotService } from '../../services/replay-slot-service.ts';
import type { LibraryService } from '../../services/library.ts';
import type { RecordsService } from '../../services/records.ts';

const dropLog = logger('drop');
const gamereplay = logger('gameplay');

export interface ReplayRouteDeps {
  /** The library the log's chart is looked for in. */
  readonly library: Pick<LibraryService, 'collection'>;
  /** The charts' SHA-256, which a log records. */
  readonly records: Pick<RecordsService, 'resolveChartSHA256'>;
  readonly setStatus: (text: string) => void;
  /** Shows a status about the play, which the select screen replaces when it comes back. */
  readonly setPlayStatus: (text: string) => void;
  /** Plays the chart back from the log (`PlayRoute.playChart`). */
  readonly playChart: (
    chartEntry: LibraryChart,
    overrides: { autoPlay: boolean; replay: BeMusicReplay },
  ) => Promise<void>;
  readonly showSelect: () => Promise<void>;
  /** The replay slots a replay is played from. */
  readonly replaySlots: Pick<ReplaySlotService, 'store' | 'targetOf'>;
  /**
   * Plays a course run back from its course replay, on the course's charts. Without it a course's replay slots can be
   * saved into and listed but not played.
   */
  readonly playCourseReplay?: (course: LibraryCourse, courseLog: BeMusicCourseReplay) => Promise<void>;
}

/** A replay played back from a file. */
export class ReplayRoute {
  private readonly library: ReplayRouteDeps['library'];
  private readonly records: ReplayRouteDeps['records'];
  private readonly setStatus: ReplayRouteDeps['setStatus'];
  private readonly setPlayStatus: ReplayRouteDeps['setPlayStatus'];
  private readonly playChart: ReplayRouteDeps['playChart'];
  private readonly showSelect: ReplayRouteDeps['showSelect'];
  private readonly replaySlots: ReplayRouteDeps['replaySlots'];
  private readonly playCourseReplay: ReplayRouteDeps['playCourseReplay'];

  public constructor(deps: ReplayRouteDeps) {
    this.replaySlots = deps.replaySlots;
    this.playCourseReplay = deps.playCourseReplay;
    this.library = deps.library;
    this.records = deps.records;
    this.setStatus = deps.setStatus;
    this.setPlayStatus = deps.setPlayStatus;
    this.playChart = deps.playChart;
    this.showSelect = deps.showSelect;
  }

  /**
   * Parses a dropped replay file and starts replay playback when the matching song is loaded. Matching prefers
   * the exact `chartPath` the log recorded (`play.native.chartPath`); older logs without it fall back to a
   * title + artist match. When no match (or the chart's `#RANDOM` roll differs so the resolved notes can't be
   * re-aligned), the failure lands in the status row instead of throwing — a bad drop must never wedge the UI.
   */
  public async startReplayReplayFromFile(file: BrowserDroppedFile): Promise<void> {
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
   * Plays the replay kept in `slot` of a chart or course bar (the select screen's REPLAY), as a dropped replay plays:
   * no record is kept and nothing is ranked. Returns whether a play starts, so the select screen plays the decide sound
   * only then; a slot that cannot be read says why on the status line.
   */
  public startReplayFromSlot(entry: Exclude<LibraryEntry, { kind: 'folder' }>, slot: number): boolean {
    const target = this.replaySlots.targetOf(entry);
    if (target === undefined || this.replaySlots.store.exists(target)[slot] !== true) return false;
    if (entry.kind === 'course' && this.playCourseReplay === undefined) {
      this.setStatus('Course replays cannot be played back yet');
      return false;
    }
    void (async () => {
      let payload;
      try {
        payload = await this.replaySlots.store.read(target, slot);
      } catch (error) {
        gamereplay.warn('replay slot read failed', error);
      }
      if (payload === undefined) {
        this.setStatus(`Replay slot ${slot + 1} could not be read`);
        await this.showSelect();
        return;
      }
      try {
        if (payload.kind === 'chart' && entry.kind === 'chart') {
          this.setPlayStatus(`Replaying slot ${slot + 1}: ${entry.chart.title}`);
          await this.playChart(entry.chart, { autoPlay: payload.replay.play.mode === 'auto', replay: payload.replay });
        } else if (payload.kind === 'course' && entry.kind === 'course') {
          this.setPlayStatus(`Replaying slot ${slot + 1}: ${entry.course.definition.name}`);
          await this.playCourseReplay?.(entry.course, payload.replay);
        }
      } catch (error) {
        gamereplay.warn('replay slot replay failed', error);
        this.setStatus(`Replay failed: ${(error as Error).message}`);
        await this.showSelect();
      }
    })();
    return true;
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
