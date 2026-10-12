import { parseChart, resolveBmsControlFlow } from '@be-music/parser';
import { describe, expect, test } from 'vite-plus/test';
import { resolvePlayChart } from './play-chart.ts';

// `#RANDOM 1` resolves without a draw; `#RANDOM 3` and `#SWITCH 2` draw.
const CONTROL_FLOW_CHART = [
  '#BPM 120',
  '#RANDOM 1',
  '#IF 1',
  '#00111:01',
  '#ENDIF',
  '#ENDRANDOM',
  '#RANDOM 3',
  '#IF 1',
  '#00112:01',
  '#ENDIF',
  '#IF 2',
  '#00113:01',
  '#ENDIF',
  '#IF 3',
  '#00114:01',
  '#ENDIF',
  '#ENDRANDOM',
  '#SWITCH 2',
  '#CASE 1',
  '#00215:01',
  '#SKIP',
  '#CASE 2',
  '#00218:01',
  '#SKIP',
  '#ENDSW',
].join('\n');

function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe('resolvePlayChart', () => {
  const source = parseChart(CONTROL_FLOW_CHART, 'bms');

  test('returns the resolved chart with the value of every #RANDOM / #SWITCH line in file order', () => {
    const resolved = resolvePlayChart(source, { random: sequence(0.5, 0.9) });
    expect(resolved.randomOutcomes).toEqual([1, 2, 2]);
    expect(resolved.chart).toEqual(resolveBmsControlFlow(source, { random: sequence(0.5, 0.9) }));
  });

  test('its outcomes rebuild the same chart', () => {
    const resolved = resolvePlayChart(source, { random: sequence(0.99, 0) });
    expect(resolved.randomOutcomes).toEqual([1, 3, 1]);
    expect(resolveBmsControlFlow(source, { outcomes: resolved.randomOutcomes })).toEqual(resolved.chart);
  });

  test('takes preset outcomes instead of drawing, and reports what it used', () => {
    const resolved = resolvePlayChart(source, {
      outcomes: [1, 3, 2],
      random: () => {
        throw new Error('no draw expected');
      },
    });
    expect(resolved.randomOutcomes).toEqual([1, 3, 2]);
    expect(resolved.chart).toEqual(resolvePlayChart(source, { random: sequence(0.99, 0.9) }).chart);
  });

  test('reports no outcomes for a chart without control flow', () => {
    const plain = parseChart(['#BPM 120', '#00111:01'].join('\n'), 'bms');
    const resolved = resolvePlayChart(plain);
    expect(resolved.randomOutcomes).toEqual([]);
    expect(resolved.chart.events).toEqual(plain.events);
  });
});
