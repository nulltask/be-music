// What a remembered folder holds, read without opening its files: every file's path, and the size and modification
// time of each chart file, which tell a chart parsed on an earlier visit from one that changed since. The walk runs in a
// worker (`folder-listing-worker.ts`) where there is one, so a library of a hundred thousand files does not hold up the
// page; a listed file opens through the folder's handle when it is first read.

import { DeferredDroppedFile, isChartFilePath, type BrowserDroppedFile } from '@be-music/player-browser/collection';

/** What the walk reads of a file handle (`FileSystemFileHandle`). */
export interface FolderFileLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
}

/** What the walk reads of a directory handle (`FileSystemDirectoryHandle`). */
export interface FolderDirectoryLike {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterable<FolderFileLike | FolderDirectoryLike>;
  getDirectoryHandle(name: string): Promise<FolderDirectoryLike>;
  getFileHandle(name: string): Promise<FolderFileLike>;
}

/** A chart file as the walk found it; a file changed on disk shows another size or modification time. */
export interface FolderChartStat {
  /** The file's path, as the song collection keys it: the folder's name, then the path under it. */
  readonly path: string;
  readonly size: number;
  readonly lastModified: number;
}

export interface FolderListing {
  /**
   * Every file under the folder, in a fixed order: for each directory that holds files, a line with its path and a
   * trailing `/` (the folder's name first), then one line per file name. Two walks of an unchanged folder give the same
   * text.
   */
  readonly text: string;
  readonly fileCount: number;
  /** The chart files, ordered by path. A chart file that could not be opened has no entry. */
  readonly charts: readonly FolderChartStat[];
}

/** Directories read at once: enough to keep the disk busy without piling up pending handles. */
const WALK_CONCURRENCY = 16;

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Lists the files under `root` ({@link FolderListing}). `onProgress` receives the number of files found so far, at
 * most once per 256 files. A directory that cannot be read rejects the walk.
 */
