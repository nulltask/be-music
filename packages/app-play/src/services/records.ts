// The player's best records and the chart hashes they are keyed by: each chart's SHA-256 and MD5, hashed once per chart,
// and the record keys of the play in flight, latched as it takes the stage. `chart-best-records.ts` keys and stores the
// records; `@be-music/player-engine/records` says how a play merges into them.

import {
  computeChartFileHashes,
  resolveChartSource,
  type BrowserChartCollection,
  type ChartFileHashes,
} from '@be-music/player-browser/collection';
import {
  mergeBestRecord,
  mergeCourseStageRecord,
  type BestRecord,
  type DanRank,
  type RecordPlay,
} from '@be-music/player-engine/records';
import type { RulesetId } from '@be-music/player-engine/ruleset';
import type { LibraryChart } from '@be-music/player-scene-model';
import type { BeMusicChartBestRecord, BeMusicDanRank } from '@be-music/player-skin-sdk';
import {
  readStoredChartBestRecords,
  rulesetRecordKey,
  rulesetRecords,
  chartBestRecordKey,
  storeChartBestRecords,
} from '../chart-best-records.ts';
import { listDanRanks, mergeDanRank, readStoredDanRanks, storeDanRanks } from '../dan-ranks.ts';

export interface RecordsServiceOptions {
  /** The library the charts are hashed from: the sources their files are in. */
  readonly collection: () => BrowserChartCollection;
  /** The judge ruleset whose records the select screen shows (Debug Menu → Judgment windows). */
  readonly judgeRuleset: () => RulesetId;
}

/** The best records, kept per chart and course and judge ruleset, and the chart-file hashes they are keyed by. */
export class RecordsService {
  /** Best record per chart ({@link chartBestRecordKey}), persisted in `localStorage` and shown to be-music select skins. */
  public readonly chartBestRecords: Map<string, BestRecord> = readStoredChartBestRecords();
  /** The highest dan cleared per judge ruleset and key mode (`danRankKey`), persisted in `localStorage`. */
  public readonly danRanks: Map<string, DanRank> = readStoredDanRanks();
  /** {@link currentDanRanks}'s answer, kept until a rank changes or the judge ruleset does. */
  private danRankList: { ruleset: RulesetId; list: readonly BeMusicDanRank[] } | undefined;
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
  private readonly collection: () => BrowserChartCollection;
  private readonly judgeRuleset: () => RulesetId;

  public constructor(options: RecordsServiceOptions) {
    this.collection = options.collection;
    this.judgeRuleset = options.judgeRuleset;
  }

  /**
   * SHA-256 and MD5 (lowercase hex) of a song's source chart file, cached per entry id — the hashes feed the replay
   * recording (`chart.sha256` / `chart.md5`) and dropped-log matching, and chart files are small enough that hashing
   * the whole library on a dropped log stays cheap.
   */
  public async resolveChartHashes(chartEntry: LibraryChart): Promise<ChartFileHashes | undefined> {
    const cached = this.chartHashCache.get(chartEntry.id);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    const pending = this.chartHashPending.get(chartEntry.id);
    if (pending !== undefined) {
      return pending;
    }
    const lookup = computeChartFileHashes(resolveChartSource(this.collection(), chartEntry), chartEntry.chartPath)
      .catch(() => undefined)
      .then((hashes) => {
        this.chartHashCache.set(chartEntry.id, hashes ?? null);
        return hashes;
      })
      .finally(() => this.chartHashPending.delete(chartEntry.id));
    this.chartHashPending.set(chartEntry.id, lookup);
    return lookup;
  }

  /** The SHA-256 half of {@link resolveChartHashes}. */
  public async resolveChartSHA256(chartEntry: LibraryChart): Promise<string | undefined> {
    return (await this.resolveChartHashes(chartEntry))?.sha256;
  }

  /**
   * A chart's best record for the select skin's `frame.chartBestRecord`. Records are keyed by chart hash, which is only known
   * once the chart has been hashed: the first lookup starts hashing it and answers from the path key meanwhile (where a
   * chart that could not be hashed keeps its record), so a skin sees the record a frame or two later.
   */
  public lookupChartBestRecord(chartEntry: LibraryChart): BeMusicChartBestRecord | undefined {
    if (this.chartBestRecords.size === 0) {
      return undefined;
    }
    if (!this.chartHashCache.has(chartEntry.id)) {
      void this.resolveChartHashes(chartEntry);
    }
    return this.peekChartBestRecord(chartEntry);
  }

