import { createEmptyJSON, type BeMusicEvent } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import { buildBGAOpacityTimelines, pickBGAOpacity, pickBGATint } from './bga-opacity.ts';
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

test('A1–A4 address independent ARGB definitions, replacing alpha without changing image slots', () => {
  const chart = createEmptyJSON('bms');
  chart.bms.argb['01'] = '128, 28, 5, 255';
  chart.bms.argb['02'] = '0, 255, 128, 0';
  chart.events = ['A1', 'a2', 'A3', 'A4'].map((channel) => event(channel, '01'));
  chart.events.push(event('A1', '02', 1));
  const original = structuredClone(chart);
  const controls = buildBGAOpacityTimelines(chart, { eventToSeconds: (entry) => entry.measure });
  for (const track of ['base', 'layer', 'layer2', 'poor'] as const) {
    expect(pickBGAOpacity(controls[track], 0)).toBe(128 / 255);
    expect(pickBGATint(controls[track], 0)).toBe(0x1c05ff);
  }
  expect(pickBGAOpacity(controls.base, 1)).toBe(0);
  expect(pickBGATint(controls.base, 1)).toBe(0xff8000);
  expect(chart).toEqual(original);
});

test('interleaved ARGB and opacity commands share alpha and retain the most recent RGB through seeks', () => {
  const chart = createEmptyJSON('bms');
  chart.bms.argb['01'] = '128, 40, 175, 48';
  chart.bms.argb['02'] = '64, 234, 210, 173';
  chart.events = [event('0C', '80', 3), event('A2', '02', 2), event('0C', 'FF', 1), event('A2', '01')];
  const cues = buildBGAOpacityTimelines(chart, { eventToSeconds: (entry) => entry.measure }).layer;
  expect(cues.map((cue) => [cue.opacity, cue.tint])).toEqual([
    [128 / 255, 0x28af30],
    [1, 0x28af30],
    [64 / 255, 0xead2ad],
    [128 / 255, 0xead2ad],
  ]);
  expect(pickBGATint(cues, 3)).toBe(0xead2ad);
  expect(pickBGATint(cues, 1)).toBe(0x28af30);
  expect(pickBGATint(cues, -1)).toBe(0xffffff);
  expect(pickBGATint(cues, Number.NaN)).toBe(0xffffff);
  expect(pickBGATint(cues, Number.POSITIVE_INFINITY)).toBe(0xead2ad);
  expect(pickBGATint([], 1)).toBe(0xffffff);
});

test.each([false, true])('equal-time ARGB/opacity conflicts use source event order (ARGB last=%s)', (argbLast) => {
  const chart = createEmptyJSON('bms');
  chart.bms.argb['01'] = '0, 40, 175, 48';
  chart.events = [event('A1', '01'), event('0B', 'FF')];
  if (argbLast) chart.events.reverse();
  const cues = buildBGAOpacityTimelines(chart, { eventToSeconds: () => 1 }).base;
  expect(pickBGAOpacity(cues, 1)).toBe(argbLast ? 0 : 1);
  expect(pickBGATint(cues, 1)).toBe(0x28af30);
});

test('ARGB references honor base-62 case and strict decimal fields, ignoring malformed definitions and rests', () => {
  const chart = createEmptyJSON('bms');
  chart.bms.base = 62;
  chart.bms.argb['0a'] = '128,1,2,3';
  chart.bms.argb['0A'] = '64,4,5,6';
  for (const [index, raw] of ['256,1,2,3', '-1,1,2,3', '128x,1,2,3', '1,,2,3', 'FF010203', '1,2,3,4,5'].entries()) {
    chart.bms.argb[String(index + 10)] = raw;
    chart.events.push(event('A1', String(index + 10)));
  }
  chart.events.push(event('A1', '00'), event('A1', 'ZZ'), event('A1', '0a', 1), event('A1', '0A', 2));
  const cues = buildBGAOpacityTimelines(chart, { eventToSeconds: (entry) => entry.measure }).base;
  expect(cues).toEqual([
    { seconds: 1, opacity: 128 / 255, tint: 0x010203 },
    { seconds: 2, opacity: 64 / 255, tint: 0x040506 },
  ]);
});
