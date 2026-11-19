import { parseBMS, parseChart, resolveBMSControlFlow } from '@be-music/chart-parser';
import { stringifyBMS } from '@be-music/chart-writer';
import { expect, test } from 'vite-plus/test';
import { computeChartFingerprint, resolveChart } from './index.ts';

test.each([false, true])('uses the last active LNOBJ with a later top-level override: %s', (override) => {
  const source = parseBMS(
    [
      '#BASE 62',
      '#LNOBJ AA',
      '#RANDOM 2',
      '#IF 1',
      '#LNOBJ aa',
      '#ENDIF',
      '#ENDRANDOM',
      ...(override ? ['#LNOBJ AA'] : []),
      '#00111:01AA02aa',
    ].join('\n'),
  );
  const resolve = (chart: typeof source, roll: number) => {
    const active = resolveBMSControlFlow(chart, { random: () => roll });
    return resolveChart(active).notes.map(({ kind, sampleKey }) => [kind, sampleKey]);
  };
  const uppercaseEnd = [
    ['ln', '01'],
    ['tap', '02'],
    ['tap', 'aa'],
  ];
  for (const chart of [source, parseChart(JSON.stringify(source), 'chart.json'), parseBMS(stringifyBMS(source))]) {
    expect(resolve(chart, 0)).toEqual(
      override
        ? uppercaseEnd
        : [
            ['tap', '01'],
            ['tap', 'AA'],
            ['ln', '02'],
          ],
    );
    expect(resolve(chart, 0.99)).toEqual(uppercaseEnd);
  }
});

test('earlier LNOBJ definitions do not change the fingerprint', () => {
  const chart = '#LNOBJ BB\n#00111:01AA02BB';
  const fingerprint = (bms: string) => computeChartFingerprint(parseBMS(bms), { chartPath: undefined });
  expect(fingerprint('#LNOBJ AA\n' + chart)).toBe(fingerprint(chart));
});

test('pairs LNOBJ with only the objects left once a later line of the same measure and channel overwrites one', () => {
  const notes = (lines: string[]) =>
    resolveChart(parseBMS(['#LNOBJ ZZ', ...lines].join('\n'))).notes.map(
      ({ kind, sampleKey, beat, endBeat }) => [kind, sampleKey, beat, endBeat] as const,
    );
  // An end object overwritten by a later line's note: that note starts the long note the next end object ends.
  expect(notes(['#00111:01', '#00211:ZZ', '#00211:02', '#00311:ZZ'])).toEqual([
    ['tap', '01', 4, undefined],
    ['ln', '02', 8, 12],
  ]);
  // A start overwritten by a later line's end object: the end object ends the note before it.
  expect(notes(['#00111:01', '#00211:02', '#00211:ZZ'])).toEqual([['ln', '01', 4, 8]]);
  // A note overwritten by a later line's note starts nothing.
  expect(notes(['#00111:01', '#00111:02', '#00211:ZZ'])).toEqual([['ln', '02', 4, 8]]);
});
