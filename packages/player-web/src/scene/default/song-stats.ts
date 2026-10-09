import type { BeMusicJson } from '@be-music/json';
import { createTimingResolver } from '@be-music/audio-renderer/triggers';
import { extractLandmineNotes, extractPlayableNotes } from '@be-music/player/playable-notes';
import type { BrowserSongEntry } from '../../collection/types.ts';

/**
 * What a player wants to know about a chart before starting it, beyond its title and level: how long it runs, the
 * tempo range it travels (soflan), and the gimmicks it carries (long notes, mines, stops).
 */
export interface SongStats {
  /** Seconds from the chart's start to the last playable note's end. */
  lengthSeconds: number;
  minBpm: number;
  maxBpm: number;
  longNotes: number;
  mines: number;
  /** Whether the chart has STOP sequences. */
  stops: boolean;
}

const STATS = new WeakMap<BeMusicJson, SongStats>();

/** {@link SongStats} for a song, computed once per chart (the select screen asks every frame). */
export function resolveSongStats(song: Pick<BrowserSongEntry, 'chart' | 'bpm'>): SongStats {
  const cached = STATS.get(song.chart);
  if (cached) return cached;
  const stats = computeSongStats(song.chart, song.bpm);
  STATS.set(song.chart, stats);
  return stats;
}

function computeSongStats(chart: BeMusicJson, fallbackBpm: number | undefined): SongStats {
  let lengthSeconds = 0;
  let longNotes = 0;
  let mines = 0;
  let minBpm = Number.POSITIVE_INFINITY;
  let maxBpm = 0;
  let stops = false;
  try {
    for (const note of extractPlayableNotes(chart, { inferBmsLnTypeWhenMissing: true })) {
      lengthSeconds = Math.max(lengthSeconds, note.endSeconds ?? note.seconds);
      if (note.endBeat !== undefined) longNotes += 1;
    }
    mines = extractLandmineNotes(chart).length;
    const timing = createTimingResolver(chart);
    for (const point of timing.tempoPoints) {
      // Zero / negative tempos are stop-like gimmicks, not a tempo the player reads.
      if (!(point.bpm > 0) || !Number.isFinite(point.bpm)) continue;
      // Only tempos in effect before the last note count — a closing tempo change after it never plays.
      if (point.seconds > lengthSeconds && minBpm !== Number.POSITIVE_INFINITY) continue;
      minBpm = Math.min(minBpm, point.bpm);
      maxBpm = Math.max(maxBpm, point.bpm);
    }
    stops = timing.stopPoints.some((stop) => stop.seconds > 0 && stop.seconds <= lengthSeconds);
  } catch {
    // A chart the timing pass can't read still lists; it just shows no extra facts.
  }
  if (minBpm === Number.POSITIVE_INFINITY) {
    const bpm = fallbackBpm !== undefined && fallbackBpm > 0 ? fallbackBpm : 0;
    minBpm = bpm;
    maxBpm = bpm;
  }
  return { lengthSeconds, minBpm, maxBpm, longNotes, mines, stops };
}

/** `m:ss` play length. */
export function formatSongLength(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** `150`, or `120-240` for a chart whose tempo changes. */
export function formatBpmRange(minBpm: number, maxBpm: number): string {
  const low = Math.round(minBpm);
  const high = Math.round(maxBpm);
  if (high <= 0) return '-';
  return low === high ? String(high) : `${low}-${high}`;
}

/** Short gimmick tags for a row: `LN`, `MINE`, `STOP`, and `SOFLAN` when the tempo moves. */
export function resolveSongTags(stats: SongStats): string[] {
  const tags: string[] = [];
  if (stats.longNotes > 0) tags.push('LN');
  if (Math.round(stats.minBpm) !== Math.round(stats.maxBpm)) tags.push('SOFLAN');
  if (stats.stops) tags.push('STOP');
  if (stats.mines > 0) tags.push('MINE');
  return tags;
}

/** The facts a select-list row prints for a song, already formatted (see {@link resolveSongStats}). */
export interface SongRowFacts {
  notes: string;
  length: string;
  bpm: string;
  tags: string[];
}

export function resolveSongRowFacts(song: Pick<BrowserSongEntry, 'chart' | 'bpm' | 'totalNotes'>): SongRowFacts {
  const stats = resolveSongStats(song);
  return {
    notes: String(Math.max(0, song.totalNotes)),
    length: formatSongLength(stats.lengthSeconds),
    bpm: formatBpmRange(stats.minBpm, stats.maxBpm),
    tags: resolveSongTags(stats),
  };
}
