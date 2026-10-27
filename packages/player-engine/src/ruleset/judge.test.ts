import { describe, expect, test } from 'vite-plus/test';
import { createEmptyRulesetNoteCounts, type RulesetChartFacts } from './facts.ts';
import { resolveRuleset } from './definitions.ts';
import {
  classifyRulesetJudge,
  pgreatWindowReachUs,
  judgeWindowEarlyReachUs,
  judgeWindowLateReachUs,
  RULESET_JUDGE_NONE,
  selectJudgeWindowSet,
} from './judge.ts';

function facts(overrides: Partial<RulesetChartFacts> = {}): RulesetChartFacts {
  return {
    sourceFormat: 'bms',
    laneMode: '7K',
    lnMode: 1,
    judgeRank: { percent: 75, sourceRank: 2 },
    notes: { ...createEmptyRulesetNoteCounts(), normal: 100 },
    ...overrides,
  };
}

describe('ruleset judge windows', () => {
  test('selectJudgeWindowSet picks the table matching the lane kind and the note context', () => {
    const tables = resolveRuleset(facts(), 'beatoraja').windows;

    expect(selectJudgeWindowSet(tables, {})).toBe(tables.note);
    expect(selectJudgeWindowSet(tables, { scratch: true })).toBe(tables.scratch);
    expect(selectJudgeWindowSet(tables, { longNoteEnd: true })).toBe(tables.longNoteEnd);
    expect(selectJudgeWindowSet(tables, { scratch: true, longNoteEnd: true })).toBe(tables.longScratchEnd);
    // beatoraja is the ruleset that actually distinguishes them; LR2 shares one table across all four contexts,
    // so callers never have to know which rulesets differentiate.
    expect(tables.scratch).not.toEqual(tables.note);
    const lr2 = resolveRuleset(facts(), 'lr2').windows;
    expect(lr2.scratch).toEqual(lr2.note);
  });

  test("classifyRulesetJudge honours both legs of beatoraja's asymmetric BAD window", () => {
    // SEVENKEYS at judgerank 100. `dm = noteTime - inputTime`, so the pair reads [late bound, early bound]: BAD
    // reaches 280 ms LATE but only 220 ms early.
    const set = resolveRuleset(facts({ judgeRank: { percent: 100, sourceRank: 3 } }), 'beatoraja').windows.note;
    expect(set.judges[3]).toEqual([-280_000, 220_000]);

    expect(classifyRulesetJudge(-250_000, set)).toBe(3); // 250 ms late — inside
    expect(classifyRulesetJudge(250_000, set)).toBe(RULESET_JUDGE_NONE); // 250 ms early — out of reach
    expect(classifyRulesetJudge(0, set)).toBe(0);
    expect(classifyRulesetJudge(-40_000, set)).toBe(1);
    expect(classifyRulesetJudge(100_000, set)).toBe(2);
  });

  test('the reaches follow the widest leg on each side, not the BAD window alone', () => {
    const set = resolveRuleset(facts({ judgeRank: { percent: 100, sourceRank: 3 } }), 'beatoraja').windows.note;

    expect(judgeWindowLateReachUs(set)).toBe(280_000);
    expect(judgeWindowEarlyReachUs(set)).toBe(220_000);
    expect(pgreatWindowReachUs(set)).toEqual([20_000, 20_000]);
  });

  test('That-Which-Must-Not-Be-Named windows are symmetric and rank independent', () => {
    const veryHard = resolveRuleset(facts({ judgeRank: { percent: 25, sourceRank: 0 } }), '____').windows.note;
    const easy = resolveRuleset(facts({ judgeRank: { percent: 100, sourceRank: 3 } }), '____').windows.note;

    expect(veryHard).toEqual(easy);
    expect(judgeWindowLateReachUs(veryHard)).toBe(250_000);
    expect(judgeWindowEarlyReachUs(veryHard)).toBe(250_000);
  });
});

describe('beatoraja scaled BAD limits', () => {
  test.each([
    ['5K', [-187500, 187500], [-200000, 200000], [-312500, 312500], [-325000, 325000]],
    ['7K', [-350000, 275000], [-362500, 287500], [-350000, 275000], [-362500, 287500]],
    ['24K', [-400000, 300000], [-400000, 300000], [-400000, 300000], [-400000, 300000]],
  ] as const)('scales all %s contexts above 100%%', (laneMode, note, scratch, tail, scratchTail) => {
    const windows = resolveRuleset(facts({ laneMode, judgeRank: { percent: 75, sourceRank: 4 } }), 'beatoraja').windows;
    expect(windows.note.judges[3]).toEqual(note);
    expect(windows.scratch.judges[3]).toEqual(scratch);
    expect(windows.longNoteEnd.judges[3]).toEqual(tail);
    expect(windows.longScratchEnd.judges[3]).toEqual(scratchTail);
  });

  test('includes both scaled BAD boundaries and excludes the next microsecond', () => {
    const set = resolveRuleset(facts({ judgeRank: { percent: 75, sourceRank: 4 } }), 'beatoraja').windows.note;
    expect([-350001, -350000, 275000, 275001].map((dm) => classifyRulesetJudge(dm, set))).toEqual([-1, 3, 3, -1]);
  });

  test('uses the same scaling for bmson judge_rank and BMS DEFEXRANK', () => {
    const bmson = resolveRuleset(
      facts({ sourceFormat: 'bmson', judgeRank: { percent: 75, sourceExRank: 150 } }),
      'beatoraja',
    ).windows;
    const bms = resolveRuleset(facts({ judgeRank: { percent: 150, sourceExRank: 200 } }), 'beatoraja').windows;
    expect(bms).toEqual(bmson);
    expect(bms.note.judges[3]).toEqual([-420000, 330000]);
  });

  test('keeps ordinary-rank scaling and PMS fixed BAD limits', () => {
    expect(resolveRuleset(facts(), 'beatoraja').windows.note.judges[3]).toEqual([-210000, 165000]);
    const pms = resolveRuleset(
      facts({ laneMode: '9K', judgeRank: { percent: 75, sourceRank: 4 } }),
      'beatoraja',
    ).windows;
    expect(pms.note.judges[0]).toEqual([-20000, 20000]);
    expect(pms.note.judges[3]).toEqual([-183000, 183000]);
    expect(pms.longNoteEnd.judges[3]).toEqual([-283000, 283000]);
  });
});
