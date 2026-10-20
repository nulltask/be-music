import { describe, expect, test } from 'vite-plus/test';
import { holdSeed, holdSparks } from './hold.ts';

describe('holdSparks', () => {
  test('gives nothing before the hold begins', () => {
    expect(holdSparks(-1, 1, 40)).toEqual([]);
  });

  test('is the same for the same hold and age, so redrawn frames do not shimmer', () => {
    expect(holdSparks(1234, 7, 40)).toEqual(holdSparks(1234, 7, 40));
    expect(holdSparks(1234, 7, 40)).not.toEqual(holdSparks(1234, 8, 40));
  });

  test('keeps a steady stream: one spark per interval, none older than its life', () => {
    // 45 ms apart, 520 ms each: at most 12 alive.
    const sparks = holdSparks(5_000, 3, 40);
    expect(sparks.length).toBeGreaterThanOrEqual(11);
    expect(sparks.length).toBeLessThanOrEqual(12);
    expect(holdSparks(0, 3, 40)).toHaveLength(1);
    expect(holdSparks(100, 3, 40, { intervalMs: 50 })).toHaveLength(3);
  });

  test('older sparks have risen higher and faded more, within the lane', () => {
    const sparks = holdSparks(5_000, 3, 40);
    const oldest = sparks[0]!;
    const newest = sparks.at(-1)!;
    expect(oldest.alpha).toBeLessThan(newest.alpha);
    expect(newest.alpha).toBeLessThanOrEqual(1);
    expect(oldest.rise).toBeGreaterThan(newest.rise);
    for (const spark of sparks) expect(Math.abs(spark.offsetX)).toBeLessThanOrEqual(16);
  });
});

describe('holdSeed', () => {
  test('differs by lane and by when the hold began', () => {
    expect(holdSeed('11', 1000)).toBe(holdSeed('11', 1000));
    expect(holdSeed('11', 1000)).not.toBe(holdSeed('12', 1000));
    expect(holdSeed('11', 1000)).not.toBe(holdSeed('11', 2000));
  });
});
