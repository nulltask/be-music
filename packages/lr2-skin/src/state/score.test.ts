import { createEmptyScore } from '@be-music/player/ruleset';
import { describe, expect, it } from 'vite-plus/test';
import { LR2_NUM } from '../ids/index.ts';
import { resolveLr2RateNumber } from './score.ts';

describe('resolveLr2RateNumber', () => {
  const score = { ...createEmptyScore(100), perfect: 50, great: 10, poor: 3, exScore: 110 };

  it('draws the rate over the notes judged so far on 102 / 103, truncated', () => {
    // 110 of 126 = 87.30… %.
    expect(resolveLr2RateNumber(LR2_NUM.SCORE_RATE, score)).toBe(87);
    expect(resolveLr2RateNumber(LR2_NUM.SCORE_RATE_AFTERDOT, score)).toBe(30);
  });

  it('draws the rate over every note on 115 / 116, truncated', () => {
    expect(resolveLr2RateNumber(LR2_NUM.TOTAL_RATE, score)).toBe(55);
    expect(resolveLr2RateNumber(LR2_NUM.TOTAL_RATE_AFTERDOT, score)).toBe(0);
    const almost = { ...score, exScore: 199 };
    expect(resolveLr2RateNumber(LR2_NUM.TOTAL_RATE, almost)).toBe(99);
    expect(resolveLr2RateNumber(LR2_NUM.TOTAL_RATE_AFTERDOT, almost)).toBe(50);
  });

  it('reads 0 before the first note, and nothing for other numbers', () => {
    expect(resolveLr2RateNumber(LR2_NUM.SCORE_RATE, createEmptyScore(100))).toBe(0);
    expect(resolveLr2RateNumber(LR2_NUM.SCORE_RATE_AFTERDOT, createEmptyScore(0))).toBe(0);
    expect(resolveLr2RateNumber(LR2_NUM.FPS, score)).toBeUndefined();
  });
});
