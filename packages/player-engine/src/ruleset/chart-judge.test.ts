import { expect, test } from 'vite-plus/test';
import {
  applyChartGaugeModifiers,
  applyChartJudgeModifiers,
  HELLJUDGE_WINDOW_RATIOS,
  resolveChartJudgeOption,
} from './chart-judge.ts';
import type { GaugeSpec, JudgeWindowSetUs, RulesetWindowTables } from './definitions.ts';

const set: JudgeWindowSetUs = {
  judges: [
    [-21_000, 21_000],
    [-60_000, 60_000],
    [-120_000, 120_000],
    [-200_000, 200_000],
  ],
  ms: [0, 1_000_000],
};
const tables: RulesetWindowTables = { note: set, scratch: set, longNoteEnd: set, longScratchEnd: set };

test('no modifier keeps the tables', () => {
  expect(applyChartJudgeModifiers(tables, undefined)).toBe(tables);
  expect(applyChartJudgeModifiers(tables, {})).toBe(tables);
});

test('HELLJUDGE narrows each judgment by its own ratio on every table and keeps empty POOR', () => {
  const result = applyChartJudgeModifiers(tables, { hellJudge: true });
  for (const table of [result.note, result.scratch, result.longNoteEnd, result.longScratchEnd]) {
    // PGREAT and GREAT × 3/8, GOOD × 1/3, BAD × 1/4, rounded to whole microseconds.
    expect(table.judges).toEqual([
      [-7_875, 7_875],
      [-22_500, 22_500],
      [-40_000, 40_000],
      [-50_000, 50_000],
    ]);
    expect(table.ms).toEqual([0, 1_000_000]);
  }
  expect(HELLJUDGE_WINDOW_RATIOS).toEqual([3 / 8, 3 / 8, 1 / 3, 1 / 4]);
});

test('HELLJUDGE keeps an asymmetric window asymmetric', () => {
  const asymmetric: JudgeWindowSetUs = { ...set, judges: [...set.judges.slice(0, 3), [-280_000, 220_000]] as never };
  const result = applyChartJudgeModifiers({ ...tables, note: asymmetric }, { hellJudge: true });
  expect(result.note.judges[3]).toEqual([-70_000, 55_000]);
});

test('GOOD2BAD and GREAT2BAD leave the windows alone', () => {
  expect(applyChartJudgeModifiers(tables, { judge: 'GOOD2BAD' })).toBe(tables);
  expect(applyChartJudgeModifiers(tables, { judge: 'GREAT2BAD' })).toBe(tables);
});

const gauge: GaugeSpec = {
  id: 'GROOVE',
  min: 2,
  max: 100,
  initial: 20,
  border: 80,
  survival: false,
  values: [1, 1, 0.5, -4, -6, -2],
  guts: [],
};

test('GOOD2BAD gives GOOD the BAD gauge delta; GREAT2BAD gives it to GREAT and GOOD', () => {
  expect(applyChartGaugeModifiers(gauge, { judge: 'GOOD2BAD' }).values).toEqual([1, 1, -4, -4, -6, -2]);
  expect(applyChartGaugeModifiers(gauge, { judge: 'GREAT2BAD' }).values).toEqual([1, -4, -4, -4, -6, -2]);
  expect(applyChartGaugeModifiers(gauge, { hellJudge: true })).toBe(gauge);
  expect(applyChartGaugeModifiers(gauge, undefined)).toBe(gauge);
});

test('a program before version 3 keeps the earlier readings: halved windows, collapsed GOOD / GREAT, gauge untouched', () => {
  expect(applyChartJudgeModifiers(tables, { hellJudge: true, legacy: true }).note.judges).toEqual([
    [-10_500, 10_500],
    [-30_000, 30_000],
    [-60_000, 60_000],
    [-100_000, 100_000],
  ]);
  expect(applyChartJudgeModifiers(tables, { judge: 'GOOD2BAD', legacy: true }).note.judges[2]).toEqual([
    -60_000, 60_000,
  ]);
  const great = applyChartJudgeModifiers(tables, { judge: 'GREAT2BAD', legacy: true }).note.judges;
  expect(great[1]).toEqual([-21_000, 21_000]);
  expect(great[2]).toEqual([-21_000, 21_000]);
  expect(applyChartGaugeModifiers(gauge, { judge: 'GOOD2BAD', legacy: true })).toBe(gauge);
});

test('resolveChartJudgeOption picks only the judge modifiers', () => {
  expect(resolveChartJudgeOption(undefined)).toEqual({});
  expect(resolveChartJudgeOption({ version: 1, options: { random: 'MIRROR', addMine: true } })).toEqual({});
  expect(resolveChartJudgeOption({ version: 3, options: { judge: 'GOOD2BAD', hellJudge: true } })).toEqual({
    chartJudge: { judge: 'GOOD2BAD', hellJudge: true },
  });
  expect(resolveChartJudgeOption({ version: 1, options: { judge: 'GOOD2BAD', hellJudge: true } })).toEqual({
    chartJudge: { judge: 'GOOD2BAD', hellJudge: true, legacy: true },
  });
});
