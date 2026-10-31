import { expect, test } from 'vite-plus/test';
import { parseBmson, parseChart } from '@be-music/chart-parser';
import { stringifyBmson } from '@be-music/chart-writer';
import { buildBGATimelines, createTimingResolver } from './index.ts';

function chart(header: Array<{ id: number; name: string }>) {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240 },
      sound_channels: [],
      bga: {
        bga_header: header,
        bga_events: [
          { y: 0, id: 1 },
          { y: 240, id_set: [2] },
        ],
        layer_events: [{ y: 480, id_set: [1, 2], condition: 'play' }],
        poor_events: [{ y: 720, id_set: [2] }],
      },
    }),
  );
}

const base = (json: ReturnType<typeof chart>) =>
  buildBGATimelines(json, createTimingResolver(json)).base.map((cue) => [cue.seconds, cue.key]);

test('keeps an omitted bmson BGA event id absent through Be-Music JSON and bmson output', () => {
  const json = chart([
    { id: 1, name: 'one.png' },
    { id: 2, name: 'two.png' },
  ]);
  expect(json.bmson.bga.events[1]).not.toHaveProperty('id');
  expect(json.bmson.bga.layerEvents[0]).not.toHaveProperty('id');
  for (const source of [json, parseChart(JSON.stringify(json), 'json')]) {
    const bga = JSON.parse(stringifyBmson(source)).bga;
    expect(bga.bga_events[1]).toEqual({ y: 240, id_set: [2] });
    expect(bga.layer_events[0]).toEqual({ y: 480, id_set: [1, 2], condition: 'play' });
    expect(bga.poor_events[0]).toEqual({ y: 720, id_set: [2] });
    // Force the canonical writer as well as the preservation path.
    source.metadata.title = 'Edited';
    expect(JSON.parse(stringifyBmson(source)).bga.bga_events[1]).not.toHaveProperty('id');
  }
});

test('an id_set-only bga_event changes nothing unless header id 0 exists, as beatoraja reads id 0', () => {
  // beatoraja ignores id_set on bga_events and resolves Java's default id 0; an unknown id leaves the BGA unset.
  expect(
    base(
      chart([
        { id: 1, name: 'one.png' },
        { id: 2, name: 'two.png' },
      ]),
    ),
  ).toEqual([[0, 'one.png']]);
  expect(
    base(
      chart([
        { id: 0, name: 'zero.png' },
        { id: 1, name: 'one.png' },
      ]),
    ),
  ).toEqual([
    [0, 'one.png'],
    [0.5, 'zero.png'],
  ]);
});
