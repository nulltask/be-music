import { expect, test } from 'vite-plus/test';
import { parseBMSBytes, parseBMS, resolveBMSControlFlowWithDraws } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { convertLR2ExtraChart } from './lr2-extra-chart.ts';
import { collectRealtimeAudioTriggers } from './engine-audio.ts';

const chart = (body: string, mode: '7' | '9' | '14' = '7') =>
  resolveChart(parseBMSBytes(new TextEncoder().encode(`#BPM 120\n${body}`)), { playVariant: mode });

test('LR2 EXTRA uses native sound families for notes and removes the converted BGM from background audio', () => {
  const source = chart('#WAV01 ki-1.wav\n#WAV02 ki-2.wav\n#00011:01\n#00101:02\n#00211:01');
  const result = convertLR2ExtraChart(source, { level: 0 });
  expect(result.chart.notes.map((note) => [note.channel, note.sampleKey, note.seconds])).toEqual([
    ['11', '01', 0],
    ['13', '02', 2],
    ['11', '01', 4],
  ]);
  expect(collectRealtimeAudioTriggers(result.chart, (channel) => channel === '01')).toEqual([]);
  expect(result.chart.sampleTriggers.find((trigger) => trigger.sampleKey === '02')).toMatchObject({
    channel: '13',
    samplePath: 'ki-2.wav',
    seconds: 2,
  });
  expect(result.chart.source).toBe(source.source);
  expect(source.notes).toHaveLength(2);
  expect(source.sampleTriggers.find((trigger) => trigger.sampleKey === '02')!.channel).toBe('01');
});

for (const authored of ['#LNOBJ ZZ\n#00011:01\n#00111:ZZ', '#LNTYPE 1\n#00051:01\n#00151:01']) {
  test(`LR2's EXTRA caller strips authored holds before conversion: ${authored.split('\n')[0]}`, () => {
    const source = chart(`${authored}\n#00101:01\n#00212:01`);
    expect(source.notes.some((note) => note.kind === 'ln')).toBe(true);
    const result = convertLR2ExtraChart(source, { level: 0 });
    expect(result.chart.notes.map((note) => [note.channel, note.seconds, note.kind, note.endBeat])).toEqual([
      ['11', 0, 'tap', undefined],
      ['11', 2, 'tap', undefined],
      ['12', 4, 'tap', undefined],
    ]);
    expect(source.notes[0]!.endBeat).toBe(4);
  });
}

test('DP scratch becomes source BGM and key conversions alternate from 2P', () => {
  const source = chart(
    '#WAV01 ki.wav\n#WAV03 sc.wav\n#00011:01\n#00021:01\n#00016:03\n#00101:01\n#00101:01\n#00211:01',
    '14',
  );
  const result = convertLR2ExtraChart(source, { level: 0 });
  expect(result.chart.notes.some((note) => note.channel === '16')).toBe(false);
  expect(result.chart.notes.filter((note) => note.beat === 4).map((note) => note.channel)).toEqual(['11', '21']);
  expect(
    collectRealtimeAudioTriggers(result.chart, (channel) => channel === '01').map((trigger) => trigger.sampleKey),
  ).toEqual(['03']);
});

test('PMS raw key routing follows LR2 before choosing and rendering an EXTRA destination', () => {
  const result = convertLR2ExtraChart(chart('#00016:01\n#00101:01\n#00216:01', '9'), { level: 0 });
  expect(result.chart.notes.map((note) => note.channel)).toEqual(['18', '18', '18']);
});

test('mines reserve normal raw ops with WAV00 and establish the source EXTRA cutoff', () => {
  const source = chart('#000D1:10\n#00101:01\n#002D1:10');
  const result = convertLR2ExtraChart(source, { level: 0 });
  expect(result.chart.notes.map((note) => [note.channel, note.seconds])).toEqual([['13', 2]]);
  expect(result.chart.mines.map((mine) => [mine.channel, mine.damage, mine.seconds])).toEqual(
    source.mines.map((mine) => [mine.channel, mine.damage, mine.seconds]),
  );
  expect(result.chart.mines.every((mine) => mine.event.channel === 'D1')).toBe(true);
});

test('tempo scales the source millisecond floor while converted note times remain in chart time', () => {
  const cells = Array<string>(32).fill('00');
  cells[9] = '01';
  const source = resolveChart(parseBMS(`#BPM 300\n#00011:01\n#00001:${cells.join('')}\n#00111:01`), {
    playVariant: '7',
  });
  const normal = convertLR2ExtraChart(source, { level: 0 });
  const fast = convertLR2ExtraChart(source, { level: 0, tempo: 2 });
  expect(normal.chart.notes[1]).toMatchObject({ channel: '11', seconds: 0.225 });
  expect(fast.chart.notes[1]).toMatchObject({ channel: '12', seconds: 0.225 });
});

test('EXTRA reads only the recorded active branch without consuming additional randomness', () => {
  const source = parseBMS(
    '#BPM 120\n#RANDOM 2\n#IF 1\n#WAV01 aa.wav\n#ELSE\n#WAV01 bb.wav\n#ENDIF\n#ENDRANDOM\n#WAV02 aa-2.wav\n#00011:01\n#00101:02\n#00211:01',
  );
  const draws = [{ command: 'RANDOM', range: 2, value: 1 }] as const;
  const resolved = resolveChart(resolveBMSControlFlowWithDraws(source, draws), {
    randomDraws: draws,
    playVariant: '7',
  });
  expect(convertLR2ExtraChart(resolved, { level: 0 }).chart.notes[1]).toMatchObject({ channel: '13', sampleKey: '02' });
});

test('unsupported source formats and tempo values do not acquire a new EXTRA interpretation', () => {
  const source = chart('#00111:01');
  for (const tempo of [0, -1, NaN, Infinity])
    expect(() => convertLR2ExtraChart(source, { level: 0, tempo })).toThrow(/tempo/);
  expect(() => convertLR2ExtraChart(resolveChart(parseBMS('#BASE 62\n#00111:01')), { level: 0 })).toThrow(
    /base-36 BMS/,
  );
});
