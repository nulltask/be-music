import { runWithConcurrency } from '@be-music/utils/core';

/**
 * Minimal slice of `FileSystemFileEntry` the deferred handle needs. Kept structural so tests can hand in a stub.
 */
export interface DroppedFileEntryLike {
  readonly name: string;
  file(successCallback: (file: File) => void, errorCallback?: (error: unknown) => void): void;
}

/**
 * A dropped file whose `File` object has not been opened yet. Calling `FileSystemFileEntry.file()` costs a browser
 * round trip per file (tens of microseconds each, serialised), which dominates a multi-thousand-file drop — so the drop
 * walk hands back this handle for song-bundle assets and only opens the entry when somebody actually reads the bytes.
 *
 * It satisfies the same `{ name, webkitRelativePath, arrayBuffer() }` shape the song loader and `loadAssetBytes`
 * already accept for lazy `File` references.
 */
export class DeferredDroppedFile {
  readonly name: string;
  readonly webkitRelativePath: string;
  private readonly entry: DroppedFileEntryLike;
  private pending: Promise<File> | undefined;

  constructor(entry: DroppedFileEntryLike, relativePath: string) {
    this.entry = entry;
    this.name = entry.name;
    this.webkitRelativePath = relativePath;
  }

  /** Opens the underlying entry once and caches the result; a failed open is retried on the next call. */
  getFile(): Promise<File> {
    this.pending ??= new Promise<File>((resolve, reject) => {
      this.entry.file(resolve, reject);
    }).catch((error: unknown) => {
      this.pending = undefined;
      throw error;
    });
    return this.pending;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return (await this.getFile()).arrayBuffer();
  }

  async text(): Promise<string> {
    return (await this.getFile()).text();
  }
}

/** A file handed back by the drop walk: either an opened `File` or a handle that opens on first read. */
export type BrowserDroppedFile = File | DeferredDroppedFile;

/**
 * Opens every deferred handle in `files` (bounded concurrency) and returns plain `File`s in the same order. Handles that
 * fail to open are dropped from the result and reported through `onError`. Use it before passing dropped files to an
 * API that needs real `File`s, such as the theme loaders.
 */
export async function materializeDroppedFiles(
  files: readonly BrowserDroppedFile[],
  options: { concurrency?: number; onError?: (file: DeferredDroppedFile, error: unknown) => void } = {},
): Promise<File[]> {
  const opened: Array<File | undefined> = Array.from({ length: files.length });
  const indices = files.map((_, index) => index);
  await runWithConcurrency(indices, options.concurrency ?? 16, async (index) => {
    const file = files[index]!;
    if (!(file instanceof DeferredDroppedFile)) {
      opened[index] = file;
      return;
    }
    try {
      opened[index] = withRelativePath(await file.getFile(), file.webkitRelativePath);
    } catch (error) {
      options.onError?.(file, error);
    }
  });
  return opened.filter((file): file is File => file !== undefined);
}

/**
 * Pins `webkitRelativePath` on a `File` opened from a `FileSystemEntry` walk. The browser leaves that property empty
 * for entry-sourced files, but every loader keys the dropped tree by it.
 */
export function withRelativePath(file: File, relativePath: string): File {
  if (file.webkitRelativePath === relativePath) {
    return file;
  }
  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      enumerable: true,
      value: relativePath,
      writable: false,
    });
    return file;
  } catch {
    return new Proxy(file, {
      get(target, property) {
        if (property === 'webkitRelativePath') {
          return relativePath;
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
}
