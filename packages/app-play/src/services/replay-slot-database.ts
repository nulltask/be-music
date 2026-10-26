// The replay slots' IndexedDB backend: each slot's record in `replaySlots` and its compressed replay in `replaySlotData`
// of the player's database, written together in one transaction.

import { openPlayerDatabase, REPLAY_SLOT_DATA_STORE, REPLAY_SLOTS_STORE } from '../player-database.ts';
import type { ReplaySlotBackend } from './replay-slots.ts';

function request<T>(target: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    target.onsuccess = () => resolve(target.result);
    target.onerror = () => reject(target.error ?? new Error('indexedDB request failed'));
  });
}

async function withDatabase<T>(action: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openPlayerDatabase();
  try {
    return await action(db);
  } finally {
    db.close();
  }
}

/** The replay slots kept in the player's IndexedDB database. */
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
