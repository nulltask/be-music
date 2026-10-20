import type { BeMusicPlayLevel } from '@be-music/chart-source';
import { clamp } from '@be-music/shared-utils/core';
import type { PlayerSummary } from '@be-music/player-engine';
import { normalizeHighSpeed } from './high-speed.ts';
import { type RGBColor, colorizeText, dimRGB } from './ansi-text.ts';
import { colorizeLaneOuterBorder } from './lane-rows.ts';

const JUDGE_COMBO_VISIBILITY_TIMEOUT_MS = 1000;
const JUDGE_COMBO_BLINK_INTERVAL_MS = 80;

export interface JudgeComboDisplayState {
  latestJudge: string;
  combo: number;
  updatedAtMs: number;
}

const PAUSE_FOREGROUND_RGB: RGBColor = { r: 255, g: 255, b: 255 };
const PAUSE_BACKGROUND_RGB: RGBColor = { r: 200, g: 59, b: 59 };
const GREAT_JUDGE_RGB: RGBColor = { r: 255, g: 215, b: 95 };
const GOOD_JUDGE_RGB: RGBColor = { r: 135, g: 255, b: 118 };
const BAD_JUDGE_RGB: RGBColor = { r: 255, g: 159, b: 74 };
const POOR_JUDGE_RGB: RGBColor = { r: 255, g: 107, b: 107 };
const READY_JUDGE_RGB: RGBColor = { r: 95, g: 215, b: 255 };
const IDLE_JUDGE_RGB: RGBColor = { r: 154, g: 161, b: 170 };
const GROOVE_GAUGE_SAFE_RGB: RGBColor = { r: 72, g: 238, b: 255 };
const GROOVE_GAUGE_SAFE_EMPTY_RGB: RGBColor = { r: 18, g: 74, b: 86 };
const GROOVE_GAUGE_CLEAR_RGB: RGBColor = { r: 255, g: 72, b: 72 };
const GROOVE_GAUGE_CLEAR_EMPTY_RGB: RGBColor = { r: 84, g: 18, b: 18 };
const RAINBOW_RGB_STEPS: RGBColor[] = [
  { r: 255, g: 0, b: 0 },
  { r: 255, g: 135, b: 0 },
  { r: 255, g: 255, b: 0 },
  { r: 135, g: 255, b: 0 },
  { r: 0, g: 255, b: 255 },
  { r: 0, g: 175, b: 255 },
  { r: 255, g: 0, b: 255 },
];

export function renderProgress(currentSeconds: number, totalSeconds: number): string {
  const barLength = 28;
  const safeTotal = Math.max(1, totalSeconds);
  const ratio = clamp(currentSeconds / safeTotal, 0, 1);
  const filled = Math.round(barLength * ratio);
  return `[${'#'.repeat(filled)}${'-'.repeat(barLength - filled)}] ${Math.round(ratio * 100)}%`;
}

export function createJudgeComboDisplayState(): JudgeComboDisplayState {
  return {
    latestJudge: '-',
    combo: 0,
    updatedAtMs: 0,
  };
}

export function resetJudgeComboDisplayState(state: JudgeComboDisplayState): void {
  state.latestJudge = '-';
  state.combo = 0;
  state.updatedAtMs = 0;
}

export function resolveVisibleJudgeComboLabel(state: JudgeComboDisplayState, nowMs: number, paused: boolean): string {
  if (paused) {
    return formatJudgeComboDisplay(state.latestJudge, state.combo, nowMs, true);
  }
  if (state.updatedAtMs <= 0 || nowMs - state.updatedAtMs > JUDGE_COMBO_VISIBILITY_TIMEOUT_MS) {
    return '';
  }
  return formatJudgeComboDisplay(state.latestJudge, state.combo, nowMs, false);
}

