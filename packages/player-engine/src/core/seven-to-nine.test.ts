import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart, type ChartPlayVariant } from '@be-music/chart-model';
import { preparePlaybackChart } from './bootstrap.ts';
import { applySevenToNine, type SevenToNinePattern, type SevenToNineType } from './seven-to-nine.ts';
import type { TimedPlayableNote } from '../playable-notes.ts';

function note(channel: string, beat: number, endBeat?: number): TimedPlayableNote {
  return {
    channel,
    beat,
    seconds: beat * 0.4,
    judged: false,
    event: { measure: 0, position: [0, 1], channel, value: '01' },
    ...(endBeat !== undefined ? { endBeat, endSeconds: endBeat * 0.4, longNoteMode: 1 } : {}),
  };
}
function prepared(notes: TimedPlayableNote[], playVariant: ChartPlayVariant = '7') {
  const chart = preparePlaybackChart(resolveChart(parseBMS('#BPM 150'), { playVariant }));
  chart.notes = notes;
  chart.renderNotes = notes;
  chart.laneSoundNotes = [...notes];
  return chart;
}

test('the six source mappings place all keys and scratch on nine-key inputs without copying notes', () => {
  const cases = [
    [1, ['12', '13', '14', '15', '16', '17', '18', '11']],
    [2, ['13', '14', '15', '16', '17', '18', '19', '11']],
    [3, ['13', '14', '15', '16', '17', '18', '19', '12']],
    [4, ['11', '12', '13', '14', '15', '16', '17', '18']],
    [5, ['11', '12', '13', '14', '15', '16', '17', '19']],
    [6, ['12', '13', '14', '15', '16', '17', '18', '19']],
  ] as const;
  for (const [pattern, channels] of cases) {
    const source = ['11', '12', '13', '14', '15', '18', '19', '16'].map((channel) => note(channel, 0));
    const chart = prepared(source);
    applySevenToNine(chart, { sevenToNinePattern: pattern });
    expect(chart.notes.map((note) => note.channel)).toEqual(channels);
    expect(chart.notes.map((note) => note.event.channel)).toEqual(['11', '12', '13', '14', '15', '18', '19', '16']);
    expect(chart.notes).toBe(source);
    expect(chart.sevenToNineApplied).toBe(true);
    expect(chart.scorableNotes).toHaveLength(8);
    expect(chart.laneBindings.map((binding) => binding.channel)).toEqual([
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
      '17',
      '18',
      '19',
    ]);
    expect(chart.laneBindings.every((binding) => !binding.isScratch)).toBe(true);
    expect(chart.resolvedChart.playVariant).toBe('9');
    expect(chart.inputTokenToChannels.size).toBeGreaterThan(0);
  }
});

test('fixed, anti-repeat and alternating scratch use source last-hit times and strict threshold', () => {
  for (const [type, expected] of [
    [0, ['12', '12', '12']],
    [1, ['12', '11', '12']],
    [2, ['12', '11', '12']],
  ] as const) {
    const chart = prepared([note('16', 0), note('16', 0.25), note('16', 0.5)]);
    applySevenToNine(chart, { sevenToNinePattern: 3, sevenToNineType: type });
    expect(chart.notes.map((note) => note.channel)).toEqual(expected);
  }
  for (const [beat, expected] of [
    [0.3125, '11'],
    [0.315, '12'],
  ] as const) {
    const chart = prepared([note('16', 0), note('16', beat)]);
    applySevenToNine(chart, { sevenToNinePattern: 3, sevenToNineType: 1, hRandomThresholdBPM: 120 });
    expect(chart.notes[1]!.channel).toBe(expected);
  }
  const disabled = prepared([note('16', 0), note('16', 0.01)]);
  applySevenToNine(disabled, { sevenToNinePattern: 3, sevenToNineType: 1, hRandomThresholdBPM: 0 });
  expect(disabled.notes.map((note) => note.channel)).toEqual(['12', '12']);
});

test('scratch holds reserve their destination through the tail row; hidden rows never update hit time', () => {
  const chart = prepared([note('16', 0, 1), note('16', 1.1)]);
  chart.invisibleNotes = [note('16', 0.1), note('16', 1), note('16', 1.05)];
  applySevenToNine(chart, { sevenToNinePattern: 3, sevenToNineType: 2 });
  expect(chart.notes.map((note) => note.channel)).toEqual(['12', '11']);
  expect(chart.invisibleNotes.map((note) => note.channel)).toEqual(['12', '12', '11']);
  expect(chart.notes[0]).toMatchObject({ endBeat: 1, endSeconds: 0.4 });
});

test('mines participate in visible-row scratch timing and hidden objects follow the same row mapping', () => {
  const chart = prepared([note('16', 0.25)]);
  chart.landmineNotes = [{ ...note('16', 0), mine: true }];
  chart.invisibleNotes = [note('16', 0.125)];
  applySevenToNine(chart, { sevenToNinePattern: 3, sevenToNineType: 2 });
  expect(chart.landmineNotes[0]!.channel).toBe('12');
  expect(chart.invisibleNotes[0]!.channel).toBe('11');
  expect(chart.notes[0]!.channel).toBe('11');
});

test('OFF and unsupported source modes leave the arrangement intact; invalid parameters fail', () => {
  for (const playVariant of ['5', '9', '10', '14', '24', '48'] as const) {
    const chart = prepared([note('11', 0)], playVariant);
    applySevenToNine(chart, { sevenToNinePattern: 3 });
    expect(chart.resolvedChart.playVariant).toBe(playVariant);
    expect(chart.sevenToNineApplied).toBe(false);
    expect(chart.notes[0]!.channel).toBe('11');
  }
  const off = prepared([note('16', 0)]);
  applySevenToNine(off);
  expect(off.resolvedChart.playVariant).toBe('7');
  for (const value of [-1, 1.5, 7])
    expect(() => applySevenToNine(prepared([]), { sevenToNinePattern: value as SevenToNinePattern })).toThrow(
      RangeError,
    );
  expect(() => applySevenToNine(prepared([]), { sevenToNineType: 3 as SevenToNineType })).toThrow(RangeError);
  expect(() => applySevenToNine(prepared([]), { hRandomThresholdBPM: Number.NaN })).toThrow(RangeError);
});

test('ignored seven-key FREE ZONE objects do not become judged ninth-mode keys', () => {
  const chart = prepared([note('11', 0), note('17', 0)]);
  chart.invisibleNotes = [note('17', 0)];
  chart.landmineNotes = [{ ...note('17', 0), mine: true }];
  applySevenToNine(chart, { sevenToNinePattern: 3 });
  expect(chart.notes.map((note) => note.channel)).toEqual(['13']);
  expect(chart.scorableNotes).toHaveLength(1);
  expect(chart.invisibleNotes).toHaveLength(0);
  expect(chart.landmineNotes).toHaveLength(0);
  expect(chart.laneSoundNotes).toHaveLength(1);
});
