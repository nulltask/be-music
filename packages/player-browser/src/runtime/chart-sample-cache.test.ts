import { describe, expect, test } from 'vite-plus/test';
import {
  chartTrackFolder,
  createChartSampleCache,
  isSameChartSampleSource,
  type ChartSampleCacheKey,
} from './chart-sample-cache.ts';

const SOURCE = {};
const KEY: ChartSampleCacheKey = { source: SOURCE, chartPath: 'Songs/a/normal.bms', sampleRate: 48_000 };
const KICK = { file: 'Songs/a/kick.wav' };
const SNARE = { file: 'Songs/a/snare.wav' };

function buffer(label: string): AudioBuffer {
  return { label } as unknown as AudioBuffer;
}

describe('isSameChartSampleSource', () => {
  test('matches only the same source and sample rate, whatever the chart', () => {
    const other: ChartSampleCacheKey = { ...KEY, chartPath: 'Songs/b/other.bms' };
    expect(isSameChartSampleSource(KEY, other)).toBe(true);
    expect(isSameChartSampleSource(KEY, { ...KEY, source: {} })).toBe(false);
    expect(isSameChartSampleSource(KEY, { ...KEY, sampleRate: 44_100 })).toBe(false);
  });
});

describe('chartTrackFolder', () => {
  test('is the folder of the chart, case-folded', () => {
    expect(chartTrackFolder('Songs/A/normal.bms')).toBe('songs/a');
    expect(chartTrackFolder('Songs\\A\\hyper.bms')).toBe('songs\\a');
    expect(chartTrackFolder('main.bms')).toBe('');
  });
});

describe('createChartSampleCache', () => {
  test('gives a retry of the same chart the samples the last play decoded', () => {
    const cache = createChartSampleCache();
    const first = cache.claim(KEY, [KICK]);
    expect(first.reused).toBe(0);
    const kick = buffer('kick');
    first.set(KICK, { buffer: kick, nativeSampleRate: 22_050 });
    const retry = cache.claim({ ...KEY }, [KICK]);
    expect(retry.reused).toBe(1);
    expect(retry.get(KICK)).toEqual({ buffer: kick, nativeSampleRate: 22_050 });
    expect(retry.holds(kick)).toBe(true);
    expect(cache.size).toBe(1);
  });

  test('gives another chart of the source the decodes of the files it shares, and drops the rest first', () => {
    const cache = createChartSampleCache();
    const normal = cache.claim(KEY, [KICK, SNARE]);
    const kick = buffer('kick');
    const snare = buffer('snare');
    normal.set(KICK, { buffer: kick });
    normal.set(SNARE, { buffer: snare });
    const hyper = cache.claim({ ...KEY, chartPath: 'Songs/a/hyper.bms' }, [KICK, { file: 'Songs/a/hat.wav' }]);
    expect(hyper.reused).toBe(1);
    expect(hyper.get(KICK)?.buffer).toBe(kick);
    expect(hyper.get(SNARE)).toBeUndefined();
    expect(hyper.holds(snare)).toBe(false);
    expect(cache.size).toBe(1);
    expect(cache.key?.chartPath).toBe('Songs/a/hyper.bms');
  });

  test('a file the claim did not name is not kept', () => {
    const cache = createChartSampleCache();
    const lease = cache.claim(KEY, [KICK]);
    lease.set(SNARE, { buffer: buffer('snare') });
    expect(cache.size).toBe(0);
  });

  test('releases everything for another source or sample rate', () => {
    const cache = createChartSampleCache();
    cache.claim(KEY, [KICK]).set(KICK, { buffer: buffer('kick') });
    expect(cache.claim({ ...KEY, sampleRate: 44_100 }, [KICK]).get(KICK)).toBeUndefined();
    cache.claim(KEY, [KICK]).set(KICK, { buffer: buffer('kick') });
    const other = cache.claim({ ...KEY, source: {} }, [KICK]);
    expect(other.reused).toBe(0);
    expect(other.get(KICK)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test('a stale lease neither reads nor writes', () => {
    const cache = createChartSampleCache();
    const abandoned = cache.claim(KEY, [KICK]);
    cache.claim({ ...KEY, chartPath: 'Songs/a/hyper.bms' }, [KICK]);
    abandoned.set(KICK, { buffer: buffer('late') });
    expect(cache.size).toBe(0);
    expect(abandoned.get(KICK)).toBeUndefined();
  });

  test('a retry keeps what a play abandoned while loading decoded', () => {
    const cache = createChartSampleCache();
    cache.claim(KEY, [KICK]).set(KICK, { buffer: buffer('kick') });
    const retry = cache.claim(KEY, [KICK]);
    expect(retry.reused).toBe(1);
    expect(retry.get(KICK)).toBeDefined();
  });

  test('keepTrackOf keeps the samples for a chart of the same folder and source only', () => {
    const cache = createChartSampleCache();
    cache.claim(KEY, [KICK]).set(KICK, { buffer: buffer('kick') });
    cache.keepTrackOf(SOURCE, 'songs/A/another.bms');
    expect(cache.size).toBe(1);
    cache.keepTrackOf({}, 'Songs/a/another.bms');
    expect(cache.size).toBe(0);
    cache.claim(KEY, [KICK]).set(KICK, { buffer: buffer('kick') });
    cache.keepTrackOf(SOURCE, 'Songs/b/another.bms');
    expect(cache.size).toBe(0);
    expect(cache.key).toBeUndefined();
    cache.claim(KEY, [KICK]).set(KICK, { buffer: buffer('kick') });
    cache.keepTrackOf(undefined, undefined);
    expect(cache.size).toBe(0);
  });

  test('release empties the cache and stales every lease', () => {
    const cache = createChartSampleCache();
    const lease = cache.claim(KEY, [KICK, SNARE]);
    lease.set(KICK, { buffer: buffer('kick') });
    cache.release();
    expect(cache.size).toBe(0);
    expect(cache.key).toBeUndefined();
    lease.set(SNARE, { buffer: buffer('snare') });
    expect(cache.size).toBe(0);
    expect(cache.claim(KEY, [KICK]).reused).toBe(0);
  });
});
