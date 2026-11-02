import { describe, expect, test } from 'vite-plus/test';
import { createChartSampleCache, isSameChartSampleKey, type ChartSampleCacheKey } from './chart-sample-cache.ts';

const KEY: ChartSampleCacheKey = {
  source: {},
  chartPath: 'Songs/a/main.bms',
  pathPrefix: undefined,
  sampleRate: 48_000,
};

function buffer(label: string): AudioBuffer {
  return { label } as unknown as AudioBuffer;
}

describe('isSameChartSampleKey', () => {
  test('matches only the same source, chart path, #PATH_WAV and sample rate', () => {
    expect(isSameChartSampleKey(KEY, { ...KEY })).toBe(true);
    expect(isSameChartSampleKey(KEY, { ...KEY, source: {} })).toBe(false);
    expect(isSameChartSampleKey(KEY, { ...KEY, chartPath: 'Songs/a/hyper.bms' })).toBe(false);
    expect(isSameChartSampleKey(KEY, { ...KEY, pathPrefix: 'wav/' })).toBe(false);
    expect(isSameChartSampleKey(KEY, { ...KEY, sampleRate: 44_100 })).toBe(false);
  });
});

describe('createChartSampleCache', () => {
  test('gives a play of the same chart the samples the last play decoded', () => {
    const cache = createChartSampleCache();
    const first = cache.claim(KEY);
    expect(first.reused).toBe(false);
    const kick = buffer('kick');
    first.set('kick.wav', { buffer: kick, nativeSampleRate: 22_050 });
    const retry = cache.claim({ ...KEY });
    expect(retry.reused).toBe(true);
    expect(retry.get('kick.wav')).toEqual({ buffer: kick, nativeSampleRate: 22_050 });
    expect(retry.holds(kick)).toBe(true);
    expect(cache.size).toBe(1);
  });

  test('releases the held chart before another chart decodes', () => {
    const cache = createChartSampleCache();
    const kick = buffer('kick');
    cache.claim(KEY).set('kick.wav', { buffer: kick });
    const other = cache.claim({ ...KEY, chartPath: 'Songs/b/main.bms' });
    expect(other.reused).toBe(false);
    expect(other.get('kick.wav')).toBeUndefined();
    expect(other.holds(kick)).toBe(false);
    expect(cache.size).toBe(0);
    expect(cache.key?.chartPath).toBe('Songs/b/main.bms');
  });

  test('releases the samples when the context sample rate changes', () => {
    const cache = createChartSampleCache();
    cache.claim(KEY).set('kick.wav', { buffer: buffer('kick') });
    expect(cache.claim({ ...KEY, sampleRate: 44_100 }).get('kick.wav')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test('a stale lease neither reads nor writes', () => {
    const cache = createChartSampleCache();
    const abandoned = cache.claim(KEY);
    cache.claim({ ...KEY, chartPath: 'Songs/b/main.bms' });
    abandoned.set('late.wav', { buffer: buffer('late') });
    expect(cache.size).toBe(0);
    expect(abandoned.get('late.wav')).toBeUndefined();
    abandoned.retain([]);
    expect(cache.key?.chartPath).toBe('Songs/b/main.bms');
  });

  test('a retry of the same chart keeps what a play abandoned while loading decoded', () => {
    const cache = createChartSampleCache();
    cache.claim(KEY).set('kick.wav', { buffer: buffer('kick') });
    const retry = cache.claim(KEY);
    expect(retry.reused).toBe(true);
    expect(retry.get('kick.wav')).toBeDefined();
  });

  test('retain keeps only the paths the play used', () => {
    const cache = createChartSampleCache();
    const lease = cache.claim(KEY);
    const kick = buffer('kick');
    const branchB = buffer('branch-b');
    lease.set('kick.wav', { buffer: kick });
    lease.set('branch-b.wav', { buffer: branchB });
    lease.retain(['kick.wav']);
    expect(cache.size).toBe(1);
    expect(lease.holds(branchB)).toBe(false);
    expect(lease.holds(kick)).toBe(true);
  });

  test('release empties the cache and stales every lease', () => {
    const cache = createChartSampleCache();
    const lease = cache.claim(KEY);
    lease.set('kick.wav', { buffer: buffer('kick') });
    cache.release();
    expect(cache.size).toBe(0);
    expect(cache.key).toBeUndefined();
    lease.set('snare.wav', { buffer: buffer('snare') });
    expect(cache.size).toBe(0);
    expect(cache.claim(KEY).reused).toBe(false);
  });
});
