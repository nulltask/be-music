import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { convertLR2SPToDPChart } from './lr2-sp-to-dp-chart.ts';
import { withChartOverrides } from './resolved-chart-overrides.ts';
import { preparePlaybackChart } from './bootstrap.ts';

for (const [input, output] of [
  ['5', '10'],
  ['7', '14'],
] as const) {
  test(`SP TO DP changes ${input}KEY to ${output}KEY while retaining source identity and keysounds`, () => {
    const source = resolveChart(parseBMS('#BPM 120\n#WAV01 ki.wav\n#WAV02 cl.wav\n#00111:01\n#00112:0002'), {
      playVariant: input,
    });
    const result = convertLR2SPToDPChart(source);
    expect(result.chart.playVariant).toBe(output);
    expect(result.chart.layouts[0]!.id).toBe(output);
    expect(result.chart.notes.map((note) => [note.channel, note.sampleKey])).toEqual([
      ['11', '01'],
      ['22', '02'],
    ]);
    expect(result.chart.sampleTriggers.find((trigger) => trigger.sampleKey === '02')).toMatchObject({
      channel: '22',
      samplePath: 'cl.wav',
    });
    expect(result.chart.source).toBe(source.source);
    expect(source.notes.map((note) => note.channel)).toEqual(['11', '12']);
    const prepared = preparePlaybackChart(source, { battleMode: 'SP-TO-DP' });
    expect(prepared.laneDisplayMode).toContain(output);
    expect(prepared.laneBindings.some((lane) => lane.channel === '22' && lane.side === '2P')).toBe(true);
    expect(
      prepared.inputTokenToChannels.get(prepared.laneBindings.find((lane) => lane.channel === '22')!.inputTokens[0]!),
    ).toContain('22');
  });
}

test('a moved long-note head retains its endpoint and the source remains unchanged', () => {
  const source = resolveChart(
    parseBMS('#BPM 120\n#WAV01 aa.wav\n#WAV02 bb.wav\n#LNOBJ ZZ\n#00111:01\n#00112:02\n#00212:ZZ'),
    { playVariant: '7' },
  );
  const result = convertLR2SPToDPChart(source);
  expect(result.chart.notes.find((note) => note.sampleKey === '02')).toMatchObject({
    kind: 'ln',
    channel: '22',
    endBeat: 8,
    endSeconds: 4,
  });
  expect(source.notes.find((note) => note.sampleKey === '02')!.channel).toBe('12');
});

test('heads moved onto a prior hold are suppressed with their triggers, including the exact tail boundary', () => {
  const original = resolveChart(parseBMS('#BPM 120\n#00111:01\n#00211:01\n#00311:01'), { playVariant: '7' });
  // Isolate conversion from the decoder's own overlap/coalescing rules.
  const source = withChartOverrides(original, {
    notes: original.notes.map((note, index) =>
      index === 0 ? { ...note, kind: 'ln', endBeat: 12, endSeconds: 6 } : note,
    ),
  });
  const result = convertLR2SPToDPChart(source);
  expect(result.chart.notes.map((note) => [note.channel, note.seconds])).toEqual([
    ['11', 2],
    ['21', 4],
  ]);
  expect(result.droppedObjectCount).toBe(1);
  expect(result.chart.sampleTriggers).toHaveLength(2);
});

test('native blank-measure timing makes the first zero-position scratch choose the same side as beta3', () => {
  const source = resolveChart(parseBMS('#BPM 120\n#00016:01'), { playVariant: '7' });
  expect(convertLR2SPToDPChart(source).chart.notes[0]).toMatchObject({ channel: '26', seconds: 0 });
});

test('course settings ignore conversion; EXTRA is applied before a non-course SP TO DP conversion', () => {
  const source = resolveChart(parseBMS('#BPM 120\n#LNOBJ ZZ\n#00111:01\n#00211:ZZ'), { playVariant: '7' });
  expect(preparePlaybackChart(source, { battleMode: 'SP-TO-DP', course: { kind: 'expert' } })).toMatchObject({
    battleMode: 'OFF',
    resolvedChart: { playVariant: '7' },
  });
  const prepared = preparePlaybackChart(source, { battleMode: 'SP-TO-DP', lr2ExtraMode: true });
  expect(prepared.resolvedChart.playVariant).toBe('14');
  expect(prepared.notes[0]!.endSeconds).toBeUndefined();
});

test('unsupported source modes and invalid tempos do not acquire a different conversion algorithm', () => {
  const source = parseBMS('#BPM 120\n#00111:01');
  // LR2 has no keyboard modes; 9KEY and double play take their own merges (PMStoSP, DPtoSP).
  for (const playVariant of ['24', '48'] as const)
    expect(() => convertLR2SPToDPChart(resolveChart(source, { playVariant }))).toThrow(/5, 7, 9, 10 or 14KEY/);
  for (const tempo of [0, -1, NaN, Infinity])
    expect(() => convertLR2SPToDPChart(resolveChart(source, { playVariant: '7' }), { tempo })).toThrow(/tempo/);
});

test('SP TO DP merges a 14KEY chart onto the 1P side (DP-TO-SP)', () => {
  // 120 BPM (minimum gap 250 ms): 21 at 2 s is alone on lane 1, 22 shares a row with 12, 26 shares a row with 16.
  const source = resolveChart(
    parseBMS('#BPM 120\n#WAV01 a.wav\n#WAV02 b.wav\n#00121:01\n#00212:01\n#00222:02\n#00316:01\n#00326:02\n#00411:01'),
    { playVariant: '14' },
  );
  const result = convertLR2SPToDPChart(source);
  expect(result.chart.playVariant).toBe('7');
  expect(result.chart.notes.map((note) => [note.channel, note.seconds])).toEqual([
    ['11', 2],
    ['12', 4],
    ['13', 4],
    ['16', 6],
    ['11', 8],
  ]);
  // The 2P scratch on the 1P scratch's row has no lane left: it sounds as BGM.
  expect(result.chart.sampleTriggers.find((trigger) => trigger.channel === '01')).toMatchObject({
    sampleKey: '02',
    seconds: 6,
  });
  expect(preparePlaybackChart(source, { battleMode: 'SP-TO-DP' }).laneDisplayMode).toContain('7');
});

test('SP TO DP folds a 9KEY chart onto seven keys (9-TO-7)', () => {
  // One measure on lanes 3..9 (right 9, left 3): every lane shifts two to the left.
  const source = resolveChart(
    parseBMS('#BPM 120\n#00113:01\n#00114:0001\n#00115:000001\n#00122:00000001\n#00125:0000000001'),
    {
      playVariant: '9',
    },
  );
  const result = convertLR2SPToDPChart(source);
  expect(result.chart.playVariant).toBe('7');
  expect(result.chart.notes.map((note) => note.channel)).toEqual(['11', '12', '13', '14', '19']);
});
