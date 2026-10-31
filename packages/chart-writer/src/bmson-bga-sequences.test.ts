import { expect, test } from 'vite-plus/test';
import { parseBmson, parseChart } from '@be-music/chart-parser';
import { cloneJSON } from '@be-music/chart-source';
import { stringifyBmson } from './index.ts';
import { areBmsonChartsEquivalent } from './equivalence.ts';

function chart() {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240 },
      sound_channels: [{ name: 'a.wav', notes: [{ x: 1, y: 0 }] }],
      bga: {
        bga_header: [
          { id: 1, name: 'a.png' },
          { id: 2, name: 'b.png' },
        ],
        bga_sequence: [
          { id: 10, sequence: [{ time: 0, id: 1 }, { time: 100, id: 2 }, { time: 250 }] },
          {
            id: 11,
            sequence: [
              { time: 0, id: 2 },
              { time: 500, id: -2147483648 },
            ],
          },
        ],
        bga_events: [{ y: 0, id: 1 }],
        layer_events: [
          { y: 0, id_set: [10, 11], condition: 'play', interval: 2 },
          { y: 240, id: 2, condition: 'miss', interval: 0 },
          { y: 480, id_set: [], condition: 'future-condition' },
        ],
        poor_events: [{ y: 0, id: 10 }],
      },
    }),
  );
}

test('retains sequences, end markers and id-only or set-only conditional events through JSON and bmson', () => {
  const source = chart();
  expect(source.bmson.bga.layerEvents).toEqual([
    { y: 0, id: 0, idSet: [10, 11], condition: 'play', interval: 2 },
    { y: 240, id: 2, condition: 'miss', interval: 0 },
    { y: 480, id: 0, idSet: [], condition: 'future-condition' },
  ]);
  expect(source.bmson.bga.sequences?.[0]?.sequence.at(-1)).toEqual({ time: 250 });
  expect(source.bmson.bga.sequences?.[1]?.sequence.at(-1)).toEqual({ time: 500, id: -2147483648 });
  for (const json of [source, cloneJSON(source), parseChart(JSON.stringify(source), 'json')]) {
    for (const canonical of [false, true]) {
      if (canonical) json.preservation.bmson.soundChannels = [];
      const output = JSON.parse(stringifyBmson(json));
      expect(output.bga.layer_events[0]).toMatchObject({ id_set: [10, 11], condition: 'play', interval: 2 });
      expect(output.bga.bga_sequence).toEqual(source.bmson.bga.sequences);
      expect(parseBmson(JSON.stringify(output)).bmson.bga).toEqual(source.bmson.bga);
    }
  }
});

test('clone owns its sequence frames and alternative id arrays', () => {
  const source = chart();
  const copy = cloneJSON(source);
  copy.bmson.bga.sequences![0]!.sequence[0]!.id = 2;
  copy.bmson.bga.layerEvents[0]!.idSet![0] = 99;
  expect(source.bmson.bga.sequences![0]!.sequence[0]!.id).toBe(1);
  expect(source.bmson.bga.layerEvents[0]!.idSet![0]).toBe(10);
});

test('edited sequence and conditions appear in output instead of stale preserved values', () => {
  const source = chart();
  source.bmson.bga.sequences![0]!.sequence[1]!.time = 150;
  source.bmson.bga.layerEvents[0]!.condition = 'miss';
  source.bmson.bga.layerEvents[0]!.interval = 4;
  source.bmson.bga.layerEvents[0]!.idSet = [11];
  const output = JSON.parse(stringifyBmson(source));
  expect(output.bga.bga_sequence[0].sequence[1].time).toBe(150);
  expect(output.bga.layer_events[0]).toMatchObject({ id_set: [11], condition: 'miss', interval: 4 });
});

test('normalizes external aliases on Be-Music JSON input and ignores malformed sequence entries', () => {
  const source = chart();
  const raw = JSON.parse(JSON.stringify(source));
  raw.bmson.bga.bga_sequence = [
    null,
    { id: -1, sequence: [] },
    { id: 3, sequence: [null, { time: -1 }, { time: 0, id: -1 }, { time: 1, id: 2 }, { time: 2 }] },
  ];
  delete raw.bmson.bga.sequences;
  raw.bmson.bga.layerEvents = [{ y: 0, id_set: [1, -1, '2', 2], condition: 'miss', interval: -1 }];
  const json = parseChart(JSON.stringify(raw), 'json');
  expect(json.bmson.bga.sequences).toEqual([{ id: 3, sequence: [{ time: 1, id: 2 }, { time: 2 }] }]);
  expect(json.bmson.bga.layerEvents).toEqual([{ y: 0, id: 0, idSet: [1, 2], condition: 'miss' }]);
});

test.each(['sequence', 'idSet', 'condition', 'interval'])('equivalence detects edits to %s', (field) => {
  const source = chart();
  const copy = cloneJSON(source);
  expect(areBmsonChartsEquivalent(source, copy)).toBe(true);
  switch (field) {
    case 'sequence':
      copy.bmson.bga.sequences![0]!.sequence[1]!.time += 1;
      break;
    case 'idSet':
      copy.bmson.bga.layerEvents[0]!.idSet!.reverse();
      break;
    case 'condition':
      copy.bmson.bga.layerEvents[0]!.condition = 'miss';
      break;
    case 'interval':
      copy.bmson.bga.layerEvents[0]!.interval = 3;
      break;
  }
  expect(areBmsonChartsEquivalent(source, copy)).toBe(false);
});
