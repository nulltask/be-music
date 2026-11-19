import type { BrowserDroppedFile } from '@be-music/player-browser/collection';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { DropTarget, type DropTargetOptions } from './drop-target.ts';
import {
  FOLDER_HANDLE_TIMEOUT_MS,
  FOLDER_PERMISSION_REQUEST_TIMEOUT_MS,
  isUnansweredFolder,
} from '../services/folder-handle.ts';
import type { FolderListing } from '../services/folder-listing.ts';
import type { FolderSnapshot, FolderSnapshotStore } from '../services/folder-snapshots.ts';
import type { LibraryLoadOrigin } from '../services/library.ts';
import type { RememberedFolder } from '../services/remembered-folder.ts';

// The remembered folders' own store and the browser's pickers: the folders are handed in by each test.
// `unstorable` folders make a write fail, as a handle the browser cannot store again does.
const remembered = vi.hoisted(() => ({
  saved: [] as unknown[],
  dropped: [] as unknown[],
  picked: undefined as unknown,
  unstorable: new Set<unknown>(),
}));
vi.mock('../services/remembered-folder.ts', () => ({
  pickRememberedFolder: () => (remembered.picked === undefined ? undefined : Promise.resolve(remembered.picked)),
  captureDroppedFolders: async () => remembered.dropped,
  storedFolders: async (folders?: readonly unknown[]) => {
    if (folders) {
      if (folders.some((folder) => remembered.unstorable.has(folder)))
        throw new DOMException('cannot', 'DataCloneError');
      remembered.saved = [...folders];
    }
    return [...remembered.saved];
  },
}));

// These fixtures test synchronous drop reads and overlay lifecycle without a browser DOM.
// Real Lit rendering is covered by the browser suites; retain the controller's other DOM effects here.
vi.mock('lit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('lit')>()),
  render: vi.fn(),
}));

function fakeElement(): HTMLDivElement & HTMLInputElement {
  const classes = new Set<string>();
  return {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
    setAttribute: () => {},
    style: {},
    textContent: '',
  } as unknown as HTMLDivElement & HTMLInputElement;
}

/**
 * A drop's `DataTransfer`. The browser's reads empty once the `drop` handler has returned; this one does after
 * `expire()`. With `entries`, its items hand the files as `FileSystemFileEntry`s (a folder drop); without, it has only
 * `files` (as some browsers hand dropped files).
 */
function fakeDrop(files: readonly File[], options: { entries?: boolean } = {}) {
  let live = true;
  const entryOf = (file: File) => ({
    isFile: true,
    isDirectory: false,
    name: file.name,
    fullPath: `/${file.name}`,
    file: (resolve: (file: File) => void) => resolve(file),
  });
  const transfer = {
    get items() {
      return live && options.entries === true ? files.map((file) => ({ webkitGetAsEntry: () => entryOf(file) })) : [];
    },
    get files() {
      return live ? [...files] : [];
    },
  } as unknown as DataTransfer;
  return {
    transfer,
    expire: () => {
      live = false;
    },
  };
}

function harness(overrides: Partial<DropTargetOptions> = {}) {
  const elements = {
    loadingOverlay: fakeElement(),
    loadingLabel: fakeElement(),
    loadingBarFill: fakeElement(),
    loadingCounter: fakeElement(),
    chartInput: fakeElement(),
    filesInput: fakeElement(),
  };
  const loaded: string[][] = [];
  const options: DropTargetOptions = {
    elements,
    leaveSelect: vi.fn(async () => true),
    processIncomingFiles: vi.fn(async (files: BrowserDroppedFile[]) => {
      // The overlay is up while the library loads.
      expect(elements.loadingOverlay.classList.contains('visible')).toBe(true);
      loaded.push(files.map((file) => file.name));
    }),
    loadPickedFiles: vi.fn(async () => {}),
    recordLoad: vi.fn(),
    resumeSelect: vi.fn(async () => {}),
    setStatus: vi.fn(),
    refreshCharts: vi.fn(async () => {}),
    folders: { list: vi.fn(async () => ({ text: '', fileCount: 0, charts: [] })), snapshots: undefined },
    ...overrides,
  };
  return { target: new DropTarget(options), options, elements, loaded };
}

const skinDropPrompt = { close: vi.fn() };

