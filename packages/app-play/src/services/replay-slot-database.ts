// The replay slots' IndexedDB backend: a database of their own (`be-music-replays`), apart from the player's `be-music`
// one, with each slot's record in `replaySlots` and its compressed replay in `replaySlotData`, written together in one
// transaction.

import type { ReplaySlotBackend } from './replay-slots.ts';

/** The replay slots' database. */
export const REPLAY_SLOT_DB_NAME = 'be-music-replays';
/** Bumped when a store is added. */
const REPLAY_SLOT_DB_VERSION = 1;
/** One small record per slot: what it holds, its size and score. */
const REPLAY_SLOTS_STORE = 'replaySlots';
/** The gzip-compressed replay of each slot, by the same key as its record. */
const REPLAY_SLOT_DATA_STORE = 'replaySlotData';

/** Opens the replay slots' database, creating its stores. Rejects where IndexedDB is unavailable or blocked. */
function openReplaySlotDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REPLAY_SLOT_DB_NAME, REPLAY_SLOT_DB_VERSION);
    request.onupgradeneeded = () => {
      for (const store of [REPLAY_SLOTS_STORE, REPLAY_SLOT_DATA_STORE]) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

function request<T>(target: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    target.onsuccess = () => resolve(target.result);
    target.onerror = () => reject(target.error ?? new Error('indexedDB request failed'));
  });
}

async function withDatabase<T>(action: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openReplaySlotDatabase();
  try {
    return await action(db);
  } finally {
    db.close();
  }
}

/** The replay slots kept in their IndexedDB database. */
export function createIndexedDBReplaySlotBackend(): ReplaySlotBackend {
  return {
    listRecords: () =>
      withDatabase((db) =>
        request(db.transaction(REPLAY_SLOTS_STORE, 'readonly').objectStore(REPLAY_SLOTS_STORE).getAll()),
      ),
    readData: (key) =>
      withDatabase(async (db) => {
        const value: unknown = await request(
          db.transaction(REPLAY_SLOT_DATA_STORE, 'readonly').objectStore(REPLAY_SLOT_DATA_STORE).get(key),
        );
        return value instanceof Blob ? value : undefined;
      }),
    write: (entry, remove) =>
      withDatabase(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const transaction = db.transaction([REPLAY_SLOTS_STORE, REPLAY_SLOT_DATA_STORE], 'readwrite');
            const records = transaction.objectStore(REPLAY_SLOTS_STORE);
            const data = transaction.objectStore(REPLAY_SLOT_DATA_STORE);
            for (const key of remove) {
              records.delete(key);
              data.delete(key);
            }
            if (entry !== undefined) {
              records.put(entry.record, entry.record.key);
              data.put(entry.data, entry.record.key);
            }
            transaction.oncomplete = () => resolve();
            // A quota error aborts the transaction: nothing it wrote or removed is kept.
            transaction.onabort = () => reject(transaction.error ?? new Error('indexedDB write aborted'));
            transaction.onerror = () => undefined;
          }),
      ),
  };
}
