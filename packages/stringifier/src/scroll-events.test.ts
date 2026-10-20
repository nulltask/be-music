import { describe, expect, test } from 'vite-plus/test';
import { createBeatResolver, createScrollTimeline } from '../../chart/src/index.ts';
import type { BeMusicJSON } from '../../json/src/index.ts';
import { parseBMS, parseBmson } from '../../parser/src/index.ts';
import { stringifyBMS, stringifyBmson } from './index.ts';

const SCROLL_BMSON = JSON.stringify({
  version: '1.0.0',
  info: { init_bpm: 120, resolution: 240, mode_hint: 'beat-7k' },
  sound_channels: [{ name: 's.wav', notes: [{ x: 1, y: 0, l: 0, c: false }] }],
  scroll_events: [
    { y: 240, rate: 0.5 },
    { y: 480, rate: 2 },
    { y: 720, rate: 0.5 },
  ],
});

const SCROLL_BMS = [
  '#TITLE scroll',
  '#BPM 120',
  '#WAV01 s.wav',
  '#SCROLL01 0.5',
  '#SCROLL02 2',
  '#00111:01',
  '#001SC:00010200',
  '#002SC:01',
].join('\n');

function scrollTimeline(json: BeMusicJSON) {
  return createScrollTimeline(json, createBeatResolver(json));
}

describe('bmson scroll_events output', () => {
  test('a bmson chart re-emits its preserved scroll_events', () => {
    const json = parseBmson(SCROLL_BMSON);
    const output = JSON.parse(stringifyBmson(json)) as { scroll_events?: unknown };
    expect(output.scroll_events).toEqual([
      { y: 240, rate: 0.5 },
      { y: 480, rate: 2 },
      { y: 720, rate: 0.5 },
    ]);
  });

  test('the regenerated (event-based) output writes SC events as scroll_events', () => {
    const json = parseBmson(SCROLL_BMSON);
    const output = JSON.parse(stringifyBmson(json, { resolution: 480 })) as { scroll_events?: unknown };
    expect(output.scroll_events).toEqual([
      { y: 480, rate: 0.5 },
      { y: 960, rate: 2 },
      { y: 1440, rate: 0.5 },
    ]);
    expect(scrollTimeline(parseBmson(stringifyBmson(json, { resolution: 480 })))).toEqual(scrollTimeline(json));
  });

  test('a chart without SCROLL writes no scroll_events', () => {
    const json = parseBmson(
      JSON.stringify({
        version: '1.0.0',
        info: { init_bpm: 120, resolution: 240 },
        sound_channels: [{ name: 's.wav', notes: [{ x: 1, y: 0 }] }],
      }),
    );
    expect(JSON.parse(stringifyBmson(json, { resolution: 240 }))).not.toHaveProperty('scroll_events');
  });

  test('BMS #SCROLL / SC convert to scroll_events that play the same scroll timeline', () => {
    const bms = parseBMS(SCROLL_BMS);
    const output = JSON.parse(stringifyBmson(bms)) as { scroll_events?: unknown };
    expect(output.scroll_events).toEqual([
      { y: 1200, rate: 0.5 },
      { y: 1440, rate: 2 },
      { y: 1920, rate: 0.5 },
    ]);
    expect(scrollTimeline(parseBmson(stringifyBmson(bms)))).toEqual(scrollTimeline(bms));
  });

  test('a preserved document whose scroll list no longer matches the events falls back to the regenerated output', () => {
    const json = parseBmson(SCROLL_BMSON);
    json.preservation.bmson.scrollEvents = [];
    const output = JSON.parse(stringifyBmson(json, { skipPreservationValidation: true })) as {
      scroll_events?: unknown;
    };
    expect(output.scroll_events).toEqual([
      { y: 240, rate: 0.5 },
      { y: 480, rate: 2 },
      { y: 720, rate: 0.5 },
    ]);
  });
});

describe('bmson scroll_events to BMS', () => {
  test('scroll_events become #SCROLLxx and SC objects that play the same scroll timeline', () => {
    const json = parseBmson(SCROLL_BMSON);
    const bms = stringifyBMS(json);
    expect(bms).toMatch(/^#SCROLL01 0\.5$/m);
    expect(bms).toMatch(/^#SCROLL02 2$/m);
    expect(bms).toMatch(/^#000SC:/m);
    expect(scrollTimeline(parseBMS(bms))).toEqual(scrollTimeline(json));
  });
});
