import { describe, expect, it } from 'vite-plus/test';
import { GAUGE_TYPES, LR2_GAUGE_TYPES, isGaugeType, resolveGaugeTypes } from './gauge-type.ts';

describe('gauge types', () => {
  it('lists the gauges in the order LR2’s gauge button cycles them', () => {
    expect(LR2_GAUGE_TYPES).toEqual(['GROOVE', 'HARD', 'DEATH', 'EASY']);
    expect(GAUGE_TYPES).toContain('EX-HARD');
  });

  it('knows the gauge type names, in LR2’s spelling', () => {
    expect(GAUGE_TYPES.every(isGaugeType)).toBe(true);
    expect(isGaugeType('NORMAL')).toBe(false);
    expect(isGaugeType('hard')).toBe(false);
    expect(isGaugeType(undefined)).toBe(false);
  });
});

it('offers EX-HARD only for its source rulesets, separately from HAZARD', () => {
  expect(resolveGaugeTypes('lr2')).not.toContain('EX-HARD');
  expect(resolveGaugeTypes('beatoraja')).toContain('EX-HARD');
  expect(resolveGaugeTypes('beatoraja')).toContain('DEATH');
  expect(resolveGaugeTypes('____')).toContain('EX-HARD');
  expect(resolveGaugeTypes('____')).not.toContain('DEATH');
});
