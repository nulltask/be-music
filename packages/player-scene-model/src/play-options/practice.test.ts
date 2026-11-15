import { expect, test } from 'vite-plus/test';
import { DEFAULT_PLAY_OPTIONS, resolvePlayOptionValue } from './choices.ts';
import {
  formatPracticeTime,
  keepPracticeGauge,
  practiceGaugeSource,
  resolvePracticeSelection,
  type PracticePlayOptions,
} from './practice.ts';

const RANGE = { startMs: 3000, endMs: 9000 };

const OPTIONS: PracticePlayOptions = {
  practiceGauge: 'HARD',
  practiceGaugeCategory: 'LR2',
  practiceStartGauge: 40,
  practiceJudgeRank: 50,
  practiceTotal: 300,
  practiceRestBefore: 2,
  practiceRestAfter: 0,
};

test('a PRACTICE gauge is the judge ruleset’s own, else its default', () => {
  expect(keepPracticeGauge('HAZARD', 'beatoraja')).toBe('HAZARD');
  expect(keepPracticeGauge('HAZARD', 'lr2')).toBe('GROOVE');
  expect(keepPracticeGauge('DEATH', 'lr2')).toBe('DEATH');
  expect(keepPracticeGauge('GROOVE', 'beatoraja')).toBe('NORMAL');
  expect(keepPracticeGauge('ASSISTED-EASY', '____')).toBe('ASSISTED-EASY');
  expect(keepPracticeGauge('EXCLASS', '____')).toBe('NORMAL');
});

test('beatoraja PRACTICE takes every setting', () => {
  expect(resolvePracticeSelection(OPTIONS, 'beatoraja', RANGE)).toEqual({
    startMs: 3000,
    endMs: 9000,
    gauge: 'HARD',
    gaugeCategory: 'LR2',
    startGauge: 40,
    restBarsBefore: 2,
    restBarsAfter: 0,
    judgeRank: 50,
    total: 300,
  });
});

test('LR2 PRACTICE has no GAUGE CATEGORY and reads JUDGERANK and TOTAL (#933)', () => {
  expect(resolvePracticeSelection({ ...OPTIONS, practiceGauge: 'DEATH' }, 'lr2', RANGE)).toEqual({
    startMs: 3000,
    endMs: 9000,
    gauge: 'DEATH',
    startGauge: 40,
    restBarsBefore: 2,
    restBarsAfter: 0,
    judgeRank: 50,
    total: 300,
  });
});

test('AC PRACTICE sets only the range and the gauge (#933)', () => {
  expect(resolvePracticeSelection({ ...OPTIONS, practiceGauge: 'EX-HARD' }, '____', RANGE)).toEqual({
    startMs: 3000,
    endMs: 9000,
    gauge: 'EX-HARD',
    startGauge: 40,
    restBarsBefore: 2,
    restBarsAfter: 0,
  });
});

test('no range plays the whole chart, and a 0 JUDGERANK or TOTAL keeps the chart’s', () => {
  expect(resolvePracticeSelection(DEFAULT_PLAY_OPTIONS, 'lr2')).toEqual({
    startMs: 0,
    gauge: 'GROOVE',
    startGauge: 20,
    // One bar of rest on either side by default.
    restBarsBefore: 1,
    restBarsAfter: 1,
  });
});

test('a range without an end, or one that does not end after its start, plays to the chart’s end', () => {
  expect(resolvePracticeSelection(DEFAULT_PLAY_OPTIONS, 'lr2', { startMs: 4000.6 })).toMatchObject({ startMs: 4000 });
  expect(resolvePracticeSelection(DEFAULT_PLAY_OPTIONS, 'lr2', { startMs: 4000, endMs: 4000 })).not.toHaveProperty(
    'endMs',
  );
});

test('formatPracticeTime writes m:ss.s, tenths rounded down', () => {
  expect(formatPracticeTime(83_456)).toBe('1:23.4');
  expect(formatPracticeTime(0)).toBe('0:00.0');
});

test('PRACTICE may play on another source’s gauge, qualified with it (ADR 0019)', () => {
  const borrowed = { ...OPTIONS, practiceGauge: 'beatoraja:ASSIST-EASY' } as const;
  // The pick and beatoraja's GAUGE CATEGORY follow a beatoraja gauge under LR2 judging.
  expect(resolvePracticeSelection(borrowed, 'lr2', RANGE)).toMatchObject({
    gauge: 'beatoraja:ASSIST-EASY',
    gaugeCategory: 'LR2',
  });
  // An LR2 gauge under beatoraja judging has no GAUGE CATEGORY.
  expect(
    resolvePracticeSelection({ ...OPTIONS, practiceGauge: 'lr2:G-ATTACK' }, 'beatoraja', RANGE),
  ).not.toHaveProperty('gaugeCategory');
  expect(practiceGaugeSource('beatoraja:ASSIST-EASY', 'lr2')).toBe('beatoraja');
  expect(practiceGaugeSource('GROOVE', 'lr2')).toBe('lr2');
  // A ruleset change keeps a qualified pick and resets a bare one the new ruleset lacks.
  expect(keepPracticeGauge('beatoraja:ASSIST-EASY', 'lr2')).toBe('beatoraja:ASSIST-EASY');
  expect(keepPracticeGauge('ASSIST-EASY', 'lr2')).toBe('GROOVE');
  // Stored settings take a qualified pick and refuse one its source lacks.
  expect(resolvePlayOptionValue('practiceGauge', 'beatoraja:ASSIST-EASY')).toBe('beatoraja:ASSIST-EASY');
  expect(resolvePlayOptionValue('practiceGauge', 'lr2:ASSIST-EASY')).toBeUndefined();
});
