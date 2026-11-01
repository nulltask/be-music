// The player's dan rank per key mode and judge ruleset: the keys the ranks are kept under and their persistence across
// reloads. The rules — which course clear earns which rank, which rank wins — are `@be-music/player-engine/records`.

import { isDanRank, type DanRankRecord } from '@be-music/player-engine/records';
import type { RulesetId } from '@be-music/player-engine/ruleset';

export const DAN_RANK_STORAGE_KEY = 'be-music.dan-ranks';
/**
 * The stored map's revision. `0` while the shape is still being defined. Older data has no such entry at all, which
 * reads as no rank in any key mode.
 */
const STORAGE_VERSION = 0;

const JUDGE_RULESETS: readonly RulesetId[] = ['lr2', 'beatoraja', '____'];

/**
 * The key a dan rank is kept under: the judge ruleset the course was played under, then the key mode, e.g. `lr2:7`.
 * LR2 keeps one dan per key mode (its `player` table's `grade_7`, `grade_5`, `grade_14`, `grade_10`, `grade_9`), and
 * be-music keeps best records per judge ruleset, so a rank is kept per both.
 */
export function danRankRecordKey(ruleset: RulesetId, keyMode: number): string {
  return `${ruleset}:${keyMode}`;
}

/**
 * Parses stored dan ranks, keyed by {@link danRankRecordKey}. Entries whose key names no judge ruleset and key mode, or
 * whose rank is unknown, are dropped; anything unreadable (and storage from before dan ranks were kept) yields none.
 */
export function parseDanRankRecords(raw: string | null | undefined): Map<string, DanRankRecord> {
  const records = new Map<string, DanRankRecord>();
  if (!raw) return records;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return records;
  }
  if (typeof parsed !== 'object' || parsed === null) return records;
  const { version, ranks } = parsed as { version?: unknown; ranks?: unknown };
  if (version !== STORAGE_VERSION || typeof ranks !== 'object' || ranks === null) return records;
  for (const [key, entry] of Object.entries(ranks)) {
    const [ruleset, keyMode, ...rest] = key.split(':');
    if (rest.length > 0 || !JUDGE_RULESETS.includes(ruleset as RulesetId) || !/^[1-9][0-9]*$/u.test(keyMode ?? '')) {
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const { rank, course } = entry as { rank?: unknown; course?: unknown };
    if (!isDanRank(rank)) continue;
    records.set(key, { rank, course: typeof course === 'string' ? course : '' });
  }
  return records;
}

/** Serializes dan ranks as `{ version: 0, ranks: { [danRankRecordKey]: DanRankRecord } }`. */
export function serializeDanRankRecords(records: ReadonlyMap<string, DanRankRecord>): string {
  return JSON.stringify({ version: STORAGE_VERSION, ranks: Object.fromEntries(records) });
}

export function readStoredDanRankRecords(): Map<string, DanRankRecord> {
  try {
    return parseDanRankRecords(window.localStorage.getItem(DAN_RANK_STORAGE_KEY));
  } catch {
    return new Map();
  }
}

export function storeDanRankRecords(records: ReadonlyMap<string, DanRankRecord>): void {
  try {
    window.localStorage.setItem(DAN_RANK_STORAGE_KEY, serializeDanRankRecords(records));
  } catch {
    // Private windows / blocked or full storage: the ranks still hold for this session.
  }
}
