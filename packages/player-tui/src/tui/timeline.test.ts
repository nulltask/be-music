import { describe, expect, test } from 'vite-plus/test';
import {
  findCurrentBpm,
  findCurrentMeasure,
  findCurrentScroll,
  findRemainingStopSeconds,
  findTotalMeasures,
  resolveMeasureLength,
} from './timeline.ts';

const MEASURES = [
  { measure: 0, seconds: 0 },
  { measure: 1, seconds: 2 },
  { measure: 2, seconds: 4 },
];

describe('measure lookups', () => {
  test('findCurrentMeasure finds the last measure started by the time', () => {
    expect(findCurrentMeasure(MEASURES, 3)).toBe(1);
    expect(findCurrentMeasure(MEASURES, 4)).toBe(2);
    expect(findCurrentMeasure(MEASURES, -1)).toBe(0);
    expect(findCurrentMeasure(undefined, 3)).toBe(0);
  });

  test('findTotalMeasures reads the last measure, at least 1', () => {
    expect(findTotalMeasures(MEASURES)).toBe(2);
    expect(findTotalMeasures([{ measure: 0, seconds: 0 }])).toBe(1);
    expect(findTotalMeasures(undefined)).toBe(1);
  });

  test('resolveMeasureLength falls back to 1 for a missing or non-positive length', () => {
    const lengths = new Map([
      [0, 0.5],
      [2, 0],
      [3, 0.75],
    ]);
    expect(resolveMeasureLength(lengths, 3)).toBe(0.75);
    expect(resolveMeasureLength(lengths, 3.7)).toBe(0.75);
    expect(resolveMeasureLength(lengths, -1)).toBe(0.5);
    expect(resolveMeasureLength(lengths, 2)).toBe(1);
    expect(resolveMeasureLength(lengths, 1)).toBe(1);
    expect(resolveMeasureLength(undefined, 3)).toBe(1);
  });
});

describe('findCurrentBpm', () => {
  const timeline = [
    { bpm: 120, seconds: 0 },
    { bpm: 180, seconds: 10 },
  ];

  test('finds the BPM in effect, and the first one before the chart starts', () => {
    expect(findCurrentBpm(timeline, 5)).toBe(120);
    expect(findCurrentBpm(timeline, 10)).toBe(180);
    expect(findCurrentBpm(timeline, -1)).toBe(120);
  });

  test('is 0 without a timeline', () => {
    expect(findCurrentBpm(undefined, 5)).toBe(0);
    expect(findCurrentBpm([], 5)).toBe(0);
  });
});

describe('findCurrentScroll', () => {
  const timeline = [
    { beat: 0, speed: 1 },
    { beat: 8, speed: 0.5 },
  ];

  test('finds the SCROLL in effect at the beat, and 1 before any', () => {
    expect(findCurrentScroll(timeline, 4)).toBe(1);
    expect(findCurrentScroll(timeline, 8)).toBe(0.5);
    expect(findCurrentScroll([{ beat: 4, speed: 2 }], 1)).toBe(1);
    expect(findCurrentScroll(undefined, 4)).toBe(1);
  });
});

describe('findRemainingStopSeconds', () => {
  const windows = [
    { startSeconds: 1, endSeconds: 2 },
    { startSeconds: 5, endSeconds: 5.5 },
  ];

  test('is the time left in the STOP the time falls in', () => {
    expect(findRemainingStopSeconds(windows, 1.25)).toBe(0.75);
    expect(findRemainingStopSeconds(windows, 5.25)).toBe(0.25);
  });

  test('is 0 outside a STOP', () => {
    expect(findRemainingStopSeconds(windows, 0.5)).toBe(0);
    expect(findRemainingStopSeconds(windows, 3)).toBe(0);
    expect(findRemainingStopSeconds(windows, Number.NaN)).toBe(0);
    expect(findRemainingStopSeconds(undefined, 1.25)).toBe(0);
  });
});
