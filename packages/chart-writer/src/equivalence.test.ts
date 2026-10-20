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
