import { DeferredDroppedFile, type BrowserDroppedFile, type LoadProgress } from '@be-music/player-browser/collection';

interface LocalDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
}

export type RememberedFolder = LocalDirectoryHandle;

export function pickRememberedFolder(): Promise<RememberedFolder> | undefined {
  return (
    window as Window & {
      showDirectoryPicker?: (options: { mode: 'read' }) => Promise<RememberedFolder>;
    }
  ).showDirectoryPicker?.({ mode: 'read' });
}

/** Start capturing handles before the drop event's data store closes. */
export async function captureDroppedFolders(transfer: DataTransfer): Promise<RememberedFolder[]> {
  const handles = await Promise.all(
    Array.from(transfer.items ?? [], async (item) => {
      if (item.kind !== 'file') return;
      try {
        return await (
          item as DataTransferItem & {
            getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
          }
        ).getAsFileSystemHandle?.();
      } catch {
        return undefined;
      }
    }),
  );
  return handles.filter((handle): handle is RememberedFolder => handle?.kind === 'directory');
}

/** The folders {@link readRememberedFolders} listed, and the files they hold. */
export interface RememberedFolderFiles {
  readonly files: BrowserDroppedFile[];
  /** The folders listed in full; a folder that could not be read is left out, with its files. */
  readonly read: RememberedFolder[];
}

/**
 * Lists the files of every folder in one walk, as a drop of the same folders is listed: the count runs on over all the
 * folders, and the total is reported once every folder is listed, so the charts are then parsed in one pass. Each
 * folder's files sit under its name (see {@link rememberedFolderPrefixes}); a folder that cannot be read is passed to
 * `onError` and skipped, and the others are still listed.
 */
export async function readRememberedFolders(
  folders: readonly RememberedFolder[],
  options: {
    readonly onProgress?: (progress: LoadProgress) => void;
    readonly onError?: (folder: RememberedFolder, error: unknown) => void;
  } = {},
): Promise<RememberedFolderFiles> {
  const { onProgress } = options;
  const files: BrowserDroppedFile[] = [];
  const read: RememberedFolder[] = [];
  onProgress?.({ phase: 'enumerating', current: 0, total: -1 });
  const prefixes = rememberedFolderPrefixes(folders.map((folder) => folder.name));
  for (const [index, folder] of folders.entries()) {
    const listed: BrowserDroppedFile[] = [];
    async function walk(directory: RememberedFolder, prefix: string): Promise<void> {
      for await (const handle of directory.values()) {
        const path = `${prefix}/${handle.name}`;
        if (handle.kind === 'directory') {
          await walk(handle as RememberedFolder, path);
        } else {
          const file = handle as FileSystemFileHandle;
          listed.push(
            new DeferredDroppedFile(
              {
                name: file.name,
                file: (resolve, reject) => {
                  void file.getFile().then(resolve, reject);
                },
              },
              path,
            ),
          );
          const count = files.length + listed.length;
          if ((count & 0x1f) === 1) {
            onProgress?.({ phase: 'enumerating', current: count, total: -1, label: path });
          }
        }
      }
    }
    try {
      await walk(folder, prefixes[index]!);
    } catch (error) {
      options.onError?.(folder, error);
      continue;
    }
    files.push(...listed);
    read.push(folder);
  }
  onProgress?.({ phase: 'enumerating', current: files.length, total: files.length });
  return { files, read };
}

/**
 * The top folder each remembered folder's files are listed under: its own name, and for a later folder with the same
 * name as an earlier one (two `BMS` folders on different drives) the name numbered as `BMS (2)`, so the folders'
 * files never take each other's paths.
 */
export function rememberedFolderPrefixes(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    let prefix = name;
    for (let count = 2; taken.has(prefix); count += 1) prefix = `${name} (${count})`;
    taken.add(prefix);
    return prefix;
  });
}

export async function storedFolders(folders?: readonly RememberedFolder[]): Promise<RememberedFolder[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('be-music-folders', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('folders');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('folders', folders ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('folders');
      const request = folders ? store.put(folders, 'last') : store.get('last');
      transaction.oncomplete = () => {
        // The folder picker originally stored a single handle under this key.
        const saved = folders ?? request.result;
        resolve(Array.isArray(saved) ? [...saved] : saved ? [saved] : []);
      };
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
