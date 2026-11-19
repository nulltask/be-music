import { expect, test } from 'vite-plus/test';
import {
  BEATORAJA_PRACTICE_GAUGE_TYPES,
  LR2_PRACTICE_GAUGE_TYPES,
  PRACTICE_GAUGE_TYPES,
  isPracticeGaugePick,
  isPracticeGaugeType,
  practiceReadsJudgeRankAndTotal,
  qualifyPracticeGaugePick,
  resolveDefaultPracticeGauge,
  resolvePracticeGaugeTypes,
  splitPracticeGaugePick,
} from './practice-gauge.ts';

test('PRACTICE lists the judge ruleset’s own gauges', () => {
  expect(resolvePracticeGaugeTypes('beatoraja')).toBe(BEATORAJA_PRACTICE_GAUGE_TYPES);
  expect(resolvePracticeGaugeTypes('lr2')).toEqual([
    'GROOVE',
    'HARD',
    'DEATH',
    'EASY',
    'P-ATTACK',
    'G-ATTACK',
    'DEATH-CORRECTED',
  ]);
  expect(resolvePracticeGaugeTypes('lr2')).toBe(LR2_PRACTICE_GAUGE_TYPES);
  expect(resolvePracticeGaugeTypes('____')).toEqual(['ASSISTED-EASY', 'EASY', 'NORMAL', 'HARD', 'EX-HARD']);
});

test('every ruleset’s gauges are a valid stored PRACTICE gauge, each once', () => {
  expect(new Set(PRACTICE_GAUGE_TYPES).size).toBe(PRACTICE_GAUGE_TYPES.length);
  for (const ruleset of ['lr2', 'beatoraja', '____', 'plugout'] as const)
    for (const gauge of resolvePracticeGaugeTypes(ruleset)) {
      expect(PRACTICE_GAUGE_TYPES).toContain(gauge);
      expect(isPracticeGaugeType(gauge, ruleset)).toBe(true);
    }
  expect(isPracticeGaugeType('HAZARD')).toBe(true);
  expect(isPracticeGaugeType('HAZARD', 'lr2')).toBe(false);
  expect(isPracticeGaugeType('GROOVE', 'beatoraja')).toBe(false);
  expect(isPracticeGaugeType('hard')).toBe(false);
  expect(isPracticeGaugeType(3)).toBe(false);
});

test('each ruleset starts PRACTICE on its default recovery gauge', () => {
  expect(resolveDefaultPracticeGauge('lr2')).toBe('GROOVE');
  expect(resolveDefaultPracticeGauge('beatoraja')).toBe('NORMAL');
  expect(resolveDefaultPracticeGauge('____')).toBe('NORMAL');
  for (const ruleset of ['lr2', 'beatoraja', '____', 'plugout'] as const)
    expect(isPracticeGaugeType(resolveDefaultPracticeGauge(ruleset), ruleset)).toBe(true);
});

test('JUDGERANK and TOTAL take effect except under AC rules', () => {
  expect(practiceReadsJudgeRankAndTotal('lr2')).toBe(true);
  expect(practiceReadsJudgeRankAndTotal('beatoraja')).toBe(true);
  expect(practiceReadsJudgeRankAndTotal('____')).toBe(false);
});

test('a PRACTICE gauge pick names a bare gauge or another source’s, qualified with it (ADR 0019)', () => {
  expect(splitPracticeGaugePick('GROOVE')).toEqual({ source: undefined, type: 'GROOVE' });
  expect(splitPracticeGaugePick('beatoraja:ASSIST-EASY')).toEqual({ source: 'beatoraja', type: 'ASSIST-EASY' });
  expect(splitPracticeGaugePick('____:ASSISTED-EASY')).toEqual({ source: '____', type: 'ASSISTED-EASY' });
  // A source's pick is on that source's own list, never a lookalike of another's.
  expect(splitPracticeGaugePick('lr2:ASSIST-EASY')).toBeUndefined();
  expect(splitPracticeGaugePick('beatoraja:GROOVE')).toBeUndefined();
  expect(splitPracticeGaugePick('unknown:HARD')).toBeUndefined();
  expect(splitPracticeGaugePick(3)).toBeUndefined();
  // A bare pick is the judge ruleset's own when one is given; a qualified one stands under every ruleset.
  expect(isPracticeGaugePick('beatoraja:ASSIST-EASY', 'lr2')).toBe(true);
  expect(isPracticeGaugePick('ASSIST-EASY', 'lr2')).toBe(false);
  expect(isPracticeGaugePick('ASSIST-EASY')).toBe(true);
  expect(isPracticeGaugePick('lr2:EX-HARD')).toBe(false);
  expect(qualifyPracticeGaugePick('beatoraja', 'ASSIST-EASY')).toBe('beatoraja:ASSIST-EASY');
});
