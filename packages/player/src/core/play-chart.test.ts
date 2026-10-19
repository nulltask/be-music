import { describe, expect, test } from 'vite-plus/test';
import { parseChart, resolveBMSControlFlowWithDraws } from '../../../parser/src/index.ts';
import { resolveChartRulesetFacts, resolvePlayChart } from './engine.ts';

const SOURCE = parseChart(
  ['#RANDOM 2', '#IF 1', '#00111:01', '#ENDIF', '#IF 2', '#00112:01', '#ENDIF', '#ENDRANDOM'].join('\n'),
  'bms',
);

describe('resolvePlayChart', () => {
  test('resolves the chart once and keeps the draws it was resolved with', () => {
    for (const [roll, value] of [
      [0, 1],
      [0.9, 2],
    ] as const) {
      const { chart, randomDraws } = resolvePlayChart(SOURCE, { random: () => roll });
      expect(randomDraws).toEqual([{ command: 'RANDOM', range: 2, value }]);
      expect(chart.events.map((event) => event.channel)).toEqual([value === 1 ? '11' : '12']);
      expect(chart.bms.controlFlow).toEqual([]);
      // The draws rebuild exactly the chart that plays.
      expect(resolveBMSControlFlowWithDraws(SOURCE, randomDraws)).toEqual(chart);
    }
  });

  test('resolves with given draws (a play log’s) without drawing', () => {
    const randomDraws = [{ command: 'RANDOM' as const, range: 2, value: 2 }];
    const resolved = resolvePlayChart(SOURCE, {
      randomDraws,
      random: () => {
        throw new Error('must not draw');
      },
    });
    expect(resolved.randomDraws).toBe(randomDraws);
    expect(resolved.chart.events.map((event) => event.channel)).toEqual(['12']);
  });

  test('a chart without control flow has no draws', () => {
    const plain = parseChart('#00111:01', 'bms');
    expect(resolvePlayChart(plain, { random: () => 0.5 })).toEqual({ chart: plain, randomDraws: [] });
  });
});

describe('resolveChartRulesetFacts', () => {
  test('counts the chart notes a ruleset needs, taking the first #RANDOM branch', () => {
    const json = parseChart(
      [
        '#TOTAL 300',
        '#00111:01',
        '#00112:01',
        '#RANDOM 2',
        '#IF 1',
        '#00213:01',
        '#ENDIF',
        '#IF 2',
        '#00214:0101',
        '#ENDIF',
        '#ENDRANDOM',
      ].join('\n'),
      'bms',
    );
    const facts = resolveChartRulesetFacts(json);
    expect(facts).toMatchObject({ sourceFormat: 'bms', total: 300, lnMode: 1 });
    expect(facts.notes.normal).toBe(3);
    expect(resolveChartRulesetFacts(json)).toEqual(facts);
  });
});
