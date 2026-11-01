import { expect, test } from 'vite-plus/test';
import {
  CHART_CHANGE_HS_OPTIONS,
  CHART_HIDDEN_OPTIONS,
  isChartVisualOptionValue,
  parseChartVisualOption,
  resolveChartChangeHSProgress,
  resolveChartCrazyScale,
  resolveChartCrazyXOffset,
  resolveChartHiddenAlpha,
  resolveChartNoteVisual,
} from './chart-option-visual.ts';

const input = (
  progress: number,
  extra: Partial<{ channel: string; beat: number; seconds: number; combo: number }> = {},
) => ({ progress, channel: '11', beat: 8, seconds: 0, ...extra });

test('parses exact-case modern IDs only, with OFF clearing its family', () => {
  expect(parseChartVisualOption('774:HIDDEN_HID-SUD2')).toEqual({ set: { hidden: 'HID-SUD2' }, clear: [] });
  expect(parseChartVisualOption('774:CHANGE-HS_OFF')).toEqual({ set: {}, clear: ['changeHS'] });
  expect(parseChartVisualOption('774:CRAZY_OFF')).toEqual({ set: {}, clear: ['crazySize', 'crazyWave'] });
  expect(parseChartVisualOption('774:CRAZY_XWAVE2')).toEqual({ set: { crazyWave: 'XWAVE2' }, clear: [] });
  for (const rejected of [
    '774:hidden_SUDDEN',
    '774:HIDDEN_M-SUDDEN',
    '774:CRAZY_SPIN',
    '774:HID-HIDDEN1',
    'HIDDEN_SUDDEN',
  ])
    expect(parseChartVisualOption(rejected)).toBeUndefined();
  expect(isChartVisualOptionValue('changeHS', 'CHAOS')).toBe(true);
  expect(isChartVisualOptionValue('hidden', 'CHAOS')).toBe(false);
});

test('HIDDEN edges, bands, mists, blink periods and stealth follow the documented formulas', () => {
  expect(resolveChartHiddenAlpha('HIDDEN', 0.29, 0)).toBe(0);
  expect(resolveChartHiddenAlpha('HIDDEN', 0.325, 0)).toBeCloseTo(0.5);
  expect(resolveChartHiddenAlpha('HIDDEN', 0.36, 0)).toBe(1);
  expect(resolveChartHiddenAlpha('HIDDEN3', 0.5, 0)).toBe(0);
  expect(resolveChartHiddenAlpha('SUDDEN', 0.6, 0)).toBe(1);
  expect(resolveChartHiddenAlpha('SUDDEN', 0.8, 0)).toBe(0);
  expect(resolveChartHiddenAlpha('SUDDEN3', 0.5, 0)).toBe(0);
  expect(resolveChartHiddenAlpha('HID-SUD', 0.5, 0)).toBe(1);
  expect(resolveChartHiddenAlpha('HID-SUD3', 0.6, 0)).toBe(0);
  expect(resolveChartHiddenAlpha('MIST', 0.9, 0)).toBe(0.35);
  expect(resolveChartHiddenAlpha('DEEPMIST', 0.9, 0)).toBe(0.1);
  expect(resolveChartHiddenAlpha('BLINK', 0.5, 0)).toBe(1);
  expect(resolveChartHiddenAlpha('BLINK', 0.5, 1)).toBeCloseTo(0);
  expect(resolveChartHiddenAlpha('BLINK2', 0.5, 2)).toBeCloseTo(0);
  expect(resolveChartHiddenAlpha('STEALTH', 0.5, 0)).toBe(0);
  expect(resolveChartHiddenAlpha(undefined, 0.5, 0)).toBe(1);
  // A note held on the line (negative progress) reads as on the line.
  expect(resolveChartHiddenAlpha('HIDDEN', -0.2, 0)).toBe(0);
});

