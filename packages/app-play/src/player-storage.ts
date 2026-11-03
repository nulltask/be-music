// Storage data shared by settings services and the Options dialog; no UI dependencies.

/** Prefix every `localStorage` key the player writes starts with. */
export const PLAYER_STORAGE_PREFIX = 'be-music.';

/**
 * Stored keys "Reset settings" leaves alone: the best records are play data, not settings, and have their own
 * "Clear best records" button.
 */
export const PLAYER_STORAGE_KEYS_KEPT_ON_RESET: readonly string[] = [`${PLAYER_STORAGE_PREFIX}chart-best-records`];

/** Minimal storage surface, so tests can hand in a stub and blocked storage can throw. */
export interface PlayerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export function defaultStorage(): PlayerStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The player's stored keys a settings reset removes: every `be-music.*` key except the kept ones. */
export function playerSettingKeys(storage: PlayerStorage | undefined = defaultStorage()): string[] {
  const keys: string[] = [];
  try {
    if (!storage) return keys;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(PLAYER_STORAGE_PREFIX) && !PLAYER_STORAGE_KEYS_KEPT_ON_RESET.includes(key)) keys.push(key);
    }
  } catch {
    // Blocked storage holds nothing to reset.
  }
  return keys;
}

/** Removes every player setting (see {@link playerSettingKeys}); returns how many keys were removed. */
export function clearPlayerSettings(storage: PlayerStorage | undefined = defaultStorage()): number {
  const keys = playerSettingKeys(storage);
  let removed = 0;
  for (const key of keys) {
    try {
      storage?.removeItem(key);
      removed++;
    } catch {
      // Keep going: one blocked key shouldn't stop the rest.
    }
  }
  return removed;
}

/** Moves the former player namespace once, keeping newer values and removing an old key only after copying it. */
export function migratePlayerStorage(storage: PlayerStorage | undefined = defaultStorage()): void {
  if (!storage) return;
  const previousPrefix = 'be-music-demo.';
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(previousPrefix)) keys.push(key);
    }
    for (const key of keys) {
      const target = `${PLAYER_STORAGE_PREFIX}${key.slice(previousPrefix.length)}`;
      const value = storage.getItem(key);
      if (value === null) continue;
      if (storage.getItem(target) === null) storage.setItem(target, value);
      storage.removeItem(key);
    }
  } catch {
    // Leave uncopied data in place when storage is blocked or full; retry on the next visit.
  }
}
