import { expect, test } from 'vite-plus/test';
import { DEFAULT_PLAY_OPTIONS } from './choices.ts';
import {
  formatPracticeTime,
  keepPracticeGauge,
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
  });
});

test('no range plays the whole chart, and a 0 JUDGERANK or TOTAL keeps the chart’s', () => {
  expect(resolvePracticeSelection(DEFAULT_PLAY_OPTIONS, 'lr2')).toEqual({
    startMs: 0,
    gauge: 'GROOVE',
    startGauge: 20,
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
