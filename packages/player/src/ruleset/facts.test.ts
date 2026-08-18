import { describe, expect, test } from 'vitest';
import { countBaseNotes, createEmptyRulesetNoteCounts, resolveRuleset, type RulesetChartFacts } from './index.ts';

function facts(overrides: Partial<RulesetChartFacts> = {}): RulesetChartFacts {
  return {
    sourceFormat: 'bms',
    laneMode: '7keys',
    lnMode: 1,
    judgeRank: { percent: 75, sourceRank: 2 },
    notes: { ...createEmptyRulesetNoteCounts(), normal: 100 },
    ...overrides,
  };
}

describe('ruleset/facts', () => {
  test('countBaseNotes counts every long note once', () => {
    expect(countBaseNotes({ normal: 10, long: { 1: 2, 2: 3, 3: 4 } })).toBe(19);
    expect(countBaseNotes(createEmptyRulesetNoteCounts())).toBe(0);
  });

  test('judgment-note count follows each ruleset long-note style', () => {
    const chart = facts({ notes: { normal: 10, long: { 1: 1, 2: 1, 3: 1 } } });
    // LR2 plays every long as an LN → one judgment each.
    expect(resolveRuleset(chart, 'lr2').noteCount).toBe(13);
    // beatoraja honours the chart mode → LN 1, CN 2, HCN 2.
    expect(resolveRuleset(chart, 'beatoraja').noteCount).toBe(15);
    // IIDX plays every long as a charge note → head + tail each.
    expect(resolveRuleset(chart, 'iidx').noteCount).toBe(16);
  });

  test('selectedGauge maps the LR2-family pick onto each ruleset line-up', () => {
    const chart = facts();
    expect(resolveRuleset(chart, 'lr2', { selectedGauge: 'GROOVE' }).gauge.id).toBe('GROOVE');
    expect(resolveRuleset(chart, 'beatoraja', { selectedGauge: 'GROOVE' }).gauge.id).toBe('NORMAL');
    expect(resolveRuleset(chart, 'iidx', { selectedGauge: 'GROOVE' }).gauge.id).toBe('NORMAL');
    expect(resolveRuleset(chart, 'beatoraja', { selectedGauge: 'DEATH' }).gauge.id).toBe('HAZARD');
    // An explicit ruleset-scoped id wins over the mapping.
    expect(resolveRuleset(chart, 'beatoraja', { selectedGauge: 'GROOVE', gauge: 'EX-HARD' }).gauge.id).toBe('EX-HARD');
  });

  test('the debug judge-window override reaches the ruleset window tables', () => {
    const chart = facts();
    const base = resolveRuleset(chart, 'lr2');
    const overridden = resolveRuleset(chart, 'lr2', { judgeWindowOverrideMs: 120 });
    expect(base.windows.note.judges[3]).toEqual([-200_000, 200_000]);
    expect(overridden.windows.note.judges[3]).toEqual([-120_000, 120_000]);
  });

  test('LR2 resolves dynamic #EXRANK windows from the timeline, other rulesets ignore it', () => {
    const chart = facts({
      judgeRank: { percent: 75, sourceRank: 2, timeline: [{ timeUs: 5_000_000, exRankValue: 48 }] },
    });
    const lr2 = resolveRuleset(chart, 'lr2');
    expect(lr2.windowsAt(0).note.judges[0]).toEqual(lr2.windows.note.judges[0]);
    // After the change the PGREAT window narrows (EXRANK 48 → percent 36).
    expect(lr2.windowsAt(6_000_000).note.judges[0][1]).toBeLessThan(lr2.windows.note.judges[0][1]);

    const beatoraja = resolveRuleset(chart, 'beatoraja');
    expect(beatoraja.windowsAt(6_000_000)).toEqual(beatoraja.windows);
  });
});
