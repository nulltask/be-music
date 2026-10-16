import { describe, expect, it } from 'vite-plus/test';
import { GAUGE_TYPES, isGaugeType } from './gauge-type.ts';

describe('gauge types', () => {
  it('lists the gauges in the order LR2’s gauge button cycles them', () => {
    expect(GAUGE_TYPES).toEqual(['GROOVE', 'HARD', 'DEATH', 'EASY']);
  });

  it('knows the gauge type names, in LR2’s spelling', () => {
    expect(GAUGE_TYPES.every(isGaugeType)).toBe(true);
    expect(isGaugeType('NORMAL')).toBe(false);
    expect(isGaugeType('hard')).toBe(false);
    expect(isGaugeType(undefined)).toBe(false);
  });
});
