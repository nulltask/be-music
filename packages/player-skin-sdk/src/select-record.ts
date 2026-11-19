import { computeScoreRate, resolve____RankLabel } from '@be-music/player-engine/ruleset';
import type { BeMusicChartBestRecord, BeMusicClearLamp } from './chart.ts';

/** How a select screen names each clear lamp: `HARD CLEAR`, `FULL COMBO`, `NO PLAY`. */
export const CLEAR_LAMP_LABELS: Readonly<Record<BeMusicClearLamp, string>> = {
  NO_PLAY: 'NO PLAY',
  FAILED: 'FAILED',
  ASSIST_EASY: 'ASSIST CLEAR',
  LIGHT_ASSIST_EASY: 'LIGHT ASSIST',
  EASY: 'EASY CLEAR',
  NORMAL: 'CLEAR',
  HARD: 'HARD CLEAR',
  EX_HARD: 'EX HARD CLEAR',
  FULL_COMBO: 'FULL COMBO',
  PERFECT: 'PERFECT',
  MAX: 'MAX',
};

/** Each clear lamp's short name, for a column already captioned as the clear: `HARD`, `EX HARD`, `FULL COMBO`. */
export const CLEAR_LAMP_SHORT_LABELS: Readonly<Record<BeMusicClearLamp, string>> = {
  NO_PLAY: 'NO PLAY',
  FAILED: 'FAILED',
  ASSIST_EASY: 'ASSIST',
  LIGHT_ASSIST_EASY: 'L-ASSIST',
  EASY: 'EASY',
  NORMAL: 'NORMAL',
  HARD: 'HARD',
  EX_HARD: 'EX HARD',
  FULL_COMBO: 'FULL COMBO',
  PERFECT: 'PERFECT',
  MAX: 'MAX',
};

/**
 * Each clear lamp's light (`0xRRGGBB`), in the colours LR2 and beatoraja players read lamps by: red FAILED, purple and
 * pink assisted clears, green EASY, blue NORMAL, white HARD, yellow EX HARD, then the full combos. FULL COMBO and above
 * cycle through hues as {@link resolveClearLampLight} draws them; their colour here is the one a still image shows.
 */
export const CLEAR_LAMP_COLORS: Readonly<Record<BeMusicClearLamp, number>> = {
  NO_PLAY: 0x4a5060,
  FAILED: 0xff3b5c,
  ASSIST_EASY: 0xb07cff,
  LIGHT_ASSIST_EASY: 0xff7ce0,
  EASY: 0x5cf07a,
  NORMAL: 0x45b4ff,
  HARD: 0xf4f6ff,
  EX_HARD: 0xffd23f,
  FULL_COMBO: 0x7ff6ff,
  PERFECT: 0xc8ffef,
  MAX: 0xffffff,
};

/** How long one FAILED blink takes, on and off (LR2's select bar flashes a FAILED lamp). */
export const FAILED_LAMP_BLINK_MS = 500;
/** How long a FULL COMBO (and better) lamp takes to cycle once through the hues. */
export const FULL_COMBO_LAMP_CYCLE_MS = 2000;

/**
 * A lamp's light at `nowMs`: FAILED blinks (full, then dim, every {@link FAILED_LAMP_BLINK_MS}), FULL COMBO and better
 * cycle through the hues once every {@link FULL_COMBO_LAMP_CYCLE_MS} (`phase` 0..1 offsets a bar's cycle so a column of
 * them ripples), and the rest hold their {@link CLEAR_LAMP_COLORS}. `NO_PLAY` is not lit (`alpha` 0).
 */
export function resolveClearLampLight(
  lamp: BeMusicClearLamp,
  nowMs: number,
  phase = 0,
): { color: number; alpha: number } {
  if (lamp === 'NO_PLAY') return { color: CLEAR_LAMP_COLORS.NO_PLAY, alpha: 0 };
  if (lamp === 'FAILED') {
    const on = Math.floor(Math.max(0, nowMs) / FAILED_LAMP_BLINK_MS) % 2 === 0;
    return { color: CLEAR_LAMP_COLORS.FAILED, alpha: on ? 1 : 0.35 };
  }
  if (lamp === 'FULL_COMBO' || lamp === 'PERFECT' || lamp === 'MAX') {
    const turn = (((nowMs / FULL_COMBO_LAMP_CYCLE_MS + phase) % 1) + 1) % 1;
    // PERFECT and MAX wash the hues towards white, as the brighter lamps.
    const saturation = lamp === 'FULL_COMBO' ? 0.55 : lamp === 'PERFECT' ? 0.32 : 0.16;
    return { color: hsvColor(turn, saturation, 1), alpha: 1 };
  }
  return { color: CLEAR_LAMP_COLORS[lamp], alpha: 1 };
}

/** The player's best record on a chart as a select screen shows it. */
export interface BestRecordSummary {
  lamp: BeMusicClearLamp;
  /** The lamp's name ({@link CLEAR_LAMP_LABELS}). */
  lampLabel: string;
  /** The best EX score, absent when the record keeps none (only assisted plays). */
  exScore?: number;
  /** The EX score the chart allows (2 per note), absent when its note count is unknown. */
  maxExScore?: number;
  /** The best EX score over {@link maxExScore}, 0..1. */
  rate?: number;
  /** The rate as text, two decimals: `85.42%`. */
  rateLabel?: string;
  /** The DJ Rank the best EX score earns (`AAA` … `F`). */
  rank?: string;
  /** The fewest BP. */
  missCount?: number;
  maxCombo?: number;
  playCount: number;
}

/**
 * What a select card and bar show of the player's best `record` on a chart of `totalNotes` notes: its lamp and name, and,
 * when the record keeps an EX score and the chart's notes are known, the score rate and DJ Rank it earns. `undefined`
 * without a record.
 */
export function describeBestRecord(
  record: BeMusicChartBestRecord | undefined,
  totalNotes?: number,
): BestRecordSummary | undefined {
  if (record === undefined) return undefined;
  const summary: BestRecordSummary = {
    lamp: record.lamp,
    lampLabel: CLEAR_LAMP_LABELS[record.lamp],
    playCount: record.playCount ?? 0,
  };
  if (record.missCount !== undefined) summary.missCount = record.missCount;
  if (record.maxCombo !== undefined) summary.maxCombo = record.maxCombo;
  if (record.exScore === undefined) return summary;
  summary.exScore = record.exScore;
  if (totalNotes === undefined || !(totalNotes > 0)) return summary;
  const rate = computeScoreRate({ exScore: record.exScore, total: totalNotes });
  summary.maxExScore = totalNotes * 2;
  summary.rate = rate;
  // Cut, not rounded, so 99.999% never reads 100.00%; the epsilon keeps 85.42 from reading 85.41 in binary.
  summary.rateLabel = `${(Math.floor(rate * 10000 + 1e-6) / 100).toFixed(2)}%`;
  summary.rank = resolve____RankLabel(record.exScore, totalNotes);
  return summary;
}

function hsvColor(hue: number, saturation: number, value: number): number {
  const sector = hue * 6;
  const index = Math.floor(sector) % 6;
  const fraction = sector - Math.floor(sector);
  const p = value * (1 - saturation);
  const q = value * (1 - fraction * saturation);
  const t = value * (1 - (1 - fraction) * saturation);
  const [r, g, b] = [
    [value, t, p],
    [q, value, p],
    [p, value, t],
    [p, q, value],
    [t, p, value],
    [value, p, q],
  ][index]!;
  return (Math.round(r! * 255) << 16) | (Math.round(g! * 255) << 8) | Math.round(b! * 255);
}
