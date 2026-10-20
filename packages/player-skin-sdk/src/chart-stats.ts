import type { BeMusicJSON } from '@be-music/chart-source';
import { resolveChart, resolveChartPlayVariant } from '@be-music/chart-model';
import type { LibraryChart } from './chart.ts';

/**
 * What a player wants to know about a chart before starting it, beyond its title and level: how long it runs, the
 * tempo range it travels (soflan), and the gimmicks it carries (long notes, mines, stops).
 */
export interface ChartStats {
  /** Seconds from the chart's start to the last playable note's end. */
  lengthSeconds: number;
  minBPM: number;
  maxBPM: number;
  longNotes: number;
  mines: number;
  /** Whether the chart has STOP sequences. */
  stops: boolean;
  /**
   * The judge rank as players read it: `VERY HARD` … `VERY EASY` for `#RANK 0`–`4`, the `#DEFEXRANK` / bmson
   * `judge_rank` value (`120`, `100` …) when the chart sets one, `NORMAL` when it sets neither (bmson: `100`), and
   * `RANDOM` when `#EXRANKxx` changes it mid-chart.
   */
  judgeRank: string;
}

const STATS = new WeakMap<BeMusicJSON, ChartStats>();

/** {@link ChartStats} for a song, computed once per chart (the select screen asks every frame). */
export function resolveChartStats(chartEntry: Pick<LibraryChart, 'chart' | 'bpm'>): ChartStats {
  const cached = STATS.get(chartEntry.chart);
  if (cached) return cached;
  const stats = computeChartStats(chartEntry.chart, chartEntry.bpm);
  STATS.set(chartEntry.chart, stats);
  return stats;
}

function computeChartStats(chart: BeMusicJSON, fallbackBPM: number | undefined): ChartStats {
  let lengthSeconds = 0;
  let longNotes = 0;
  let mines = 0;
  let minBPM = Number.POSITIVE_INFINITY;
  let maxBPM = 0;
  let stops = false;
  let rankChanges = false;
  try {
    // The song list sees the chart before any `#RANDOM` draw: only its unconditional content counts.
    const resolved = resolveChart(chart, { inferBmsLNTypeWhenMissing: true });
    for (const note of resolved.notes) {
      lengthSeconds = Math.max(lengthSeconds, note.endSeconds ?? note.seconds);
      if (note.endBeat !== undefined) longNotes += 1;
    }
    mines = resolved.mines.length;
    const timing = resolved.timing;
    for (const point of timing.tempoPoints) {
      // Zero / negative tempos are stop-like gimmicks, not a tempo the player reads.
      if (!(point.bpm > 0) || !Number.isFinite(point.bpm)) continue;
      // Only tempos in effect before the last note count — a closing tempo change after it never plays.
      if (point.seconds > lengthSeconds && minBPM !== Number.POSITIVE_INFINITY) continue;
      minBPM = Math.min(minBPM, point.bpm);
      maxBPM = Math.max(maxBPM, point.bpm);
    }
    stops = timing.stopPoints.some((stop) => stop.seconds > 0 && stop.seconds <= lengthSeconds);
    rankChanges = resolved.judgeRank.changes.length > 0;
  } catch {
    // A chart the timing pass can't read still lists; it just shows no extra facts.
  }
  if (minBPM === Number.POSITIVE_INFINITY) {
    const bpm = fallbackBPM !== undefined && fallbackBPM > 0 ? fallbackBPM : 0;
    minBPM = bpm;
    maxBPM = bpm;
  }
  return { lengthSeconds, minBPM, maxBPM, longNotes, mines, stops, judgeRank: judgeRankLabel(chart, rankChanges) };
}

const JUDGE_RANK_NAMES = ['VERY HARD', 'HARD', 'NORMAL', 'EASY', 'VERY EASY'] as const;

/**
 * {@link ChartStats.judgeRank}. The same rules as the player's song screens (`resolveDisplayedJudgeRankLabel` in
 * `@be-music/player-engine`'s `utils.ts`): a positive `#DEFEXRANK` / bmson `judge_rank` wins, then `#RANK` 0–4 (truncated),
 * then the format's default.
 */
function judgeRankLabel(chart: BeMusicJSON, changes: boolean): string {
  if (changes) return 'RANDOM';
  const exRank = chart.sourceFormat === 'bmson' ? chart.bmson.info.judgeRank : chart.bms.defExRank;
  if (typeof exRank === 'number' && Number.isFinite(exRank) && exRank > 0) {
    return Number.isInteger(exRank) && exRank <= 4 ? JUDGE_RANK_NAMES[exRank]! : formatRankValue(exRank);
  }
  if (chart.sourceFormat === 'bmson') return '100';
  const rank = chart.metadata.rank;
  const truncated = typeof rank === 'number' && Number.isFinite(rank) ? Math.trunc(rank) : Number.NaN;
  return truncated >= 0 && truncated <= 4 ? JUDGE_RANK_NAMES[truncated]! : 'NORMAL';
}

/** `120`, `99.5`: an `#DEFEXRANK` value with up to two decimals and no trailing zeros. */
function formatRankValue(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}

/** `m:ss` play length. */
export function formatChartLength(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** `150`, or `120-240` for a chart whose tempo changes. */
export function formatBPMRange(minBPM: number, maxBPM: number): string {
  const low = Math.round(minBPM);
  const high = Math.round(maxBPM);
  if (high <= 0) return '-';
  return low === high ? String(high) : `${low}-${high}`;
}

/** Short gimmick tags for a row: `LN`, `MINE`, `STOP`, and `SOFLAN` when the tempo moves. */
export function resolveChartTags(stats: ChartStats): string[] {
  const tags: string[] = [];
  if (stats.longNotes > 0) tags.push('LN');
  if (Math.round(stats.minBPM) !== Math.round(stats.maxBPM)) tags.push('SOFLAN');
  if (stats.stops) tags.push('STOP');
  if (stats.mines > 0) tags.push('MINE');
  return tags;
}

/** The facts a select-list row prints for a song, already formatted (see {@link resolveChartStats}). */
export interface ChartRowFacts {
  notes: string;
  length: string;
  bpm: string;
  tags: string[];
}

export function resolveChartRowFacts(chartEntry: Pick<LibraryChart, 'chart' | 'bpm' | 'totalNotes'>): ChartRowFacts {
  const stats = resolveChartStats(chartEntry);
  return {
    notes: String(Math.max(0, chartEntry.totalNotes)),
    length: formatChartLength(stats.lengthSeconds),
    bpm: formatBPMRange(stats.minBPM, stats.maxBPM),
    tags: resolveChartTags(stats),
  };
}

/** `'7K KEYS'`-style mode label for a song's play variant. */
export function formatPlayVariantLabel(chartEntry: Pick<LibraryChart, 'chartPath' | 'chart'>): string {
  return `${resolveChartPlayVariant({ chartPath: chartEntry.chartPath, events: chartEntry.chart.events, bms: chartEntry.chart.bms, bmson: chartEntry.chart.bmson })} KEYS`;
}
