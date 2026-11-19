import { planReplaySlotRevision } from './replay-slot-revision.ts';
import type { ReplaySlotBackend } from './replay-slots.ts';

/** The replay slots' database. */
export const REPLAY_SLOT_DB_NAME = 'be-music-replays';
/** Bumped when a store is added; the shape of what the stores hold is the storage revision's. */
const REPLAY_SLOT_DB_VERSION = 2;
/** Replay metadata and the slots selecting each replay. */
const REPLAY_SLOTS_STORE = 'replaySlots';
/** The gzip-compressed replay of each history entry, by its record key. */
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
  const transaction = db.transaction([REPLAY_SLOTS_STORE, REPLAY_SLOT_DATA_STORE, META_STORE], 'readwrite');
  const done = complete(transaction);
  const requests = Promise.all([
    request(transaction.objectStore(REPLAY_SLOTS_STORE).getAllKeys()),
    request(transaction.objectStore(REPLAY_SLOTS_STORE).getAll()),
    request(transaction.objectStore(REPLAY_SLOT_DATA_STORE).getAllKeys()),
    request(transaction.objectStore(META_STORE).get(REVISION_KEY)),
  ]);
  void done.catch(() => undefined);
  const [keys, values, dataKeys, revision] = await requests;
  const plan = planReplaySlotRevision({
    storedRevision: typeof revision === 'number' ? revision : undefined,
    // Slot keys are strings; a key of any other type is not one this player wrote, and is left alone.
    records: keys.flatMap((key, index) => (typeof key === 'string' ? [{ key, value: values[index] }] : [])),
    dataKeys: dataKeys.filter((key): key is string => typeof key === 'string'),
  });
  for (const key of plan.remove) {
    transaction.objectStore(REPLAY_SLOTS_STORE).delete(key);
    transaction.objectStore(REPLAY_SLOT_DATA_STORE).delete(key);
  }
  for (const record of plan.put) transaction.objectStore(REPLAY_SLOTS_STORE).put(record, record.key);
  if (plan.revision !== undefined) transaction.objectStore(META_STORE).put(plan.revision, REVISION_KEY);
  await done;
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
    ...(typeof navigator.locks?.request === 'function'
      ? { exclusive: <T>(action: () => Promise<T>) => navigator.locks.request(REPLAY_SLOT_DB_NAME, action) }
      : {}),
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
    write: (entry, remove, update = []) =>
      withDatabase((db) => {
        const transaction = db.transaction([REPLAY_SLOTS_STORE, REPLAY_SLOT_DATA_STORE], 'readwrite');
        const records = transaction.objectStore(REPLAY_SLOTS_STORE);
        const data = transaction.objectStore(REPLAY_SLOT_DATA_STORE);
        for (const record of update) records.put(record, record.key);
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
