// A remembered folder as it was last loaded, kept across page loads in IndexedDB (`be-music-folder-snapshots`): its
// file listing and the parsed-chart cache key of each chart file. The next visit lists the folder's charts from the
// snapshot at once, without walking the folder or reading a chart file, and then walks the folder in the background to
// see whether it changed (`RememberedFolderSession`).

import type { BrowserDroppedFile, ChartCacheKeyBook } from '@be-music/player-browser/collection';
import {
  openFolderListing,
  sameFolderListing,
  type FolderChartStat,
  type FolderDirectoryLike,
  type FolderListing,
} from './folder-listing.ts';

/** A chart file of a snapshot: how the walk found it, and its parsed-chart cache key when the load worked one out. */
export interface FolderSnapshotChart extends FolderChartStat {
  readonly key?: string;
}

/** A folder's listing ({@link FolderListing}) and its charts' cache keys, as of the last load. */
export interface FolderSnapshot {
  readonly version: 1;
  readonly text: string;
  readonly fileCount: number;
  readonly charts: readonly FolderSnapshotChart[];
}

/** A folder a snapshot is kept for: a directory handle, compared with `isSameEntry`. */
export interface SnapshotFolder extends FolderDirectoryLike {
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
}

/** Where snapshots are kept, one per folder. Reads and writes may fail; the folder is then walked as if it had none. */
export interface FolderSnapshotStore {
  read(folder: SnapshotFolder): Promise<FolderSnapshot | undefined>;
  write(folder: SnapshotFolder, snapshot: FolderSnapshot): Promise<void>;
  /** Forgets the snapshots of every folder not among `folders`. */
  prune(folders: readonly SnapshotFolder[]): Promise<void>;
}

/** The snapshots' database. */
export const FOLDER_SNAPSHOT_DB_NAME = 'be-music-folder-snapshots';
/** Each folder's handle, by the id its snapshot is kept under. */
const FOLDERS_STORE = 'folders';
/** Each folder's {@link FolderSnapshot}, by that id. Kept apart so that finding a folder reads no listing. */
const SNAPSHOTS_STORE = 'snapshots';

function request<T>(target: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    target.onsuccess = () => resolve(target.result);
    target.onerror = () => reject(target.error ?? new Error('indexedDB request failed'));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('indexedDB write aborted'));
  });
}

function isFolderSnapshot(value: unknown): value is FolderSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<FolderSnapshot>;
  return snapshot.version === 1 && typeof snapshot.text === 'string' && Array.isArray(snapshot.charts);
}

/**
 * The snapshot store in IndexedDB, or `undefined` where there is none. The database opens on first use and stays open
 * for the page.
 */
export function createIndexedDBFolderSnapshotStore(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): FolderSnapshotStore | undefined {
  if (factory === undefined) return undefined;
  let opened: Promise<IDBDatabase> | undefined;
  const database = (): Promise<IDBDatabase> =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(FOLDER_SNAPSHOT_DB_NAME, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore(FOLDERS_STORE, { autoIncrement: true });
        open.result.createObjectStore(SNAPSHOTS_STORE);
      };
      open.onsuccess = () => {
        open.result.onversionchange = () => open.result.close();
        resolve(open.result);
      };
      open.onerror = () => reject(open.error ?? new Error('indexedDB open failed'));
      open.onblocked = () => reject(new Error('indexedDB open blocked'));
    }).catch((error: unknown) => {
      opened = undefined;
      throw error;
    }));
  /** Every kept folder with its id. */
  const keptFolders = async (db: IDBDatabase): Promise<Array<{ id: IDBValidKey; folder: SnapshotFolder }>> => {
    const store = db.transaction(FOLDERS_STORE, 'readonly').objectStore(FOLDERS_STORE);
    const [ids, folders] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
    return ids.map((id, index) => ({ id, folder: folders[index] as SnapshotFolder }));
  };
  const idOf = async (db: IDBDatabase, folder: SnapshotFolder): Promise<IDBValidKey | undefined> => {
    for (const kept of await keptFolders(db)) {
      if (await kept.folder.isSameEntry(folder as unknown as FileSystemHandle)) return kept.id;
    }
    return undefined;
  };
  return {
    async read(folder) {
      const db = await database();
      const id = await idOf(db, folder);
      if (id === undefined) return undefined;
      const value: unknown = await request(
        db.transaction(SNAPSHOTS_STORE, 'readonly').objectStore(SNAPSHOTS_STORE).get(id),
      );
      return isFolderSnapshot(value) ? value : undefined;
    },
    async write(folder, snapshot) {
      const db = await database();
      const existing = await idOf(db, folder);
      const transaction = db.transaction([FOLDERS_STORE, SNAPSHOTS_STORE], 'readwrite');
      const id = existing ?? (await request(transaction.objectStore(FOLDERS_STORE).add(folder)));
      transaction.objectStore(SNAPSHOTS_STORE).put(snapshot, id);
      await complete(transaction);
    },
    async prune(folders) {
      const db = await database();
      const stale: IDBValidKey[] = [];
      for (const kept of await keptFolders(db)) {
        let saved = false;
        for (const folder of folders) {
          if (await kept.folder.isSameEntry(folder as unknown as FileSystemHandle)) {
            saved = true;
            break;
          }
        }
        if (!saved) stale.push(kept.id);
      }
      if (stale.length === 0) return;
      const transaction = db.transaction([FOLDERS_STORE, SNAPSHOTS_STORE], 'readwrite');
      for (const id of stale) {
        transaction.objectStore(FOLDERS_STORE).delete(id);
        transaction.objectStore(SNAPSHOTS_STORE).delete(id);
      }
      await complete(transaction);
    },
  };
}

