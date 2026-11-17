import { describe, expect, test, vi } from 'vite-plus/test';
import { sha256HexAsync } from '@be-music/shared-utils/hash';
import type { ParseChartTaskResult } from '../compute/tasks.ts';
import {
  parseChartThroughCache,
  parsedChartCacheKey,
  readParsedCharts,
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
    expect(parsedChartPathKind('songs/a.N2S')).toBe('n2s');
    expect(parsedChartPathKind('song/001/01.LRS')).toBe('lrx');
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

  test('tells the key it worked out, whether the chart was cached or parsed', async () => {
    const cache = memoryCache();
    const keys: string[] = [];
    await parseChartThroughCache({ path: 'a.bms', bytes: BMS }, cache, (key) => keys.push(key));
    await parseChartThroughCache({ path: 'a.bms', bytes: BMS }, cache, (key) => keys.push(key));
    const key = `${await sha256HexAsync(BMS)}:bms`;
    expect(keys).toEqual([key, key]);
  });

  test('keys an LRX chart by its header and BGA file too', async () => {
    const cache = memoryCache();
    const lrs = new TextEncoder().encode('<LRS><n c="301" s="0" p="120" /><n c="1" s="0" p="0" /></LRS>');
    const lrh = (title: string) => new TextEncoder().encode(`<LRH><information title="${title}" lanetype="1" /></LRH>`);
    const first = await parseChartThroughCache({ path: 'song/01.lrs', bytes: lrs, siblings: { lrh: lrh('A') } }, cache);
    const second = await parseChartThroughCache(
      { path: 'song/01.lrs', bytes: lrs, siblings: { lrh: lrh('B') } },
      cache,
    );
    expect([first.chart.metadata.title, second.chart.metadata.title]).toEqual(['A', 'B']);
    expect([...cache.entries.keys()]).toEqual([
      `${await sha256HexAsync(lrs)}:lrx:${await sha256HexAsync(lrh('A'))}:-`,
      `${await sha256HexAsync(lrs)}:lrx:${await sha256HexAsync(lrh('B'))}:-`,
    ]);
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

describe('readParsedCharts', () => {
  test('reads the charts kept under the keys, in their order, with no chart for a key the cache lacks', async () => {
    const cache = memoryCache();
    const parsed = await parseChartThroughCache({ path: 'a.bms', bytes: BMS }, cache);
    const key = `${await sha256HexAsync(BMS)}:bms`;
    cache.entries.set('broken', { broken: true } as unknown as ParseChartTaskResult);
    cache.gets.length = 0;
    const charts = await readParsedCharts(cache, ['missing', key, 'broken']);
    expect(charts.map((chart) => chart?.scored)).toEqual([undefined, parsed.scored, undefined]);
    expect(cache.gets).toEqual(['missing', key, 'broken']);
  });

  test('asks a cache that reads many keys at once only once', async () => {
    const cache = memoryCache();
    const parsed = await parseChartThroughCache({ path: 'a.bms', bytes: BMS }, cache);
    const key = `${await sha256HexAsync(BMS)}:bms`;
    cache.gets.length = 0;
    const getMany = vi.fn(async (keys: readonly string[]) => keys.map((each) => cache.entries.get(each)));
    const charts = await readParsedCharts({ ...cache, getMany }, [key, 'missing']);
    expect(charts.map((chart) => chart?.scored)).toEqual([parsed.scored, undefined]);
    expect(getMany).toHaveBeenCalledTimes(1);
    expect(cache.gets).toEqual([]);
  });

  test('has no chart without a cache, or when the cache fails', async () => {
    expect(await readParsedCharts(undefined, ['a', 'b'])).toEqual([undefined, undefined]);
    const failing: ParsedChartCache = {
      get: () => Promise.reject(new Error('read failed')),
      set: () => Promise.resolve(),
    };
    expect(await readParsedCharts(failing, ['a'])).toEqual([undefined]);
    const failingMany: ParsedChartCache = { ...failing, getMany: () => Promise.reject(new Error('read failed')) };
    expect(await readParsedCharts(failingMany, ['a'])).toEqual([undefined]);
  });
});
