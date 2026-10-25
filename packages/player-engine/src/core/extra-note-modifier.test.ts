import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { toTimedPlayableNote, toTimedLandmineNote } from '../playable-notes.ts';
import { addExtraNotes, clampExtraNoteDepth } from './extra-note-modifier.ts';
import { collectRealtimeAudioTriggers } from './engine-audio.ts';

const chart = (body: string, variant: '7' | '9' | '14' = '7') =>
  resolveChart(parseChart(`#BPM 120\n${body}`, 'bms'), { playVariant: variant });
const prepare = (source: ReturnType<typeof chart>, depth = 1, scratch = false) => {
  const notes = source.notes.map(toTimedPlayableNote);
  return { notes, ...addExtraNotes(source, notes, source.mines.map(toTimedLandmineNote), { depth, scratch }) };
};

test('EXTRA depth has the source default and integer bounds', () => {
  expect([NaN, Infinity, -1, 0, 1.9, 100, 101].map(clampExtraNoteDepth)).toEqual([0, 0, 0, 0, 1, 100, 100]);
});

test('disabled EXTRA retains source chart, audio and note arrays', () => {
  const source = chart('#00101:01');
  const result = prepare(source, 0);
  expect(result.chart).toBe(source);
  expect(result.changes).toBe(0);
  expect(result.notes).toHaveLength(0);
  expect(source.sampleTriggers[0]!.channel).toBe('01');
});

test('EXTRA converts the first BGM and keeps the rest as background, without changing the source', () => {
  const source = chart('#00101:01\n#00101:02\n#00111:03');
  const result = prepare(source);
  expect(result.changes).toBe(1);
  expect(result.notes.map(({ channel, event }) => [channel, event.value])).toEqual([
    ['11', '03'],
    ['12', '01'],
  ]);
  expect(
    collectRealtimeAudioTriggers(result.chart, (channel) => channel === '01').map((trigger) => trigger.sampleKey),
  ).toEqual(['02']);
  expect(result.chart.sampleTriggers.find((trigger) => trigger.sampleKey === '01')!.event).toBe(result.notes[1]!.event);
  expect(source.notes).toHaveLength(1);
  expect(source.sampleTriggers.filter((trigger) => trigger.channel === '01')).toHaveLength(2);
});

test('source depth iterations can overwrite a converted note and remove both background sounds', () => {
  const source = chart('#00101:01\n#00101:01');
  const result = prepare(source, 2);
  expect(result.changes).toBe(2);
  expect(result.notes).toHaveLength(1);
  expect(result.notes[0]!.channel).toBe('11');
  expect(result.chart.sampleTriggers).toHaveLength(1);
  expect(result.chart.sampleTriggers[0]!.channel).toBe('11');
});

test('scratch inclusion follows source lane order and remembered WAVs reuse the same key', () => {
  const source = chart('#00101:01\n#00201:01');
  const excluded = prepare(source);
  expect(excluded.notes.map((note) => note.channel)).toEqual(['11', '11']);
  const included = prepare(source, 1, true);
  expect(included.notes.map((note) => note.channel)).toEqual(['16', '16']);
});

test('heads, held LNs, exact tails and mines block conversion, while hidden objects do not', () => {
  const source = chart(
    '#LNOBJ ZZ\n#00111:01\n#00311:ZZ\n#00101:02\n#00201:02\n#00301:02\n#00401:02\n#002D2:10\n#00131:03',
  );
  const result = prepare(source);
  expect(
    result.notes
      .filter((note) => note.event.channel !== '11' || note.event.value === '02')
      .map((note) => [note.beat, note.channel]),
  ).toEqual([
    [4, '12'],
    [8, '13'],
    [12, '12'],
    [16, '12'],
  ]);
  const hidden = prepare(chart('#00131:03\n#00101:02'));
  expect(hidden.notes[0]!.channel).toBe('11');
});

test('a completely occupied row retains all background sounds and has no actual assist change', () => {
  const source = chart(
    ['11', '12', '13', '14', '15', '18', '19'].map((lane) => `#001${lane}:01`).join('\n') + '\n#00101:02',
  );
  const result = prepare(source, 100);
  expect(result.changes).toBe(0);
  expect(result.chart).toBe(source);
});

test('DP and PMS use their full source lane domain', () => {
  expect(prepare(chart('#00101:01', '14'), 1, true).notes[0]!.channel).toBe('26');
  expect(prepare(chart('#00101:01', '9')).notes[0]!.channel).toBe('19');
});

test('bmson conversion retains slice offsets, lengths and sample identity', () => {
  const source = resolveChart(
    parseChart(
      JSON.stringify({
        version: '1.0.0',
        info: { init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
        sound_channels: [
          {
            name: 'a.wav',
            notes: [
              { x: 0, y: 0, l: 0, c: false },
              { x: 0, y: 240, l: 0, c: true },
            ],
          },
        ],
      }),
      'bmson',
    ),
  );
  const result = prepare(source);
  expect(result.changes).toBe(2);
  expect(result.chart.source).toBe(source.source);
  expect(result.chart.timing).toBe(source.timing);
  expect(
    result.chart.sampleTriggers.map(({ sampleKey, sampleOffsetSeconds, sampleDurationSeconds, sampleSliceId }) => [
      sampleKey,
      sampleOffsetSeconds,
      sampleDurationSeconds,
      sampleSliceId,
    ]),
  ).toEqual(
    source.sampleTriggers.map(({ sampleKey, sampleOffsetSeconds, sampleDurationSeconds, sampleSliceId }) => [
      sampleKey,
      sampleOffsetSeconds,
      sampleDurationSeconds,
      sampleSliceId,
    ]),
  );
  expect(result.chart.sampleTriggers.every((trigger) => trigger.channel === '11')).toBe(true);
});
