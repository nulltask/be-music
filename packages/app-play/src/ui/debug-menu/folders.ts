// Layout and persistence helpers for the demo's lil-gui "Debug Menu". The folder titles, their order, and which ones
// start open live here so the structure reads in one place and stays testable; `index.ts` binds the controllers.

/** Prefix every `localStorage` key the demo writes starts with. */
export const DEMO_STORAGE_PREFIX = 'be-music-demo.';

/** Where the open / closed state of each Debug Menu folder is remembered. */
export const DEBUG_MENU_FOLDERS_STORAGE_KEY = `${DEMO_STORAGE_PREFIX}debug-menu-folders`;

/**
 * Stored keys "Reset settings" leaves alone: the best records are play data, not settings, and have their own
 * "Clear best records" button.
 */
export const DEMO_STORAGE_KEYS_KEPT_ON_RESET: readonly string[] = [`${DEMO_STORAGE_PREFIX}chart-best-records`];

/** A Debug Menu folder: its title and whether it starts open before the user has opened or closed it. */
export interface DebugMenuFolder {
  readonly title: string;
  readonly open: boolean;
}

/**
 * Every folder of the Debug Menu, top to bottom. Everyday folders (play options, tempo, course) start open; skin detail,
 * the library tools, capture,
 * the Leaderboard and the developer settings start closed. Nested folders sit under the folder named in their key.
 */
export const DEBUG_MENU_FOLDERS = {
  playOptions: { title: 'Play options', open: true },
  replayView: { title: 'Replay / ghost', open: false },
  tempo: { title: 'Tempo', open: true },
  course: { title: 'Course', open: true },
  skin: { title: 'Skin & display', open: false },
  beatorajaSkins: { title: 'Beatoraja skins', open: true },
  skinSettings: { title: 'Skin settings', open: true },
  addSkin: { title: 'Add skin', open: false },
  audio: { title: 'Audio', open: true },
  compressor: { title: 'Compressor', open: false },
  compressorStages: { title: 'Stages', open: true },
  library: { title: 'Library & records', open: false },
  bgaTranscode: { title: 'BGA video transcode', open: false },
  capture: { title: 'Capture', open: false },
  leaderboard: { title: 'Leaderboard', open: false },
  developer: { title: 'Developer', open: false },
} as const satisfies Record<string, DebugMenuFolder>;

/** Folder path → open, for the folders the user has opened or closed. */
export type FolderOpenStates = Record<string, boolean>;

/** Minimal storage surface, so tests can hand in a stub and blocked storage can throw. */
export interface DebugMenuStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

function defaultStorage(): DebugMenuStorage | undefined {
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

export function readFolderOpenStates(storage: DebugMenuStorage | undefined = defaultStorage()): FolderOpenStates {
  try {
    return parseFolderOpenStates(storage?.getItem(DEBUG_MENU_FOLDERS_STORAGE_KEY));
  } catch {
    return {};
  }
}

export function storeFolderOpenStates(
  states: FolderOpenStates,
  storage: DebugMenuStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(DEBUG_MENU_FOLDERS_STORAGE_KEY, serializeFolderOpenStates(states));
  } catch {
    // Private windows / blocked storage: folders still open and close, just not remembered.
  }
}

/** The lil-gui surface the folder-state helpers touch (a `GUI` satisfies it). */
export interface FolderNode {
  readonly _title: string;
  readonly _closed: boolean;
  readonly folders: readonly FolderNode[];
  readonly parent?: FolderNode | undefined;
  open(open?: boolean): unknown;
  onOpenClose(callback: (changed: FolderNode) => void): unknown;
}

/** Titles from the top-level folder down to `folder` (the root panel, which has no parent, is left out). */
export function folderTitles(folder: FolderNode): string[] {
  const titles: string[] = [];
  for (let node: FolderNode | undefined = folder; node?.parent !== undefined; node = node.parent) {
    titles.unshift(node._title);
  }
  return titles;
}

/**
 * Opens / closes every folder under `root` the way the user last left it, then remembers each later open or close.
 * Folders keep the state they were built with until the user changes them. The root panel's own state is not
 * remembered: it starts closed so it never covers the stage on arrival.
 */
export function rememberFolderOpenStates(
  root: FolderNode,
  storage: DebugMenuStorage | undefined = defaultStorage(),
): void {
  const states = readFolderOpenStates(storage);
  const apply = (folder: FolderNode): void => {
    for (const child of folder.folders) {
      const remembered = states[folderPath(folderTitles(child))];
      if (remembered !== undefined) child.open(remembered);
      apply(child);
    }
  };
  apply(root);
  root.onOpenClose((changed) => {
    if (changed === root || changed.parent === undefined) return;
    states[folderPath(folderTitles(changed))] = !changed._closed;
    storeFolderOpenStates(states, storage);
  });
}

/** The demo's stored keys a settings reset removes: every `be-music-demo.*` key except the kept ones. */
export function demoSettingKeys(storage: DebugMenuStorage | undefined = defaultStorage()): string[] {
  const keys: string[] = [];
  try {
    if (!storage) return keys;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(DEMO_STORAGE_PREFIX) && !DEMO_STORAGE_KEYS_KEPT_ON_RESET.includes(key)) keys.push(key);
    }
  } catch {
    // Blocked storage holds nothing to reset.
  }
  return keys;
}

/** Removes every demo setting (see {@link demoSettingKeys}); returns how many keys were removed. */
export function clearDemoSettings(storage: DebugMenuStorage | undefined = defaultStorage()): number {
  const keys = demoSettingKeys(storage);
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
