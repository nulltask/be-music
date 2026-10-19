// The replay route: a play log dropped or picked (`*.bmplay.json`) played back on the play screen of the gameplay
// family, whichever family recorded it, once the chart it was recorded on is found in the library.

import { logger } from '@be-music/player-web';
import type { BrowserDroppedFile } from '@be-music/player-web/collection';
import { parsePlaylog, type BeMusicPlaylog } from '@be-music/player/playlog';
import type { LibraryChart } from '@be-music/scene-model';
import type { LibraryService } from '../../services/library.ts';
import type { RecordsService } from '../../services/records.ts';

const dropLog = logger('drop');
const gameplayLog = logger('gameplay');

export interface ReplayRouteDeps {
  /** The library the log's chart is looked for in. */
  readonly library: Pick<LibraryService, 'collection'>;
  /** The charts' SHA-256, which a log records. */
  readonly records: Pick<RecordsService, 'resolveChartSha256'>;
  readonly setStatus: (text: string) => void;
  /** Shows a status about the play, which the select screen replaces when it comes back. */
  readonly setPlayStatus: (text: string) => void;
  /** Plays the chart back from the log (`PlayRoute.playSong`). */
  readonly playSong: (song: LibraryChart, overrides: { autoPlay: boolean; replay: BeMusicPlaylog }) => Promise<void>;
  readonly showSelect: () => Promise<void>;
}

/** A play log played back from a file. */
export class ReplayRoute {
  private readonly library: ReplayRouteDeps['library'];
  private readonly records: ReplayRouteDeps['records'];
  private readonly setStatus: ReplayRouteDeps['setStatus'];
  private readonly setPlayStatus: ReplayRouteDeps['setPlayStatus'];
  private readonly playSong: ReplayRouteDeps['playSong'];
  private readonly showSelect: ReplayRouteDeps['showSelect'];

  public constructor(deps: ReplayRouteDeps) {
    this.library = deps.library;
    this.records = deps.records;
    this.setStatus = deps.setStatus;
    this.setPlayStatus = deps.setPlayStatus;
    this.playSong = deps.playSong;
    this.showSelect = deps.showSelect;
  }

  /**
   * Parses a dropped play-log file and starts replay playback when the matching song is loaded. Matching prefers
   * the exact `chartPath` the log recorded (`play.native.chartPath`); older logs without it fall back to a
   * title + artist match. When no match (or the chart's `#RANDOM` roll differs so the resolved notes can't be
   * re-aligned), the failure lands in the status row instead of throwing — a bad drop must never wedge the UI.
   */
  public async startPlaylogReplayFromFile(file: BrowserDroppedFile): Promise<void> {
    let playlog: BeMusicPlaylog;
    try {
      playlog = parsePlaylog(await file.text());
    } catch (error) {
      dropLog.warn('play-log parse failed', error);
      this.setStatus(`Replay: invalid play-log (${(error as Error).message})`);
      return;
    }
    const song = await this.findSongForPlaylog(playlog);
    if (!song) {
      this.setStatus(`Replay: song not loaded (${playlog.chart.title ?? 'untitled'})`);
      return;
    }
    this.setPlayStatus(`Replaying: ${song.title}`);
    try {
      // A replay plays on the gameplay family's own play screen, whichever family recorded it: the play session
      // re-applies the recorded arrangement and the engine replays the inputs the same way on every family.
      await this.playSong(song, { autoPlay: playlog.play.mode === 'auto', replay: playlog });
    } catch (error) {
      gameplayLog.warn('play-log replay failed', error);
      this.setStatus(`Replay failed: ${(error as Error).message}`);
      await this.showSelect();
    }
  }

  /**
   * Finds the loaded song a play-log belongs to. Chart-file SHA-256 first (`chart.sha256`), then the recorded
   * `chartPath`, then a title + artist heuristic for logs recorded before either rode along.
   */
  private async findSongForPlaylog(playlog: BeMusicPlaylog): Promise<LibraryChart | undefined> {
    // Content hash first — stable across sessions, machines, and file moves.
    const sha256 = playlog.chart.sha256?.toLowerCase();
    if (sha256 !== undefined && sha256.length > 0) {
      for (const entry of this.library.collection.charts) {
        if ((await this.records.resolveChartSha256(entry)) === sha256) {
          return entry;
        }
      }
    }
    const nativeChartPath = playlog.play.native?.chartPath;
    if (typeof nativeChartPath === 'string' && nativeChartPath.length > 0) {
      const exact = this.library.collection.charts.find((entry) => entry.chartPath === nativeChartPath);
      if (exact) {
        return exact;
      }
    }
    const title = playlog.chart.title;
    if (title === undefined || title.length === 0) {
      return undefined;
    }
    return this.library.collection.charts.find(
      (entry) => entry.title === title && (playlog.chart.artist === undefined || entry.artist === playlog.chart.artist),
    );
  }
}