beforeEach(() => {
  skinDropPrompt.close.mockClear();
  vi.stubGlobal('document', {
    querySelectorAll: () => [],
    querySelector: (selector: string) => (selector === '#skin-drop' ? skinDropPrompt : null),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DropTarget.handleDrop', () => {
  test("reads a drop's files before it first yields, as the browser empties the drop once its handler returns", async () => {
    const { target, loaded } = harness();
    const drop = fakeDrop([new File(['#TITLE a'], 'a.bms'), new File(['x'], 'a.wav')]);
    const handled = target.handleDrop(drop.transfer);
    drop.expire();
    await handled;
    expect(loaded).toEqual([['a.bms', 'a.wav']]);
  });

  test("reads a folder drop's entries before it first yields", async () => {
    const { target, loaded } = harness();
    const drop = fakeDrop([new File(['#TITLE a'], 'a.bms'), new File(['x'], 'a.wav')], { entries: true });
    const handled = target.handleDrop(drop.transfer);
    drop.expire();
    await handled;
    expect(loaded.map((names) => [...names].sort())).toEqual([['a.bms', 'a.wav']]);
  });

  test('takes the select screen off the stage without waiting for it to go before reading', async () => {
    const leaveSelect = vi.fn(() => new Promise<boolean>(() => {}));
    const { target, loaded } = harness({ leaveSelect });
    const drop = fakeDrop([new File(['#TITLE a'], 'a.bms')]);
    const handled = target.handleDrop(drop.transfer);
    drop.expire();
    await handled;
    expect(leaveSelect).toHaveBeenCalledTimes(1);
    expect(loaded).toEqual([['a.bms']]);
  });

  test('closes the "Drop a skin" prompt, and takes the overlay down and counts the load once it is done', async () => {
    const { target, options, elements } = harness();
    await target.handleDrop(fakeDrop([new File(['#TITLE a'], 'a.bms')]).transfer);
    expect(skinDropPrompt.close).toHaveBeenCalledTimes(1);
    expect(elements.loadingOverlay.classList.contains('visible')).toBe(false);
    expect(options.recordLoad).toHaveBeenCalledTimes(1);
  });

  test('takes the overlay down and counts the load when the load fails', async () => {
    const processIncomingFiles = vi.fn(async () => {
      throw new Error('unreadable');
    });
    const { target, options, elements } = harness({ processIncomingFiles });
    await expect(target.handleDrop(fakeDrop([new File(['x'], 'a.bms')]).transfer)).rejects.toThrow('unreadable');
    expect(elements.loadingOverlay.classList.contains('visible')).toBe(false);
    expect(options.recordLoad).toHaveBeenCalledTimes(1);
  });
});

/** A folder the player granted, by name: the tests list it through `folders.list`, never through the handle. */
function grantedFolder(name: string): RememberedFolder {
  const folder = {
    kind: 'directory',
    name,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    isSameEntry: async (other: unknown) => other === folder,
  };
  return folder as unknown as RememberedFolder;
}

const listingOf = (name: string, charts: Record<string, number>): FolderListing => ({
  text: [`${name}/`, ...Object.keys(charts)].join('\n'),
  fileCount: Object.keys(charts).length,
  charts: Object.entries(charts)
    .filter(([file]) => file.endsWith('.bms'))
    .map(([file, size]) => ({ path: `${name}/${file}`, size, lastModified: 1 })),
});

function memorySnapshots(initial?: FolderSnapshot): FolderSnapshotStore & { kept: FolderSnapshot | undefined } {
  const store = {
    kept: initial,
    read: async () => store.kept,
    write: async (_folder: unknown, snapshot: FolderSnapshot) => {
      store.kept = snapshot;
    },
    prune: vi.fn(async () => {}),
  };
  return store;
}

describe('remembered folders', () => {
  beforeEach(() => {
    remembered.saved = [];
    remembered.dropped = [];
    remembered.picked = undefined;
    remembered.unstorable.clear();
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('window', {});
  });

  /** A harness whose library reports a key for every chart it is handed, as a load does. */
  function folderHarness(
    listings: FolderListing[],
    snapshots = memorySnapshots(),
    load?: (files: BrowserDroppedFile[], origin: LibraryLoadOrigin) => void,
  ) {
    const origins: LibraryLoadOrigin[] = [];
    const list = vi.fn(async () => {
      const next = listings.shift();
      if (next === undefined) throw new Error('gone');
      return next;
    });
    const built = harness({
      folders: { list, snapshots },
      processIncomingFiles: vi.fn(async (files: BrowserDroppedFile[], origin: LibraryLoadOrigin = {}) => {
        origins.push(origin);
        built.loaded.push(files.map((file) => file.webkitRelativePath));
        if (load !== undefined) return load(files, origin);
        for (const file of files) {
          if (file.name.endsWith('.bms')) origin.chartKeys?.learned(file.webkitRelativePath, `key:${file.name}`);
        }
        origin.onLoaded?.();
      }),
    });
    return { ...built, list, snapshots, origins };
  }

  test('walks a remembered folder that has no snapshot, and keeps one once its charts are in', async () => {
    remembered.saved = [grantedFolder('Pack')];
    const { target, loaded, list, snapshots, options } = folderHarness([
      listingOf('Pack', { 'a.bms': 10, 'kick.wav': 3 }),
    ]);
    await target.restoreFolder();
    expect(loaded).toEqual([['Pack/a.bms', 'Pack/kick.wav']]);
    await vi.waitFor(() => expect(snapshots.kept).toBeDefined());
    expect(snapshots.kept).toEqual({
      version: 1,
      text: 'Pack/\na.bms\nkick.wav',
      fileCount: 2,
      charts: [{ path: 'Pack/a.bms', size: 10, lastModified: 1, key: 'key:a.bms' }],
    });
    // A folder just walked is not walked a second time.
    expect(list).toHaveBeenCalledTimes(1);
    expect(options.refreshCharts).not.toHaveBeenCalled();
  });

  test('lists a folder from its snapshot at once, then walks it and leaves an unchanged library alone', async () => {
    remembered.saved = [grantedFolder('Pack')];
    const listing = listingOf('Pack', { 'a.bms': 10 });
    const snapshot: FolderSnapshot = { version: 1, ...listing, charts: [{ ...listing.charts[0]!, key: 'kept' }] };
    const walksBeforeListing: number[] = [];
    const { target, loaded, list, options } = folderHarness([listing], memorySnapshots(snapshot), (_files, origin) => {
      // The charts are listed before the folder is touched, under the keys the snapshot kept.
      walksBeforeListing.push(list.mock.calls.length);
      expect(origin.chartKeys?.known('Pack/a.bms')).toBe('kept');
    });
    await target.restoreFolder();
    expect(walksBeforeListing).toEqual([0]);
    expect(loaded).toEqual([['Pack/a.bms']]);
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(options.refreshCharts).not.toHaveBeenCalled();
  });

  test('has the library read a folder again when it changed since its snapshot', async () => {
    remembered.saved = [grantedFolder('Pack')];
    const before = listingOf('Pack', { 'a.bms': 10 });
    const { target, origins, options, list } = folderHarness(
      [listingOf('Pack', { 'a.bms': 10, 'b.bms': 20 })],
      memorySnapshots({ version: 1, ...before }),
    );
    await target.restoreFolder();
    await vi.waitFor(() => expect(options.refreshCharts).toHaveBeenCalledTimes(1));
    // The library reads the folder from the walk that found the change.
    const files = await origins[0]!.readFiles!();
    expect(files.map((file) => file.webkitRelativePath)).toEqual(['Pack/a.bms', 'Pack/b.bms']);
    expect(list).toHaveBeenCalledTimes(1);
  });

  test('reports a folder that is gone, and has the library drop its charts', async () => {
    remembered.saved = [grantedFolder('Pack')];
    const before = listingOf('Pack', { 'a.bms': 10 });
    const { target, origins, options } = folderHarness([], memorySnapshots({ version: 1, ...before }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await target.restoreFolder();
    await vi.waitFor(() => expect(options.refreshCharts).toHaveBeenCalledTimes(1));
    expect(options.setStatus).toHaveBeenCalled();
    expect(await origins[0]!.readFiles!()).toEqual([]);
    vi.restoreAllMocks();
  });

  test('leaves a folder that needs its permission asked again for the reconnect button', async () => {
    const folder = grantedFolder('Pack');
    (folder as unknown as { queryPermission: () => Promise<string> }).queryPermission = async () => 'prompt';
    remembered.saved = [folder];
    const { target, loaded, list } = folderHarness([]);
    await target.restoreFolder();
    expect(loaded).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  test('restores the other folders when the browser never answers one permission query', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stuck = grantedFolder('Stuck');
    (stuck as unknown as { queryPermission: () => Promise<string> }).queryPermission = () => new Promise(() => {});
    remembered.saved = [stuck, grantedFolder('Pack')];
    const { target, loaded, list } = folderHarness([listingOf('Pack', { 'a.bms': 10 })]);
    try {
      const restored = target.restoreFolder();
      await vi.advanceTimersByTimeAsync(FOLDER_HANDLE_TIMEOUT_MS);
      await restored;
      expect(loaded).toEqual([['Pack/a.bms']]);
      expect(list).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  /** Restores `saved`, with `stuck` leaving every call unanswered, and returns once the start has gone on without it. */
  async function restoreWithStuck(stuck: RememberedFolder, others: RememberedFolder[], listings: FolderListing[] = []) {
    const never = () => new Promise(() => {});
    Object.assign(stuck, { queryPermission: never, requestPermission: never, isSameEntry: never });
    remembered.saved = [stuck, ...others];
    const built = folderHarness(listings);
    const restored = built.target.restoreFolder();
    await vi.advanceTimersByTimeAsync(FOLDER_HANDLE_TIMEOUT_MS);
    await restored;
    return built;
  }

  test('replaces an unanswered folder with the one the player picks again, and loads it', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stuck = grantedFolder('Stuck');
      const { target, loaded } = await restoreWithStuck(stuck, [], [listingOf('Again', { 'a.bms': 10 })]);
      expect(isUnansweredFolder(stuck)).toBe(true);
      const again = grantedFolder('Again');
      remembered.picked = again;
      await target['reconnectFolder'](stuck);
      expect(remembered.saved).toEqual([again]);
      expect(loaded).toEqual([['Again/a.bms']]);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  test('frees the folder buttons when a permission request goes unanswered, and offers to pick the folder again', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const folder = grantedFolder('Pack');
      Object.assign(folder, { queryPermission: async () => 'prompt', requestPermission: () => new Promise(() => {}) });
      remembered.saved = [folder];
      const { target, loaded } = folderHarness([listingOf('Pack', { 'a.bms': 10 })]);
      await target.restoreFolder();
      const reconnect = target['reconnectFolder'](folder);
      await vi.advanceTimersByTimeAsync(FOLDER_PERMISSION_REQUEST_TIMEOUT_MS);
      await reconnect;
      expect(loaded).toEqual([]);
      expect(isUnansweredFolder(folder)).toBe(true);
      // The next press picks the folder again instead of waiting on the same request.
      const again = grantedFolder('Pack');
      remembered.picked = again;
      await target['reconnectFolder'](folder);
      expect(remembered.saved).toEqual([again]);
      expect(loaded).toEqual([['Pack/a.bms']]);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  test('removes a saved folder even when an unanswered one cannot be stored again', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stuck = grantedFolder('Stuck');
      const kept = grantedFolder('Kept');
      const removed = grantedFolder('Removed');
      Object.assign(kept, { queryPermission: async () => 'prompt' });
      Object.assign(removed, { queryPermission: async () => 'prompt' });
      const { target, options } = await restoreWithStuck(stuck, [kept, removed]);
      remembered.unstorable.add(stuck);
      await target['editSavedFolder'](removed, false);
      expect(remembered.saved).toEqual([kept]);
      expect(options.setStatus).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  test("keeps a dropped folder's snapshot from the keys of the charts its drop loaded", async () => {
    const folder = grantedFolder('Pack');
    remembered.dropped = [folder];
    const { target, snapshots } = folderHarness(
      [listingOf('Pack', { 'a.bms': 8, 'a.wav': 1 })],
      memorySnapshots(),
      (_files, origin) => {
        // A drop reads every file: no key is offered, and the keys it works out are kept by the folder's path.
        expect(origin.chartKeys?.known('Pack/a.bms')).toBeUndefined();
        origin.chartKeys?.learned('Pack/a.bms', 'dropped-key');
        origin.chartKeys?.learned('Other/a.bms', 'stray');
      },
    );
    const drop = fakeDrop([new File(['#TITLE a'], 'a.bms'), new File(['x'], 'a.wav')]);
    await target.handleDrop(drop.transfer);
    await vi.waitFor(() => expect(snapshots.kept).toBeDefined());
    expect(remembered.saved).toEqual([folder]);
    expect(snapshots.kept?.charts).toEqual([{ path: 'Pack/a.bms', size: 8, lastModified: 1, key: 'dropped-key' }]);
    expect(snapshots.prune).toHaveBeenCalledWith([folder]);
  });
});
