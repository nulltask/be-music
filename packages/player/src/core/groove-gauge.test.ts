import { describe, expect, test } from 'vitest';
import {
  applyGrooveGaugeJudge,
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
});