  /**
   * A chart's best record as far as its hash is known already, without hashing it: by its hash once the chart has been
   * hashed (by {@link lookupChartBestRecord} or {@link resolveChartHashes}), by its path before. For readers that must start
   * nothing, such as the test hook.
   */
  public peekChartBestRecord(chartEntry: LibraryChart): BeMusicChartBestRecord | undefined {
    if (this.chartBestRecords.size === 0) {
      return undefined;
    }
    const hashes = this.chartHashCache.get(chartEntry.id);
    return this.chartBestRecords.get(
      rulesetRecordKey(this.judgeRuleset(), chartBestRecordKey(chartEntry, hashes?.sha256)),
    );
  }

  /** The best records of the current judge ruleset, by chart or course key: the ones the select screen shows. */
  public currentRulesetRecords(): { get(key: string): BeMusicChartBestRecord | undefined } {
    return rulesetRecords(this.chartBestRecords, this.judgeRuleset());
  }

  /**
   * Records the running play's result under its chart, when the play counts ({@link playRecordKey}). Returns the record
   * as it was before the play (`previous`, absent for a first play), or `undefined` when the play did not count.
   */
  public recordActivePlay(play: RecordPlay): { previous: BestRecord | undefined } | undefined {
    const key = this.activePlayRecordKey;
    if (key === undefined) return undefined;
    const previous = this.chartBestRecords.get(key);
    this.recordSongResult(key, play);
    this.activePlayRecordKey = undefined;
    return { previous };
  }

  /** Folds the running course stage into its chart's record ({@link mergeCourseStageRecord}), when the stage counts. */
  public recordActiveCourseStage(play: RecordPlay): void {
    const key = this.activeStageRecordKey;
    this.activeStageRecordKey = undefined;
    if (key === undefined) return;
    this.chartBestRecords.set(key, mergeCourseStageRecord(this.chartBestRecords.get(key), play));
    storeChartBestRecords(this.chartBestRecords);
  }

  /** Folds a finished play into its chart's best record and persists the records. */
  private recordSongResult(key: string, play: RecordPlay): void {
    this.chartBestRecords.set(key, mergeBestRecord(this.chartBestRecords.get(key), play));
    storeChartBestRecords(this.chartBestRecords);
  }

  /**
   * Keeps a course run's best lamp, EX score, course max combo and BP under the course's key, when the run keeps a
   * record ({@link resolveCourseBestRecordUpdate}). Returns the record as it was before the run, or `undefined` when
   * the run kept none.
   */
  public recordCourseResult(
    update: { key: string; play: RecordPlay } | undefined,
  ): { previous: BestRecord | undefined } | undefined {
    if (update === undefined) return undefined;
    const previous = this.chartBestRecords.get(update.key);
    this.chartBestRecords.set(update.key, mergeBestRecord(previous, update.play));
    storeChartBestRecords(this.chartBestRecords);
    return { previous };
  }

  /**
   * Keeps the dan rank a GRADE course run certified (`resolveDanRankUpdate`), when it is higher than the one held in its
   * key mode. Returns the rank as it was before, or `undefined` when the run certified none.
   */
  public recordDanRank(
    update: { key: string; rank: DanRank } | undefined,
  ): { previous: DanRank | undefined } | undefined {
    if (update === undefined) return undefined;
    const kept = mergeDanRank(this.danRanks, update);
    this.danRankList = undefined;
    storeDanRanks(this.danRanks);
    return kept;
  }

  /** The dan ranks of the current judge ruleset, by key mode: the ones the select screen shows. */
  public currentDanRanks(): readonly BeMusicDanRank[] {
    const ruleset = this.judgeRuleset();
    if (this.danRankList?.ruleset !== ruleset) {
      this.danRankList = { ruleset, list: listDanRanks(this.danRanks, ruleset) };
    }
    return this.danRankList.list;
  }
}
