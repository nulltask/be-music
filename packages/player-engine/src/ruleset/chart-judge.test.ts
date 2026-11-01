import { expect, test } from 'vite-plus/test';
import { applyChartJudgeModifiers, resolveChartJudgeOption } from './chart-judge.ts';
import type { JudgeWindowSetUs, RulesetWindowTables } from './definitions.ts';

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

test('HELLJUDGE halves every judge window on every table and keeps empty POOR', () => {
  const result = applyChartJudgeModifiers(tables, { hellJudge: true });
  for (const table of [result.note, result.scratch, result.longNoteEnd, result.longScratchEnd]) {
    expect(table.judges).toEqual([
      [-10_500, 10_500],
      [-30_000, 30_000],
      [-60_000, 60_000],
      [-100_000, 100_000],
    ]);
    expect(table.ms).toEqual([0, 1_000_000]);
  }
});

test('GOOD2BAD and GREAT2BAD collapse windows as NO_GOOD / NO_GREAT, after halving', () => {
  expect(applyChartJudgeModifiers(tables, { judge: 'GOOD2BAD' }).note.judges[2]).toEqual([-60_000, 60_000]);
  const great = applyChartJudgeModifiers(tables, { judge: 'GREAT2BAD' }).note.judges;
  expect(great[1]).toEqual([-21_000, 21_000]);
  expect(great[2]).toEqual([-21_000, 21_000]);
  expect(great[3]).toEqual([-200_000, 200_000]);
  expect(applyChartJudgeModifiers(tables, { judge: 'GOOD2BAD', hellJudge: true }).note.judges).toEqual([
    [-10_500, 10_500],
    [-30_000, 30_000],
    [-30_000, 30_000],
    [-100_000, 100_000],
  ]);
});

test('resolveChartJudgeOption picks only the judge modifiers', () => {
  expect(resolveChartJudgeOption(undefined)).toEqual({});
  expect(resolveChartJudgeOption({ version: 1, options: { random: 'MIRROR', addMine: true } })).toEqual({});
  expect(resolveChartJudgeOption({ version: 1, options: { judge: 'GOOD2BAD', hellJudge: true } })).toEqual({
    chartJudge: { judge: 'GOOD2BAD', hellJudge: true },
  });
});
