import { describe, expect, test } from 'vite-plus/test';
import { makeChart, makeChartWith } from '../test-support/library.ts';
import { resolveLibraryChartDifficulty, resolveLibraryChartDifficultyValue } from './difficulty.ts';

describe('resolveLibraryChartDifficulty', () => {
  test("uses the chart's own #DIFFICULTY", () => {
    const chart = makeChartWith('song_7a', 'pack', { difficulty: 2 });
    expect(resolveLibraryChartDifficulty(chart)).toEqual({ value: 2, estimated: false });
  });

  test('estimates one from the file name and subtitle when the chart names none', () => {
    expect(resolveLibraryChartDifficulty(makeChart('song_7a', 'pack'))).toEqual({ value: 4, estimated: true });
    const chart = makeChart('song', 'pack');
    chart.chart.metadata.subtitle = '[HYPER]';
    expect(resolveLibraryChartDifficulty(chart)).toEqual({ value: 3, estimated: true });
  });

  test('gives none when neither names one', () => {
    expect(resolveLibraryChartDifficulty(makeChart('song', 'pack'))).toBeUndefined();
    expect(resolveLibraryChartDifficultyValue(makeChart('song', 'pack'))).toBeUndefined();
  });

  test('lets an edited difficulty take over from the estimate', () => {
    const chart = makeChart('song_7a', 'pack');
    expect(resolveLibraryChartDifficultyValue(chart)).toBe(4);
    chart.chart.metadata.difficulty = 1;
    expect(resolveLibraryChartDifficulty(chart)).toEqual({ value: 1, estimated: false });
  });

  test('reads the chart path when the entry has no file label', () => {
    const { chart } = makeChart('song', 'pack');
    expect(resolveLibraryChartDifficulty({ chart, chartPath: 'pack/song_SPN.bms' })).toEqual({
      value: 2,
      estimated: true,
    });
  });
});