test.each(CHART_CHANGE_HS_OPTIONS)(
  'CHANGE-HS %s keeps the line fixed, never slows a note below 1x at the top, and is monotonic',
  (option) => {
    for (const seconds of [0, 0.7, 3.3, 11]) {
      for (const combo of [0, 50, 500]) {
        const at = (progress: number) =>
          resolveChartChangeHSProgress(option, input(progress, { seconds, combo, beat: 3.5 }));
        expect(at(0)).toBe(0);
        expect(at(-0.25)).toBe(-0.25);
        expect(at(1)).toBeGreaterThanOrEqual(1);
        let previous = 0;
        for (let progress = 0.05; progress <= 1.5; progress += 0.05) {
          const value = at(progress);
          expect(value).toBeGreaterThanOrEqual(previous);
          previous = value;
        }
      }
    }
  },
);

test('CHANGE-HS values are deterministic per lane, note and clock', () => {
  const a = resolveChartChangeHSProgress('RANDOM', input(0.4, { beat: 2 }));
  expect(resolveChartChangeHSProgress('RANDOM', input(0.4, { beat: 2 }))).toBe(a);
  expect(resolveChartChangeHSProgress('RANDOM', input(0.4, { beat: 2.25 }))).not.toBe(a);
  expect(resolveChartChangeHSProgress('ACCEL', input(0.5))).toBe(0.625);
  expect(resolveChartChangeHSProgress('BRAKE', input(0.5))).toBe(0.375);
  expect(resolveChartChangeHSProgress('NAZO', input(0.4, { seconds: 1 }))).toBeCloseTo(0.6);
  expect(resolveChartChangeHSProgress('COMBO-UP', input(0.4, { combo: 0 }))).toBe(0.4);
  expect(resolveChartChangeHSProgress('COMBO-UP', input(0.4, { combo: 200 }))).toBe(0.8);
  expect(resolveChartChangeHSProgress('COMBO-DN', input(0.4, { combo: 200 }))).toBe(0.4);
  // WARP holds one factor for each two-second step.
  expect(resolveChartChangeHSProgress('WARP', input(0.4, { seconds: 2.1 }))).toBe(
    resolveChartChangeHSProgress('WARP', input(0.4, { seconds: 3.9 })),
  );
});

test('CRAZY size and X wave', () => {
  expect(resolveChartCrazyScale('SMALL', input(0.5))).toBe(0.6);
  expect(resolveChartCrazyScale('BIG', input(0.5))).toBe(1.4);
  expect(resolveChartCrazyScale('FADEIN', input(1))).toBeCloseTo(0.4);
  expect(resolveChartCrazyScale('FADEIN', input(0))).toBe(1);
  expect(resolveChartCrazyScale('FADEOUT', input(1))).toBe(1);
  expect(resolveChartCrazyScale('FADEOUT', input(0))).toBeCloseTo(0.4);
  const size = resolveChartCrazyScale('RD-SIZE', input(0.5));
  expect(size).toBeGreaterThanOrEqual(0.5);
  expect(size).toBeLessThan(1.5);
  expect(resolveChartCrazyXOffset('XWAVE', 0)).toBe(0);
  expect(resolveChartCrazyXOffset('XWAVE', 0.125)).toBeCloseTo(0.25);
  expect(resolveChartCrazyXOffset('XWAVE2', 1 / 12)).toBeCloseTo(0.5);
});

test('resolveChartNoteVisual composes the families on the displayed progress', () => {
  expect(resolveChartNoteVisual({}, input(0.5))).toEqual({ progress: 0.5, alpha: 1, scale: 1, xOffset: 0 });
  // ACCEL moves 0.5 to 0.625, past SUDDEN3's 0.4 ceiling.
  expect(resolveChartNoteVisual({ changeHS: 'ACCEL', hidden: 'SUDDEN3' }, input(0.5)).alpha).toBe(0);
  for (const option of CHART_HIDDEN_OPTIONS) {
    const alpha = resolveChartNoteVisual({ hidden: option }, input(0.5, { seconds: 0.4 })).alpha;
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThanOrEqual(1);
  }
});
