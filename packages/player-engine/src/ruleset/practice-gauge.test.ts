import { expect, test } from 'vite-plus/test';
import {
  BEATORAJA_PRACTICE_GAUGE_TYPES,
  LR2_PRACTICE_GAUGE_TYPES,
  PRACTICE_GAUGE_TYPES,
  isPracticeGaugeType,
  practiceReadsJudgeRankAndTotal,
  resolveDefaultPracticeGauge,
  resolvePracticeGaugeTypes,
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
  for (const ruleset of ['lr2', 'beatoraja', '____'] as const)
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
  for (const ruleset of ['lr2', 'beatoraja', '____'] as const)
    expect(isPracticeGaugeType(resolveDefaultPracticeGauge(ruleset), ruleset)).toBe(true);
});

test('JUDGERANK and TOTAL take effect except under AC rules', () => {
  expect(practiceReadsJudgeRankAndTotal('lr2')).toBe(true);
  expect(practiceReadsJudgeRankAndTotal('beatoraja')).toBe(true);
  expect(practiceReadsJudgeRankAndTotal('____')).toBe(false);
});
