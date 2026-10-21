import { describe, expect, it } from 'vite-plus/test';
import {
  DEBUG_MENU_FOLDERS,
  DEBUG_MENU_FOLDERS_STORAGE_KEY,
  clearDemoSettings,
  demoSettingKeys,
  folderPath,
  folderEntries,
  parseFolderOpenStates,
  readFolderOpenStates,
  rememberFolderOpenStates,
  serializeFolderOpenStates,
  storeFolderOpenStates,
  type DebugMenuStorage,
  type FolderNode,
} from './folders.ts';

function memoryStorage(initial: Record<string, string> = {}): DebugMenuStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
  };
}

const BLOCKED_STORAGE: DebugMenuStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
  get length(): number {
    throw new Error('SecurityError');
  },
  key: () => {
    throw new Error('SecurityError');
  },
};

/** A stand-in for Tweakpane's `GUI` with the same open / close bubbling. */
class FakeFolder implements FolderNode {
  public readonly children: FakeFolder[] = [];
  public readonly title: string;
  private openState: boolean;
  private listener: ((event: { expanded: boolean }) => void) | undefined;
  public constructor(title: string, parent?: FakeFolder, open = true) {
    this.title = title;
    this.openState = open;
    parent?.children.push(this);
  }
  public get expanded(): boolean {
    return this.openState;
  }
  public set expanded(value: boolean) {
    this.openState = value;
    this.listener?.({ expanded: value });
  }
  public on(_event: 'fold', callback: (event: { expanded: boolean }) => void): this {
    this.listener = callback;
    return this;
  }
}

describe('Debug Menu folder layout', () => {
  it('has unique folder titles', () => {
    const titles = Object.values(DEBUG_MENU_FOLDERS).map((folder) => folder.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('opens the everyday folders and closes the developer ones', () => {
    expect(DEBUG_MENU_FOLDERS.playOptions.open).toBe(true);
    expect(DEBUG_MENU_FOLDERS.audio.open).toBe(true);
    expect(DEBUG_MENU_FOLDERS.developer.open).toBe(false);
    expect(DEBUG_MENU_FOLDERS.library.open).toBe(false);
  });
});

describe('folder open-state persistence', () => {
  it('joins folder titles into a path', () => {
    expect(folderPath(['Audio', 'Compressor'])).toBe('Audio / Compressor');
  });

  it('keeps only boolean entries from stored JSON', () => {
    expect(parseFolderOpenStates('{"Audio":false,"Skin":"yes","Developer":true}')).toEqual({
      Audio: false,
      Developer: true,
    });
    expect(parseFolderOpenStates('[true]')).toEqual({});
    expect(parseFolderOpenStates('not json')).toEqual({});
    expect(parseFolderOpenStates(null)).toEqual({});
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    storeFolderOpenStates({ Audio: false }, storage);
    expect(storage.values.get(DEBUG_MENU_FOLDERS_STORAGE_KEY)).toBe(serializeFolderOpenStates({ Audio: false }));
    expect(readFolderOpenStates(storage)).toEqual({ Audio: false });
  });

  it('survives blocked storage', () => {
    expect(readFolderOpenStates(BLOCKED_STORAGE)).toEqual({});
    expect(() => storeFolderOpenStates({ Audio: true }, BLOCKED_STORAGE)).not.toThrow();
  });

  it('names a folder by its titles below the root', () => {
    const root = new FakeFolder('Debug Menu');
    const audio = new FakeFolder('Audio', root);
    const compressor = new FakeFolder('Compressor', audio);
    expect(folderEntries(root).find(({ folder }) => folder === compressor)?.titles).toEqual(['Audio', 'Compressor']);
    expect(folderEntries(root)[0]?.titles).toEqual([]);
  });

  it('restores remembered folders and remembers later changes, but not the root panel', () => {
    const storage = memoryStorage({
      [DEBUG_MENU_FOLDERS_STORAGE_KEY]: JSON.stringify({ Audio: false, 'Audio / Compressor': true }),
    });
    const root = new FakeFolder('Debug Menu', undefined, false);
    const audio = new FakeFolder('Audio', root, true);
    const compressor = new FakeFolder('Compressor', audio, false);
    const developer = new FakeFolder('Developer', root, false);
    rememberFolderOpenStates(root, storage);
    expect(!audio.expanded).toBe(true);
    expect(!compressor.expanded).toBe(false);
    expect(!developer.expanded).toBe(true);

    developer.expanded = true;
    root.expanded = true;
    expect(readFolderOpenStates(storage)).toEqual({ Audio: false, 'Audio / Compressor': true, Developer: true });
  });
});

describe('settings reset', () => {
  it('removes demo settings but keeps best records and other sites’ keys', () => {
    const storage = memoryStorage({
      'be-music-demo.volumes': '{}',
      'be-music-demo.debug-menu-folders': '{}',
      'be-music-demo.chart-best-records': '{}',
      'other-app.key': 'x',
    });
    expect(demoSettingKeys(storage).sort()).toEqual(['be-music-demo.debug-menu-folders', 'be-music-demo.volumes']);
    expect(clearDemoSettings(storage)).toBe(2);
    expect([...storage.values.keys()].sort()).toEqual(['be-music-demo.chart-best-records', 'other-app.key']);
  });

  it('does nothing on blocked storage', () => {
    expect(demoSettingKeys(BLOCKED_STORAGE)).toEqual([]);
    expect(clearDemoSettings(BLOCKED_STORAGE)).toBe(0);
  });
});

it('keeps stored folder keys stable under native tab pages and ignores value blades', () => {
  const root = new FakeFolder('Debug Menu');
  const audio = new FakeFolder('Audio');
  const wrapper = { pages: [{ title: 'Sound', children: [audio, { label: 'Master' }] }] };
  (root.children as unknown[]).push(wrapper);
  const storage = memoryStorage({ [DEBUG_MENU_FOLDERS_STORAGE_KEY]: '{"Audio":false}' });
  rememberFolderOpenStates(root, storage);
  expect(audio.expanded).toBe(false);
  audio.expanded = true;
  expect(readFolderOpenStates(storage)).toEqual({ Audio: true });
});
