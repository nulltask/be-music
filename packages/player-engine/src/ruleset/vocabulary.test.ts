import { createEmptyJSON } from '@be-music/chart-source';
import { describe, expect, it } from 'vite-plus/test';
import { REPLAY_SIMULATOR_RULESETS } from '../replay/simulate.ts';
import { isRulesetId, RULESET_IDS, resolveJudgeWindowsMs } from './vocabulary.ts';

describe('judge ruleset ids', () => {
  it('lists the judge rulesets in the order the replay simulators run them', () => {
    expect(RULESET_IDS).toEqual(['lr2', 'beatoraja', 'iidx']);
    expect(RULESET_IDS).toEqual(REPLAY_SIMULATOR_RULESETS);
  });

  it('knows the judge ruleset ids, in lower case', () => {
    expect(RULESET_IDS.every(isRulesetId)).toBe(true);
    expect(isRulesetId('LR2')).toBe(false);
    expect(isRulesetId('popn')).toBe(false);
    expect(isRulesetId('')).toBe(false);
    expect(isRulesetId(undefined)).toBe(false);
    expect(isRulesetId(['lr2'])).toBe(false);
  });
});

describe('judge windows on the ruleset entry', () => {
  it("resolves LR2's windows from the chart's #RANK", () => {
    const json = createEmptyJSON('bms');
    json.metadata.rank = 0;
    expect(resolveJudgeWindowsMs(json)).toEqual({ pgreat: 8, great: 24, good: 40, bad: 200 });
  });

  it('keeps every window inside a narrowed BAD window', () => {
    const json = createEmptyJSON('bms');
    json.metadata.rank = 3;
    expect(resolveJudgeWindowsMs(json, 50)).toEqual({ pgreat: 21, great: 50, good: 50, bad: 50 });
  });
});
