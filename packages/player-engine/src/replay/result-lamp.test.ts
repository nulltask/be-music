import { describe, expect, test } from 'vite-plus/test';
import type { ReplayRulesetResult } from './format.ts';
import { resolveRulesetResultLamp } from './result-lamp.ts';

function result(
  gauge: { type: string; cleared: boolean },
  judge: Partial<ReplayRulesetResult['judge']> = {},
): ReplayRulesetResult {
  const counts = { pgreat: 10, great: 5, good: 2, bad: 1, poor: 1, emptyPoor: 3, ...judge };
  return {
    ruleset: 'lr2/0',
    judge: counts,
    fast: 0,
    slow: 0,
    exScore: 25,
    // Every note judged, as in a simulated result that reached the end of its chart.
    noteCount: counts.pgreat + counts.great + counts.good + counts.bad + counts.poor,
    maxCombo: 10,
    gauge: { ...gauge, final: 80 },
  };
}

describe('resolveRulesetResultLamp', () => {
  test('a run that did not clear is FAILED whatever its judgments', () => {
    expect(resolveRulesetResultLamp(result({ type: 'HARD', cleared: false }, { bad: 0, poor: 0 }), 'lr2')).toBe(
      'FAILED',
    );
  });

  test.each([
    ['ASSIST-EASY', 'beatoraja', 'ASSIST_EASY'],
    ['ASSISTED-EASY', 'iidx', 'ASSIST_EASY'],
    ['EASY', 'lr2', 'EASY'],
    ['GROOVE', 'lr2', 'NORMAL'],
    ['NORMAL', 'beatoraja', 'NORMAL'],
    ['HARD', 'iidx', 'HARD'],
    ['EX-HARD', 'beatoraja', 'EX_HARD'],
    ['DEATH', 'lr2', 'NORMAL'],
    ['DEATH', 'beatoraja', 'EX_HARD'],
    ['HAZARD', 'beatoraja', 'EX_HARD'],
    ['SOMETHING-NEW', 'lr2', 'NORMAL'],
  ] as const)('a cleared %s gauge under %s gives lamp %s', (type, ruleset, lamp) => {
    expect(resolveRulesetResultLamp(result({ type, cleared: true }), ruleset)).toBe(lamp);
  });

  test('no BAD and no missed POOR is a FULL COMBO, empty POORs notwithstanding', () => {
    const fullCombo = result({ type: 'EASY', cleared: true }, { bad: 0, poor: 0, emptyPoor: 9 });
    expect(resolveRulesetResultLamp(fullCombo, 'lr2')).toBe('FULL_COMBO');
  });

  test('beatoraja awards PERFECT and MAX; LR2 and IIDX stop at FULL COMBO', () => {
    const perfect = result({ type: 'NORMAL', cleared: true }, { bad: 0, poor: 0, good: 0 });
    const max = result({ type: 'NORMAL', cleared: true }, { bad: 0, poor: 0, good: 0, great: 0 });
    expect(resolveRulesetResultLamp(perfect, 'beatoraja')).toBe('PERFECT');
    expect(resolveRulesetResultLamp(max, 'beatoraja')).toBe('MAX');
    expect(resolveRulesetResultLamp(max, 'lr2')).toBe('FULL_COMBO');
    expect(resolveRulesetResultLamp(max, 'iidx')).toBe('FULL_COMBO');
  });

  test('a chart without notes takes its gauge’s lamp', () => {
    const empty = result({ type: 'HARD', cleared: true }, { pgreat: 0, great: 0, good: 0, bad: 0, poor: 0 });
    expect(resolveRulesetResultLamp(empty, 'beatoraja')).toBe('HARD');
  });
});
