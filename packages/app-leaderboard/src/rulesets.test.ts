import { describe, expect, test } from 'vite-plus/test';
import { isOn } from './http/query.ts';
import { byRulesetOrder, isRuleset, RULESET_IDS } from './rulesets.ts';

describe('rulesets', () => {
  test('isRuleset accepts exactly the ranked rulesets', () => {
    expect(RULESET_IDS.every((id) => isRuleset(id))).toBe(true);
    expect(isRuleset('LR2')).toBe(false);
    expect(isRuleset(undefined)).toBe(false);
  });

  test('byRulesetOrder sorts into display order', () => {
    const sorted = [{ ruleset: 'iidx' }, { ruleset: 'lr2' }, { ruleset: 'beatoraja' }].sort(byRulesetOrder);
    expect(sorted.map((entry) => entry.ruleset)).toEqual(['lr2', 'beatoraja', 'iidx']);
  });
});

describe('isOn', () => {
  test('turns on for 1 and true only', () => {
    expect(['1', 'true'].map(isOn)).toEqual([true, true]);
    expect(['0', 'false', 'yes', '', undefined].map(isOn)).toEqual([false, false, false, false, false]);
  });
});
