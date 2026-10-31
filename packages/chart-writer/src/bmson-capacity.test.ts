import { expect, test } from 'vite-plus/test';
import { parseBmson, parseChart } from '@be-music/chart-parser';
import {
  createBeatResolver,
  createScrollTimeline,
  createPlayFingerprintDocument,
  createTimingResolver,
  resolveChart,
} from '@be-music/chart-model';
import { stringifyBMS, stringifyBmson } from './index.ts';

const count = 3_845;
function chart() {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
      sound_channels: Array.from({ length: count }, (_, index) => ({
        name: `sample-${index}.wav`,
        notes: [{ x: 1, y: index * 240 }],
      })),
      key_channels: [{ name: 'hidden.wav', notes: [{ x: 2, y: 0 }] }],
      mine_channels: [{ name: 'mine.wav', notes: [{ x: 3, y: 0, damage: 10 }] }],
      bpm_events: Array.from({ length: count }, (_, index) => ({ y: index * 240, bpm: 120 + index })),
      stop_events: Array.from({ length: count }, (_, index) => ({ y: index * 240, duration: index + 1 })),
      scroll_events: Array.from({ length: count }, (_, index) => ({ y: index * 240, rate: index + 1 })),
    }),
  );
}

test('preserves long keys through JSON, model resolution and canonical bmson serialization', () => {
  const source = chart();
  const json = parseChart(JSON.stringify(source), 'json');
  expect(json.resources).toEqual(source.resources);
  expect(json.bms.scroll).toEqual(source.bms.scroll);
  expect(json.events).toEqual(source.events);
  const resolved = resolveChart(json);
  expect(resolved.notes.filter((note) => note.kind === 'tap')).toHaveLength(count);
  expect(resolved.sampleTriggers.at(-1)?.samplePath).toBe(`sample-${count - 1}.wav`);
  expect(createTimingResolver(json).bpmAtBeat(count - 1)).toBe(120 + count - 1);
  expect(createScrollTimeline(json, createBeatResolver(json)).at(-1)?.speed).toBe(count);
  // Remove the preserved source so this exercises every canonical resource lookup.
  json.preservation.bmson.soundChannels = [];
  json.metadata.title = 'Canonical output';
  const output = JSON.parse(stringifyBmson(json));
  expect(output.sound_channels).toHaveLength(count);
  expect(output.sound_channels.at(-1).name).toBe(`sample-${count - 1}.wav`);
  expect(output.key_channels[0].name).toBe('hidden.wav');
  expect(output.mine_channels[0].name).toBe('mine.wav');
  expect(output.bpm_events.at(-1).bpm).toBe(120 + count - 1);
  expect(output.stop_events.at(-1).duration).toBe(count);
  expect(output.scroll_events.at(-1).rate).toBe(count);
  const reparsed = parseBmson(JSON.stringify(output));
  expect(resolveChart(reparsed).sampleTriggers.at(-1)?.samplePath).toBe(`sample-${count - 1}.wav`);
});

test.each([false, true])(
  'rejects overflowing BMS output explicitly (skip validation: %s)',
  (skipPreservationValidation) => {
    const json = chart();
    const before = JSON.stringify(json);
    expect(() => stringifyBMS(json, { skipPreservationValidation })).toThrow(/two-character BMS IDs/);
    expect(JSON.stringify(json)).toBe(before);
  },
);

test('keeps ordinary within-capacity bmson to BMS conversion', () => {
  const json = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120 },
      sound_channels: [{ name: 'sample.wav', notes: [{ x: 1, y: 0 }] }],
    }),
  );
  expect(stringifyBMS(json)).toContain('#WAV01 sample.wav');
});

test('fingerprints read exact STOP durations beyond the BMS capacity and honor edited resources', () => {
  const json = chart();
  const stops = createPlayFingerprintDocument(json, { chartPath: undefined }).timeline.filter(
    (event) => event.type === 'stop',
  );
  expect(stops.at(-1)?.v).toBe('769/48');
  json.resources.stop['101'] = 48;
  expect(
    createPlayFingerprintDocument(json, { chartPath: undefined })
      .timeline.filter((event) => event.type === 'stop')
      .at(-1)?.v,
  ).toBe('1');
});

test('fingerprints do not confuse deduplicated STOP keys with source event indices', () => {
  const json = parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240 },
      sound_channels: [],
      stop_events: [240, 480, 240, 720].map((duration, index) => ({ y: index * 240, duration })),
    }),
  );
  expect(createPlayFingerprintDocument(json, { chartPath: undefined }).timeline.map((event) => event.v)).toEqual([
    '1',
    '2',
    '1',
    '3',
  ]);
});
