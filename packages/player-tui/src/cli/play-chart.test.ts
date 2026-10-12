import { describe, expect, test } from 'vite-plus/test';
import { parseChart, resolveBmsControlFlowWithDraws } from '../../../parser/src/index.ts';
import { resolvePlayChart } from './play-chart.ts';

const SOURCE = parseChart(
  ['#RANDOM 2', '#IF 1', '#00111:01', '#ENDIF', '#IF 2', '#00112:01', '#ENDIF', '#ENDRANDOM'].join('\n'),
  'bms',
);

describe('resolvePlayChart', () => {
  test('resolves the chart once and keeps the draws it was resolved with', () => {
    for (const [roll, channel] of [
      [0, '11'],
      [0.9, '12'],
    ] as const) {
      const { json, randomDraws } = resolvePlayChart(SOURCE, () => roll);
      expect(randomDraws).toEqual([{ command: 'RANDOM', range: 2, value: channel === '11' ? 1 : 2 }]);
      expect(json.events.map((event) => event.channel)).toEqual([channel]);
      expect(json.bms.controlFlow).toEqual([]);
      // The draws rebuild exactly the chart that plays.
      expect(resolveBmsControlFlowWithDraws(SOURCE, randomDraws)).toEqual(json);
    }
  });

  test('a chart without control flow has no draws', () => {
    const plain = parseChart('#00111:01', 'bms');
    expect(resolvePlayChart(plain, () => 0.5)).toEqual({ json: plain, randomDraws: [] });
  });
});