export interface RememberedFolderSessionDeps {
  /** Walks a folder (`listFolder`, or `listFolderInWorker`). */
  readonly list: (folder: FolderDirectoryLike, onProgress?: (fileCount: number) => void) => Promise<FolderListing>;
  /** Where the folder's snapshot is kept; without one every visit walks the folder. */
  readonly snapshots: FolderSnapshotStore | undefined;
}

/**
 * One remembered folder for as long as the page is open: the listing its charts were last loaded from, and the cache
 * key of each of its chart files (the {@link ChartCacheKeyBook} the song collection loads the folder with).
 *
 * A key is offered again only while its file is as large and as old as when the key was worked out, so a chart edited
 * on disk is read again. The first load of a visit takes the folder from its snapshot ({@link restore}), which may be
 * out of date: {@link verify} then walks the folder, and when it changed the library reads it again ({@link read}).
 */
export class RememberedFolderSession implements ChartCacheKeyBook {
  /** The listing the library was last loaded from. */
  private listing: FolderListing | undefined;
  /** The cache keys of the chart files of {@link listing}, by path. */
  private keys = new Map<string, string>();
  /** A walk that found the folder changed, which the next {@link read} takes instead of walking again. */
  private walked: FolderListing | undefined;
  /** The folder could not be walked: the next {@link read} lists nothing. */
  private unreadable = false;
  /** The listing or a key differs from the kept snapshot. */
  private unsaved = false;
  public readonly folder: SnapshotFolder;
  private readonly deps: RememberedFolderSessionDeps;

  public constructor(folder: SnapshotFolder, deps: RememberedFolderSessionDeps) {
    this.folder = folder;
    this.deps = deps;
  }

  public known(path: string): string | undefined {
    return this.keys.get(path);
  }

  public learned(path: string, key: string): void {
    if (this.keys.get(path) === key) return;
    this.keys.set(path, key);
    this.unsaved = true;
  }

  /** The folder's files as its snapshot lists them, without touching the folder; `undefined` without a snapshot. */
  public async restore(): Promise<BrowserDroppedFile[] | undefined> {
    let snapshot: FolderSnapshot | undefined;
    try {
      snapshot = await this.deps.snapshots?.read(this.folder);
    } catch {
      snapshot = undefined;
    }
    if (snapshot === undefined) return undefined;
    this.listing = { text: snapshot.text, fileCount: snapshot.fileCount, charts: snapshot.charts };
    this.keys = new Map();
    for (const chart of snapshot.charts) {
      if (chart.key !== undefined) this.keys.set(chart.path, chart.key);
    }
    this.unsaved = false;
    return openFolderListing(this.folder, snapshot.text);
  }

  /** The folder's files as they are now: the walk {@link verify} made, or a new one. */
  public async read(onProgress?: (fileCount: number) => void): Promise<BrowserDroppedFile[]> {
    if (this.unreadable) {
      this.unreadable = false;
      return [];
    }
    const listing = this.walked ?? (await this.deps.list(this.folder, onProgress));
    this.walked = undefined;
    const previous = new Map(this.listing?.charts.map((chart) => [chart.path, chart]));
    const keys = new Map<string, string>();
    for (const chart of listing.charts) {
      const before = previous.get(chart.path);
      const key = this.keys.get(chart.path);
      if (
        key !== undefined &&
        before !== undefined &&
        before.size === chart.size &&
        before.lastModified === chart.lastModified
      ) {
        keys.set(chart.path, key);
      }
    }
    if (this.listing === undefined || !sameFolderListing(this.listing, listing)) this.unsaved = true;
    this.listing = listing;
    this.keys = keys;
    return openFolderListing(this.folder, listing.text);
  }

  /**
   * Walks the folder and tells whether it differs from what the library was loaded from; the library then reads it
   * again ({@link read}). A folder that cannot be walked rejects, and reads as empty from then on.
   */
  public async verify(): Promise<boolean> {
    let listing: FolderListing;
    try {
      listing = await this.deps.list(this.folder);
    } catch (error) {
      this.unreadable = true;
      throw error;
    }
    if (this.listing !== undefined && sameFolderListing(this.listing, listing)) return false;
    this.walked = listing;
    return true;
  }

  /**
   * Lists the folder once its charts were loaded another way (a drop's entries, which name the same paths) and keeps
   * its snapshot: the keys that load {@link learned} stay with the chart files the walk finds.
   */
  public async capture(): Promise<void> {
    const listing = await this.deps.list(this.folder);
    const keys = new Map<string, string>();
    for (const chart of listing.charts) {
      const key = this.keys.get(chart.path);
      if (key !== undefined) keys.set(chart.path, key);
    }
    this.listing = listing;
    this.keys = keys;
    this.unsaved = true;
    await this.save();
  }

  /** Keeps the folder's snapshot, once the library has loaded it, when anything changed since it was last kept. */
  public async save(): Promise<void> {
    if (!this.unsaved || this.listing === undefined || this.deps.snapshots === undefined) return;
    this.unsaved = false;
    const { text, fileCount, charts } = this.listing;
    await this.deps.snapshots.write(this.folder, {
      version: 1,
      text,
      fileCount,
      charts: charts.map((chart) => {
        const key = this.keys.get(chart.path);
        return key === undefined ? { ...chart } : { ...chart, key };
      }),
    });
  }
}
