// The demo's best records, handed to the select skins through `resolveSongRecord` / `resolveCourseRecord`: the keys
// they are kept under and their persistence across reloads. The rules they are kept by — merging a play, what a play
// contributes, which plays count — are `@be-music/player/records`.

import {
  courseStageKeepsRecord,
  playKeepsRecord,
  type BestRecord,
  type RecordPlayKind,
} from '@be-music/player/records';
import { isClearLamp, type ClearLamp } from '@be-music/player/ruleset';
import type { BrowserSongEntry } from '@be-music/player-web/collection';

const STORAGE_KEY = 'be-music-demo.song-records';
/**
 * Bumped when the stored shape changes; a stored map with an unknown version is ignored. Version 1 records were kept
 * before the LR2 ruleset's lamps followed LR2, and are read through {@link toLr2RecordLamp}.
 */
const STORAGE_VERSION = 2;

/**
 * The key a play's result is recorded under, or `undefined` when the play leaves the records alone
 * (`playKeepsRecord`): an auto play, a replay, a course stage (NONSTOP included — the course keeps the record) and a
 * play at another tempo (practice).
 */
export function playRecordKey(
  song: Pick<BrowserSongEntry, 'chartPath'>,
  chartSha256: string | undefined,
  play: RecordPlayKind & { course: boolean },
): string | undefined {
  return playKeepsRecord(play) ? songRecordKey(song, chartSha256) : undefined;
}

/**
 * The key an EXPERT / GRADE course stage also updates its chart's record under, or `undefined` when it leaves the
 * chart's record alone (`courseStageKeepsRecord`): an auto play, a replay and a play at another tempo.
 */
export function courseStageRecordKey(
  song: Pick<BrowserSongEntry, 'chartPath'>,
  chartSha256: string | undefined,
  play: RecordPlayKind,
): string | undefined {
  return courseStageKeepsRecord(play) ? songRecordKey(song, chartSha256) : undefined;
}

/**
 * The key a chart's record is stored under: its chart-file SHA-256 when known (stable across sessions, machines, and
 * file moves — the same hash the play-logs record), else its chart path inside the dropped library.
 */
export function songRecordKey(song: Pick<BrowserSongEntry, 'chartPath'>, chartSha256: string | undefined): string {
  return chartSha256 !== undefined && chartSha256.length > 0 ? `sha256:${chartSha256}` : `path:${song.chartPath}`;
}

/**
 * Parses stored records. Entries whose lamp is unknown are dropped and malformed counts are left out, so a hand-edited
 * or stale store can't hand a skin junk; anything unreadable yields no records.
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
  if ((version !== STORAGE_VERSION && version !== 1) || typeof stored !== 'object' || stored === null) return records;
  // Version 1 lamps predate LR2's lamp rules; the demo plays on LR2's ruleset by default, so they are read as LR2 plays.
  const readLamp = version === 1 ? toLr2RecordLamp : (lamp: ClearLamp) => lamp;
  for (const [key, entry] of Object.entries(stored)) {
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
export function toLr2RecordLamp(lamp: ClearLamp): ClearLamp {
  if (lamp === 'PERFECT' || lamp === 'MAX') return 'FULL_COMBO';
  if (lamp === 'EX_HARD') return 'NORMAL';
  return lamp;
}

/** Serializes records as `{ version: 2, records: { [key]: BestRecord } }`. */
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
