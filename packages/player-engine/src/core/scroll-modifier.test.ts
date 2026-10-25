import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { createBeatAtSecondsResolverFromTimingResolver, resolveChart } from '@be-music/chart-model';
import { removeScrollChanges } from './scroll-modifier.ts';
import { preparePlaybackChart } from './bootstrap.ts';

const text =
  '#BPM 120\n#BPM01 240\n#STOP01 192\n#SCROLL01 2\n#SCROLL02 -1\n#LNOBJ AA\n#000SC:01\n#00011:01\n#00108:01\n#00112:01\n#00209:01\n#002SC:02\n#003D3:0A\n#00334:01\n#00301:02\n#00304:01\n#00412:AA';

test('REMOVE reparameterizes all sections and removes BPM/STOP/SCROLL changes while retaining every event time', () => {
  const json = parseChart(text, 'bms');
  const original = structuredClone(json);
  const source = resolveChart(json);
  const { chart, changed } = removeScrollChanges(source);
  expect(changed).toBe(true);
  expect(chart.timing.tempoPoints).toEqual([{ beat: 0, seconds: 0, bpm: 120 }]);
  expect(chart.timing.stopPoints).toEqual([]);
  expect(chart.scroll).toEqual([{ beat: 0, speed: 2 }]);
  expect(chart.notes.map((note) => [note.seconds, note.endSeconds])).toEqual(
    source.notes.map((note) => [note.seconds, note.endSeconds]),
  );
  expect(chart.mines.map((note) => note.seconds)).toEqual(source.mines.map((note) => note.seconds));
  expect(chart.invisibleNotes.map((note) => note.seconds)).toEqual(source.invisibleNotes.map((note) => note.seconds));
  expect(chart.notes[1]).toMatchObject({ beat: 4, seconds: 2, endBeat: 12, endSeconds: 6 });
  expect(chart.barLines).toEqual(source.barLines.map((beat) => source.timing.beatToSeconds(beat) * 2));
  expect(chart.sampleTriggers.map((trigger) => trigger.seconds)).toEqual(
    source.sampleTriggers.map((trigger) => trigger.seconds),
  );
  expect(chart.sampleTriggers.every((trigger) => trigger.beat === trigger.seconds * 2)).toBe(true);
  expect(chart.bga).toBe(source.bga);
  expect(chart.judgeRank).toBe(source.judgeRank);
  expect(chart.total).toEqual(source.total);
  for (const event of source.sortedEvents) {
    expect(chart.timing.eventToSeconds(event)).toBe(source.timing.eventToSeconds(event));
    expect(chart.beatResolver.eventToBeat(event)).toBe(source.timing.eventToSeconds(event) * 2);
  }
  const beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(chart.timing);
  expect(beatAtSeconds(3.5)).toBe(7); // Inside the original STOP, effective sections continue advancing.
  expect(chart.timing.beatToSeconds(7)).toBe(3.5);
  expect(json).toEqual(original);
});

test('the first timeline values are retained, and a selection without relevant changes is a distinct false fact', () => {
  for (const input of ['#BPM 120\n#00111:01', '#BPM 120\n#BPM01 240\n#00008:01\n#SCROLL01 -2\n#000SC:01\n#00111:01']) {
    const source = resolveChart(parseChart(input, 'bms'));
    const { chart, changed } = removeScrollChanges(source);
    expect(changed).toBe(false);
    expect(chart.notes[0]!.seconds).toBe(source.notes[0]!.seconds);
    expect(chart.timing.bpmAtBeat(100)).toBe(source.timing.bpmAtBeat(0));
    expect(chart.scroll[0]!.speed).toBe(source.scroll.at(-1)?.speed ?? 1);
  }
});

test('preparation applies REMOVE before LN additions and retains original next-timeline audio times', () => {
  const source = resolveChart(parseChart('#BPM 120\n#BPM01 240\n#00011:01\n#00108:01\n#00312:01', 'bms'));
  const original = preparePlaybackChart(source);
  const prepared = preparePlaybackChart(source, { scrollModifier: 'REMOVE', longNoteModifier: 'ADD_CN' }, 0, () => 0);
  expect(prepared.scrollModifierApplied).toBe('REMOVE');
  expect(prepared.scrollModifierChanged).toBe(true);
  expect(prepared.longNoteModifierChangeCount).toBeGreaterThan(0);
  expect(prepared.notes[0]).toMatchObject({ seconds: 0, endSeconds: 2, endBeat: 4, longNoteMode: 2 });
  expect(prepared.notes.map((note) => note.seconds)).toEqual(original.notes.map((note) => note.seconds));
  expect(original.resolvedChart).toBe(source);
  expect(original.notes[0]!.endSeconds).toBeUndefined();
});

test('bmson LN endpoints and STOP gaps use the same absolute-time coordinate transform', () => {
  const json = parseChart(
    JSON.stringify({
      version: '1.0.0',
      info: { title: 'Scroll', init_bpm: 120, mode_hint: 'beat-7k', resolution: 240 },
      bpm_events: [{ y: 960, bpm: 240 }],
      stop_events: [{ y: 1920, duration: 960 }],
      sound_channels: [{ name: 'note.wav', notes: [{ x: 1, y: 2880, l: 960, c: false }] }],
    }),
    'bmson',
  );
  const source = resolveChart(json);
  const { chart, changed } = removeScrollChanges(source);
  expect(changed).toBe(true);
  expect(chart.notes[0]).toMatchObject({ seconds: 5, beat: 10, endSeconds: 6, endBeat: 12 });
  expect(chart.notes[0]!.event).toBe(source.notes[0]!.event);
  expect(
    chart.sampleTriggers.map((trigger) => [
      trigger.seconds,
      trigger.sampleOffsetSeconds,
      trigger.sampleDurationSeconds,
    ]),
  ).toEqual(
    source.sampleTriggers.map((trigger) => [
      trigger.seconds,
      trigger.sampleOffsetSeconds,
      trigger.sampleDurationSeconds,
    ]),
  );
});
