// Storage data shared by settings services and the Options dialog; no UI dependencies.

/** Prefix every `localStorage` key the player writes starts with. */
export const PLAYER_STORAGE_PREFIX = 'be-music.';

/** Where the open / closed state of each Options dialog folder is remembered. */
export const OPTION_FOLDERS_STORAGE_KEY = `${PLAYER_STORAGE_PREFIX}option-folders`;

/**
 * Stored keys "Reset settings" leaves alone: the best records are play data, not settings, and have their own
 * "Clear best records" button.
 */
export const PLAYER_STORAGE_KEYS_KEPT_ON_RESET: readonly string[] = [`${PLAYER_STORAGE_PREFIX}chart-best-records`];

/** Folder path → open, for the folders the user has opened or closed. */
export type FolderOpenStates = Record<string, boolean>;

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

/**
 * Identifies a folder by its titles from the top-level folder down (the root panel excluded), e.g.
 * `Audio / Compressor`. Titles are unique among siblings, so the path is unique in the menu.
 */
export function folderPath(titles: readonly string[]): string {
  return titles.join(' / ');
}

/** Stored folder states, keeping only well-formed `path → boolean` entries. */
export function parseFolderOpenStates(raw: string | null | undefined): FolderOpenStates {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const states: FolderOpenStates = {};
    for (const [path, open] of Object.entries(parsed)) {
      if (typeof open === 'boolean') states[path] = open;
    }
    return states;
  } catch {
    return {};
  }
}

export function serializeFolderOpenStates(states: FolderOpenStates): string {
  return JSON.stringify(states);
}

export function readFolderOpenStates(storage: PlayerStorage | undefined = defaultStorage()): FolderOpenStates {
  try {
    return parseFolderOpenStates(storage?.getItem(OPTION_FOLDERS_STORAGE_KEY));
  } catch {
    return {};
  }
}

export function storeFolderOpenStates(
  states: FolderOpenStates,
  storage: PlayerStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(OPTION_FOLDERS_STORAGE_KEY, serializeFolderOpenStates(states));
  } catch {
    // Private windows / blocked storage: folders still open and close, just not remembered.
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

/**
 * Keys the player has renamed, former → current: the Options dialog's document and folder states were the Debug
 * Menu's. The current document key is `OPTION_SETTINGS_STORAGE_KEY` (`option-settings.ts`, which imports this module).
 */
export const RENAMED_PLAYER_STORAGE_KEYS: Readonly<Record<string, string>> = {
  [`${PLAYER_STORAGE_PREFIX}debug-menu-settings`]: `${PLAYER_STORAGE_PREFIX}option-settings`,
  [`${PLAYER_STORAGE_PREFIX}debug-menu-folders`]: OPTION_FOLDERS_STORAGE_KEY,
};

/**
 * Moves the former player namespace, then the renamed keys, once each: a newer value under the current key is kept, and
 * an old key is removed only after it is copied.
 */
export function migratePlayerStorage(storage: PlayerStorage | undefined = defaultStorage()): void {
  if (!storage) return;
  const previousPrefix = 'be-music-demo.';
  const move = (key: string, target: string): void => {
    const value = storage.getItem(key);
    if (value === null) return;
    if (storage.getItem(target) === null) storage.setItem(target, value);
    storage.removeItem(key);
  };
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(previousPrefix)) keys.push(key);
    }
    for (const key of keys) move(key, `${PLAYER_STORAGE_PREFIX}${key.slice(previousPrefix.length)}`);
    for (const [key, target] of Object.entries(RENAMED_PLAYER_STORAGE_KEYS)) move(key, target);
  } catch {
    // Leave uncopied data in place when storage is blocked or full; retry on the next visit.
  }
}
