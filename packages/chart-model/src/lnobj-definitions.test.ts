import { parseBMS, resolveBMSControlFlow } from '@be-music/chart-parser';
import { stringifyBMS } from '@be-music/chart-writer';
import { expect, test } from 'vite-plus/test';
import { resolveChart } from './index.ts';

test('repeated LNOBJ declarations keep every active case-sensitive end marker', () => {
  const source = parseBMS(
    [
      '#BASE 62',
      '#LNOBJ AA',
      '#RANDOM 2',
      '#IF 1',
      '#LNOBJ aa',
      '#ENDIF',
      '#ENDRANDOM',
      '#LNOBJ AA',
      '#00111:01AA02aa',
    ].join('\n'),
  );
  const resolve = (chart: typeof source, roll: number) => {
    const active = resolveBMSControlFlow(chart, { random: () => roll });
    return resolveChart(active).notes.map(({ kind, sampleKey }) => [kind, sampleKey]);
  };
  for (const chart of [source, parseBMS(stringifyBMS(source))]) {
    expect(resolve(chart, 0)).toEqual([
      ['ln', '01'],
      ['ln', '02'],
    ]);
    expect(resolve(chart, 0.99)).toEqual([
      ['ln', '01'],
      ['tap', '02'],
      ['tap', 'aa'],
    ]);
  }
});
