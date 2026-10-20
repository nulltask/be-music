import { resolveChart, type ResolvedChart } from '@be-music/chart-model';
import type { BeMusicJSON, BeMusicPlayLevel } from '@be-music/chart-source';

const BMS_DEFAULT_DISPLAY_RANK = 2;
const BMS_DEFAULT_DISPLAY_PLAY_LEVEL = 3;
const BMSON_DEFAULT_DISPLAY_JUDGE_RANK = 100;

/**
 * The judge rank a chart screen shows: bmson `judge_rank` (100 when the chart has none), or BMS `#DEFEXRANK` when it is
 * above 0, else `#RANK 0`–`4` (truncated), else NORMAL (`2`).
 *
 * Reads the resolved chart's judge-rank facts (`ResolvedChart.judgeRank`); a source chart is resolved first. The facts
 * are the raw chart values, so the format defaults are filled here for display, as each ruleset fills them for play:
 * a replay records only what the chart sets and must replay to the same windows.
 */
export function resolveDisplayedJudgeRankValue(chart: BeMusicJSON | ResolvedChart): number {
  const resolved = toResolvedChart(chart);
  const { rank, exRank } = resolved.judgeRank;
  if (resolved.sourceFormat === 'bmson') {
    return exRank !== undefined && exRank > 0 ? exRank : BMSON_DEFAULT_DISPLAY_JUDGE_RANK;
  }
  if (exRank !== undefined && exRank > 0) {
    return exRank;
  }
  const rankValue = rank !== undefined ? Math.trunc(rank) : Number.NaN;
  if (rankValue >= 0 && rankValue <= 4) {
    return rankValue;
  }
  return BMS_DEFAULT_DISPLAY_RANK;
}

/** {@link resolveDisplayedJudgeRankValue} as a label (`NORMAL`, `120` …); `RANDOM` when `#EXRANKxx` changes it mid-play. */
export function resolveDisplayedJudgeRankLabel(chart: BeMusicJSON | ResolvedChart): string {
  const resolved = toResolvedChart(chart);
  if (resolved.judgeRank.changes.length > 0) {
    return 'RANDOM';
  }
  return formatDisplayedJudgeRankValue(resolveDisplayedJudgeRankValue(resolved));
}

function toResolvedChart(chart: BeMusicJSON | ResolvedChart): ResolvedChart {
  return 'judgeRank' in chart ? chart : resolveChart(chart);
}

export function resolveDisplayedPlayLevelValue(chart: BeMusicJSON): BeMusicPlayLevel | undefined {
  const playLevel = chart.metadata.playLevel;
  if (typeof playLevel === 'number' && Number.isFinite(playLevel) && playLevel >= 0) {
    return playLevel;
  }
  if (typeof playLevel === 'string' && playLevel.trim().length > 0) {
    return playLevel.trim();
  }
  if (chart.sourceFormat === 'bms') {
    return BMS_DEFAULT_DISPLAY_PLAY_LEVEL;
  }
  return undefined;
}

export function resolveDisplayedDifficultyValue(chart: BeMusicJSON): number | undefined {
  const difficulty = chart.metadata.difficulty;
  const normalized =
    typeof difficulty === 'number' && Number.isFinite(difficulty) ? Math.trunc(difficulty) : Number.NaN;
  if (Number.isFinite(normalized) && normalized >= 1 && normalized <= 5) {
    return normalized;
  }
  return undefined;
}

function formatDisplayedJudgeRankValue(value: number): string {
  const normalized = Math.trunc(value);
  if (normalized === value) {
    if (normalized === 0) {
      return 'VERY HARD';
    }
    if (normalized === 1) {
      return 'HARD';
    }
    if (normalized === 2) {
      return 'NORMAL';
    }
    if (normalized === 3) {
      return 'EASY';
    }
    if (normalized === 4) {
      return 'VERY EASY';
    }
  }
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}

export function formatSeconds(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalCentiseconds = Math.floor(safe * 100);
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const secondsPart = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes}:${secondsPart.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  }

  const minutesPart = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${minutesPart.toString().padStart(2, '0')}:${secondsPart.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

export function resolveAltModifierLabel(platform: NodeJS.Platform = resolveDefaultPlatform()): 'Alt' | 'Option' {
  return platform === 'darwin' ? 'Option' : 'Alt';
}

/**
 * Browser-safe `process.platform` lookup. Falls back to `'linux'` when running outside Node so a static
 * `process.platform` reference doesn't `ReferenceError` the moment a web bundle calls a default-param consumer.
 * The value's only consumer is the human-readable Alt/Option modifier label, and `'Alt'` is the right fallback
 * for any non-Mac surface.
 */
function resolveDefaultPlatform(): NodeJS.Platform {
  const proc = (globalThis as { process?: { platform?: NodeJS.Platform } }).process;
  return proc?.platform ?? ('linux' as NodeJS.Platform);
}
