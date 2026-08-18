import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, defaultJudgeColor, parallelogramPoints } from './theme.ts';
import { resolveDefaultLaneTone } from './playfield.ts';

describe('parallelogramPoints', () => {
  it('shifts only the top edge by the skew', () => {
    expect(parallelogramPoints(10, 20, 30, 8, 4)).toEqual([14, 20, 44, 20, 40, 28, 10, 28]);
  });
});

describe('resolveDefaultLaneTone', () => {
  it('paints scratch lanes gold (hazard) for 7-key', () => {
    const tone = resolveDefaultLaneTone('16', 0, '7');
    expect(tone.body).toBe(DEFAULT_THEME.gold);
  });

  it('alternates cream and crimson on key lanes', () => {
    const cream = resolveDefaultLaneTone('11', 1, '7');
    const crimson = resolveDefaultLaneTone('12', 2, '7');
    expect(cream.body).toBe(DEFAULT_THEME.paper);
    expect(crimson.body).toBe(DEFAULT_THEME.crimson);
  });
});

describe('defaultJudgeColor', () => {
  it('maps each judgement name onto the cut-in palette', () => {
    expect(defaultJudgeColor('PERFECT')).toBe(DEFAULT_THEME.judgePerfect);
    expect(defaultJudgeColor('GREAT')).toBe(DEFAULT_THEME.judgeGreat);
    expect(defaultJudgeColor('POOR')).toBe(DEFAULT_THEME.judgePoor);
    expect(defaultJudgeColor('UNKNOWN')).toBe(DEFAULT_THEME.paper);
  });
});
