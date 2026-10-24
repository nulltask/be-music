import { describe, expect, it } from 'vite-plus/test';
import {
  GAUGE_TYPES,
  LR2_GAUGE_TYPES,
  isGaugeType,
  resolveGaugeTypes,
  resolveGaugeEndOnFailure,
} from './gauge-type.ts';

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

it('separates source ASSIST EASY from the original LR2 gauge choices', () => {
  expect(isGaugeType('ASSIST-EASY')).toBe(true);
  expect(resolveGaugeTypes('lr2')).not.toContain('ASSIST-EASY');
  expect(resolveGaugeTypes('beatoraja')).toContain('ASSIST-EASY');
  expect(resolveGaugeTypes('____')).toContain('ASSIST-EASY');
});

it('CONTINUE keeps the same dead gauge and NONE ends judging, with an explicit source gate', () => {
  expect(resolveGaugeEndOnFailure('CONTINUE', 'beatoraja', true)).toBe(false);
  expect(resolveGaugeEndOnFailure('NONE', 'beatoraja', false)).toBe(true);
  expect(resolveGaugeEndOnFailure(undefined, 'beatoraja', false)).toBe(false);
  expect(resolveGaugeEndOnFailure(undefined, 'lr2')).toBe(true);
  for (const ruleset of ['lr2', '____'] as const)
    expect(() => resolveGaugeEndOnFailure('CONTINUE', ruleset)).toThrow(/only for beatoraja/);
});