export async function listFolder(
  root: FolderDirectoryLike,
  onProgress?: (fileCount: number) => void,
  signal?: AbortSignal,
): Promise<FolderListing> {
  signal?.throwIfAborted();
  const directories: Array<{ path: string; names: string[] }> = [];
  const charts: FolderChartStat[] = [];
  let fileCount = 0;
  let reported = 0;
  const readDirectory = async (
    directory: FolderDirectoryLike,
    path: string,
    queue: (directory: FolderDirectoryLike, path: string) => void,
  ): Promise<void> => {
    const names: string[] = [];
    const chartFiles: FolderFileLike[] = [];
    signal?.throwIfAborted();
    for await (const handle of directory.values()) {
      signal?.throwIfAborted();
      // A listing is one name per line.
      if (handle.name.includes('\n')) continue;
      if (handle.kind === 'directory') {
        queue(handle, `${path}/${handle.name}`);
        continue;
      }
      names.push(handle.name);
      if (isChartFilePath(handle.name)) chartFiles.push(handle);
    }
    if (names.length === 0) return;
    directories.push({ path, names: names.sort(compareText) });
    fileCount += names.length;
    if (onProgress !== undefined && fileCount - reported >= 256) {
      reported = fileCount;
      onProgress(fileCount);
    }
    await Promise.all(
      chartFiles.map(async (handle) => {
        try {
          signal?.throwIfAborted();
          const file = await handle.getFile();
          charts.push({ path: `${path}/${handle.name}`, size: file.size, lastModified: file.lastModified });
        } catch {
          // Left without an entry: the load reads the file, and reports it if it still cannot.
        }
      }),
    );
  };
  await new Promise<void>((resolve, reject) => {
    const pending: Array<[FolderDirectoryLike, string]> = [[root, root.name]];
    let active = 0;
    let failed = false;
    const queue = (directory: FolderDirectoryLike, path: string): void => {
      pending.push([directory, path]);
      pump();
    };
    const pump = (): void => {
      while (!failed && active < WALK_CONCURRENCY && pending.length > 0) {
        const [directory, path] = pending.pop()!;
        active += 1;
        readDirectory(directory, path, queue).then(
          () => {
            active -= 1;
            if (pending.length === 0 && active === 0) resolve();
            else pump();
          },
          (error: unknown) => {
            failed = true;
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      }
    };
    pump();
  });
  signal?.throwIfAborted();
  directories.sort((left, right) => compareText(left.path, right.path));
  charts.sort((left, right) => compareText(left.path, right.path));
  const lines: string[] = [];
  for (const { path, names } of directories) {
    lines.push(`${path}/`);
    for (const name of names) lines.push(name);
  }
  return { text: lines.join('\n'), fileCount, charts };
}

/** Whether two listings name the same files, with every chart file as large and as old in both. */
export function sameFolderListing(left: FolderListing, right: FolderListing): boolean {
  if (left.text !== right.text || left.charts.length !== right.charts.length) return false;
  return left.charts.every((chart, index) => {
    const other = right.charts[index]!;
    return chart.path === other.path && chart.size === other.size && chart.lastModified === other.lastModified;
  });
}

/** A listed file, opened through the folder on first read: its directory's handle, its own handle, then the file. */
class ListedFolderFile {
  public readonly name: string;
  private readonly directories: FolderDirectoryCache;
  private readonly directory: string;

  public constructor(directories: FolderDirectoryCache, directory: string, name: string) {
    this.directories = directories;
    this.directory = directory;
    this.name = name;
  }

  public file(resolve: (file: File) => void, reject: (error: unknown) => void): void {
    this.directories
      .open(this.directory)
      .then((directory) => directory.getFileHandle(this.name))
      .then((handle) => handle.getFile())
      .then(resolve, reject);
  }
}

/** The handles of a folder's directories, by path, each looked up once. */
class FolderDirectoryCache {
  private readonly opened = new Map<string, Promise<FolderDirectoryLike>>();
  private readonly root: FolderDirectoryLike;

  public constructor(root: FolderDirectoryLike) {
    this.root = root;
  }

  /** The directory at `path`, which starts with the folder's own name (as a listing writes it). */
  public open(path: string): Promise<FolderDirectoryLike> {
    let opened = this.opened.get(path);
    if (opened === undefined) {
      const slash = path.lastIndexOf('/');
      opened =
        slash < 0
          ? Promise.resolve(this.root)
          : this.open(path.slice(0, slash)).then((parent) => parent.getDirectoryHandle(path.slice(slash + 1)));
      this.opened.set(path, opened);
      // A directory that could not be opened is looked up again by the next read.
      opened.catch(() => this.opened.delete(path));
    }
    return opened;
  }
}

/**
 * The files a listing names, as the drop loaders take them: each keeps its path (`webkitRelativePath`, the folder's
 * name first) and opens through `root` when it is first read, so listing a folder opens none of its files.
 */
export function openFolderListing(root: FolderDirectoryLike, text: string): BrowserDroppedFile[] {
  const directories = new FolderDirectoryCache(root);
  const files: BrowserDroppedFile[] = [];
  if (text.length === 0) return files;
  let directory = root.name;
  for (const line of text.split('\n')) {
    if (line.endsWith('/')) {
      directory = line.slice(0, -1);
      continue;
    }
    files.push(new DeferredDroppedFile(new ListedFolderFile(directories, directory, line), `${directory}/${line}`));
  }
  return files;
}

/** What `folder-listing-worker.ts` posts back: its progress, then the listing or the error that ended the walk. */
export type FolderListingWorkerMessage =
  | { readonly fileCount: number }
  | { readonly listing: FolderListing }
  | { readonly error: { readonly name: string; readonly message: string } };

/** The worker's side of {@link listFolderInWorker}: walks the folder it is posted and posts back what it finds. */
export function serveFolderListing(scope: {
  onmessage: ((event: MessageEvent<{ folder: FolderDirectoryLike }>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: FolderListingWorkerMessage): void;
}): void {
  scope.onmessageerror = () => {
    scope.postMessage({ error: { name: 'DataCloneError', message: 'Could not receive the folder handle' } });
  };
  scope.onmessage = (event) => {
    listFolder(event.data.folder, (fileCount) => scope.postMessage({ fileCount })).then(
      (listing) => scope.postMessage({ listing }),
      (error: unknown) =>
        scope.postMessage({
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { name: 'Error', message: String(error) },
        }),
    );
  };
}

/**
 * {@link listFolder} in a worker of its own, so the walk shares no thread with the page. Where the worker cannot be
 * started (or dies before answering) the folder is walked here instead; a walk that fails rejects with the worker's
 * error, under its name (`NotFoundError` for a folder that is gone).
 */
export function listFolderInWorker(
  createWorker: () => Worker,
  folder: FolderDirectoryLike,
  onProgress?: (fileCount: number) => void,
  signal?: AbortSignal,
): Promise<FolderListing> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  let worker: Worker;
  try {
    worker = createWorker();
  } catch {
    return listFolder(folder, onProgress, signal);
  }
  return new Promise<FolderListing>((resolve, reject) => {
    let finished = false;
    const stop = () => {
      finished = true;
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      stop();
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const listOnPage = () => {
      if (finished) return;
      stop();
      resolve(listFolder(folder, onProgress, signal));
    };
    worker.onmessage = (event: MessageEvent<FolderListingWorkerMessage>) => {
      if (finished) return;
      const message = event.data;
      if ('fileCount' in message) {
        onProgress?.(message.fileCount);
        return;
      }
      if ('listing' in message) {
        stop();
        resolve(message.listing);
        return;
      }
      const { name, message: detail } = message.error;
      // Access can be granted in the page even if the worker cannot receive or use the directory handle.
      if (name === 'DataCloneError' || name === 'NotAllowedError' || name === 'SecurityError') {
        listOnPage();
        return;
      }
      stop();
      const error = new Error(detail);
      error.name = name;
      reject(error);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      listOnPage();
    };
    worker.onmessageerror = listOnPage;
    try {
      worker.postMessage({ folder });
    } catch {
      listOnPage();
    }
  });
}
