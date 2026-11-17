import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import {
  BEMUSE_CHUNK_LIST_STORAGE_KEY,
  bemuseChunksOverBudget,
  createCacheStorageBemuseChunkStore,
  parseBemuseChunkRecords,
  touchBemuseChunkRecord,
} from './bemuse-chunk-store.ts';

describe('touchBemuseChunkRecord', () => {
  test('moves a chunk to most recently used, keeping its size when none is given', () => {
    const records = [
      { url: 'a', size: 10, usedAt: 1 },
      { url: 'b', size: 20, usedAt: 2 },
    ];
    expect(touchBemuseChunkRecord(records, 'a', undefined, 5)).toEqual([
      { url: 'b', size: 20, usedAt: 2 },
      { url: 'a', size: 10, usedAt: 5 },
    ]);
    expect(touchBemuseChunkRecord(records, 'c', 30, 6).at(-1)).toEqual({ url: 'c', size: 30, usedAt: 6 });
    // An unknown chunk without a size is not listed.
    expect(touchBemuseChunkRecord(records, 'c', undefined, 6)).toEqual(records);
  });
});

describe('bemuseChunksOverBudget', () => {
  test('drops the chunks used longest ago until the rest fit', () => {
    const records = [
      { url: 'new', size: 40, usedAt: 9 },
      { url: 'old', size: 40, usedAt: 1 },
      { url: 'mid', size: 40, usedAt: 5 },
    ];
    expect(bemuseChunksOverBudget(records, 120)).toEqual([]);
    expect(bemuseChunksOverBudget(records, 100)).toEqual(['old']);
    expect(bemuseChunksOverBudget(records, 40)).toEqual(['old', 'mid']);
  });
});

describe('parseBemuseChunkRecords', () => {
  test('keeps well-formed records, the last of a URL', () => {
    expect(
      parseBemuseChunkRecords(JSON.stringify([['a', 1, 2], ['b', -1, 2], ['c', 1, 'x'], 'junk', ['a', 3, 4]])),
    ).toEqual([{ url: 'a', size: 3, usedAt: 4 }]);
    expect(parseBemuseChunkRecords('not json')).toEqual([]);
    expect(parseBemuseChunkRecords(null)).toEqual([]);
  });
});

describe('createCacheStorageBemuseChunkStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(budgetBytes: number) {
    vi.useFakeTimers();
    const responses = new Map<string, Uint8Array>();
    const cache = {
      match: async (url: string) => {
        const body = responses.get(url);
        return body === undefined ? undefined : new Response(new Uint8Array(body));
      },
      put: async (url: string, response: Response) => {
        responses.set(url, new Uint8Array(await response.arrayBuffer()));
      },
      delete: async (url: string) => responses.delete(url),
    };
    const list = new Map<string, string>();
    const listStorage = {
      getItem: (key: string) => list.get(key) ?? null,
      setItem: (key: string, value: string) => void list.set(key, value),
    };
    let nowMs = 0;
    const store = createCacheStorageBemuseChunkStore({
      storage: { open: async () => cache } as unknown as CacheStorage,
      listStorage,
      budgetBytes,
      now: () => ++nowMs,
    })!;
    return { store, responses, list };
  }

  test('serves a stored chunk and drops the one used longest ago past the budget', async () => {
    const { store, responses, list } = setup(10);
    await store.put('a', new Uint8Array(4));
    await store.put('b', new Uint8Array(4));
    expect(await store.get('a')).toHaveLength(4);
    await store.put('c', new Uint8Array(4));
    expect([...responses.keys()].sort()).toEqual(['a', 'c']);
    expect(await store.get('b')).toBeUndefined();
    // The list is written once the uses settle.
    expect(list.has(BEMUSE_CHUNK_LIST_STORAGE_KEY)).toBe(false);
    await vi.runAllTimersAsync();
    expect(parseBemuseChunkRecords(list.get(BEMUSE_CHUNK_LIST_STORAGE_KEY)).map((record) => record.url)).toEqual([
      'a',
      'c',
    ]);
  });

  test('stores no chunk larger than the whole budget', async () => {
    const { store, responses } = setup(3);
    await store.put('a', new Uint8Array(4));
    expect(responses.size).toBe(0);
  });

  test('is absent without Cache Storage', () => {
    expect(createCacheStorageBemuseChunkStore({ storage: undefined })).toBeUndefined();
  });
});
