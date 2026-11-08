import { describe, expect, test } from 'vite-plus/test';
import { sha256HexAsync } from '@be-music/shared-utils/hash';
import type { ParseChartTaskResult } from '../compute/tasks.ts';
import {
  parseChartThroughCache,
  parsedChartCacheKey,
  parsedChartPathKind,
  type ParsedChartCache,
} from './parsed-chart-cache.ts';

const BMS = new TextEncoder().encode('#TITLE cached\n#BPM 120\n#00111:01010101\n');

function memoryCache(): ParsedChartCache & { entries: Map<string, ParseChartTaskResult>; gets: string[] } {
  const entries = new Map<string, ParseChartTaskResult>();
  const gets: string[] = [];
  return {
    entries,
    gets,
    async get(key) {
      gets.push(key);
      return entries.get(key);
    },
    async set(key, value) {
      entries.set(key, structuredClone(value));
    },
  };
}

describe('parsedChartPathKind', () => {
  test('tells bmson, PMS and other BMS names apart, ignoring case', () => {
    expect(parsedChartPathKind('songs/a.bmson')).toBe('bmson');
    expect(parsedChartPathKind('songs/A.BMSON')).toBe('bmson');
    expect(parsedChartPathKind('songs/a.PMS')).toBe('pms');
    expect(parsedChartPathKind('songs/a.bms')).toBe('bms');
    expect(parsedChartPathKind('songs/a.bme')).toBe('bms');
    expect(parsedChartPathKind('songs/a.bml')).toBe('bms');
  });
});

describe('parsedChartCacheKey', () => {
  test('joins the SHA-256 and the path kind', () => {
    expect(parsedChartCacheKey('abc', 'x/y.bms')).toBe('abc:bms');
    expect(parsedChartCacheKey('abc', 'x/y.pms')).toBe('abc:pms');
    expect(parsedChartCacheKey('abc', 'x/y.bmson')).toBe('abc:bmson');
  });
});

describe('parseChartThroughCache', () => {
  test('parses without a cache', async () => {
    const result = await parseChartThroughCache({ path: 'a.bms', bytes: BMS }, undefined);
    expect(result.chart.metadata.title).toBe('cached');
    expect(result.scored.notes).toBe(4);
  });

  test('keeps a parsed chart under the SHA-256 of its bytes and returns it on the next load', async () => {
    const cache = memoryCache();
    const first = await parseChartThroughCache({ path: 'a.bms', bytes: BMS }, cache);
    const key = `${await sha256HexAsync(BMS)}:bms`;
    expect([...cache.entries.keys()]).toEqual([key]);

    const kept = cache.entries.get(key)!;
    kept.chart.metadata.title = 'from cache';
    const second = await parseChartThroughCache({ path: 'other/b.bme', bytes: BMS }, cache);
    expect(second.chart.metadata.title).toBe('from cache');
    expect(second.scored).toEqual(first.scored);
    expect(cache.gets).toEqual([key, key]);
  });

  test('parses again under another path kind', async () => {
    const cache = memoryCache();
    await parseChartThroughCache({ path: 'a.bms', bytes: BMS }, cache);
    await parseChartThroughCache({ path: 'a.pms', bytes: BMS }, cache);
    expect(cache.entries.size).toBe(2);
  });

  test('ignores a cached value that is not a parse result', async () => {
    const cache = memoryCache();
    cache.entries.set(`${await sha256HexAsync(BMS)}:bms`, { broken: true } as unknown as ParseChartTaskResult);
    const result = await parseChartThroughCache({ path: 'a.bms', bytes: BMS }, cache);
    expect(result.chart.metadata.title).toBe('cached');
  });

  test('parses when the cache fails to read or write', async () => {
    const failing: ParsedChartCache = {
      get: () => Promise.reject(new Error('read failed')),
      set: () => Promise.reject(new Error('write failed')),
    };
    const result = await parseChartThroughCache({ path: 'a.bms', bytes: BMS }, failing);
    expect(result.chart.metadata.title).toBe('cached');
  });
});
