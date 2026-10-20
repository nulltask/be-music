import { describe, expect, test } from 'vite-plus/test';
import { clearLampRank } from '@be-music/player/ruleset';
import { averageRate, djRankDistribution, lampDistribution } from './stats.ts';

describe('lampDistribution', () => {
  test('lists every lamp, highest first, and totals the counts', () => {
    const distribution = lampDistribution([
      { lamp: clearLampRank('NORMAL'), count: 3 },
      { lamp: clearLampRank('FAILED'), count: 1 },
      { lamp: clearLampRank('NORMAL'), count: 1 },
    ]);
    expect(distribution.total).toBe(5);
    expect(distribution.buckets[0]!.key).toBe(clearLampRank('MAX'));
    expect(distribution.buckets.at(-1)!.key).toBe(clearLampRank('FAILED'));
    expect(distribution.buckets.find((bucket) => bucket.key === clearLampRank('NORMAL'))!.count).toBe(4);
    expect(distribution.buckets.find((bucket) => bucket.key === clearLampRank('HARD'))!.count).toBe(0);
  });

  test('is empty without rows', () => {
    expect(lampDistribution([]).total).toBe(0);
  });
});

describe('djRankDistribution', () => {
  test('counts DJ Ranks from AAA down, leaving out charts without notes', () => {
    const distribution = djRankDistribution([
      { exScore: 20, noteCount: 10 },
      { exScore: 18, noteCount: 10 },
      { exScore: 8, noteCount: 10 },
      { exScore: 0, noteCount: 0 },
    ]);
    expect(distribution.total).toBe(3);
    expect(distribution.buckets.map((bucket) => bucket.key)).toEqual(['AAA', 'AA', 'A', 'B', 'C', 'D', 'E', 'F']);
    expect(Object.fromEntries(distribution.buckets.map((bucket) => [bucket.key, bucket.count]))).toMatchObject({
      AAA: 2,
      D: 1,
    });
  });
});

describe('averageRate', () => {
  test('averages the score rates, or gives null without any', () => {
    expect(
      averageRate([
        { exScore: 20, noteCount: 10 },
        { exScore: 10, noteCount: 10 },
      ]),
    ).toBe(0.75);
    expect(averageRate([{ exScore: 0, noteCount: 0 }])).toBeNull();
    expect(averageRate([])).toBeNull();
  });
});
