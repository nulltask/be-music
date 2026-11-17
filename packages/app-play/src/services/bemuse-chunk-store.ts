// The `*.bemuse` chunks of the Bemuse server songs played, kept between visits so that a song played again downloads
// nothing. A chunk's file name carries the hash of its payload (`ogg.3.8ed2dece.bemuse`), so a URL always serves the
// same bytes and a kept chunk never needs asking for again. The chunks take a fixed share of the disk: once they pass
// it, the ones used longest ago go first. Which chunks are kept, their sizes and when each was last used are listed in
// `localStorage`, since Cache Storage keeps no use times and reading every entry to size it would cost a download.

/** A chunk store by URL. */
export interface BemuseChunkStore {
  get(url: string): Promise<Uint8Array | undefined>;
  put(url: string, bytes: Uint8Array): Promise<void>;
}

/** A kept chunk as the list names it. */
export interface BemuseChunkRecord {
  readonly url: string;
  readonly size: number;
  /** `Date.now()` when the chunk was last read or stored. */
  readonly usedAt: number;
}

export const BEMUSE_CHUNK_CACHE_NAME = 'be-music-bemuse-chunks';
/** `localStorage` key of the kept chunks' list. */
export const BEMUSE_CHUNK_LIST_STORAGE_KEY = 'be-music.bemuse-chunk-cache';
/** The disk the chunks may take: about 700 chunks, a few dozen songs. */
export const BEMUSE_CHUNK_BUDGET_BYTES = 1024 * 1024 * 1024;
/** How long the list waits for more uses before it is written, so a song's dozens of chunks write it once. */
const LIST_WRITE_DELAY_MS = 1000;

/** `records` with `url` marked used at `nowMs` (and sized `size` when given), most recently used last. */
export function touchBemuseChunkRecord(
  records: readonly BemuseChunkRecord[],
  url: string,
  size: number | undefined,
  nowMs: number,
): BemuseChunkRecord[] {
  const previous = records.find((record) => record.url === url);
  const rest = records.filter((record) => record.url !== url);
  const recordSize = size ?? previous?.size;
  if (recordSize === undefined) return rest;
  return [...rest, { url, size: recordSize, usedAt: nowMs }];
}

/** The URLs to drop so that the rest fit in `budgetBytes`, used longest ago first. */
export function bemuseChunksOverBudget(records: readonly BemuseChunkRecord[], budgetBytes: number): string[] {
  let total = records.reduce((sum, record) => sum + record.size, 0);
  const dropped: string[] = [];
  for (const record of [...records].sort((a, b) => a.usedAt - b.usedAt)) {
    if (total <= budgetBytes) break;
    total -= record.size;
    dropped.push(record.url);
  }
  return dropped;
}

/** Reads the stored list, keeping only well-formed records, each URL once. */
export function parseBemuseChunkRecords(raw: string | null | undefined): BemuseChunkRecord[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const records = new Map<string, BemuseChunkRecord>();
  for (const value of parsed) {
    if (!Array.isArray(value) || value.length !== 3) continue;
    const [url, size, usedAt] = value as unknown[];
    if (typeof url !== 'string' || !Number.isSafeInteger(size) || (size as number) < 0) continue;
    if (typeof usedAt !== 'number' || !Number.isFinite(usedAt)) continue;
    records.delete(url);
    records.set(url, { url, size: size as number, usedAt });
  }
  return [...records.values()];
}

function stringifyBemuseChunkRecords(records: readonly BemuseChunkRecord[]): string {
  return JSON.stringify(records.map((record) => [record.url, record.size, record.usedAt]));
}

/**
 * A chunk store over Cache Storage with its list in `listStorage`, or `undefined` where the page has no Cache Storage.
 * Without list storage (a private window) the list lasts for the visit and the budget holds within it.
 */
export function createCacheStorageBemuseChunkStore(
  options: {
    storage?: CacheStorage | undefined;
    listStorage?: Pick<Storage, 'getItem' | 'setItem'> | undefined;
    budgetBytes?: number;
    now?: () => number;
  } = {},
): BemuseChunkStore | undefined {
  const storage = 'storage' in options ? options.storage : globalThis.caches;
  if (storage === undefined) return undefined;
  const listStorage = 'listStorage' in options ? options.listStorage : defaultStorage();
  const budgetBytes = options.budgetBytes ?? BEMUSE_CHUNK_BUDGET_BYTES;
  const now = options.now ?? Date.now;
  const open = () => storage.open(BEMUSE_CHUNK_CACHE_NAME);
  let records = readRecords(listStorage);
  let writeTimer: ReturnType<typeof setTimeout> | undefined;

  const writeList = () => {
    writeTimer = undefined;
    try {
      listStorage?.setItem(BEMUSE_CHUNK_LIST_STORAGE_KEY, stringifyBemuseChunkRecords(records));
    } catch {
      // Full or blocked storage: the list is rebuilt as chunks are read again.
    }
  };
  const scheduleWrite = () => {
    writeTimer ??= setTimeout(writeList, LIST_WRITE_DELAY_MS);
  };

  return {
    async get(url) {
      try {
        const response = await (await open()).match(url);
        if (response === undefined) return undefined;
        const bytes = new Uint8Array(await response.arrayBuffer());
        records = touchBemuseChunkRecord(records, url, bytes.byteLength, now());
        scheduleWrite();
        return bytes;
      } catch {
        return undefined;
      }
    },
    async put(url, bytes) {
      if (bytes.byteLength > budgetBytes) return;
      try {
        const cache = await open();
        await cache.put(url, new Response(new Uint8Array(bytes)));
        records = touchBemuseChunkRecord(records, url, bytes.byteLength, now());
        const dropped = bemuseChunksOverBudget(records, budgetBytes);
        if (dropped.length > 0) {
          const droppedSet = new Set(dropped);
          records = records.filter((record) => !droppedSet.has(record.url));
          await Promise.all(dropped.map((droppedURL) => cache.delete(droppedURL).catch(() => false)));
        }
        scheduleWrite();
      } catch {
        // A full or blocked store: the chunk is fetched again next time.
      }
    },
  };
}

function readRecords(storage: Pick<Storage, 'getItem'> | undefined): BemuseChunkRecord[] {
  try {
    return parseBemuseChunkRecords(storage?.getItem(BEMUSE_CHUNK_LIST_STORAGE_KEY));
  } catch {
    return [];
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

let pageChunkStore: BemuseChunkStore | null | undefined;

/** The page's chunk store, shared by every server; `undefined` without Cache Storage. */
export function pageBemuseChunkStore(): BemuseChunkStore | undefined {
  if (pageChunkStore === undefined) pageChunkStore = createCacheStorageBemuseChunkStore() ?? null;
  return pageChunkStore ?? undefined;
}
