import { describe, expect, test } from 'vitest';
import {
  applyGrooveGaugeJudge,
  applyGrooveGaugeRawDelta,
  createGrooveGaugeState,
  isGrooveGaugeCleared,
  LR2_GROOVE_GAUGE_DEFAULT_TOTAL,
} from './groove-gauge.ts';

describe('groove gauge', () => {
  test('uses LR2 default TOTAL when #TOTAL is omitted', () => {
    const gauge = createGrooveGaugeState(100, undefined);
    expect(gauge.effectiveTotal).toBe(LR2_GROOVE_GAUGE_DEFAULT_TOTAL);
    expect(gauge.current).toBe(20);
    expect(isGrooveGaugeCleared(gauge)).toBe(false);
  });

  test('applies LR2 groove gauge deltas per judge', () => {
    const gauge = createGrooveGaugeState(400, 200);

    expect(applyGrooveGaugeJudge(gauge, 'PERFECT')).toBeCloseTo(0.5, 9);
    expect(gauge.current).toBeCloseTo(20.5, 9);

    expect(applyGrooveGaugeJudge(gauge, 'GREAT')).toBeCloseTo(0.5, 9);
    expect(gauge.current).toBeCloseTo(21, 9);

    expect(applyGrooveGaugeJudge(gauge, 'GOOD')).toBeCloseTo(0.25, 9);
    expect(gauge.current).toBeCloseTo(21.25, 9);

    expect(applyGrooveGaugeJudge(gauge, 'BAD')).toBe(-4);
    expect(gauge.current).toBeCloseTo(17.25, 9);

    expect(applyGrooveGaugeJudge(gauge, 'POOR')).toBe(-6);
    expect(gauge.current).toBeCloseTo(11.25, 9);

    expect(applyGrooveGaugeJudge(gauge, 'EMPTY_POOR')).toBe(-2);
    expect(gauge.current).toBeCloseTo(9.25, 9);
  });

  test('clamps groove gauge to LR2 bounds', () => {
    const lowGauge = createGrooveGaugeState(1, 160);
    applyGrooveGaugeJudge(lowGauge, 'POOR');
    applyGrooveGaugeJudge(lowGauge, 'POOR');
    applyGrooveGaugeJudge(lowGauge, 'POOR');
    applyGrooveGaugeJudge(lowGauge, 'POOR');
    expect(lowGauge.current).toBe(2);

    const highGauge = createGrooveGaugeState(1, 400);
    for (let index = 0; index < 4; index += 1) {
      applyGrooveGaugeJudge(highGauge, 'PERFECT');
    }
    expect(highGauge.current).toBe(100);
    expect(isGrooveGaugeCleared(highGauge)).toBe(true);
  });

  test('HARD gauge uses the LR2 fixed recovery and TOTAL-scaled damage', () => {
    // TOTAL 240 → damage multiplier 1.0 (the top row of the LR2 fix1 table).
    const gauge = createGrooveGaugeState(20, 240, 'HARD');
    expect(gauge.current).toBe(100);

    expect(applyGrooveGaugeJudge(gauge, 'PERFECT')).toBeCloseTo(0.1, 9); // clamped at 100
    expect(applyGrooveGaugeJudge(gauge, 'BAD')).toBeCloseTo(-6, 9);
    expect(applyGrooveGaugeJudge(gauge, 'POOR')).toBeCloseTo(-10, 9);
    expect(applyGrooveGaugeJudge(gauge, 'EMPTY_POOR')).toBeCloseTo(-2, 9);
    expect(gauge.current).toBeCloseTo(82, 9);
    expect(applyGrooveGaugeJudge(gauge, 'GOOD')).toBeCloseTo(0.05, 9);
    expect(gauge.current).toBeCloseTo(82.05, 9);
  });

  test('HARD gauge damage scales with #TOTAL (LR2 fix1 table)', () => {
    // Default TOTAL 160 → ×2.0; TOTAL 100 (< 120) → ×10.
    const total160 = createGrooveGaugeState(20, 160, 'HARD');
    expect(applyGrooveGaugeJudge(total160, 'POOR')).toBeCloseTo(-20, 9);

    const total100 = createGrooveGaugeState(20, 100, 'HARD');
    expect(applyGrooveGaugeJudge(total100, 'POOR')).toBeCloseTo(-100, 9);
    expect(total100.current).toBe(0);
    expect(isGrooveGaugeCleared(total100)).toBe(false);

    // Recovery is TOTAL-independent.
    const recovery = createGrooveGaugeState(20, 100, 'HARD');
    applyGrooveGaugeJudge(recovery, 'BAD'); // -60, current 40
    expect(applyGrooveGaugeJudge(recovery, 'PERFECT')).toBeCloseTo(0.1, 9);
  });

  test('HARD gauge softens damage by 0.6 below 30 %', () => {
    const gauge = createGrooveGaugeState(20, 240, 'HARD');
    gauge.current = 30;
    expect(applyGrooveGaugeJudge(gauge, 'POOR')).toBeCloseTo(-10, 9); // exactly 30 — strict less-than, no guts
    expect(gauge.current).toBeCloseTo(20, 9);
    expect(applyGrooveGaugeJudge(gauge, 'POOR')).toBeCloseTo(-6, 9); // 20 < 30 — ×0.6
    expect(gauge.current).toBeCloseTo(14, 9);
  });

  test('survival gauges collapse below 2 % and never recover from 0', () => {
    const gauge = createGrooveGaugeState(20, 240, 'HARD');
    gauge.current = 7;
    applyGrooveGaugeJudge(gauge, 'POOR'); // guts: -6 → 1 → below the 2 % death threshold → 0
    expect(gauge.current).toBe(0);
    expect(isGrooveGaugeCleared(gauge)).toBe(false);

    expect(applyGrooveGaugeJudge(gauge, 'PERFECT')).toBe(0); // dead gauges never recover
    expect(gauge.current).toBe(0);
  });

  test('DEATH gauge follows the LR2 HAZARD table', () => {
    const gauge = createGrooveGaugeState(20, 160, 'DEATH');
    expect(applyGrooveGaugeJudge(gauge, 'EMPTY_POOR')).toBeCloseTo(-10, 9); // drains, not instant death
    expect(gauge.current).toBeCloseTo(90, 9);
    expect(applyGrooveGaugeJudge(gauge, 'GREAT')).toBeCloseTo(0.06, 9);
    expect(applyGrooveGaugeJudge(gauge, 'GOOD')).toBe(0);

    applyGrooveGaugeJudge(gauge, 'POOR'); // -100 → instant death
    expect(gauge.current).toBe(0);
    expect(isGrooveGaugeCleared(gauge)).toBe(false);
  });

  test('EASY gauge uses the LR2 1.2× gains / 0.8× damage and clears at 80 %', () => {
    const gauge = createGrooveGaugeState(400, 200, 'EASY'); // a = 0.5
    expect(gauge.clearThreshold).toBe(80);

    expect(applyGrooveGaugeJudge(gauge, 'PERFECT')).toBeCloseTo(0.6, 9); // 1.2a
    expect(applyGrooveGaugeJudge(gauge, 'GOOD')).toBeCloseTo(0.3, 9); // 0.6a
    expect(applyGrooveGaugeJudge(gauge, 'BAD')).toBeCloseTo(-3.2, 9);
    expect(applyGrooveGaugeJudge(gauge, 'POOR')).toBeCloseTo(-4.8, 9);
    expect(applyGrooveGaugeJudge(gauge, 'EMPTY_POOR')).toBeCloseTo(-1.6, 9);
  });

  test('applyGrooveGaugeRawDelta bypasses guts / TOTAL scaling but keeps the survival life rules', () => {
    const hard = createGrooveGaugeState(20, 100, 'HARD'); // TOTAL 100 would mean ×10 on judges — raw deltas ignore it
    hard.current = 25; // below the guts threshold — raw deltas ignore that too
    expect(applyGrooveGaugeRawDelta(hard, -10)).toBe(-10);
    expect(hard.current).toBeCloseTo(15, 9);

    applyGrooveGaugeRawDelta(hard, -14); // 1 → collapses below the 2 % death threshold
    expect(hard.current).toBe(0);
    expect(applyGrooveGaugeRawDelta(hard, 5)).toBe(0); // dead gauges never recover

    const groove = createGrooveGaugeState(20, 160, 'GROOVE');
    applyGrooveGaugeRawDelta(groove, -50);
    expect(groove.current).toBe(2); // GROOVE keeps its 2 % soft floor
  });
});
