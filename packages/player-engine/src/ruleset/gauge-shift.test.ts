import { describe, expect, test } from 'vite-plus/test';
import { resolveRuleset, type RulesetId } from './definitions.ts';
import type { RulesetChartFacts } from './facts.ts';
import { resolveGaugeShiftBottomIndex, resolveGaugeShiftFallbackId, resolveGaugeShiftLadder } from './gauge-shift.ts';

const facts: RulesetChartFacts = {
  sourceFormat: 'bms',
  laneMode: '7K',
  lnMode: 1,
  judgeRank: { percent: 75, sourceRank: 2 },
  notes: { normal: 500, long: { 1: 0, 2: 0, 3: 0 } },
};

describe('resolveGaugeShiftLadder', () => {
  test('each ruleset shifts along its own single-play gauges, gentlest first', () => {
    expect(resolveGaugeShiftLadder('lr2')).toEqual(['EASY', 'GROOVE', 'HARD', 'DEATH']);
    expect(resolveGaugeShiftLadder('beatoraja')).toEqual([
      'ASSIST-EASY',
      'EASY',
      'NORMAL',
      'HARD',
      'EX-HARD',
      'HAZARD',
    ]);
    expect(resolveGaugeShiftLadder('____')).toEqual(['ASSISTED-EASY', 'EASY', 'NORMAL', 'HARD', 'EX-HARD']);
  });

  test('a course shifts along the ruleset’s course gauges', () => {
    expect(resolveGaugeShiftLadder('lr2', 'grade')).toEqual(['GRADE', 'GRADE-HARD', 'GRADE-DEATH']);
    expect(resolveGaugeShiftLadder('lr2', 'expert')).toEqual(['COURSE-EASY', 'COURSE', 'COURSE-HARD', 'COURSE-DEATH']);
    expect(resolveGaugeShiftLadder('lr2', 'nonstop')).toEqual(resolveGaugeShiftLadder('lr2', 'expert'));
    for (const ruleset of ['beatoraja', '____'] as const)
      expect(resolveGaugeShiftLadder(ruleset, 'grade')).toEqual(['CLASS', 'EXCLASS', 'EXHARDCLASS']);
  });
});

describe('resolveGaugeShiftBottomIndex', () => {
  test('reads the lowest auto-shift gauge on each ruleset’s ladder', () => {
    expect(resolveGaugeShiftBottomIndex('beatoraja', 'ASSIST-EASY')).toBe(0);
    expect(resolveGaugeShiftBottomIndex('beatoraja', 'EASY')).toBe(1);
    expect(resolveGaugeShiftBottomIndex('beatoraja', 'GROOVE')).toBe(2);
    expect(resolveGaugeShiftBottomIndex('____', 'ASSIST-EASY')).toBe(0);
    expect(resolveGaugeShiftBottomIndex('____', 'GROOVE')).toBe(2);
    expect(resolveGaugeShiftBottomIndex('beatoraja', undefined)).toBe(0);
  });

  test('LR2 lacks ASSIST EASY, so its lowest gauge is EASY', () => {
    expect(resolveGaugeShiftBottomIndex('lr2', 'ASSIST-EASY')).toBe(0);
    expect(resolveGaugeShiftBottomIndex('lr2', 'EASY')).toBe(0);
    expect(resolveGaugeShiftBottomIndex('lr2', 'GROOVE')).toBe(1);
  });

  test('a course starts from its gentlest course gauge whatever the pick', () => {
    for (const ruleset of ['lr2', 'beatoraja', '____'] as const)
      expect(resolveGaugeShiftBottomIndex(ruleset, 'GROOVE', 'grade')).toBe(0);
  });
});

test('SURVIVAL TO GROOVE falls back to each ruleset’s default recovery gauge', () => {
  expect(resolveGaugeShiftFallbackId('lr2')).toBe('GROOVE');
  expect(resolveGaugeShiftFallbackId('beatoraja')).toBe('NORMAL');
  expect(resolveGaugeShiftFallbackId('____')).toBe('NORMAL');
});

