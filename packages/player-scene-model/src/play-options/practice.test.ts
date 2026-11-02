import { expect, test } from 'vite-plus/test';
import { DEFAULT_PLAY_OPTIONS } from './choices.ts';
import { keepPracticeGauge, resolvePracticeSelection, type PracticePlayOptions } from './practice.ts';

const OPTIONS: PracticePlayOptions = {
  practiceStartMs: 3000,
  practiceEndMs: 9000,
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
  expect(resolvePracticeSelection(OPTIONS, 'beatoraja')).toEqual({
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
  expect(resolvePracticeSelection({ ...OPTIONS, practiceGauge: 'DEATH' }, 'lr2')).toEqual({
    startMs: 3000,
    endMs: 9000,
    gauge: 'DEATH',
    startGauge: 40,
    judgeRank: 50,
    total: 300,
  });
});

test('AC PRACTICE sets only the range and the gauge (#933)', () => {
  expect(resolvePracticeSelection({ ...OPTIONS, practiceGauge: 'EX-HARD' }, '____')).toEqual({
    startMs: 3000,
    endMs: 9000,
    gauge: 'EX-HARD',
    startGauge: 40,
  });
});

test('a 0 END TIME, JUDGERANK or TOTAL keeps the chart’s', () => {
  expect(resolvePracticeSelection(DEFAULT_PLAY_OPTIONS, 'lr2')).toEqual({
    startMs: 0,
    gauge: 'GROOVE',
    startGauge: 20,
  });
});
