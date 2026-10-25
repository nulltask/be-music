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
    expect(LR2_GAUGE_TYPES).toEqual(['GROOVE', 'HARD', 'DEATH', 'EASY', 'P-ATTACK']);
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

it('SURVIVAL TO GROOVE continues after survival failure only for beatoraja', () => {
  expect(resolveGaugeEndOnFailure('SURVIVAL_TO_GROOVE', 'beatoraja')).toBe(false);
  expect(() => resolveGaugeEndOnFailure('SURVIVAL_TO_GROOVE', 'lr2')).toThrow(/beatoraja/);
  expect(() => resolveGaugeEndOnFailure('SURVIVAL_TO_GROOVE', '____')).toThrow(/beatoraja/);
});

it('BEST CLEAR keeps judging while the parallel gauges determine the effective outcome', () => {
  expect(resolveGaugeEndOnFailure('BEST_CLEAR', 'beatoraja')).toBe(false);
  expect(() => resolveGaugeEndOnFailure('BEST_CLEAR', 'lr2')).toThrow(/beatoraja/);
});

it('SELECT TO UNDER keeps judging without granting another source ruleset gauge shifting', () => {
  expect(resolveGaugeEndOnFailure('SELECT_TO_UNDER', 'beatoraja')).toBe(false);
  expect(() => resolveGaugeEndOnFailure('SELECT_TO_UNDER', '____')).toThrow(/beatoraja/);
});

it('offers P.ATTACK only for LR2 while preserving its recorded identifier', () => {
  expect(isGaugeType('P-ATTACK')).toBe(true);
  expect(resolveGaugeTypes('lr2')).toContain('P-ATTACK');
  expect(resolveGaugeTypes('beatoraja')).not.toContain('P-ATTACK');
  expect(resolveGaugeTypes('____')).not.toContain('P-ATTACK');
});
