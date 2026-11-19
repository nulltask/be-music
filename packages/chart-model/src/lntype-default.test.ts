import { parseBMS } from '@be-music/chart-parser';
import { expect, test } from 'vite-plus/test';
import { computeChartFingerprint, resolveChart } from './index.ts';

test.each([
  [
    '#00151:01010101',
    [
      [4, 5],
      [6, 7],
    ],
    [[4, 8]],
  ],
  [
    '#00151:00000101\n#00251:01010000',
    [
      [6, 7],
      [8, 9],
    ],
    [[6, 10]],
  ],
])('defaults to paired LNs across legacy object rows', (row, pairs, run) => {
  const source = '#BPM 120\n' + row;
  const omitted = parseBMS(source);
  const explicit1 = parseBMS('#LNTYPE 1\n' + source);
  const explicit2 = parseBMS('#LNTYPE 2\n' + source);
  const spans = (chart: typeof omitted, inferBmsLNTypeWhenMissing = false) =>
    resolveChart(chart, { inferBmsLNTypeWhenMissing }).notes.map(({ beat, endBeat }) => [beat, endBeat]);
  expect(spans(omitted)).toEqual(pairs);
  expect(spans(explicit1, true)).toEqual(pairs);
  expect(spans(omitted, true)).toEqual(run);
  expect(spans(explicit2)).toEqual(run);
  const fingerprint = (chart: typeof omitted) => computeChartFingerprint(chart, { chartPath: undefined });
  expect(fingerprint(omitted)).toBe(fingerprint(explicit1));
  expect(fingerprint(omitted)).not.toBe(fingerprint(explicit2));
});
