// The player's best records, handed to the select skins through `resolveChartBestRecord` / `resolveCourseBestRecord`: the keys
// they are kept under — one record per chart (or course) and judge ruleset — and their persistence across reloads. The
// rules they are kept by — merging a play, what a play contributes, which plays count — are `@be-music/player-engine/records`.

import {
  courseStageKeepsRecord,
  playKeepsRecord,
  type BestRecord,
  type RecordPlayKind,
  type RecordSlot,
} from '@be-music/player-engine/records';
import { isClearLamp, type RulesetId } from '@be-music/player-engine/ruleset';
import type { LibraryChart } from '@be-music/player-scene-model';

const STORAGE_KEY = 'be-music.chart-best-records';
/**
 * The stored map's revision. `0` while the shape is still being defined: it may change incompatibly without the number
 * moving. The current shape keys every record by its judge ruleset ({@link rulesetRecordKey}). Any other stamp is
 * unreadable.
 */
const STORAGE_VERSION = 0;

const JUDGE_RULESETS: readonly RulesetId[] = ['lr2', 'beatoraja', '____'];

/** How a play was played and judged, as far as which record it keeps goes. */
export type RecordedPlayKind = RecordPlayKind & {
  /** The judge ruleset the play ran under: it keeps that ruleset's record. */
  judgeRuleset: RulesetId;
};

/**
 * The key a record is stored under: the judge ruleset it was played under, then the chart's key ({@link chartBestRecordKey})
 * or the course's (`courseBestRecordKey`), e.g. `lr2:sha256:…`. Each ruleset has its own lamps, BP and scoring, so a chart
 * keeps one record per ruleset.
 */
export function rulesetRecordKey(ruleset: RulesetId, key: string): string {
  return `${ruleset}:${key}`;
}

/** The judge ruleset a {@link rulesetRecordKey} keeps its record under, or `undefined` for a key that names none. */
export function recordKeyRuleset(key: string): RulesetId | undefined {
  return JUDGE_RULESETS.find((ruleset) => key.startsWith(`${ruleset}:`));
}

/**
 * The key of a record slot beside a chart's ordinary record (`RecordPolicy.recordSlot`): an LR2 separate lamp (D-BATTLE,
 * SP TO DP, EXTRA MODE) as `lr2:d-battle:sha256:…`. The ordinary slot keeps the key itself.
 */
export function slotRecordKey(key: string, slot: RecordSlot): string {
  const ruleset = recordKeyRuleset(key);
  if (slot === 'main' || ruleset === undefined) return key;
  return `${ruleset}:${slot}:${key.slice(ruleset.length + 1)}`;
}

/** The records of one judge ruleset, looked up by a chart's or a course's own key (as `lookupCourseBestRecord` reads them). */
export function rulesetRecords<T>(
  records: { get(key: string): T | undefined },
  ruleset: RulesetId,
): { get(key: string): T | undefined } {
  return { get: (key) => records.get(rulesetRecordKey(ruleset, key)) };
}

/**
 * The key a play's result is recorded under — its chart's, under the judge ruleset the play ran under — or `undefined`
 * when the play leaves the records alone (`playKeepsRecord`): an auto play, a replay, a course stage (NONSTOP included —
 * the course keeps the record) and a play at another tempo (practice).
 */
export function playRecordKey(
  chartEntry: Pick<LibraryChart, 'chartPath'>,
  chartSHA256: string | undefined,
  play: RecordedPlayKind & { course: boolean },
): string | undefined {
  return playKeepsRecord(play)
    ? rulesetRecordKey(play.judgeRuleset, chartBestRecordKey(chartEntry, chartSHA256))
    : undefined;
}

/**
 * The key an EXPERT / GRADE course stage also updates its chart's record under (under the judge ruleset the stage ran
 * under), or `undefined` when it leaves the chart's record alone (`courseStageKeepsRecord`): an auto play, a replay and a
 * play at another tempo.
 */
export function courseStageRecordKey(
  chartEntry: Pick<LibraryChart, 'chartPath'>,
  chartSHA256: string | undefined,
  play: RecordedPlayKind,
): string | undefined {
  return courseStageKeepsRecord(play)
    ? rulesetRecordKey(play.judgeRuleset, chartBestRecordKey(chartEntry, chartSHA256))
    : undefined;
}

/**
 * The key a chart's record is stored under, before its judge ruleset ({@link rulesetRecordKey}): its chart-file SHA-256
 * when known (stable across sessions, machines, and file moves — the same hash the replays record), else its chart
 * path inside the dropped library.
 */
export function chartBestRecordKey(
  chartEntry: Pick<LibraryChart, 'chartPath'>,
  chartSHA256: string | undefined,
): string {
  return chartSHA256 !== undefined && chartSHA256.length > 0 ? `sha256:${chartSHA256}` : `path:${chartEntry.chartPath}`;
}

/**
 * Parses stored records, keyed by {@link rulesetRecordKey}. Entries whose lamp is unknown (or whose key names no judge
 * ruleset) are dropped and malformed counts are left out, so a hand-edited or stale store can't hand a skin junk;
 * anything unreadable yields no records.
 */
export function parseChartBestRecords(raw: string | null | undefined): Map<string, BestRecord> {
  const records = new Map<string, BestRecord>();
  if (!raw) return records;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return records;
  }
  if (typeof parsed !== 'object' || parsed === null) return records;
  const { version, records: stored } = parsed as { version?: unknown; records?: unknown };
  if (version !== STORAGE_VERSION || typeof stored !== 'object' || stored === null) return records;
  for (const [key, entry] of Object.entries(stored)) {
    if (!JUDGE_RULESETS.some((ruleset) => key.startsWith(`${ruleset}:`))) continue;
    if (typeof entry !== 'object' || entry === null) continue;
    const { lamp } = entry as { lamp?: unknown };
    if (!isClearLamp(lamp)) continue;
    const record: BestRecord = { lamp };
    for (const field of ['exScore', 'maxCombo', 'missCount', 'playCount'] as const) {
      const value = (entry as Record<string, unknown>)[field];
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) record[field] = value;
    }
    records.set(key, record);
  }
  return records;
}

/** Serializes records as `{ version: 0, records: { [rulesetRecordKey]: BestRecord } }`. */
export function serializeChartBestRecords(records: ReadonlyMap<string, BestRecord>): string {
  return JSON.stringify({ version: STORAGE_VERSION, records: Object.fromEntries(records) });
}

export function readStoredChartBestRecords(): Map<string, BestRecord> {
  try {
    return parseChartBestRecords(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return new Map();
  }
}

export function storeChartBestRecords(records: ReadonlyMap<string, BestRecord>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeChartBestRecords(records));
  } catch {
    // Private windows / blocked or full storage: the records still hold for this session.
  }
}
