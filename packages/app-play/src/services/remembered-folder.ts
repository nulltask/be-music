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
