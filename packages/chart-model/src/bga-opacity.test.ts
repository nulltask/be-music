import { createEmptyJSON, type BeMusicEvent } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import { buildBGAOpacityTimelines, pickBGAOpacity } from './bga-opacity.ts';
import { createTimingResolver } from './timing.ts';

function event(channel: string, value: string, measure = 0): BeMusicEvent {
  return { channel, value, measure, position: [0, 1] };
}

describe('BGA opacity timelines', () => {
  test('decodes all tracks as hex bytes independently of resource-id base', () => {
    const chart = createEmptyJSON('bms');
    chart.bms.base = 62;
    chart.events = [event('0B', '01'), event('0c', '80'), event('0D', 'ff'), event('0E', '40')];
    const original = structuredClone(chart);
    expect(buildBGAOpacityTimelines(chart, { eventToSeconds: () => 0 })).toEqual({
      base: [{ seconds: 0, opacity: 1 / 255 }],
      layer: [{ seconds: 0, opacity: 128 / 255 }],
      layer2: [{ seconds: 0, opacity: 1 }],
      poor: [{ seconds: 0, opacity: 64 / 255 }],
    });
    expect(chart).toEqual(original);
  });

  test('sorts by time, retaining event-array order for equal-time commands', () => {
    const chart = createEmptyJSON('bms');
    chart.events = [event('0C', '80', 2), event('0C', 'FF'), event('0C', '40')];
    const cues = buildBGAOpacityTimelines(chart, { eventToSeconds: (entry) => entry.measure }).layer;
    expect(cues).toEqual([
      { seconds: 0, opacity: 1 },
      { seconds: 0, opacity: 64 / 255 },
      { seconds: 2, opacity: 128 / 255 },
    ]);
    expect(pickBGAOpacity(cues, 0)).toBe(64 / 255);
  });

  test('ignores rests, invalid hex bytes, unrelated channels and non-finite times', () => {
    const chart = createEmptyJSON('bms');
    chart.events = ['00', 'G0', '100', ' 80', '-1'].map((value) => event('0C', value));
    chart.events.push(event('07', '80'), event('0C', '80', 1));
    expect(buildBGAOpacityTimelines(chart, { eventToSeconds: () => Number.NaN })).toEqual({
      base: [],
      layer: [],
      layer2: [],
      poor: [],
    });
    expect(buildBGAOpacityTimelines(chart, { eventToSeconds: (entry) => entry.measure }).layer).toEqual([
      { seconds: 1, opacity: 128 / 255 },
    ]);
  });

  test('uses the chart timing resolver, including STOP duration', () => {
    const chart = createEmptyJSON('bms');
    chart.metadata.bpm = 120;
    chart.resources.stop['01'] = 192;
    chart.events = [{ ...event('09', '01'), position: [1, 2] }, event('0C', '80', 1)];
    expect(buildBGAOpacityTimelines(chart, createTimingResolver(chart)).layer).toEqual([
      { seconds: 4, opacity: 128 / 255 },
    ]);
  });
});

test('opacity selection restores defaults and prior values when seeking backwards', () => {
  const cues = [
    { seconds: 1, opacity: 128 / 255 },
    { seconds: 3, opacity: 1 },
  ];
  expect(pickBGAOpacity(cues, 4)).toBe(1);
  expect(pickBGAOpacity(cues, 2)).toBe(128 / 255);
  expect(pickBGAOpacity(cues, 1)).toBe(128 / 255);
  expect(pickBGAOpacity(cues, 0)).toBe(1);
  expect(pickBGAOpacity([], 4)).toBe(1);
  expect(pickBGAOpacity(cues, Number.NaN)).toBe(1);
  expect(pickBGAOpacity(cues, Number.POSITIVE_INFINITY)).toBe(1);
});
