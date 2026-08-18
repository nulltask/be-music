import { createEmptyJson } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import type { BeMusicPlaylog } from '../playlog/format.ts';
import { rulesetChartFactsFromPlaylog } from '../playlog/rulesets.ts';
import {
  countBaseNotes,
  createEmptyRulesetNoteCounts,
  resolveRuleset,
  rulesetChartFactsFromChart,
  type RulesetChartFacts,
} from './index.ts';

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

describe('ruleset chart-facts adapters agree', () => {
  test('the engine adapter and the play-log adapter derive the same facts from one chart', () => {
    // A live play and a replay of that same play must resolve the SAME ruleset, so the two adapters have to agree.
    const json = createEmptyJson('bms');
    json.metadata.rank = 2;
    json.metadata.total = 300;
    json.bms.lnMode = 2;

    const scorableNotes = [
      { channel: '11', seconds: 1, beat: 0, judged: false, event: {} as never },
      { channel: '12', seconds: 2, endSeconds: 3, beat: 0, judged: false, event: {} as never },
    ] as never;
    const fromChart = rulesetChartFactsFromChart(json, { scorableNotes, laneDisplayMode: '7keys' });

    const playlog: BeMusicPlaylog = {
      format: 'be-music-playlog',
      version: 1,
      clock: { unit: 'us', origin: 'chart-zero' },
      chart: {
        sourceFormat: 'bms',
        laneMode: '7keys',
        total: 300,
        lnMode: 2,
        judgeRank: { percent: 75, sourceRank: 2 },
        noteCount: 2,
        notes: [
          { id: 0, channel: '11', type: 'normal', timeUs: 1_000_000 },
          { id: 1, channel: '12', type: 'long', timeUs: 2_000_000, endTimeUs: 3_000_000, lnMode: 2 },
        ],
      },
      inputs: [],
      play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE' },
    };
    const fromPlaylog = rulesetChartFactsFromPlaylog(playlog);

    expect(fromChart).toEqual(fromPlaylog);
    // …and therefore resolve identical rulesets.
    for (const id of ['lr2', 'beatoraja', 'iidx'] as const) {
      expect(resolveRuleset(fromChart, id).noteCount).toBe(resolveRuleset(fromPlaylog, id).noteCount);
      expect(resolveRuleset(fromChart, id).effectiveTotal).toBe(resolveRuleset(fromPlaylog, id).effectiveTotal);
    }
  });
});
