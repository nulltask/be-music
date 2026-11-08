// Parsed charts kept across page loads in IndexedDB (`be-music-charts`), keyed by the SHA-256 of each chart file and
// the kind of its name (`parsedChartCacheKey`), so a folder dropped again lists its charts without parsing them again.
// What a parse produces belongs to the build that parsed it: a build with another stamp clears the store first.

import type { ParseChartTaskResult } from '@be-music/player-browser';
import type { ParsedChartCache } from '@be-music/player-browser/collection';

/** The parsed charts' database. */
export const PARSED_CHART_DB_NAME = 'be-music-charts';
const PARSED_CHART_DB_VERSION = 1;
/** Each chart's parse result (`ParseChartTaskResult`), by its cache key. */
const PARSED_CHARTS_STORE = 'parsedCharts';
/** The stamp of the build that wrote the parse results, under {@link BUILD_KEY}. */
const META_STORE = 'meta';
const BUILD_KEY = 'build';

/**
 * The stamp a build keeps its parse results under: its source revision and build time, so any parser change a new
 * build brings (or a restarted dev server picks up) starts from an empty store. Empty when neither is known, in which
 * case nothing is cached.
 */
export function parsedChartBuildStamp(info: { revision: string; builtAt: string } | undefined): string {
  if (info === undefined) return '';
  const revision = info.revision === 'unknown' ? '' : info.revision;
  if (revision.length === 0 && info.builtAt.length === 0) return '';
  return `${revision}@${info.builtAt}`;
}

/** This build's stamp, from the build info `vite.config.ts` defines; empty where it defines none (tests). */
export function currentParsedChartBuildStamp(): string {
  return parsedChartBuildStamp(
    typeof __BE_MUSIC_BUILD_TIME__ === 'string'
      ? { revision: __BE_MUSIC_BUILD_REVISION__, builtAt: __BE_MUSIC_BUILD_TIME__ }
      : undefined,
  );
}

function request<T>(target: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    target.onsuccess = () => resolve(target.result);
    target.onerror = () => reject(target.error ?? new Error('indexedDB request failed'));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('indexedDB write aborted'));
    transaction.onerror = () => undefined;
  });
}

function openParsedChartDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(PARSED_CHART_DB_NAME, PARSED_CHART_DB_VERSION);
    open.onupgradeneeded = () => {
      for (const store of [PARSED_CHARTS_STORE, META_STORE]) {
        if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store);
      }
    };
    open.onsuccess = () => {
      // Another tab upgrading the database must not wait on this one.
      open.result.onversionchange = () => open.result.close();
      resolve(open.result);
    };
    open.onerror = () => reject(open.error ?? new Error('indexedDB open failed'));
    open.onblocked = () => reject(new Error('indexedDB open blocked'));
  });
}

/** Opens the database and clears the parse results another build wrote. */
async function openForBuild(factory: IDBFactory, stamp: string): Promise<IDBDatabase> {
  const db = await openParsedChartDatabase(factory);
  try {
    const stored = await request(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(BUILD_KEY));
    if (stored !== stamp) {
      const write = db.transaction([PARSED_CHARTS_STORE, META_STORE], 'readwrite');
      write.objectStore(PARSED_CHARTS_STORE).clear();
      write.objectStore(META_STORE).put(stamp, BUILD_KEY);
      await complete(write);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * The parsed-chart cache in IndexedDB, or `undefined` where there is no IndexedDB or no build stamp. The database
 * opens on the first lookup and stays open for the page; if it cannot be opened, every lookup misses and nothing is
 * kept, so loads parse as they would without a cache.
 */
export function createIndexedDBParsedChartCache(
  stamp: string,
  factory: IDBFactory | undefined = globalThis.indexedDB,
): ParsedChartCache | undefined {
  if (factory === undefined || stamp.length === 0) return undefined;
  let opened: Promise<IDBDatabase | undefined> | undefined;
  const database = (): Promise<IDBDatabase | undefined> =>
    (opened ??= openForBuild(factory, stamp).catch(() => undefined));
  return {
    async get(key) {
      const db = await database();
      if (db === undefined) return undefined;
      const value: unknown = await request(
        db.transaction(PARSED_CHARTS_STORE, 'readonly').objectStore(PARSED_CHARTS_STORE).get(key),
      );
      return value === undefined ? undefined : (value as ParseChartTaskResult);
    },
    async set(key, value) {
      const db = await database();
      if (db === undefined) return;
      const transaction = db.transaction(PARSED_CHARTS_STORE, 'readwrite');
      // `put` copies the value now; the write lands on its own. A quota error only aborts this one entry.
      transaction.objectStore(PARSED_CHARTS_STORE).put(value, key);
      transaction.onabort = () => undefined;
      transaction.onerror = (event) => event.preventDefault();
    },
  };
}
