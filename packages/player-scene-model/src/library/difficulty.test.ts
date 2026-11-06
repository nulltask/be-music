import { describe, expect, test } from 'vite-plus/test';
import { estimateChartDifficulty } from './difficulty.ts';

describe('estimateChartDifficulty', () => {
  test('keeps a #DIFFICULTY the chart names', () => {
    expect(estimateChartDifficulty({ difficulty: 2, title: 'X [ANOTHER]', notes: 3000 })).toBe(2);
  });

  test('reads a difficulty name in the subtitle first, then in the title', () => {
    expect(estimateChartDifficulty({ title: 'Song [NORMAL]', subtitle: '[Hyper]', notes: 10 })).toBe(3);
    expect(estimateChartDifficulty({ title: 'Song [Another]', subtitle: '', notes: 10 })).toBe(4);
    expect(estimateChartDifficulty({ difficulty: 0, title: 'Song', subtitle: 'LEGGENDARIA', notes: 10 })).toBe(5);
    expect(estimateChartDifficulty({ title: 'Song', subtitle: '-beginner-', notes: 3000 })).toBe(1);
  });

  test('falls back to the note count', () => {
    expect(
      [249, 250, 599, 600, 999, 1000, 1999, 2000].map((notes) => estimateChartDifficulty({ title: 'Song', notes })),
    ).toEqual([1, 2, 2, 3, 3, 4, 4, 5]);
  });
});