export function formatJudgeComboDisplay(latestJudge: string, combo: number, nowMs: number, paused: boolean): string {
  if (paused) {
    return colorizeText('PAUSE', PAUSE_FOREGROUND_RGB, PAUSE_BACKGROUND_RGB);
  }
  const normalizedJudge = latestJudge === 'PERFECT' ? 'GREAT' : latestJudge;
  // LR2 convention: the judge plate pairs with the combo readout for clean hits (PERFECT / GREAT / GOOD)
  // but reads as a bare verdict for misses (BAD / POOR). The previous code appended the combo unconditionally,
  // which made `POOR 5` appear after an EMPTY POOR (kara-poor — phantom press) — the engine preserves combo on
  // empty POOR per beatoraja behavior, so the combo argument is non-zero there even though no note was hit.
  const showCombo = latestJudge !== 'BAD' && latestJudge !== 'POOR';
  const safeCombo = Math.max(0, Math.floor(combo));
  const baseText = `${normalizedJudge}${showCombo && safeCombo > 0 ? ` ${safeCombo}` : ''}`;

  if (latestJudge === 'PERFECT') {
    return colorizeBlinkingRainbow(baseText, nowMs);
  }
  if (latestJudge === 'GREAT') {
    return colorizeBlinkingText(baseText, GREAT_JUDGE_RGB, dimRGB(GREAT_JUDGE_RGB, 0.5), nowMs);
  }
  if (latestJudge === 'GOOD') {
    return colorizeBlinkingText(baseText, GOOD_JUDGE_RGB, dimRGB(GOOD_JUDGE_RGB, 0.5), nowMs);
  }
  if (latestJudge === 'BAD') {
    return colorizeBlinkingText(baseText, BAD_JUDGE_RGB, dimRGB(BAD_JUDGE_RGB, 0.5), nowMs);
  }
  if (latestJudge === 'POOR') {
    return colorizeBlinkingText(baseText, POOR_JUDGE_RGB, dimRGB(POOR_JUDGE_RGB, 0.5), nowMs);
  }
  if (latestJudge === 'READY') {
    return colorizeText(baseText, READY_JUDGE_RGB);
  }
  if (latestJudge === '-') {
    return colorizeText(baseText, IDLE_JUDGE_RGB);
  }
  return baseText;
}

function colorizeBlinkingText(value: string, onColor: RGBColor, offColor: RGBColor, nowMs: number): string {
  // ANSI blink is not consistently supported, so emulate blink with a time-based pulse.
  const blinkOn = Math.floor(nowMs / JUDGE_COMBO_BLINK_INTERVAL_MS) % 2 === 0;
  return colorizeText(value, blinkOn ? onColor : offColor);
}

function colorizeBlinkingRainbow(value: string, nowMs: number): string {
  const blinkOn = Math.floor(nowMs / JUDGE_COMBO_BLINK_INTERVAL_MS) % 2 === 0;
  return colorizeRainbow(value, blinkOn);
}

function colorizeRainbow(value: string, bright = true): string {
  const brightness = bright ? 1 : 0.5;
  const characters = Array.from(value);
  return characters
    .map((character, index) =>
      colorizeText(character, dimRGB(RAINBOW_RGB_STEPS[index % RAINBOW_RGB_STEPS.length]!, brightness)),
    )
    .join('');
}

export function formatPlayerLabel(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  const normalized = Math.floor(value);
  if (normalized === 1) {
    return 'SINGLE';
  }
  if (normalized === 2) {
    return 'COUPLE';
  }
  if (normalized === 3) {
    return 'DOUBLE';
  }
  if (normalized === 4) {
    return 'BATTLE';
  }
  return String(normalized);
}

export function formatRankLabel(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  const normalized = Math.floor(value);
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
  return String(normalized);
}

export function formatPlayLevelLabel(value: BeMusicPlayLevel | undefined): string {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : '-';
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '-';
  }
  if (value === 0) {
    return '?';
  }
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}

