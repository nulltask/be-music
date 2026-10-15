// The demo's per-chart best records, handed to be-music skins through the select scene's `resolveSongRecord`: lamp
// ordering, merging a finished play into a record, and persistence across reloads.

import type { PlayerSummary } from '@be-music/player/core/engine';
import { playedAtAnotherTempo, type BeMusicCoursePlaylog } from '@be-music/player/playlog';
import type { BrowserSongEntry } from '@be-music/player-web/collection';
import { resolveClearLamp, type PixiGameplayResultData } from '@be-music/player-web/scenes';
import type { BeMusicClearLamp, BeMusicSongRecord } from '@be-music/player-web/skin';

const STORAGE_KEY = 'be-music-demo.song-records';
/**
 * Bumped when the stored shape changes; a stored map with an unknown version is ignored. Version 1 records were kept
 * before the LR2 ruleset's lamps followed LR2, and are read through {@link toLr2RecordLamp}.
 */
const STORAGE_VERSION = 2;

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
  /** BP: BAD + POOR + empty POOR, as LR2 (`LR2body.exe` adds an empty POOR to its POOR count), beatoraja and the Leaderboard count it. */
  missCount: number;
}

/** The record-relevant facts of a result. A result without a lamp falls back to its gauge verdict. */
export function songRecordPlayFromResult(data: PixiGameplayResultData): SongRecordPlay {
  return {
    lamp: data.lamp ?? (data.cleared ? 'NORMAL' : 'FAILED'),
    exScore: data.score.exScore,
    maxCombo: data.maxCombo,
    missCount: data.score.bad + data.score.poor + data.score.emptyPoor,
  };
}

/**
 * The record-relevant facts of a play's final engine summary, for a family whose gameplay hands the host no result data
 * (beatoraja): the lamp comes from the same `resolveClearLamp` rule the LR2 / default result uses.
 */
export function songRecordPlayFromSummary(
  summary: Pick<
    PlayerSummary,
    'total' | 'perfect' | 'great' | 'good' | 'bad' | 'poor' | 'emptyPoor' | 'exScore' | 'gauge'
  >,
  maxCombo: number,
  ruleset?: 'lr2' | 'beatoraja' | 'iidx',
): SongRecordPlay {
  const cleared = summary.gauge?.cleared ?? false;
  return {
    lamp: resolveClearLamp({
      cleared,
      score: summary,
      gaugeType: summary.gauge?.type,
      ...(ruleset ? { ruleset } : {}),
    }),
    exScore: summary.exScore,
    maxCombo,
    missCount: summary.bad + summary.poor + summary.emptyPoor,
  };
}

/**
 * The key a play's result is recorded under, or `undefined` when the play leaves the records alone: an auto play, a
 * replay, a course stage (NONSTOP included — the course keeps the record) and a play at another tempo (practice). The
 * same rule holds whichever skin family plays the chart.
 */
export function playRecordKey(
  song: Pick<BrowserSongEntry, 'chartPath'>,
  chartSha256: string | undefined,
  play: { autoPlay: boolean; replay: boolean; course: boolean; tempo: number },
): string | undefined {
  if (play.autoPlay || play.replay || play.course || play.tempo !== 1) return undefined;
  return songRecordKey(song, chartSha256);
}

/**
 * The key an EXPERT / GRADE course stage also updates its chart's record under, or `undefined` when it leaves the
 * chart's record alone: an auto play, a replay and a play at another tempo, as for a single play
 * ({@link playRecordKey}). A NONSTOP run's stitched play has no stage chart to record.
 */
export function courseStageRecordKey(
  song: Pick<BrowserSongEntry, 'chartPath'>,
  chartSha256: string | undefined,
  play: { autoPlay: boolean; replay: boolean; tempo: number },
): string | undefined {
  return playRecordKey(song, chartSha256, { ...play, course: false });
}

/** The lamps from FULL COMBO up: the only ones a course stage writes into its chart's record. */
const FULL_COMBO_LAMPS: ReadonlySet<BeMusicClearLamp> = new Set(['FULL_COMBO', 'PERFECT', 'MAX']);

/**
 * Merges a course stage's play into its chart's record, as LR2 keeps an EXPERT / GRADE stage (OpenLR2 L9043-L9192):
 * the higher EX score and max combo and the lower BP count, and the FULL COMBO lamp (PERFECT and MAX too) when the stage
 * earned one, but neither the clear lamp nor the play count. A chart without a record gets one at `NO_PLAY` (or the
 * full-combo lamp) without a play count.
 */
