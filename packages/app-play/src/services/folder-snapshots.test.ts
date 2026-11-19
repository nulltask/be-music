import { describe, expect, test, vi } from 'vite-plus/test';
import type { FolderListing } from './folder-listing.ts';
import {
  createIndexedDBFolderSnapshotStore,
  RememberedFolderSession,
  type FolderSnapshot,
  type FolderSnapshotStore,
  type SnapshotFolder,
} from './folder-snapshots.ts';

const folder = { kind: 'directory', name: 'Pack' } as unknown as SnapshotFolder;

const listingOf = (charts: Record<string, [size: number, lastModified: number]>, extra = ''): FolderListing => ({
  text: ['Pack/', ...Object.keys(charts).map((path) => path.slice('Pack/'.length)), ...(extra ? [extra] : [])].join(
    '\n',
  ),
  fileCount: Object.keys(charts).length + (extra ? 1 : 0),
  charts: Object.entries(charts).map(([path, [size, lastModified]]) => ({ path, size, lastModified })),
});

function memoryStore(
  initial?: FolderSnapshot,
): FolderSnapshotStore & { kept: FolderSnapshot | undefined; writes: number } {
  const store = {
    kept: initial,
    writes: 0,
    read: async () => store.kept,
    write: async (_folder: SnapshotFolder, snapshot: FolderSnapshot) => {
      store.kept = snapshot;
      store.writes += 1;
    },
    prune: async () => {},
  };
  return store;
}

function session(listings: FolderListing[], snapshots: FolderSnapshotStore | undefined = memoryStore()) {
  const list = vi.fn(async () => {
    const next = listings.shift();
    if (next === undefined) throw new DOMException('gone', 'NotFoundError');
    return next;
  });
  return { session: new RememberedFolderSession(folder, { list, snapshots }), list, snapshots };
}

const paths = (files: readonly { webkitRelativePath: string }[]): string[] =>
  files.map((file) => file.webkitRelativePath);

