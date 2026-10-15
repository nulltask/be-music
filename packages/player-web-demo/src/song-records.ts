// The demo's per-chart best records, handed to be-music skins through the select scene's `resolveSongRecord`: lamp
// ordering, merging a finished play into a record, and persistence across reloads.

import type { BeMusicCoursePlaylog } from '@be-music/player/playlog';
import type { BrowserSongEntry } from '@be-music/player-web/collection';
import type { PixiGameplayResultData } from '@be-music/player-web/scenes';
import type { BeMusicClearLamp, BeMusicSongRecord } from '@be-music/player-web/skin';

const STORAGE_KEY = 'be-music-demo.song-records';
/** Bumped when the stored shape changes; a stored map with another version is ignored. */
const STORAGE_VERSION = 1;

/** Clear lamps from worst to best — a record keeps the best lamp it has seen. */
export const CLEAR_LAMP_ORDER: readonly BeMusicClearLamp[] = [
  'NO_PLAY',
  'FAILED',
  'ASSIST_EASY',
  'EASY',
  'NORMAL',
  'HARD',
  'EX_HARD',
  'FULL_COMBO',
  'PERFECT',
  'MAX',
];

/** Rank of `lamp` in {@link CLEAR_LAMP_ORDER} (higher is better); an unknown lamp ranks as `NO_PLAY`. */
export function clearLampRank(lamp: BeMusicClearLamp): number {
  return Math.max(0, CLEAR_LAMP_ORDER.indexOf(lamp));
}

/** What one finished play contributes to a record. */
export interface SongRecordPlay {
  lamp: BeMusicClearLamp;
  exScore: number;
  maxCombo: number;
  /** BAD + POOR (empty POORs excluded — they never cost a note). */
  missCount: number;
}

/** The record-relevant facts of a result. A result without a lamp falls back to its gauge verdict. */
export function songRecordPlayFromResult(data: PixiGameplayResultData): SongRecordPlay {
  return {
    lamp: data.lamp ?? (data.cleared ? 'NORMAL' : 'FAILED'),
    exScore: data.score.exScore,
    maxCombo: data.maxCombo,
    missCount: data.score.bad + data.score.poor,
  };
}

/**
 * Merges `play` into `previous`: the better lamp, the higher EX score and max combo, the lower miss count, and one more
 * play. Every best is kept independently, as LR2 and beatoraja do — the best EX score may come from a different play
 * than the best lamp.
 */
export function mergeSongRecord(previous: BeMusicSongRecord | undefined, play: SongRecordPlay): BeMusicSongRecord {
  if (previous === undefined) {
    return { lamp: play.lamp, exScore: play.exScore, maxCombo: play.maxCombo, missCount: play.missCount, playCount: 1 };
  }
  return {
    lamp: clearLampRank(play.lamp) > clearLampRank(previous.lamp) ? play.lamp : previous.lamp,
    exScore: Math.max(previous.exScore ?? 0, play.exScore),
    maxCombo: Math.max(previous.maxCombo ?? 0, play.maxCombo),
    missCount: previous.missCount === undefined ? play.missCount : Math.min(previous.missCount, play.missCount),
    playCount: (previous.playCount ?? 0) + 1,
  };
}

/**
 * The key a chart's record is stored under: its chart-file SHA-256 when known (stable across sessions, machines, and
 * file moves — the same hash the play-logs record), else its chart path inside the dropped library.
 */
/**
 * Whether a course run played a stage at another tempo (`play.tempo`): such a run is practice, so it leaves the course's
 * record alone, as a single play at another tempo leaves the chart's.
 */
export function isCourseRunAtAnotherTempo(courseLog: Pick<BeMusicCoursePlaylog, 'stages'>): boolean {
  return courseLog.stages.some((entry) => entry.played && (entry.playlog.play.tempo ?? 1) !== 1);
}

export function songRecordKey(song: Pick<BrowserSongEntry, 'chartPath'>, chartSha256: string | undefined): string {
  return chartSha256 !== undefined && chartSha256.length > 0 ? `sha256:${chartSha256}` : `path:${song.chartPath}`;
}

/**
 * Parses stored records. Entries whose lamp is unknown are dropped and malformed counts are left out, so a hand-edited
 * or stale store can't hand a skin junk; anything unreadable yields no records.
 */
export function parseSongRecords(raw: string | null | undefined): Map<string, BeMusicSongRecord> {
  const records = new Map<string, BeMusicSongRecord>();
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
    if (typeof entry !== 'object' || entry === null) continue;
    const { lamp } = entry as { lamp?: unknown };
    if (typeof lamp !== 'string' || !CLEAR_LAMP_ORDER.includes(lamp as BeMusicClearLamp)) continue;
    const record: BeMusicSongRecord = { lamp: lamp as BeMusicClearLamp };
    for (const field of ['exScore', 'maxCombo', 'missCount', 'playCount'] as const) {
      const value = (entry as Record<string, unknown>)[field];
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) record[field] = value;
    }
    records.set(key, record);
  }
  return records;
}

/** Serializes records as `{ version: 1, records: { [key]: BeMusicSongRecord } }`. */
export function serializeSongRecords(records: ReadonlyMap<string, BeMusicSongRecord>): string {
  return JSON.stringify({ version: STORAGE_VERSION, records: Object.fromEntries(records) });
}

export function readStoredSongRecords(): Map<string, BeMusicSongRecord> {
  try {
    return parseSongRecords(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return new Map();
  }
}

export function storeSongRecords(records: ReadonlyMap<string, BeMusicSongRecord>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeSongRecords(records));
  } catch {
    // Private windows / blocked or full storage: the records still hold for this session.
  }
}