export function mergeCourseStageRecord(
  previous: BeMusicSongRecord | undefined,
  play: SongRecordPlay,
): BeMusicSongRecord {
  const lamp = previous?.lamp ?? 'NO_PLAY';
  const record: BeMusicSongRecord = {
    ...previous,
    lamp: FULL_COMBO_LAMPS.has(play.lamp) && clearLampRank(play.lamp) > clearLampRank(lamp) ? play.lamp : lamp,
    exScore: Math.max(previous?.exScore ?? 0, play.exScore),
    maxCombo: Math.max(previous?.maxCombo ?? 0, play.maxCombo),
    missCount: previous?.missCount === undefined ? play.missCount : Math.min(previous.missCount, play.missCount),
  };
  return record;
}

/**
 * What a course stage's result contributes to its chart's record: as {@link songRecordPlayFromResult}, with the notes a
 * stage that failed mid-way never judged counted in its BP, as LR2 counts them (OpenLR2 L9105-L9113).
 */
export function courseStagePlayFromResult(data: PixiGameplayResultData): SongRecordPlay {
  const play = songRecordPlayFromResult(data);
  const { total, perfect, great, good, bad, poor } = data.score;
  return { ...play, missCount: play.missCount + Math.max(0, total - (perfect + great + good + bad + poor)) };
}

/** {@link courseStagePlayFromResult} for a play whose result is its engine summary (beatoraja). */
export function courseStagePlayFromSummary(
  summary: Pick<
    PlayerSummary,
    'total' | 'perfect' | 'great' | 'good' | 'bad' | 'poor' | 'emptyPoor' | 'exScore' | 'gauge'
  >,
  maxCombo: number,
): SongRecordPlay {
  const play = songRecordPlayFromSummary(summary, maxCombo);
  const judged = summary.perfect + summary.great + summary.good + summary.bad + summary.poor;
  return { ...play, missCount: play.missCount + Math.max(0, summary.total - judged) };
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
 * Whether a course run played a stage at another tempo at any point (`play.tempo`, `play.tempoChanges`): such a run
 * is practice, so it leaves the course's record alone, as a single play at another tempo leaves the chart's.
 */
export function isCourseRunAtAnotherTempo(courseLog: Pick<BeMusicCoursePlaylog, 'stages'>): boolean {
  return courseLog.stages.some((entry) => entry.played && playedAtAnotherTempo(entry.playlog.play));
}

/**
 * Whether a course run played itself (`play.mode: 'auto'`) on any stage, or on the stitched play of a NONSTOP run: an
 * auto-played run leaves the course's record alone, as an auto play leaves the chart's.
 */
export function isCourseRunAutoPlayed(courseLog: Pick<BeMusicCoursePlaylog, 'stages' | 'nonstop'>): boolean {
  if (courseLog.nonstop?.playlog.play.mode === 'auto') return true;
  return courseLog.stages.some((entry) => entry.played && entry.playlog.play.mode === 'auto');
}

/** Whether a course run counts for the course's best record: not auto-played and not played at another tempo. */
export function courseRunKeepsRecord(courseLog: Pick<BeMusicCoursePlaylog, 'stages' | 'nonstop'>): boolean {
  return !isCourseRunAutoPlayed(courseLog) && !isCourseRunAtAnotherTempo(courseLog);
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
  if ((version !== STORAGE_VERSION && version !== 1) || typeof stored !== 'object' || stored === null) return records;
  // Version 1 lamps predate LR2's lamp rules; the demo plays on LR2's ruleset by default, so they are read as LR2 plays.
  const readLamp = version === 1 ? toLr2RecordLamp : (lamp: BeMusicClearLamp) => lamp;
  for (const [key, entry] of Object.entries(stored)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { lamp } = entry as { lamp?: unknown };
    if (typeof lamp !== 'string' || !CLEAR_LAMP_ORDER.includes(lamp as BeMusicClearLamp)) continue;
    const record: BeMusicSongRecord = { lamp: readLamp(lamp as BeMusicClearLamp) };
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
export function toLr2RecordLamp(lamp: BeMusicClearLamp): BeMusicClearLamp {
  if (lamp === 'PERFECT' || lamp === 'MAX') return 'FULL_COMBO';
  if (lamp === 'EX_HARD') return 'NORMAL';
  return lamp;
}

/** Serializes records as `{ version: 2, records: { [key]: BeMusicSongRecord } }`. */
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
