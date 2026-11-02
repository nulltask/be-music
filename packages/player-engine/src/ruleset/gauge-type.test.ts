import { describe, expect, it } from 'vite-plus/test';
import {
  GAUGE_AUTO_SHIFTS,
  GAUGE_TYPES,
  LR2_GAUGE_TYPES,
  isGaugeType,
  resolveGaugeTypes,
  resolveGaugeEndOnFailure,
} from './gauge-type.ts';

describe('gauge types', () => {
  it('lists the gauges in the order LR2’s gauge button cycles them', () => {
    expect(LR2_GAUGE_TYPES).toEqual(['GROOVE', 'HARD', 'DEATH', 'EASY', 'P-ATTACK', 'G-ATTACK']);
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

it('NONE ends judging when a survival gauge empties and every other policy keeps judging, under every ruleset', () => {
  expect(resolveGaugeEndOnFailure('NONE', false)).toBe(true);
  for (const policy of ['CONTINUE', 'SURVIVAL_TO_GROOVE', 'BEST_CLEAR', 'SELECT_TO_UNDER'] as const)
    expect(resolveGaugeEndOnFailure(policy, true)).toBe(false);
  expect(GAUGE_AUTO_SHIFTS).toEqual(['NONE', 'CONTINUE', 'SURVIVAL_TO_GROOVE', 'BEST_CLEAR', 'SELECT_TO_UNDER']);
});

it('keeps the host-level contract without a policy and rejects an unknown one', () => {
  expect(resolveGaugeEndOnFailure(undefined, false)).toBe(false);
  expect(resolveGaugeEndOnFailure(undefined)).toBe(true);
  expect(() => resolveGaugeEndOnFailure('SOMETIMES' as never)).toThrow(RangeError);
});
