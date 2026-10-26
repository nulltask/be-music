import { expect, test } from 'vite-plus/test';
import {
  applyJudgeWindowRates,
  clampCustomJudgeRate,
  DEFAULT_BEATORAJA_CUSTOM_JUDGE,
  isCustomJudgeAssist,
} from './custom-judge.ts';
import { resolveRuleset, type JudgeWindowSetUs } from './definitions.ts';
import type { RulesetChartFacts } from './facts.ts';

const SET: JudgeWindowSetUs = {
  judges: [
    [-20000, 20000],
    [-60000, 60000],
    [-150000, 150000],
    [-280000, 220000],
  ],
  ms: [-150000, 500000],
};

test('rates scale PGREAT, GREAT and GOOD, clamped to BAD and kept monotonic', () => {
  expect(applyJudgeWindowRates(SET, [50, 400, 100]).judges).toEqual([
    [-10000, 10000],
    [-240000, 220000],
    [-240000, 220000],
    [-280000, 220000],
  ]);
  // A zero rate widens back to the window inside it (course NO GREAT).
  expect(applyJudgeWindowRates(SET, [100, 0, 0]).judges.slice(0, 3)).toEqual([
    [-20000, 20000],
    [-20000, 20000],
    [-20000, 20000],
  ]);
  expect(applyJudgeWindowRates(SET, [100, 100, 100])).toEqual(SET);
});

test('PlayerConfig ranges and the source assist test', () => {
  expect(clampCustomJudgeRate('keyPerfectGreat', 10)).toBe(25);
  expect(clampCustomJudgeRate('keyGood', -5)).toBe(0);
  expect(clampCustomJudgeRate('scratchGreat', 401.7)).toBe(400);
  expect(clampCustomJudgeRate('longNoteMargin', Number.NaN)).toBe(100);
  expect(isCustomJudgeAssist(DEFAULT_BEATORAJA_CUSTOM_JUDGE)).toBe(true);
  expect(
    isCustomJudgeAssist({
      ...DEFAULT_BEATORAJA_CUSTOM_JUDGE,
      keyPerfectGreat: 50,
      keyGreat: 100,
      scratchPerfectGreat: 100,
      scratchGreat: 100,
    }),
  ).toBe(false);
});

const CHART: RulesetChartFacts = {
  sourceFormat: 'bms',
  laneMode: '7',
  lnMode: 1,
  judgeRank: { percent: 100, sourceRank: 3 },
  notes: { normal: 10, long: { 1: 0, 2: 0, 3: 0 } },
};

test('beatoraja applies key rates to notes and both LN ends, scratch rates to scratch heads', () => {
  const plain = resolveRuleset(CHART, 'beatoraja');
  const custom = resolveRuleset(CHART, 'beatoraja', {
    customJudge: { ...DEFAULT_BEATORAJA_CUSTOM_JUDGE, keyPerfectGreat: 50, scratchPerfectGreat: 200 },
  });
  expect(custom.windows.note.judges[0]).toEqual(plain.windows.note.judges[0].map((leg) => leg / 2));
  expect(custom.windows.scratch.judges[0]).toEqual(plain.windows.scratch.judges[0].map((leg) => leg * 2));
  expect(custom.windows.longScratchEnd.judges[0]).toEqual(plain.windows.longScratchEnd.judges[0].map((leg) => leg / 2));
  expect(() => resolveRuleset(CHART, 'lr2', { customJudge: DEFAULT_BEATORAJA_CUSTOM_JUDGE })).toThrow(RangeError);
});

test('only the PMS key release margin takes the LN margin rate', () => {
  const pms: RulesetChartFacts = { ...CHART, laneMode: '9' };
  expect(
    resolveRuleset(pms, 'beatoraja', { customJudge: { ...DEFAULT_BEATORAJA_CUSTOM_JUDGE, longNoteMargin: 50 } })
      .longNoteReleaseMarginUs,
  ).toEqual({ note: 100_000, scratch: 0 });
});
