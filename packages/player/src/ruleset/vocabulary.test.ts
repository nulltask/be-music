import { createEmptyJSON } from '@be-music/json';
import { describe, expect, it } from 'vite-plus/test';
import { PLAYLOG_SIMULATOR_RULESETS } from '../playlog/simulate.ts';
import { isPlaylogRulesetId, PLAYLOG_RULESET_IDS, resolveJudgeWindowsMs } from './vocabulary.ts';

describe('judge ruleset ids', () => {
  it('lists the judge rulesets in the order the play-log simulators run them', () => {
    expect(PLAYLOG_RULESET_IDS).toEqual(['lr2', 'beatoraja', 'iidx']);
    expect(PLAYLOG_RULESET_IDS).toEqual(PLAYLOG_SIMULATOR_RULESETS);
  });

  it('knows the judge ruleset ids, in lower case', () => {
    expect(PLAYLOG_RULESET_IDS.every(isPlaylogRulesetId)).toBe(true);
    expect(isPlaylogRulesetId('LR2')).toBe(false);
    expect(isPlaylogRulesetId('popn')).toBe(false);
    expect(isPlaylogRulesetId('')).toBe(false);
    expect(isPlaylogRulesetId(undefined)).toBe(false);
    expect(isPlaylogRulesetId(['lr2'])).toBe(false);
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
