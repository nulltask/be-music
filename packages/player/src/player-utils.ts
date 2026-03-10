import { normalizeChannel, normalizeObjectKey, type BeMusicJson, type BeMusicPlayLevel } from '@be-music/json';

const BMS_DEFAULT_DISPLAY_RANK = 2;
const BMS_DEFAULT_DISPLAY_PLAY_LEVEL = 3;
const BMSON_DEFAULT_DISPLAY_JUDGE_RANK = 100;

export function resolveChartVolWavGain(chart: BeMusicJson): number {
  const volWav = chart.bms.volWav;
  if (typeof volWav !== 'number' || !Number.isFinite(volWav) || volWav < 0) {
    return 1;
  }
  return volWav / 100;
}

export function resolveDisplayedJudgeRankValue(chart: BeMusicJson): number {
  if (chart.sourceFormat === 'bmson') {
    const judgeRank = chart.bmson.info.judgeRank;
    if (typeof judgeRank === 'number' && Number.isFinite(judgeRank) && judgeRank > 0) {
      return judgeRank;
    }
    const metadataRank = chart.metadata.rank;
    if (typeof metadataRank === 'number' && Number.isFinite(metadataRank) && metadataRank > 0) {
      return metadataRank;
    }
    return BMSON_DEFAULT_DISPLAY_JUDGE_RANK;
  }

  const defExRank = chart.bms.defExRank;
  if (typeof defExRank === 'number' && Number.isFinite(defExRank) && defExRank > 0) {
    return defExRank;
  }

  const rankValue = Number.isFinite(chart.metadata.rank) ? Math.trunc(chart.metadata.rank!) : Number.NaN;
  if (Number.isFinite(rankValue) && rankValue >= 0 && rankValue <= 4) {
    return rankValue;
  }

  return BMS_DEFAULT_DISPLAY_RANK;
}

export function resolveDisplayedJudgeRankLabel(chart: BeMusicJson): string {
  if (hasDynamicJudgeRankChanges(chart)) {
    return 'RANDOM';
  }
  return formatDisplayedJudgeRankValue(resolveDisplayedJudgeRankValue(chart));
}

export function resolveDisplayedPlayLevelValue(chart: BeMusicJson): BeMusicPlayLevel | undefined {
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

function hasDynamicJudgeRankChanges(chart: BeMusicJson): boolean {
  if (chart.sourceFormat !== 'bms') {
    return false;
  }
  for (const event of chart.events) {
    if (normalizeChannel(event.channel) !== 'A0') {
      continue;
    }
    if (parseDynamicJudgeRankPercent(chart.bms.exRank[normalizeObjectKey(event.value)]) !== undefined) {
      return true;
    }
  }
  return false;
}

function parseDynamicJudgeRankPercent(raw: string | undefined): number | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
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

export function resolveAltModifierLabel(platform: NodeJS.Platform = process.platform): 'Alt' | 'Option' {
  return platform === 'darwin' ? 'Option' : 'Alt';
}
