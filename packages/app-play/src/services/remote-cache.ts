// Files the player reads from other sites (difficulty-table pages, headers and song lists, Bemuse server indexes and
// song asset indexes), kept between visits so that opening the player again asks those sites for nothing until an entry
// is due. An entry serves until it is older than its policy's age, was fetched before a refresh the player asked for,
// or was stored for another version of what it describes. A due entry is fetched again, and when that fetch fails the
// entry still serves, so a site that is down or a player offline keeps what was read last time.

/** One kept file: its bytes, when they were fetched, and the version of what they describe, if the reader names one. */
export interface RemoteCacheEntry {
  readonly bytes: Uint8Array;
  /** `Date.now()` when the bytes arrived. */
  readonly fetchedAt: number;
  readonly version?: string;
}

/** Where the entries are kept, by a key the reader picks (usually the file's URL). */
export interface RemoteCacheStore {
  get(key: string): Promise<RemoteCacheEntry | undefined>;
  put(key: string, entry: RemoteCacheEntry): Promise<void>;
}

/** When a kept entry serves without asking the network. */
export interface RemoteCachePolicy {
  /** How long an entry serves; `Infinity` keeps it until its version changes or a refresh asks for it. */
  readonly maxAgeMs: number;
  /** An entry fetched before this time is fetched again: the player asked to refresh then. */
  readonly refreshedSince?: number;
  /** The version the reader expects; an entry stored under another is fetched again. */
  readonly version?: string;
}

/** How a read was answered, for the caller's log. */
export type RemoteCacheSource = 'cache' | 'network' | 'stale';

/** Whether `entry` serves under `policy` at `nowMs` without asking the network. */
export function isRemoteCacheEntryFresh(entry: RemoteCacheEntry, policy: RemoteCachePolicy, nowMs: number): boolean {
  if (policy.version !== undefined && entry.version !== policy.version) return false;
  if (policy.refreshedSince !== undefined && entry.fetchedAt < policy.refreshedSince) return false;
  // An entry from the future (a clock set back) is due, so a wrong clock never keeps it forever.
  const age = nowMs - entry.fetchedAt;
  return age >= 0 && age < policy.maxAgeMs;
}

/**
 * The bytes of `key`: the kept entry while it is fresh, else `fetchBytes()` (kept for next time), else, when that
 * fails, the kept entry however old. Without a store, or without an entry, a failed fetch rejects.
 */
export async function readThroughRemoteCache(
  key: string,
  fetchBytes: () => Promise<Uint8Array>,
  store: RemoteCacheStore | undefined,
  policy: RemoteCachePolicy,
  nowMs: number = Date.now(),
): Promise<{ bytes: Uint8Array; source: RemoteCacheSource }> {
  const kept = await store?.get(key).catch(() => undefined);
  if (kept !== undefined && isRemoteCacheEntryFresh(kept, policy, nowMs)) return { bytes: kept.bytes, source: 'cache' };
  let bytes: Uint8Array;
  try {
    bytes = await fetchBytes();
  } catch (error) {
    if (kept !== undefined) return { bytes: kept.bytes, source: 'stale' };
    throw error;
  }
  await store
    ?.put(key, { bytes, fetchedAt: nowMs, ...(policy.version !== undefined ? { version: policy.version } : {}) })
    .catch(() => undefined);
  return { bytes, source: 'network' };
}

/** The Cache Storage cache the entries live in. */
export const REMOTE_CACHE_NAME = 'be-music-remote-v1';
/** The made-up origin the keys are filed under, so a key is never a request the browser could match another way. */
const KEY_ORIGIN = 'https://remote-cache.be-music.invalid/';
const FETCHED_AT_HEADER = 'x-be-music-fetched-at';
const VERSION_HEADER = 'x-be-music-version';

function cacheRequestURL(key: string): string {
  return `${KEY_ORIGIN}?key=${encodeURIComponent(key)}`;
}

/** A store over Cache Storage, or `undefined` where the page has none (an insecure origin, a worker test). */
export function createCacheStorageRemoteStore(
  storage: CacheStorage | undefined = globalThis.caches,
  cacheName: string = REMOTE_CACHE_NAME,
): RemoteCacheStore | undefined {
  if (storage === undefined) return undefined;
  const open = () => storage.open(cacheName);
  return {
    async get(key) {
      try {
        const response = await (await open()).match(cacheRequestURL(key));
        if (response === undefined) return undefined;
        const fetchedAt = Number(response.headers.get(FETCHED_AT_HEADER));
        if (!Number.isFinite(fetchedAt)) return undefined;
        const version = response.headers.get(VERSION_HEADER);
        return {
          bytes: new Uint8Array(await response.arrayBuffer()),
          fetchedAt,
          ...(version !== null ? { version: decodeURIComponent(version) } : {}),
        };
      } catch {
        return undefined;
      }
    },
    async put(key, entry) {
      const headers = new Headers({ [FETCHED_AT_HEADER]: String(entry.fetchedAt) });
      // Header values are Latin-1; a version may be any text.
      if (entry.version !== undefined) headers.set(VERSION_HEADER, encodeURIComponent(entry.version));
      try {
        await (await open()).put(cacheRequestURL(key), new Response(new Uint8Array(entry.bytes), { headers }));
      } catch {
        // A full or blocked store: the file is fetched again next time.
      }
    },
  };
}

/** A store in memory, for tests and pages without Cache Storage. */
export function createMemoryRemoteStore(): RemoteCacheStore & { readonly entries: Map<string, RemoteCacheEntry> } {
  const entries = new Map<string, RemoteCacheEntry>();
  return {
    entries,
    get: async (key) => entries.get(key),
    put: async (key, entry) => {
      entries.set(key, entry);
    },
  };
}

/**
 * Caches earlier builds kept and this store took over: `be-music-bemuse-charts` held Bemuse charts by their index MD5,
 * which some servers list for other bytes than they serve, so those charts were fetched on every visit.
 */
export const RETIRED_CACHE_NAMES: readonly string[] = ['be-music-bemuse-charts'];

let pageStore: RemoteCacheStore | null | undefined;

/** The page's store, shared by every reader; `undefined` without Cache Storage. Its first use drops the retired caches. */
export function pageRemoteCacheStore(): RemoteCacheStore | undefined {
  if (pageStore === undefined) {
    pageStore = createCacheStorageRemoteStore() ?? null;
    if (pageStore !== null) {
      for (const name of RETIRED_CACHE_NAMES) void globalThis.caches.delete(name).catch(() => false);
    }
  }
  return pageStore ?? undefined;
}

const HOUR_MS = 60 * 60 * 1000;
/**
 * How long a difficulty table's page, header and song list serve before they are asked for again. Tables change a few
 * times a day at most, and a reload of the folders asks at once.
 */
export const COURSE_TABLE_MAX_AGE_MS = 24 * HOUR_MS;
/** How long a Bemuse server's index serves before it is asked for again; a reload of the folders asks at once. */
export const BEMUSE_INDEX_MAX_AGE_MS = 24 * HOUR_MS;
/** How long a song's missing default preview is believed missing; a preview that exists is kept with the song. */
export const BEMUSE_MISSING_PREVIEW_MAX_AGE_MS = 7 * 24 * HOUR_MS;