describe('RememberedFolderSession', () => {
  test('walks a folder without a snapshot and keeps one with the keys the load worked out', async () => {
    const store = memoryStore();
    const { session: loaded, list } = session([listingOf({ 'Pack/a.bms': [10, 1], 'Pack/b.bms': [20, 2] })], store);
    expect(await loaded.restore()).toBeUndefined();
    const progress = vi.fn();
    expect(paths(await loaded.read(progress))).toEqual(['Pack/a.bms', 'Pack/b.bms']);
    expect(list).toHaveBeenCalledWith(folder, progress, undefined);
    expect(loaded.known('Pack/a.bms')).toBeUndefined();
    loaded.learned('Pack/a.bms', 'key-a');
    await loaded.save();
    expect(store.kept).toEqual({
      version: 1,
      text: 'Pack/\na.bms\nb.bms',
      fileCount: 2,
      charts: [
        { path: 'Pack/a.bms', size: 10, lastModified: 1, key: 'key-a' },
        { path: 'Pack/b.bms', size: 20, lastModified: 2 },
      ],
    });
    // Nothing changed since: nothing is written again.
    await loaded.save();
    expect(store.writes).toBe(1);
  });

  test('lists a folder from its snapshot without walking it, offering the keys it kept', async () => {
    const store = memoryStore({
      version: 1,
      text: 'Pack/\na.bms\nkick.wav',
      fileCount: 2,
      charts: [{ path: 'Pack/a.bms', size: 10, lastModified: 1, key: 'key-a' }],
    });
    const { session: loaded, list } = session([], store);
    expect(paths((await loaded.restore())!)).toEqual(['Pack/a.bms', 'Pack/kick.wav']);
    expect(loaded.known('Pack/a.bms')).toBe('key-a');
    expect(list).not.toHaveBeenCalled();
    // The snapshot is what was loaded: it is not written again, and the same key learned again changes nothing.
    loaded.learned('Pack/a.bms', 'key-a');
    await loaded.save();
    expect(store.writes).toBe(0);
  });

  test('walks the folder when its snapshot cannot be read', async () => {
    const store = { ...memoryStore(), read: () => Promise.reject(new Error('blocked')) };
    const { session: loaded } = session([], store);
    expect(await loaded.restore()).toBeUndefined();
  });

  test('finds an unchanged folder unchanged', async () => {
    const listing = listingOf({ 'Pack/a.bms': [10, 1] });
    const { session: loaded, list } = session([listing, listingOf({ 'Pack/a.bms': [10, 1] })]);
    await loaded.read();
    expect(await loaded.verify()).toBe(false);
    expect(list).toHaveBeenCalledTimes(2);
  });

  test('reads a changed folder again from the walk that found the change, keeping only the keys of unchanged charts', async () => {
    const store = memoryStore();
    const { session: loaded, list } = session(
      [
        listingOf({ 'Pack/a.bms': [10, 1], 'Pack/b.bms': [20, 2], 'Pack/c.bms': [30, 3] }),
        // `b` was edited, `c` removed and `d` added.
        listingOf({ 'Pack/a.bms': [10, 1], 'Pack/b.bms': [21, 9], 'Pack/d.bms': [40, 4] }),
      ],
      store,
    );
    await loaded.read();
    for (const name of ['a', 'b', 'c']) loaded.learned(`Pack/${name}.bms`, `key-${name}`);
    await loaded.save();
    expect(await loaded.verify()).toBe(true);
    // Until the library reads the folder again, the keys are those of the listing it was loaded from.
    expect(loaded.known('Pack/b.bms')).toBe('key-b');
    expect(paths(await loaded.read())).toEqual(['Pack/a.bms', 'Pack/b.bms', 'Pack/d.bms']);
    expect(list).toHaveBeenCalledTimes(2);
    expect(loaded.known('Pack/a.bms')).toBe('key-a');
    expect(loaded.known('Pack/b.bms')).toBeUndefined();
    expect(loaded.known('Pack/c.bms')).toBeUndefined();
    loaded.learned('Pack/b.bms', 'key-b2');
    loaded.learned('Pack/d.bms', 'key-d');
    await loaded.save();
    expect(store.kept?.charts).toEqual([
      { path: 'Pack/a.bms', size: 10, lastModified: 1, key: 'key-a' },
      { path: 'Pack/b.bms', size: 21, lastModified: 9, key: 'key-b2' },
      { path: 'Pack/d.bms', size: 40, lastModified: 4, key: 'key-d' },
    ]);
  });

  test('a folder that can no longer be walked reads as empty once, and keeps its snapshot', async () => {
    const store = memoryStore();
    const { session: loaded } = session([listingOf({ 'Pack/a.bms': [10, 1] })], store);
    await loaded.read();
    loaded.learned('Pack/a.bms', 'key-a');
    await loaded.save();
    await expect(loaded.verify()).rejects.toThrow('gone');
    expect(await loaded.read()).toEqual([]);
    await loaded.save();
    expect(store.writes).toBe(1);
    expect(store.kept?.charts).toHaveLength(1);
  });

  test('keeps a snapshot of a folder whose charts a drop loaded, with the keys that load worked out', async () => {
    const store = memoryStore();
    const { session: dropped } = session([listingOf({ 'Pack/a.bms': [10, 1] }, 'kick.wav')], store);
    dropped.learned('Pack/a.bms', 'key-a');
    dropped.learned('Pack/gone.bms', 'key-gone');
    await dropped.capture();
    expect(store.kept).toEqual({
      version: 1,
      text: 'Pack/\na.bms\nkick.wav',
      fileCount: 2,
      charts: [{ path: 'Pack/a.bms', size: 10, lastModified: 1, key: 'key-a' }],
    });
  });

  test('walks the folder on every visit without a store', async () => {
    const { session: loaded } = session([listingOf({ 'Pack/a.bms': [10, 1] })], undefined);
    expect(await loaded.restore()).toBeUndefined();
    expect(paths(await loaded.read())).toEqual(['Pack/a.bms']);
    await expect(loaded.save()).resolves.toBeUndefined();
  });
});

describe('createIndexedDBFolderSnapshotStore', () => {
  test('keeps nothing without IndexedDB', () => {
    expect(createIndexedDBFolderSnapshotStore(undefined)).toBeUndefined();
  });

  test('fails its reads and writes when the database cannot be opened, and opens it again the next time', async () => {
    const open = vi.fn(() => {
      throw new Error('blocked by the browser');
    });
    const store = createIndexedDBFolderSnapshotStore({ open } as unknown as IDBFactory)!;
    await expect(store.read(folder)).rejects.toThrow('blocked');
    await expect(store.prune([])).rejects.toThrow('blocked');
    expect(open).toHaveBeenCalledTimes(2);
  });
});
