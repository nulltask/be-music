import { parseBMS, parseChart, resolveBMSControlFlow } from '@be-music/chart-parser';
import { stringifyBMS } from '@be-music/chart-writer';
import { expect, test } from 'vite-plus/test';
import { computeChartFingerprint, resolveChart } from './index.ts';

test.each([
  ['#00111:01\n#00111:0200', '02'],
  ['#00111:0200\n#00111:01', '01'],
])('replaces colliding normal-channel objects in file order (%s)', (source, winner) => {
  const chart = parseBMS(source + '\n#00111:0003\n#00101:0400\n#00101:0500');
  const check = (json: typeof chart) => {
    const resolved = resolveChart(json);
    expect(resolved.notes.map((note) => note.sampleKey)).toEqual([winner, '03']);
    expect(resolved.shadowedNotes).toEqual([]);
    expect(json.events.filter((event) => event.channel === '01')).toHaveLength(2);
  };
  check(chart);
  check(parseChart(JSON.stringify(chart), 'chart.json'));
  check(parseBMS(stringifyBMS(chart)));
  chart.preservation.bms.objectLines = [];
  expect(
    resolveChart(parseBMS(stringifyBMS(chart, { maxResolution: 16 }))).notes.map((note) => note.sampleKey),
  ).toEqual([winner, '03']);
  const expected = parseBMS(`#00111:${winner}03\n#00101:0400\n#00101:0500`);
  expect(computeChartFingerprint(chart, { chartPath: undefined })).toBe(
    computeChartFingerprint(expected, { chartPath: undefined }),
  );
});

test('uses the file order of active RANDOM and SWITCH objects across top-level lines', () => {
  const chart = parseBMS(
    [
      '#00111:01',
      '#RANDOM 2',
      '#IF 1',
      '#00111:02',
      '#ENDIF',
      '#ENDRANDOM',
      '#00211:03',
      '#SETSWITCH 1',
      '#CASE 1',
      '#00211:04',
      '#ENDSW',
      '#00211:05',
    ].join('\n'),
  );
  const json = parseChart(JSON.stringify(chart), 'chart.json');
  expect(resolveChart(resolveBMSControlFlow(json, { random: () => 0 })).notes.map((note) => note.sampleKey)).toEqual([
    '02',
    '05',
  ]);
  expect(resolveChart(resolveBMSControlFlow(json, { random: () => 0.99 })).notes.map((note) => note.sampleKey)).toEqual(
    ['01', '05'],
  );
});

test('keeps the replacement keysound as BGM when a dedicated long note starts there', () => {
  const resolved = resolveChart(parseBMS('#LNTYPE 1\n#00111:01\n#00111:02\n#00151:0303'));
  expect(resolved.notes).toMatchObject([{ kind: 'ln', sampleKey: '03' }]);
  expect(resolved.shadowedNotes.map((note) => note.sampleKey)).toEqual(['02']);
});
