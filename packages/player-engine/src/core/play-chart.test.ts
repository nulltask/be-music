import { describe, expect, test } from 'vite-plus/test';
import { parseChart, resolveBMSControlFlowWithDraws } from '../../../chart-parser/src/index.ts';
import { resolveChartRulesetFacts, resolvePlayChart } from './engine.ts';
import { preparePlaybackChart } from './bootstrap.ts';
import { resolveEngineChart } from './play-chart.ts';
import { rulesetChartFactsFromChart } from '../ruleset/chart-facts.ts';

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

  test('resolves with given draws (a replay’s) without drawing', () => {
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
  test.each([
    ['5 KEY SP', '#LNMODE 2\n#00111:01\n#00117:01\n#00151:0101\n#001D1:01\n#00232:01', '.bms'],
    ['9 KEY (PMS-STD)', '#00111:01\n#00122:01\n#001D1:01\n#00232:01', '.pms'],
    ['5 KEY SP', '#001D1:01\n#00232:01', '.bms'],
    ['UNKNOWN', '#TITLE Empty', '.bms'],
  ])('matches playback facts for %s', (laneMode, input, laneModeExtension) => {
    const json = parseChart(input, 'bms');
    const options = { laneModeExtension };
    const playback = preparePlaybackChart(resolveEngineChart(json, options), options);
    const facts = resolveChartRulesetFacts(json, options);
    expect(facts.laneMode).toBe(laneMode);
    expect(facts).toEqual(rulesetChartFactsFromChart(json, playback));
  });

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
