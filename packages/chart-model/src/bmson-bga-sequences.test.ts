import { expect, test } from 'vite-plus/test';
import { parseBmson } from '@be-music/chart-parser';
import { buildBmsonBGAEventTimeline, createTimingResolver, pickBmsonBGASequenceFrame } from './index.ts';

function chart() {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240 },
      sound_channels: [],
      stop_events: [{ y: 240, duration: 240 }],
      bga: {
        bga_header: [
          { id: 20, name: 'first.png' },
          { id: 30, name: 'second.png' },
        ],
        bga_sequence: [
          { id: 10, sequence: [{ time: 0, id: 0 }, { time: 120, id: 1 }, { time: 500 }] },
          {
            id: 11,
            sequence: [
              { time: 0, id: 99 },
              { time: 100, id: -2147483648 },
            ],
          },
        ],
        layer_events: [
          { y: 0, id: 20 }, // Ordinary overlay is unchanged and belongs to the normal image timeline.
          { y: 480, id_set: [10, 30], condition: 'play', interval: 3 },
          { y: 720, id: 11, condition: 'future', interval: 0 },
        ],
        poor_events: [
          { y: 240, id: 10 },
          { y: 960, id: 999 },
        ],
      },
    }),
  );
}

test('resolves alternatives and conditions in chart order using the BPM/STOP clock', () => {
  const json = chart();
  const cues = buildBmsonBGAEventTimeline(json, createTimingResolver(json));
  expect(cues.map(({ seconds, plane, condition, interval }) => ({ seconds, plane, condition, interval }))).toEqual([
    { seconds: 0.5, plane: 'poor', condition: 'miss', interval: 1 },
    { seconds: 1.5, plane: 'layer', condition: 'play', interval: 3 },
    { seconds: 2, plane: 'layer', condition: 'always', interval: 0 },
    { seconds: 2.5, plane: 'poor', condition: 'miss', interval: 1 },
  ]);
  expect(cues[1]!.sequences.map((sequence) => sequence.id)).toEqual([10, 30]);
  expect(cues[1]!.sequences[1]!.frames).toEqual([
    { elapsedSeconds: 0, key: 'second.png' },
    { elapsedSeconds: 0.5, end: true },
  ]);
});

test('sequence frames use header array indices, while ordinary references use declared header ids', () => {
  const json = chart();
  const sequence = buildBmsonBGAEventTimeline(json, createTimingResolver(json))[0]!.sequences[0]!;
  expect(sequence.frames).toEqual([
    { elapsedSeconds: 0, key: 'first.png' },
    { elapsedSeconds: 0.12, key: 'second.png' },
    { elapsedSeconds: 0.5, end: true },
  ]);
  expect(pickBmsonBGASequenceFrame(sequence, 0)?.key).toBe('first.png');
  expect(pickBmsonBGASequenceFrame(sequence, 0.119)?.key).toBe('first.png');
  expect(pickBmsonBGASequenceFrame(sequence, 0.12)?.key).toBe('second.png');
  expect(pickBmsonBGASequenceFrame(sequence, 0.5)).toBeUndefined();
  expect(pickBmsonBGASequenceFrame(sequence, 100)).toBeUndefined();
  expect(pickBmsonBGASequenceFrame(sequence, 0.01)?.key).toBe('first.png'); // Stateless rewind/restart.
});

test('missing references clear rather than resolving to another declared id', () => {
  const json = chart();
  const cues = buildBmsonBGAEventTimeline(json, createTimingResolver(json));
  expect(cues[2]!.sequences[0]!.frames).toEqual([
    { elapsedSeconds: 0, key: undefined },
    { elapsedSeconds: 0.1, end: true },
  ]);
  expect(cues[3]!.sequences[0]!.frames[0]!.key).toBeUndefined();
});

test('stable ordering, empty alternatives, late first frames and end markers stay deterministic', () => {
  const json = chart();
  json.bmson.bga.layerEvents = [
    { y: 0, id: 10, idSet: [] },
    { y: 0, id: 20, condition: 'miss' },
  ];
  json.bmson.bga.poorEvents = [];
  const cues = buildBmsonBGAEventTimeline(json, createTimingResolver(json));
  expect(cues.map((cue) => cue.sequences.length)).toEqual([0, 1]);
  const sequence = {
    id: 1,
    frames: [
      { elapsedSeconds: 0.1, key: 'a' },
      { elapsedSeconds: 0.1, key: 'b' },
      { elapsedSeconds: 0.2, end: true as const },
      { elapsedSeconds: 0.3, key: 'never' },
    ],
  };
  expect(pickBmsonBGASequenceFrame(sequence, -1)).toBeUndefined();
  expect(pickBmsonBGASequenceFrame(sequence, NaN)).toBeUndefined();
  expect(pickBmsonBGASequenceFrame(sequence, 0)).toBeUndefined();
  expect(pickBmsonBGASequenceFrame(sequence, 0.1)?.key).toBe('b');
  expect(pickBmsonBGASequenceFrame(sequence, 0.3)).toBeUndefined();
});

test('poor events retain the upstream forced MISS condition and single-id selection', () => {
  const json = chart();
  json.bmson.bga.layerEvents = [];
  json.bmson.bga.poorEvents = [{ y: 0, id: 10, idSet: [30], condition: 'play', interval: 99 }];
  const cue = buildBmsonBGAEventTimeline(json, createTimingResolver(json))[0]!;
  expect(cue.condition).toBe('miss');
  expect(cue.interval).toBe(1);
  expect(cue.sequences.map((sequence) => sequence.id)).toEqual([10]);
});

test('engine consumers may include ordinary layer changes as ordered event-selection clears', () => {
  const json = chart();
  const cues = buildBmsonBGAEventTimeline(json, createTimingResolver(json), { includeOrdinaryLayerClears: true });
  expect(cues[0]).toMatchObject({ seconds: 0, plane: 'layer', sequences: [] });
  expect(cues).toHaveLength(5);
});