export function formatNotesProgress(summary: PlayerSummary): string {
  const total = Math.max(0, summary.total);
  const judged = Math.max(0, summary.perfect + summary.great + summary.good + summary.bad + summary.poor);
  return `${Math.min(total, judged)}/${total}`;
}

export function formatGrooveGaugeLine(summary: PlayerSummary, laneBlockWidth: number, leftPadding = 0): string {
  const gauge = summary.gauge;
  if (!gauge) {
    return '-';
  }
  const percentLabel = `${formatGrooveGaugePercent(gauge.current)}%`;
  const safeLaneBlockWidth = Math.max(3, Math.floor(laneBlockWidth));
  const barWidth = Math.max(1, safeLaneBlockWidth - 2);
  const safeLeftPadding = Math.max(0, Math.floor(leftPadding));
  return `${' '.repeat(safeLeftPadding)}${colorizeLaneOuterBorder('┃')}${renderGrooveGaugeBar(gauge.current, gauge.clearThreshold, gauge.max, barWidth)}${colorizeLaneOuterBorder('┃')} ${percentLabel}`;
}

function renderGrooveGaugeBar(current: number, clearThreshold: number, max: number, width: number): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const ratio = clamp(current / safeMax, 0, 1);
  const clearRatio = clamp(clearThreshold / safeMax, 0, 1);
  const filled = Math.round(safeWidth * ratio);
  const clearIndex = Math.round(safeWidth * clearRatio);
  let output = '';
  for (let index = 0; index < safeWidth; index += 1) {
    const inClearZone = index >= clearIndex;
    const filledCell = index < filled;
    const color = inClearZone
      ? filledCell
        ? GROOVE_GAUGE_CLEAR_RGB
        : GROOVE_GAUGE_CLEAR_EMPTY_RGB
      : filledCell
        ? GROOVE_GAUGE_SAFE_RGB
        : GROOVE_GAUGE_SAFE_EMPTY_RGB;
    output += colorizeText(filledCell ? '█' : '░', color);
  }
  return output;
}

function formatGrooveGaugePercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return String(Math.max(0, Math.floor(value)));
}

export function formatActiveAudioFiles(files: string[]): string {
  if (files.length === 0) {
    return '-';
  }

  const labels = files.map((file) => {
    const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
    return slash >= 0 ? file.slice(slash + 1) : file;
  });
  const uniqueLabels = [...new Set(labels)];
  const visible = uniqueLabels.slice(0, 4);
  const extra = uniqueLabels.length - visible.length;
  const suffix = extra > 0 ? ` ... +${extra}` : '';
  return `${visible.join(', ')}${suffix}`;
}

export function formatBPM(bpm: number): string {
  const safe = Number.isFinite(bpm) ? Math.max(0, bpm) : 0;
  return safe % 1 === 0 ? `${safe.toFixed(0)}` : safe.toFixed(2);
}

export function formatHighSpeed(highSpeed: number): string {
  const safe = normalizeHighSpeed(highSpeed);
  return safe.toFixed(1);
}

export function formatScroll(speed: number): string {
  if (!Number.isFinite(speed)) {
    return '1';
  }
  return speed % 1 === 0 ? speed.toFixed(0) : speed.toFixed(2);
}

export function formatStopSeconds(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return safe.toFixed(2);
}

export function formatJudgeWindowMs(milliseconds: number): string {
  const safe = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  const truncated = Math.floor(safe * 100) / 100;
  return truncated.toFixed(2);
}

export function formatAudioBackendLabel(value: string | undefined): string {
  if (typeof value !== 'string') {
    return '-';
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : '-';
}

export function formatGenreLabel(value: string | undefined): string {
  if (typeof value !== 'string') {
    return '-';
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : '-';
}

export function formatFPS(fps: number | undefined): string {
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
    return '-';
  }
  return fps >= 100 ? fps.toFixed(0) : fps.toFixed(1);
}
