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
  for (const playVariant of ['9', '10', '14', '24', '48'] as const)
    expect(() => convertLR2SPToDPChart(resolveChart(source, { playVariant }))).toThrow(/5KEY or 7KEY/);
  for (const tempo of [0, -1, NaN, Infinity])
    expect(() => convertLR2SPToDPChart(resolveChart(source, { playVariant: '7' }), { tempo })).toThrow(/tempo/);
});
