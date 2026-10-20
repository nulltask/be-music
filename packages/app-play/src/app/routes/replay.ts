// The replay route: a replay dropped or picked (`*.bmplay.json`) played back on the play screen of the gameplay
// family, whichever family recorded it, once the chart it was recorded on is found in the library.

import { logger } from '@be-music/player-browser';
import type { BrowserDroppedFile } from '@be-music/player-browser/collection';
import { parseReplay, type BeMusicReplay } from '@be-music/player-engine/replay';
import type { LibraryChart } from '@be-music/player-scene-model';
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
}

/** A replay played back from a file. */
export class ReplayRoute {
  private readonly library: ReplayRouteDeps['library'];
  private readonly records: ReplayRouteDeps['records'];
  private readonly setStatus: ReplayRouteDeps['setStatus'];
  private readonly setPlayStatus: ReplayRouteDeps['setPlayStatus'];
  private readonly playChart: ReplayRouteDeps['playChart'];
  private readonly showSelect: ReplayRouteDeps['showSelect'];

  public constructor(deps: ReplayRouteDeps) {
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
