import { describe, expect, test } from 'vite-plus/test';
import {
  createCacheStorageRemoteStore,
  createMemoryRemoteStore,
  isRemoteCacheEntryFresh,
  readThroughRemoteCache,
  type RemoteCacheEntry,
} from './remote-cache.ts';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe('isRemoteCacheEntryFresh', () => {
  const entry: RemoteCacheEntry = { bytes: bytes('x'), fetchedAt: 1000, version: 'v1' };

  test('serves within its age, and not from the age on', () => {
    expect(isRemoteCacheEntryFresh(entry, { maxAgeMs: 500 }, 1499)).toBe(true);
    expect(isRemoteCacheEntryFresh(entry, { maxAgeMs: 500 }, 1500)).toBe(false);
    expect(isRemoteCacheEntryFresh(entry, { maxAgeMs: Infinity }, 1e15)).toBe(true);
  });

  test('is due when stored under another version, or before a refresh', () => {
    expect(isRemoteCacheEntryFresh(entry, { maxAgeMs: Infinity, version: 'v2' }, 1000)).toBe(false);
    expect(isRemoteCacheEntryFresh(entry, { maxAgeMs: Infinity, version: 'v1' }, 1000)).toBe(true);
    expect(isRemoteCacheEntryFresh(entry, { maxAgeMs: Infinity, refreshedSince: 1001 }, 2000)).toBe(false);
    expect(isRemoteCacheEntryFresh(entry, { maxAgeMs: Infinity, refreshedSince: 1000 }, 2000)).toBe(true);
  });

  test('is due when it was fetched in the future (a clock set back)', () => {
    expect(isRemoteCacheEntryFresh(entry, { maxAgeMs: 500 }, 999)).toBe(false);
  });
});

describe('readThroughRemoteCache', () => {
  test('fetches and keeps a file, then serves it kept while fresh', async () => {
    const store = createMemoryRemoteStore();
    let fetches = 0;
    const fetchBytes = async () => bytes(`body ${++fetches}`);
    const first = await readThroughRemoteCache('k', fetchBytes, store, { maxAgeMs: 100, version: 'v' }, 0);
    expect({ text: text(first.bytes), source: first.source }).toEqual({ text: 'body 1', source: 'network' });
    expect(store.entries.get('k')).toMatchObject({ fetchedAt: 0, version: 'v' });
    const second = await readThroughRemoteCache('k', fetchBytes, store, { maxAgeMs: 100, version: 'v' }, 99);
    expect({ text: text(second.bytes), source: second.source }).toEqual({ text: 'body 1', source: 'cache' });
    const third = await readThroughRemoteCache('k', fetchBytes, store, { maxAgeMs: 100, version: 'v' }, 100);
    expect({ text: text(third.bytes), source: third.source }).toEqual({ text: 'body 2', source: 'network' });
  });

  test('serves the kept copy however old when the fetch fails, and rejects without one', async () => {
    const store = createMemoryRemoteStore();
    store.entries.set('k', { bytes: bytes('old'), fetchedAt: 0 });
    const failing = async (): Promise<Uint8Array> => {
      throw new TypeError('Failed to fetch');
    };
    const read = await readThroughRemoteCache('k', failing, store, { maxAgeMs: 1 }, 1e9);
    expect({ text: text(read.bytes), source: read.source }).toEqual({ text: 'old', source: 'stale' });
    await expect(readThroughRemoteCache('other', failing, store, { maxAgeMs: 1 }, 0)).rejects.toThrow(TypeError);
    await expect(readThroughRemoteCache('k', failing, undefined, { maxAgeMs: 1 }, 0)).rejects.toThrow(TypeError);
  });
});

describe('createCacheStorageRemoteStore', () => {
  function fakeCacheStorage() {
    const responses = new Map<string, Response>();
    const cache = {
      match: async (url: string) => responses.get(url)?.clone(),
      put: async (url: string, response: Response) => void responses.set(url, response),
    };
    return { storage: { open: async () => cache } as unknown as CacheStorage, responses };
  }

  test('keeps the bytes, the fetch time and the version under a key of its own origin', async () => {
    const { storage, responses } = fakeCacheStorage();
    const store = createCacheStorageRemoteStore(storage)!;
    await store.put('table:https://t.example/h.json', { bytes: bytes('{}'), fetchedAt: 42, version: 'ü 1' });
    expect([...responses.keys()]).toEqual([
      'https://remote-cache.be-music.invalid/?key=table%3Ahttps%3A%2F%2Ft.example%2Fh.json',
    ]);
    const entry = await store.get('table:https://t.example/h.json');
    expect(entry && { text: text(entry.bytes), fetchedAt: entry.fetchedAt, version: entry.version }).toEqual({
      text: '{}',
      fetchedAt: 42,
      version: 'ü 1',
    });
    expect(await store.get('missing')).toBeUndefined();
  });

  test('is absent without Cache Storage', () => {
    expect(createCacheStorageRemoteStore(undefined)).toBeUndefined();
  });
});
