import { createEmptyJson } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicPlaylog } from '../playlog/format.ts';
import { rulesetChartFactsFromPlaylog } from '../playlog/rulesets.ts';
import {
  countBaseNotes,
  createEmptyRulesetNoteCounts,
  resolveBeatorajaDefaultTotal,
  resolveLr2DefaultTotal,
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

describe('ruleset/beatoraja bmson judge_rank default', () => {
  test('a bmson chart without `judge_rank` judges like `judge_rank: 100` (the bmson default), not like #RANK 2', () => {
    const json = createEmptyJson('bmson');
    expect(json.bmson.info.judgeRank).toBeUndefined();
    const chart = { scorableNotes: [], laneDisplayMode: '7 KEY SP' };
    const absent = resolveRuleset(rulesetChartFactsFromChart(json, chart), 'beatoraja').windows;
    json.bmson.info.judgeRank = 100;
    const explicit = resolveRuleset(rulesetChartFactsFromChart(json, chart), 'beatoraja').windows;
    expect(absent).toEqual(explicit);
    // beatoraja 7 KEY PGREAT at judgerank 100 is ±20 ms (it was ±15 ms, the NORMAL-rule rank-2 value of 75).
    expect(absent.note.judges[0]).toEqual([-20_000, 20_000]);
  });

  test('the play-log adapter, which records `sourceExRank` only when the chart sets it, resolves the same default', () => {
    const recorded = resolveRuleset(facts({ sourceFormat: 'bmson', judgeRank: { percent: 75 } }), 'beatoraja');
    const explicit = resolveRuleset(
      facts({ sourceFormat: 'bmson', judgeRank: { percent: 75, sourceExRank: 100 } }),
      'beatoraja',
    );
    expect(recorded.windows).toEqual(explicit.windows);
    // A BMS chart without #DEFEXRANK / #RANK still falls back to beatoraja's rank-2 judgerank.
    const bms = resolveRuleset(facts({ judgeRank: { percent: 75 } }), 'beatoraja');
    expect(bms.windows.note.judges[0]).toEqual([-15_000, 15_000]);
  });
});

describe('effective TOTAL', () => {
  // 100 base notes: LR2 default (100 / 5 + 200) × 0.8 = 176; beatoraja default max(260, 760.5 / 7.5) = 260.
  const lr2Default = resolveLr2DefaultTotal(100);
  const beatorajaDefault = resolveBeatorajaDefaultTotal(100);
  const defaults = { lr2: lr2Default, beatoraja: beatorajaDefault, iidx: lr2Default } as const;

  test('the default formulas give the expected values for 100 notes', () => {
    expect(lr2Default).toBeCloseTo(176, 9);
    expect(beatorajaDefault).toBe(260);
  });

  for (const id of ['lr2', 'beatoraja', 'iidx'] as const) {
    describe(id, () => {
      test('BMS #TOTAL is an absolute TOTAL', () => {
        expect(resolveRuleset(facts({ total: 300 }), id).effectiveTotal).toBe(300);
      });

      test('BMS without #TOTAL (or with #TOTAL <= 0) uses the ruleset default', () => {
        expect(resolveRuleset(facts(), id).effectiveTotal).toBeCloseTo(defaults[id], 9);
        expect(resolveRuleset(facts({ total: 0 }), id).effectiveTotal).toBeCloseTo(defaults[id], 9);
      });

      test('bmson total is a percentage of the ruleset default', () => {
        // The parser pins an absent bmson `total` to the spec default 100, so 100 and "absent" must agree.
        expect(resolveRuleset(facts({ sourceFormat: 'bmson' }), id).effectiveTotal).toBeCloseTo(defaults[id], 9);
        expect(resolveRuleset(facts({ sourceFormat: 'bmson', total: 100 }), id).effectiveTotal).toBeCloseTo(
          defaults[id],
          9,
        );
        expect(resolveRuleset(facts({ sourceFormat: 'bmson', total: 150 }), id).effectiveTotal).toBeCloseTo(
          defaults[id] * 1.5,
          9,
        );
      });

      test('bmson total 0 falls back to 100 % of the ruleset default (beatoraja BMSPlayerRule)', () => {
        expect(resolveRuleset(facts({ sourceFormat: 'bmson', total: 0 }), id).effectiveTotal).toBeCloseTo(
          defaults[id],
          9,
        );
      });
    });
  }

  test('the lr2 GROOVE gauge recovers from the effective TOTAL of a bmson chart', () => {
    // 100 % of the LR2 default over 100 notes: +1.76 per PGREAT, not +1.00 (an absolute TOTAL 100).
    const gauge = resolveRuleset(facts({ sourceFormat: 'bmson', total: 100 }), 'lr2').gauge;
    expect(gauge.values[0]).toBeCloseTo(lr2Default / 100, 9);
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

  test('a bmson play and its replay resolve the same effective TOTAL', () => {
    const json = createEmptyJson('bmson');
    json.metadata.total = 150;
    const scorableNotes = [{ channel: '11', seconds: 1, beat: 0, judged: false, event: {} as never }] as never;
    const fromChart = rulesetChartFactsFromChart(json, { scorableNotes, laneDisplayMode: '7keys' });
    const playlog: BeMusicPlaylog = {
      format: 'be-music-playlog',
      version: 1,
      clock: { unit: 'us', origin: 'chart-zero' },
      chart: {
        sourceFormat: 'bmson',
        laneMode: '7keys',
        total: 150,
        lnMode: 1,
        judgeRank: { percent: fromChart.judgeRank.percent },
        noteCount: 1,
        notes: [{ id: 0, channel: '11', type: 'normal', timeUs: 1_000_000 }],
      },
      inputs: [],
      play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE' },
    };
    const fromPlaylog = rulesetChartFactsFromPlaylog(playlog);
    expect(fromChart).toEqual(fromPlaylog);
    for (const id of ['lr2', 'beatoraja', 'iidx'] as const) {
      const live = resolveRuleset(fromChart, id).effectiveTotal;
      expect(resolveRuleset(fromPlaylog, id).effectiveTotal).toBe(live);
      // 150 % of the ruleset's default for one note, never an absolute TOTAL 150.
      const fallback = id === 'beatoraja' ? resolveBeatorajaDefaultTotal(1) : resolveLr2DefaultTotal(1);
      expect(live).toBeCloseTo(fallback * 1.5, 9);
    }
  });
});
