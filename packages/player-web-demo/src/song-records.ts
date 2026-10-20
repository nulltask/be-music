// The demo's best records, handed to the select skins through `resolveSongRecord` / `resolveCourseRecord`: the keys
// they are kept under — one record per chart (or course) and judge ruleset — and their persistence across reloads. The
// rules they are kept by — merging a play, what a play contributes, which plays count — are `@be-music/player/records`.

import {
  courseStageKeepsRecord,
  playKeepsRecord,
  type BestRecord,
  type RecordPlayKind,
} from '@be-music/player/records';
import { isClearLamp, type ClearLamp, type PlaylogRulesetId } from '@be-music/player/ruleset';
import type { LibraryChart } from '@be-music/scene-model';

const STORAGE_KEY = 'be-music-demo.song-records';
/**
 * Bumped when the stored shape changes; a stored map with an unknown version is ignored. Version 3 keys every record by
 * its judge ruleset ({@link rulesetRecordKey}). Versions 1 and 2 kept one record per chart whatever the ruleset; they
 * are read as LR2 records, the demo's default ruleset, and version 1 lamps (kept before the LR2 ruleset's lamps followed
 * LR2) through {@link toLR2RecordLamp}.
 */
const STORAGE_VERSION = 3;

const JUDGE_RULESETS: readonly PlaylogRulesetId[] = ['lr2', 'beatoraja', 'iidx'];

/** How a play was played and judged, as far as which record it keeps goes. */
export type RecordedPlayKind = RecordPlayKind & {
  /** The judge ruleset the play ran under: it keeps that ruleset's record. */
  judgeRuleset: PlaylogRulesetId;
};

/**
 * The key a record is stored under: the judge ruleset it was played under, then the chart's key ({@link songRecordKey})
 * or the course's (`courseRecordKey`), e.g. `lr2:sha256:…`. Each ruleset has its own lamps, BP and scoring, so a chart
 * keeps one record per ruleset.
 */
export function rulesetRecordKey(ruleset: PlaylogRulesetId, key: string): string {
  return `${ruleset}:${key}`;
}

/** The records of one judge ruleset, looked up by a chart's or a course's own key (as `lookupCourseRecord` reads them). */
export function rulesetRecords<T>(
  records: { get(key: string): T | undefined },
  ruleset: PlaylogRulesetId,
): { get(key: string): T | undefined } {
  return { get: (key) => records.get(rulesetRecordKey(ruleset, key)) };
}

/**
 * The key a play's result is recorded under — its chart's, under the judge ruleset the play ran under — or `undefined`
 * when the play leaves the records alone (`playKeepsRecord`): an auto play, a replay, a course stage (NONSTOP included —
 * the course keeps the record) and a play at another tempo (practice).
 */
export function playRecordKey(
  song: Pick<LibraryChart, 'chartPath'>,
  chartSHA256: string | undefined,
  play: RecordedPlayKind & { course: boolean },
): string | undefined {
  return playKeepsRecord(play) ? rulesetRecordKey(play.judgeRuleset, songRecordKey(song, chartSHA256)) : undefined;
}

/**
 * The key an EXPERT / GRADE course stage also updates its chart's record under (under the judge ruleset the stage ran
 * under), or `undefined` when it leaves the chart's record alone (`courseStageKeepsRecord`): an auto play, a replay and a
 * play at another tempo.
 */
export function courseStageRecordKey(
  song: Pick<LibraryChart, 'chartPath'>,
  chartSHA256: string | undefined,
  play: RecordedPlayKind,
): string | undefined {
  return courseStageKeepsRecord(play)
    ? rulesetRecordKey(play.judgeRuleset, songRecordKey(song, chartSHA256))
    : undefined;
}

/**
 * The key a chart's record is stored under, before its judge ruleset ({@link rulesetRecordKey}): its chart-file SHA-256
 * when known (stable across sessions, machines, and file moves — the same hash the play logs record), else its chart
 * path inside the dropped library.
 */
export function songRecordKey(song: Pick<LibraryChart, 'chartPath'>, chartSHA256: string | undefined): string {
  return chartSHA256 !== undefined && chartSHA256.length > 0 ? `sha256:${chartSHA256}` : `path:${song.chartPath}`;
}

/**
 * Parses stored records, keyed by {@link rulesetRecordKey}. Entries whose lamp is unknown (or whose key names no judge
 * ruleset) are dropped and malformed counts are left out, so a hand-edited or stale store can't hand a skin junk;
 * anything unreadable yields no records. Records of versions 1 and 2 are read as LR2 records.
 */
export function parseSongRecords(raw: string | null | undefined): Map<string, BestRecord> {
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
  if (
    (version !== STORAGE_VERSION && version !== 2 && version !== 1) ||
    typeof stored !== 'object' ||
    stored === null
  ) {
    return records;
  }
  // Versions 1 and 2 kept one record per chart whatever the ruleset; the demo plays on LR2's ruleset by default, so they
  // are read as LR2 records. Version 1 lamps also predate LR2's lamp rules.
  const readKey = version === STORAGE_VERSION ? (key: string) => key : (key: string) => rulesetRecordKey('lr2', key);
  const readLamp = version === 1 ? toLR2RecordLamp : (lamp: ClearLamp) => lamp;
  for (const [storedKey, entry] of Object.entries(stored)) {
    const key = readKey(storedKey);
    if (!JUDGE_RULESETS.some((ruleset) => key.startsWith(`${ruleset}:`))) continue;
    if (typeof entry !== 'object' || entry === null) continue;
    const { lamp } = entry as { lamp?: unknown };
    if (!isClearLamp(lamp)) continue;
    const record: BestRecord = { lamp: readLamp(lamp) };
    for (const field of ['exScore', 'maxCombo', 'missCount', 'playCount'] as const) {
      const value = (entry as Record<string, unknown>)[field];
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) record[field] = value;
    }
    records.set(key, record);
  }
  return records;
}

/**
 * A record lamp kept before LR2's lamp rules, as LR2 awards it: LR2 has no PERFECT or MAX lamp (FULL COMBO is its top),
 * and under its ruleset an EX HARD lamp could only come from a DEATH clear, which LR2 lamps NORMAL. Other lamps stay.
 */
export function toLR2RecordLamp(lamp: ClearLamp): ClearLamp {
  if (lamp === 'PERFECT' || lamp === 'MAX') return 'FULL_COMBO';
  if (lamp === 'EX_HARD') return 'NORMAL';
  return lamp;
}

/** Serializes records as `{ version: 3, records: { [rulesetRecordKey]: BestRecord } }`. */
export function serializeSongRecords(records: ReadonlyMap<string, BestRecord>): string {
  return JSON.stringify({ version: STORAGE_VERSION, records: Object.fromEntries(records) });
}

export function readStoredSongRecords(): Map<string, BestRecord> {
  try {
    return parseSongRecords(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return new Map();
  }
}

export function storeSongRecords(records: ReadonlyMap<string, BestRecord>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeSongRecords(records));
  } catch {
    // Private windows / blocked or full storage: the records still hold for this session.
  }
}
