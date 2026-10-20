import { describe, expect, test } from 'vite-plus/test';
import { createBeatResolver, createScrollTimeline } from '../../chart-model/src/index.ts';
import { parseBmson, parseChart } from './index.ts';

function parse(document: Record<string, unknown>) {
  return parseBmson(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
      sound_channels: [{ name: 's.wav', notes: [{ x: 1, y: 0 }] }],
      ...document,
    }),
  );
}

describe('bmson scroll_events (beatoraja extension)', () => {
  test('become SC events into one #SCROLL key per distinct rate, which the chart scroll timeline reads', () => {
    const json = parse({
      scroll_events: [
        { y: 240, rate: 0.5 },
        { y: 480, rate: 2 },
        { y: 720, rate: 0.5 },
        { y: 960, rate: 1 },
      ],
    });

    expect(Object.values(json.bms.scroll).sort((left, right) => left - right)).toEqual([0.5, 1, 2]);
    expect(json.events.filter((event) => event.channel === 'SC')).toHaveLength(4);
    expect(createScrollTimeline(json, createBeatResolver(json))).toEqual([
      { beat: 1, speed: 0.5 },
      { beat: 2, speed: 2 },
      { beat: 3, speed: 0.5 },
      { beat: 4, speed: 1 },
    ]);
  });

  test('of several events on one pulse the last one in the list wins, as in beatoraja', () => {
    const json = parse({
      scroll_events: [
        { y: 240, rate: 3 },
        { y: 240, rate: 0.5 },
        { y: 240, rate: 2 },
      ],
    });
    expect(createScrollTimeline(json, createBeatResolver(json))).toEqual([{ beat: 1, speed: 2 }]);
    // The authored list is preserved as it is.
    expect(json.preservation.bmson.scrollEvents).toHaveLength(3);
  });

  test('keep zero and negative rates, as #SCROLL does', () => {
    const json = parse({
      scroll_events: [
        { y: 240, rate: 0 },
        { y: 480, rate: -1 },
      ],
    });
    expect(createScrollTimeline(json, createBeatResolver(json)).map((point) => point.speed)).toEqual([0, -1]);
  });

  test('skip entries without a finite y or rate', () => {
    const json = parse({ scroll_events: [{ y: 240 }, { rate: 2 }, { y: 'x', rate: 2 }, null, { y: 480, rate: 3 }] });
    expect(json.events.filter((event) => event.channel === 'SC')).toHaveLength(1);
    expect(json.preservation.bmson.scrollEvents).toEqual([{ y: 480, rate: 3 }]);
  });

  test('are kept in preservation.bmson.scrollEvents and survive a be-music JSON round trip', () => {
    const json = parse({ scroll_events: [{ y: 240, rate: 0.25 }] });
    expect(json.preservation.bmson.scrollEvents).toEqual([{ y: 240, rate: 0.25 }]);

    const reparsed = parseChart(JSON.stringify(json));
    expect(reparsed.preservation.bmson.scrollEvents).toEqual([{ y: 240, rate: 0.25 }]);
    expect(reparsed.bms.scroll).toEqual(json.bms.scroll);
  });

  test('a chart without scroll_events has no SC events or preserved scroll list', () => {
    const json = parse({});
    expect(json.preservation.bmson.scrollEvents).toBeUndefined();
    expect(json.bms.scroll).toEqual({});
  });

  test('more than 1,295 scroll_events with a few rates keep every rate', () => {
    const rates = [0.5, 1, 2, 4];
    const scrollEvents = Array.from({ length: 3_000 }, (_, index) => ({ y: index * 60, rate: rates[index % 4]! }));
    const json = parse({ scroll_events: scrollEvents });
    expect(Object.keys(json.bms.scroll)).toHaveLength(4);
    expect(json.bms.base).toBeUndefined();
    expect(createScrollTimeline(json, createBeatResolver(json)).map((point) => point.speed)).toEqual(
      scrollEvents.map((event) => event.rate),
    );
  });
});
