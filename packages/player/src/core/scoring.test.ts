import { describe, expect, test } from 'vite-plus/test';
import {
  applyJudgeToSummary,
  createScoreTracker,
  LR2_MONEY_SCORE_MAX,
  resolveIidxSelectRankOp,
  type ScoreSummary,
} from './scoring.ts';

function createSummary(total: number): ScoreSummary {
  return {
    total,
    perfect: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    emptyPoor: 0,
    exScore: 0,
    score: 0,
  };
}

describe('score trackers', () => {
  test('resolves the DJ Rank select op', () => {
    expect(resolveIidxSelectRankOp({ total: 100, exScore: 178 })).toBe(200);
    expect(resolveIidxSelectRankOp({ total: 0, exScore: 0 })).toBeUndefined();
  });

  test("LR2's money score is (4PG + 2GR + GD) x 50000 / notes, capped at 200000", () => {
    const summary = createSummary(100);
    const tracker = createScoreTracker({ moneyScore: true });
    for (let index = 0; index < summary.total; index += 1) {
      applyJudgeToSummary(summary, 'PERFECT', tracker);
    }
    expect(summary.score).toBe(LR2_MONEY_SCORE_MAX);

    const mixed = createSummary(100);
    const mixedTracker = createScoreTracker({ moneyScore: true });
    for (let index = 0; index < 99; index += 1) {
      applyJudgeToSummary(mixed, 'PERFECT', mixedTracker);
    }
    applyJudgeToSummary(mixed, 'GREAT', mixedTracker);
    // (4x99 + 2x1) x 50000 / 100 — no combo term, unlike the invented curve this replaced.
    expect(mixed.score).toBe(Math.floor(((4 * 99 + 2) * 50000) / 100));
    expect(mixed.score).toBeLessThan(LR2_MONEY_SCORE_MAX);
  });

  test('rulesets without a money score report EX-SCORE instead', () => {
    const summary = createSummary(100);
    const tracker = createScoreTracker({ moneyScore: false });
    applyJudgeToSummary(summary, 'PERFECT', tracker);
    applyJudgeToSummary(summary, 'GREAT', tracker);
    applyJudgeToSummary(summary, 'GOOD', tracker);

    expect(summary.exScore).toBe(3);
    expect(summary.score).toBe(3);
  });

  test('latches maxCombo across combo breaks', () => {
    const summary = createSummary(20);
    const tracker = createScoreTracker();

    applyJudgeToSummary(summary, 'PERFECT', tracker);
    applyJudgeToSummary(summary, 'GREAT', tracker);
    applyJudgeToSummary(summary, 'GOOD', tracker);
    expect(tracker.combo).toBe(3);
    expect(tracker.maxCombo).toBe(3);

    applyJudgeToSummary(summary, 'BAD', tracker);
    expect(tracker.combo).toBe(0);
    expect(tracker.maxCombo).toBe(3); // BAD breaks the combo but never the latch

    applyJudgeToSummary(summary, 'PERFECT', tracker);
    applyJudgeToSummary(summary, 'PERFECT', tracker);
    expect(tracker.combo).toBe(2);
    expect(tracker.maxCombo).toBe(3); // a shorter rebuild does not move the latch

    applyJudgeToSummary(summary, 'POOR', tracker);
    expect(tracker.combo).toBe(0);
    expect(tracker.maxCombo).toBe(3);

    applyJudgeToSummary(summary, 'PERFECT', tracker);
    applyJudgeToSummary(summary, 'GREAT', tracker);
    applyJudgeToSummary(summary, 'GOOD', tracker);
    applyJudgeToSummary(summary, 'PERFECT', tracker);
    expect(tracker.combo).toBe(4);
    expect(tracker.maxCombo).toBe(4); // only a longer streak advances it
  });
});
