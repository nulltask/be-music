import { describe, expect, it } from 'vite-plus/test';
import {
  DEBUG_MENU_FOLDERS,
  DEBUG_MENU_FOLDERS_STORAGE_KEY,
  clearDemoSettings,
  demoSettingKeys,
  folderPath,
  folderTitles,
  parseFolderOpenStates,
  readFolderOpenStates,
  rememberFolderOpenStates,
  serializeFolderOpenStates,
  storeFolderOpenStates,
  type DebugMenuStorage,
  type FolderNode,
} from './debug-menu.ts';

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

/** A stand-in for lil-gui's `GUI` with the same open / close bubbling. */
class FakeFolder implements FolderNode {
  public _closed: boolean;
  public readonly folders: FakeFolder[] = [];
  private listener: ((changed: FolderNode) => void) | undefined;
  public readonly _title: string;
  public readonly parent: FakeFolder | undefined;
  public constructor(title: string, parent?: FakeFolder, open = true) {
    this._title = title;
    this.parent = parent;
    this._closed = !open;
    parent?.folders.push(this);
  }
  public open(open = true): this {
    this._closed = !open;
    this.notify(this);
    return this;
  }
  private notify(changed: FakeFolder): void {
    this.parent?.notify(changed);
    this.listener?.(changed);
  }
  public onOpenClose(callback: (changed: FolderNode) => void): this {
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
    expect(folderTitles(compressor)).toEqual(['Audio', 'Compressor']);
    expect(folderTitles(root)).toEqual([]);
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
    expect(audio._closed).toBe(true);
    expect(compressor._closed).toBe(false);
    expect(developer._closed).toBe(true);

    developer.open();
    root.open();
    expect(readFolderOpenStates(storage)).toEqual({ Audio: false, 'Audio / Compressor': true, Developer: true });
  });
});

describe('settings reset', () => {
  it('removes demo settings but keeps best records and other sites’ keys', () => {
    const storage = memoryStorage({
      'be-music-demo.volumes': '{}',
      'be-music-demo.debug-menu-folders': '{}',
      'be-music-demo.song-records': '{}',
      'other-app.key': 'x',
    });
    expect(demoSettingKeys(storage).sort()).toEqual(['be-music-demo.debug-menu-folders', 'be-music-demo.volumes']);
    expect(clearDemoSettings(storage)).toBe(2);
    expect([...storage.values.keys()].sort()).toEqual(['be-music-demo.song-records', 'other-app.key']);
  });

  it('does nothing on blocked storage', () => {
    expect(demoSettingKeys(BLOCKED_STORAGE)).toEqual([]);
    expect(clearDemoSettings(BLOCKED_STORAGE)).toBe(0);
  });
});
