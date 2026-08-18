import { describe, expect, it } from 'vitest';
import { defaultJudgeColor, DEFAULT_THEME, parallelogramPoints } from './theme.ts';

describe('default theme primitives', () => {
  it('skews the top edge of a parallelogram to the right', () => {
    expect(parallelogramPoints(10, 20, 100, 30, 18)).toEqual([28, 20, 128, 20, 110, 50, 10, 50]);
  });

  it('maps judge names onto the navy/cyan/gold palette', () => {
    expect(defaultJudgeColor('PERFECT')).toBe(DEFAULT_THEME.gold);
    expect(defaultJudgeColor('POOR')).toBe(DEFAULT_THEME.danger);
    expect(defaultJudgeColor('GREAT')).toBe(DEFAULT_THEME.great);
  });
});
