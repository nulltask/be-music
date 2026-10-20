import type { PlayerSummary } from '@be-music/player';
import { describe, expect, test } from 'vite-plus/test';
import {
  createJudgeComboDisplayState,
  formatActiveAudioFiles,
  formatAudioBackendLabel,
  formatBPM,
  formatFPS,
  formatGenreLabel,
  formatGrooveGaugeLine,
  formatHighSpeed,
  formatJudgeComboDisplay,
  formatJudgeWindowMs,
  formatNotesProgress,
  formatPlayerLabel,
  formatPlayLevelLabel,
  formatRankLabel,
  formatScroll,
  formatStopSeconds,
  renderProgress,
  resetJudgeComboDisplayState,
  resolveVisibleJudgeComboLabel,
} from './hud.ts';

function stripANSI(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replaceAll(/\u001b\[[0-9;]*m/g, '');
}

function createSummary(overrides: Partial<PlayerSummary>): PlayerSummary {
  return { total: 0, perfect: 0, great: 0, good: 0, bad: 0, poor: 0, ...overrides } as PlayerSummary;
}

describe('renderProgress', () => {
  test('draws a 28-cell bar with the percentage', () => {
    expect(renderProgress(5, 10)).toBe(`[${'#'.repeat(14)}${'-'.repeat(14)}] 50%`);
    expect(renderProgress(20, 10)).toBe(`[${'#'.repeat(28)}] 100%`);
    expect(renderProgress(0, 0)).toBe(`[${'-'.repeat(28)}] 0%`);
  });
});

describe('number readouts', () => {
  test('formatBPM drops the decimals of a whole BPM', () => {
    expect(formatBPM(150)).toBe('150');
    expect(formatBPM(150.5)).toBe('150.50');
    expect(formatBPM(-10)).toBe('0');
    expect(formatBPM(Number.NaN)).toBe('0');
  });

  test('formatScroll drops the decimals of a whole SCROLL and shows 1 when unknown', () => {
    expect(formatScroll(1)).toBe('1');
    expect(formatScroll(0.5)).toBe('0.50');
    expect(formatScroll(-2)).toBe('-2');
    expect(formatScroll(Number.NaN)).toBe('1');
  });

  test('formatHighSpeed shows the clamped HIGH-SPEED with one decimal', () => {
    expect(formatHighSpeed(2.5)).toBe('2.5');
    expect(formatHighSpeed(20)).toBe('10.0');
    expect(formatHighSpeed(0.25)).toBe('0.5');
  });

  test('formatStopSeconds and formatJudgeWindowMs show two decimals of a non-negative value', () => {
    expect(formatStopSeconds(1.234)).toBe('1.23');
    expect(formatStopSeconds(-1)).toBe('0.00');
    expect(formatStopSeconds(Number.NaN)).toBe('0.00');
    expect(formatJudgeWindowMs(16.678)).toBe('16.67');
    expect(formatJudgeWindowMs(-5)).toBe('0.00');
  });

  test('formatFPS shows one decimal below 100 and none above', () => {
    expect(formatFPS(59.94)).toBe('59.9');
    expect(formatFPS(120)).toBe('120');
    expect(formatFPS(0)).toBe('-');
    expect(formatFPS(undefined)).toBe('-');
  });

  test('formatNotesProgress counts the judged notes, at most the total', () => {
    expect(formatNotesProgress(createSummary({ total: 10, perfect: 3, great: 2, bad: 1 }))).toBe('6/10');
    expect(formatNotesProgress(createSummary({ total: 2, perfect: 3 }))).toBe('2/2');
  });
});

describe('chart labels', () => {
  test('formatPlayerLabel names #PLAYER', () => {
    expect([1, 2, 3, 4].map(formatPlayerLabel)).toEqual(['SINGLE', 'COUPLE', 'DOUBLE', 'BATTLE']);
    expect(formatPlayerLabel(1.9)).toBe('SINGLE');
    expect(formatPlayerLabel(5)).toBe('5');
    expect(formatPlayerLabel(undefined)).toBe('-');
  });

  test('formatRankLabel names #RANK', () => {
    expect([0, 1, 2, 3, 4].map(formatRankLabel)).toEqual(['VERY HARD', 'HARD', 'NORMAL', 'EASY', 'VERY EASY']);
    expect(formatRankLabel(7)).toBe('7');
    expect(formatRankLabel(undefined)).toBe('-');
  });

  test('formatPlayLevelLabel trims a text level and drops trailing zeros of a number', () => {
    expect(formatPlayLevelLabel(' 12 ')).toBe('12');
    expect(formatPlayLevelLabel('')).toBe('-');
    expect(formatPlayLevelLabel(12)).toBe('12');
    expect(formatPlayLevelLabel(12.5)).toBe('12.5');
    expect(formatPlayLevelLabel(3.456)).toBe('3.46');
    expect(formatPlayLevelLabel(0)).toBe('?');
    expect(formatPlayLevelLabel(-1)).toBe('-');
    expect(formatPlayLevelLabel(undefined)).toBe('-');
  });

  test('formatAudioBackendLabel and formatGenreLabel trim the text and show - when blank', () => {
    expect(formatAudioBackendLabel(' node-web-audio-api ')).toBe('node-web-audio-api');
    expect(formatAudioBackendLabel('  ')).toBe('-');
    expect(formatAudioBackendLabel(undefined)).toBe('-');
    expect(formatGenreLabel(' TRANCE ')).toBe('TRANCE');
    expect(formatGenreLabel('')).toBe('-');
    expect(formatGenreLabel(undefined)).toBe('-');
  });

  test('formatActiveAudioFiles lists up to four distinct file names', () => {
    expect(formatActiveAudioFiles([])).toBe('-');
    expect(formatActiveAudioFiles(['a/b/kick.wav', 'c\\snare.wav', 'x/kick.wav'])).toBe('kick.wav, snare.wav');
    expect(formatActiveAudioFiles(['1.wav', '2.wav', '3.wav', '4.wav', '5.wav', '6.wav'])).toBe(
      '1.wav, 2.wav, 3.wav, 4.wav ... +2',
    );
  });
});

describe('formatGrooveGaugeLine', () => {
  test('draws the gauge bar between borders with the percentage', () => {
    const summary = createSummary({
      gauge: { current: 80, clearThreshold: 80, max: 100 } as PlayerSummary['gauge'],
    });
    expect(stripANSI(formatGrooveGaugeLine(summary, 12, 1))).toBe(` ┃${'█'.repeat(8)}${'░'.repeat(2)}┃ 80%`);
  });

  test('is - without a gauge', () => {
    expect(formatGrooveGaugeLine(createSummary({}), 12)).toBe('-');
  });
});

describe('judge and combo display state', () => {
  test('starts empty and resets to empty', () => {
    const state = createJudgeComboDisplayState();
    expect(state).toEqual({ latestJudge: '-', combo: 0, updatedAtMs: 0 });
    Object.assign(state, { latestJudge: 'GREAT', combo: 12, updatedAtMs: 500 });
    resetJudgeComboDisplayState(state);
    expect(state).toEqual({ latestJudge: '-', combo: 0, updatedAtMs: 0 });
  });

  test('resolveVisibleJudgeComboLabel shows the latest judge for a second', () => {
    const state = { latestJudge: 'GOOD', combo: 5, updatedAtMs: 1000 };
    expect(resolveVisibleJudgeComboLabel(state, 1500, false)).toBe(formatJudgeComboDisplay('GOOD', 5, 1500, false));
    expect(resolveVisibleJudgeComboLabel(state, 2001, false)).toBe('');
    expect(resolveVisibleJudgeComboLabel(createJudgeComboDisplayState(), 1500, false)).toBe('');
  });

  test('resolveVisibleJudgeComboLabel shows PAUSE while paused', () => {
    expect(stripANSI(resolveVisibleJudgeComboLabel(createJudgeComboDisplayState(), 0, true))).toBe('PAUSE');
  });
});
