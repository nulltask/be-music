import { describe, expect, test } from 'vite-plus/test';
import { makeChart, makeChartWith } from '../test-support/library.ts';
import { resolveLibraryChartDifficulty, resolveLibraryChartDifficultyValue } from './difficulty.ts';

describe('resolveLibraryChartDifficulty', () => {
  test("uses the chart's own #DIFFICULTY", () => {
    const chart = makeChartWith('song_7a', 'pack', { difficulty: 2 });
    expect(resolveLibraryChartDifficulty(chart)).toEqual({ value: 2, basis: 'chart' });
  });

  test('estimates one from the file name and subtitle when the chart names none', () => {
    expect(resolveLibraryChartDifficulty(makeChart('song_7a', 'pack'))).toEqual({ value: 4, basis: 'names' });
    const chart = makeChart('song', 'pack');
    chart.chart.metadata.subtitle = '[HYPER]';
    expect(resolveLibraryChartDifficulty(chart)).toEqual({ value: 3, basis: 'names' });
  });

  test('falls back to the note count when the names give none', () => {
    expect(resolveLibraryChartDifficulty(makeChart('song', 'pack', { totalNotes: 1500 }))).toEqual({
      value: 4,
      basis: 'notes',
    });
    expect(resolveLibraryChartDifficulty(makeChart('song_7n', 'pack', { totalNotes: 1500 }))).toEqual({
      value: 2,
      basis: 'names',
    });
  });

  test('gives none when neither the names nor the notes give one', () => {
    expect(resolveLibraryChartDifficulty(makeChart('song', 'pack'))).toBeUndefined();
    expect(resolveLibraryChartDifficultyValue(makeChart('song', 'pack'))).toBeUndefined();
  });

  test('lets an edited difficulty take over from the estimate', () => {
    const chart = makeChart('song_7a', 'pack');
    expect(resolveLibraryChartDifficultyValue(chart)).toBe(4);
    chart.chart.metadata.difficulty = 1;
    expect(resolveLibraryChartDifficulty(chart)).toEqual({ value: 1, basis: 'chart' });
  });

  test('reads the chart path when the entry has no file label', () => {
    const { chart } = makeChart('song', 'pack');
    expect(resolveLibraryChartDifficulty({ chart, chartPath: 'pack/song_SPN.bms' })).toEqual({
      value: 2,
      basis: 'names',
    });
  });
});
