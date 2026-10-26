// The replay slots' IndexedDB backend: a database of their own (`be-music-replays`), apart from the player's `be-music`
// one, with each slot's record in `replaySlots` and its compressed replay in `replaySlotData`, written together in one
// transaction. The stored shape is versioned by its storage revision (`replay-slot-revision.ts`), kept in `meta`; the
// first use on a page brings the stored slots to this build's revision.

import { planReplaySlotRevision } from './replay-slot-revision.ts';
import type { ReplaySlotBackend } from './replay-slots.ts';

/** The replay slots' database. */
export const REPLAY_SLOT_DB_NAME = 'be-music-replays';
/** Bumped when a store is added; the shape of what the stores hold is the storage revision's. */
const REPLAY_SLOT_DB_VERSION = 2;
/** One small record per slot: what it holds, its size and score. */
const REPLAY_SLOTS_STORE = 'replaySlots';
/** The gzip-compressed replay of each slot, by the same key as its record. */
const REPLAY_SLOT_DATA_STORE = 'replaySlotData';
/** The storage revision, under {@link REVISION_KEY}. */
const META_STORE = 'meta';
const REVISION_KEY = 'revision';

/** Opens the replay slots' database, creating its stores. Rejects where IndexedDB is unavailable or blocked. */
function openReplaySlotDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REPLAY_SLOT_DB_NAME, REPLAY_SLOT_DB_VERSION);
    request.onupgradeneeded = () => {
      for (const store of [REPLAY_SLOTS_STORE, REPLAY_SLOT_DATA_STORE, META_STORE]) {
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

async function withOpenDatabase<T>(action: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openReplaySlotDatabase();
  try {
    return await action(db);
  } finally {
    db.close();
  }
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    // A quota error aborts the transaction: nothing it wrote or removed is kept.
    transaction.onabort = () => reject(transaction.error ?? new Error('indexedDB write aborted'));
    transaction.onerror = () => undefined;
  });
}

/** Brings the stored slots to this build's storage revision, in one transaction. */
async function upgradeStoredSlots(db: IDBDatabase): Promise<void> {
  const read = db.transaction([REPLAY_SLOTS_STORE, REPLAY_SLOT_DATA_STORE, META_STORE], 'readonly');
  const [keys, values, dataKeys, revision] = await Promise.all([
    request(read.objectStore(REPLAY_SLOTS_STORE).getAllKeys()),
    request(read.objectStore(REPLAY_SLOTS_STORE).getAll()),
    request(read.objectStore(REPLAY_SLOT_DATA_STORE).getAllKeys()),
    request(read.objectStore(META_STORE).get(REVISION_KEY)),
  ]);
  const plan = planReplaySlotRevision({
    storedRevision: typeof revision === 'number' ? revision : undefined,
    // Slot keys are strings; a key of any other type is not one this player wrote, and is left alone.
    records: keys.flatMap((key, index) => (typeof key === 'string' ? [{ key, value: values[index] }] : [])),
    dataKeys: dataKeys.filter((key): key is string => typeof key === 'string'),
  });
  if (plan.remove.length === 0 && plan.put.length === 0 && plan.revision === undefined) return;
  const write = db.transaction([REPLAY_SLOTS_STORE, REPLAY_SLOT_DATA_STORE, META_STORE], 'readwrite');
  for (const key of plan.remove) {
    write.objectStore(REPLAY_SLOTS_STORE).delete(key);
    write.objectStore(REPLAY_SLOT_DATA_STORE).delete(key);
  }
  for (const record of plan.put) write.objectStore(REPLAY_SLOTS_STORE).put(record, record.key);
  if (plan.revision !== undefined) write.objectStore(META_STORE).put(plan.revision, REVISION_KEY);
  await complete(write);
}

/** The replay slots kept in their IndexedDB database, at the storage revision this build writes. */
export function createIndexedDBReplaySlotBackend(): ReplaySlotBackend {
  let upgraded: Promise<void> | undefined;
  const withDatabase = async <T>(action: (db: IDBDatabase) => Promise<T>): Promise<T> =>
    withOpenDatabase(async (db) => {
      // A failed upgrade is tried again on the next use.
      upgraded ??= upgradeStoredSlots(db).catch((error: unknown) => {
        upgraded = undefined;
        throw error;
      });
      await upgraded;
      return action(db);
    });
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
      withDatabase((db) => {
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
        return complete(transaction);
      }),
  };
}
