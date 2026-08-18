import { describe, expect, test } from 'vitest';
import { createEmptyRulesetNoteCounts, type RulesetChartFacts } from './facts.ts';
import { resolveRuleset } from './definitions.ts';
import {
  classifyRulesetJudge,
  goodWindowReachUs,
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
    expect(goodWindowReachUs(set)).toEqual([150_000, 150_000]);
  });

  test('IIDX windows are symmetric and rank independent', () => {
    const veryHard = resolveRuleset(facts({ judgeRank: { percent: 25, sourceRank: 0 } }), 'iidx').windows.note;
    const easy = resolveRuleset(facts({ judgeRank: { percent: 100, sourceRank: 3 } }), 'iidx').windows.note;

    expect(veryHard).toEqual(easy);
    expect(judgeWindowLateReachUs(veryHard)).toBe(250_000);
    expect(judgeWindowEarlyReachUs(veryHard)).toBe(250_000);
  });
});