describe('resolveRuleset with gauge auto-shift under every ruleset (#933)', () => {
  const ids = (ruleset: RulesetId, options: Parameters<typeof resolveRuleset>[2]) =>
    resolveRuleset(facts, ruleset, options).gaugeBank?.specs.map((spec) => spec.id);

  test('BEST CLEAR runs the ruleset’s whole ladder in parallel', () => {
    expect(ids('lr2', { gaugeAutoShift: 'BEST_CLEAR' })).toEqual(['EASY', 'GROOVE', 'HARD', 'DEATH']);
    expect(ids('____', { gaugeAutoShift: 'BEST_CLEAR' })).toEqual([
      'ASSISTED-EASY',
      'EASY',
      'NORMAL',
      'HARD',
      'EX-HARD',
    ]);
    const lr2 = resolveRuleset(facts, 'lr2', { gaugeAutoShift: 'BEST_CLEAR', bottomShiftableGauge: 'GROOVE' });
    expect(lr2.gaugeBank).toMatchObject({ bottomIndex: 1 });
    expect(lr2.gaugeBank?.upperExclusive).toBeUndefined();
    // The ladder's gauges are the ruleset's own tables.
    expect(lr2.gaugeBank?.specs[2]).toEqual(resolveRuleset(facts, 'lr2', { selectedGauge: 'HARD' }).gauge);
  });

  test('SELECT TO UNDER stops at the picked gauge', () => {
    const lr2 = resolveRuleset(facts, 'lr2', { selectedGauge: 'HARD', gaugeAutoShift: 'SELECT_TO_UNDER' });
    expect(lr2.gaugeBank?.upperExclusive).toBe(3);
    const ac = resolveRuleset(facts, '____', { selectedGauge: 'EX-HARD', gaugeAutoShift: 'SELECT_TO_UNDER' });
    expect(ac.gaugeBank?.upperExclusive).toBe(5);
  });

  test('an attack gauge is off the ladder, so it plays alone', () => {
    for (const selectedGauge of ['P-ATTACK', 'G-ATTACK'])
      expect(resolveRuleset(facts, 'lr2', { selectedGauge, gaugeAutoShift: 'BEST_CLEAR' }).gaugeBank).toBeUndefined();
  });

  test('a course shifts along the course gauges, each starting from its carried value', () => {
    const config = resolveRuleset(facts, 'lr2', {
      gaugeAutoShift: 'BEST_CLEAR',
      course: { kind: 'grade', initialGauge: 70, initialGauges: { GRADE: 70, 'GRADE-HARD': 40, 'GRADE-DEATH': 0 } },
    });
    expect(config.gaugeBank?.specs.map((spec) => [spec.id, spec.initial])).toEqual([
      ['GRADE', 70],
      ['GRADE-HARD', 40],
      ['GRADE-DEATH', 0],
    ]);
    expect(config.gaugeBank?.bottomIndex).toBe(0);
    const ac = resolveRuleset(facts, '____', {
      selectedGauge: 'HARD',
      gaugeAutoShift: 'SELECT_TO_UNDER',
      course: { kind: 'grade', initialGauges: { CLASS: 90, EXCLASS: 50 } },
    });
    expect(ac.gauge).toMatchObject({ id: 'EXCLASS', initial: 50 });
    expect(ac.gaugeBank?.specs.map((spec) => spec.initial)).toEqual([90, 50, 100]);
    expect(ac.gaugeBank?.upperExclusive).toBe(2);
  });

  test('SURVIVAL TO GROOVE falls back from a survival gauge to the ruleset’s recovery gauge', () => {
    const lr2 = resolveRuleset(facts, 'lr2', { selectedGauge: 'HARD', gaugeAutoShift: 'SURVIVAL_TO_GROOVE' });
    expect(lr2.gaugeFallback).toEqual(resolveRuleset(facts, 'lr2').gauge);
    const ac = resolveRuleset(facts, '____', { selectedGauge: 'EX-HARD', gaugeAutoShift: 'SURVIVAL_TO_GROOVE' });
    expect(ac.gaugeFallback).toEqual(resolveRuleset(facts, '____').gauge);
    // AC's EASY can reach 0 without being a survival gauge; it never falls back.
    expect(
      resolveRuleset(facts, '____', { selectedGauge: 'EASY', gaugeAutoShift: 'SURVIVAL_TO_GROOVE' }).gaugeFallback,
    ).toBeUndefined();
  });
});
