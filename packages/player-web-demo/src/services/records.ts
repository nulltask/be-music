// The demo's best records and the chart hashes they are keyed by: each chart's SHA-256 and MD5, hashed once per chart,
// and the record keys of the play in flight, latched as it takes the stage. `song-records.ts` keys and stores the
// records; `@be-music/player/records` says how a play merges into them.

import {
  computeChartFileHashes,
  resolveSongSource,
  type BrowserSongCollection,
  type ChartFileHashes,
} from '@be-music/player-web/collection';
import { mergeBestRecord, mergeCourseStageRecord, type BestRecord, type RecordPlay } from '@be-music/player/records';
import type { PlaylogRulesetId } from '@be-music/player/ruleset';
import type { LibraryChart } from '@be-music/scene-model';
import type { BeMusicSongRecord } from '@be-music/skin-sdk';
import {
  readStoredSongRecords,
  rulesetRecordKey,
  rulesetRecords,
  songRecordKey,
  storeSongRecords,
} from '../song-records.ts';

export interface RecordsServiceOptions {
  /** The library the charts are hashed from: the sources their files are in. */
  readonly collection: () => BrowserSongCollection;
  /** The judge ruleset whose records the select screen shows (Debug Menu → Judge windows). */
  readonly judgeRuleset: () => PlaylogRulesetId;
}

/** The best records, kept per chart and course and judge ruleset, and the chart-file hashes they are keyed by. */
export class RecordsService {
  /** Best record per chart ({@link songRecordKey}), persisted in `localStorage` and shown to be-music select skins. */
  public readonly songRecords: Map<string, BestRecord> = readStoredSongRecords();
  /**
   * Record key of the play in flight when it counts towards the chart's best record, latched at song start. `undefined`
   * for autoplay and replay plays, which never touch the records.
   */
  public activePlayRecordKey: string | undefined;
  /**
   * Record key of the running EXPERT / GRADE course stage's chart, latched at stage start ({@link courseStageRecordKey}):
   * as LR2 does, the stage also updates that chart's best EX score, max combo, BP and FULL COMBO lamp.
   */
  public activeStageRecordKey: string | undefined;
  /** Per-entry chart-file hash cache (`null` = lookup failed) — see {@link resolveChartHashes}. */
  private readonly chartHashCache = new Map<string, ChartFileHashes | null>();
  /** In-flight {@link resolveChartHashes} lookups, so a chart is hashed once however often it is asked for. */
  private readonly chartHashPending = new Map<string, Promise<ChartFileHashes | undefined>>();
  private readonly collection: () => BrowserSongCollection;
  private readonly judgeRuleset: () => PlaylogRulesetId;

  public constructor(options: RecordsServiceOptions) {
    this.collection = options.collection;
    this.judgeRuleset = options.judgeRuleset;
  }

  /**
   * SHA-256 and MD5 (lowercase hex) of a song's source chart file, cached per entry id — the hashes feed the play-log
   * recording (`chart.sha256` / `chart.md5`) and dropped-log matching, and chart files are small enough that hashing
   * the whole library on a dropped log stays cheap.
   */
  public async resolveChartHashes(song: LibraryChart): Promise<ChartFileHashes | undefined> {
    const cached = this.chartHashCache.get(song.id);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    const pending = this.chartHashPending.get(song.id);
    if (pending !== undefined) {
      return pending;
    }
    const lookup = computeChartFileHashes(resolveSongSource(this.collection(), song), song.chartPath)
      .catch(() => undefined)
      .then((hashes) => {
        this.chartHashCache.set(song.id, hashes ?? null);
        return hashes;
      })
      .finally(() => this.chartHashPending.delete(song.id));
    this.chartHashPending.set(song.id, lookup);
    return lookup;
  }

  /** The SHA-256 half of {@link resolveChartHashes}. */
  public async resolveChartSHA256(song: LibraryChart): Promise<string | undefined> {
    return (await this.resolveChartHashes(song))?.sha256;
  }

  /**
   * A chart's best record for the select skin's `frame.songRecord`. Records are keyed by chart hash, which is only known
   * once the chart has been hashed: the first lookup starts hashing it and answers from the path key meanwhile (where a
   * chart that could not be hashed keeps its record), so a skin sees the record a frame or two later.
   */
  public lookupSongRecord(song: LibraryChart): BeMusicSongRecord | undefined {
    if (this.songRecords.size === 0) {
      return undefined;
    }
    if (!this.chartHashCache.has(song.id)) {
      void this.resolveChartHashes(song);
    }
    return this.peekSongRecord(song);
  }

  /**
   * A chart's best record as far as its hash is known already, without hashing it: by its hash once the chart has been
   * hashed (by {@link lookupSongRecord} or {@link resolveChartHashes}), by its path before. For readers that must start
   * nothing, such as the test hook.
   */
  public peekSongRecord(song: LibraryChart): BeMusicSongRecord | undefined {
    if (this.songRecords.size === 0) {
      return undefined;
    }
    const hashes = this.chartHashCache.get(song.id);
    return this.songRecords.get(rulesetRecordKey(this.judgeRuleset(), songRecordKey(song, hashes?.sha256)));
  }

  /** The best records of the current judge ruleset, by chart or course key: the ones the select screen shows. */
  public currentRulesetRecords(): { get(key: string): BeMusicSongRecord | undefined } {
    return rulesetRecords(this.songRecords, this.judgeRuleset());
  }

  /** Records the running play's result under its chart, when the play counts ({@link playRecordKey}). */
  public recordActivePlay(play: RecordPlay): void {
    if (this.activePlayRecordKey === undefined) return;
    this.recordSongResult(this.activePlayRecordKey, play);
    this.activePlayRecordKey = undefined;
  }

  /** Folds the running course stage into its chart's record ({@link mergeCourseStageRecord}), when the stage counts. */
  public recordActiveCourseStage(play: RecordPlay): void {
    const key = this.activeStageRecordKey;
    this.activeStageRecordKey = undefined;
    if (key === undefined) return;
    this.songRecords.set(key, mergeCourseStageRecord(this.songRecords.get(key), play));
    storeSongRecords(this.songRecords);
  }

  /** Folds a finished play into its chart's best record and persists the records. */
  private recordSongResult(key: string, play: RecordPlay): void {
    this.songRecords.set(key, mergeBestRecord(this.songRecords.get(key), play));
    storeSongRecords(this.songRecords);
  }

  /**
   * Keeps a course run's best lamp, EX score, course max combo and BP under the course's key, when the run keeps a
   * record ({@link resolveCourseRecordUpdate}).
   */
  public recordCourseResult(update: { key: string; play: RecordPlay } | undefined): void {
    if (update === undefined) return;
    this.songRecords.set(update.key, mergeBestRecord(this.songRecords.get(update.key), update.play));
    storeSongRecords(this.songRecords);
  }
}
