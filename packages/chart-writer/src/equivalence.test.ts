import { describe, expect, test } from 'vite-plus/test';
import { parseBMS, parseBmson } from '../../chart-parser/src/index.ts';
import { areBMSChartsEquivalent, areBmsonChartsEquivalent, areEventBmsonExtensionsEqual } from './equivalence.ts';

const bms = (title: string): string => [`#TITLE ${title}`, '#BPM 150', '#WAV01 kick.wav', '#00111:01'].join('\n');

const bmson = (initBPM: number): string =>
  JSON.stringify({
    version: '1.0.0',
    info: { title: 'Doc', init_bpm: initBPM, resolution: 240 },
    lines: [{ y: 0 }, { y: 960 }],
    sound_channels: [{ name: 'kick.wav', notes: [{ x: 1, y: 0, l: 0, c: false }] }],
  });

describe('areEventBmsonExtensionsEqual', () => {
  test('compares the bmson length and continuation flag', () => {
    expect(areEventBmsonExtensionsEqual(undefined, undefined)).toBe(true);
    expect(areEventBmsonExtensionsEqual({ l: 240, c: true }, { l: 240, c: true })).toBe(true);
    expect(areEventBmsonExtensionsEqual({ l: 240 }, { l: 480 })).toBe(false);
    expect(areEventBmsonExtensionsEqual({ c: true }, undefined)).toBe(false);
    expect(areEventBmsonExtensionsEqual({ up: true }, { up: false })).toBe(false);
    expect(areEventBmsonExtensionsEqual({ t: 1 }, { t: 2 })).toBe(false);
  });
});

describe('areBMSChartsEquivalent', () => {
  test('holds for the same BMS source and fails when a header differs', () => {
    expect(areBMSChartsEquivalent(parseBMS(bms('A')), parseBMS(bms('A')))).toBe(true);
    expect(areBMSChartsEquivalent(parseBMS(bms('A')), parseBMS(bms('B')))).toBe(false);
  });
});

describe('areBmsonChartsEquivalent', () => {
  test('holds for the same bmson source and fails when the chart differs', () => {
    expect(areBmsonChartsEquivalent(parseBmson(bmson(150)), parseBmson(bmson(150)))).toBe(true);
    expect(areBmsonChartsEquivalent(parseBmson(bmson(150)), parseBmson(bmson(180)))).toBe(false);
  });
});

test('bmson equivalence includes up and type changes in preserved sound channels', () => {
  const source = parseBmson(bmson(120));
  for (const field of ['up', 't'] as const) {
    const changed = structuredClone(source);
    const note = changed.preservation.bmson.soundChannels[0]!.notes[0]!;
    if (field === 'up') note.up = true;
    else note.t = 2;
    expect(areBmsonChartsEquivalent(source, changed)).toBe(false);
  }
});
