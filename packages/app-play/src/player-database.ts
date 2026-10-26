// The player's IndexedDB database (`be-music`): every store the app keeps in it is created here, so each module opens
// the database at the one version that has them all.

/** The database's name. */
export const PLAYER_DB_NAME = 'be-music';
/** Bumped when a store is added: 1 had `courses`; 2 added the replay slots. */
export const PLAYER_DB_VERSION = 2;

/** The player's own courses (`course-maker-store.ts`). */
export const COURSES_STORE = 'courses';
/** One small record per replay slot: what it holds, its size and score (`services/replay-slots.ts`). */
export const REPLAY_SLOTS_STORE = 'replaySlots';
/** The gzip-compressed replay of each slot, by the same key as its record in {@link REPLAY_SLOTS_STORE}. */
export const REPLAY_SLOT_DATA_STORE = 'replaySlotData';

const STORES = [COURSES_STORE, REPLAY_SLOTS_STORE, REPLAY_SLOT_DATA_STORE] as const;

/** Opens the database, creating the stores it lacks. Rejects where IndexedDB is unavailable or blocked. */
export function openPlayerDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PLAYER_DB_NAME, PLAYER_DB_VERSION);
    request.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
}
