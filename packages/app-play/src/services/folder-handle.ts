// Calls on a remembered folder's handle that the page waits on. Chrome can leave `queryPermission` (and so, on the same
// handle, `isSameEntry`) unanswered for a saved folder: the start-up restore then never finished, so the select screen,
// the Bemuse servers, the difficulty tables and every later drop waited on it for good. Each call here gives up after a
// while and answers as for a folder that cannot be used now, which leaves it for the reconnect button.

/** How long a handle call may take before the page goes on without its answer. */
export const FOLDER_HANDLE_TIMEOUT_MS = 3000;

/** `work`'s value, or `fallback` when it fails or has not settled within `timeoutMs`. */
export function settleWithin<T>(work: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** What {@link folderReadPermission} asks of a handle. */
export interface PermissionQueryable {
  readonly name: string;
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
}

/**
 * Whether the page may read `folder` now. A query that fails or does not answer in time reads as `prompt`: the folder
 * waits for the player to reconnect it, as one whose permission lapsed does.
 */
export async function folderReadPermission(
  folder: PermissionQueryable,
  timeoutMs = FOLDER_HANDLE_TIMEOUT_MS,
): Promise<PermissionState> {
  let query: Promise<PermissionState>;
  try {
    query = folder.queryPermission({ mode: 'read' });
  } catch {
    return 'prompt';
  }
  const state = await settleWithin<PermissionState | 'timeout'>(
    query.catch(() => 'prompt' as const),
    timeoutMs,
    'timeout',
  );
  if (state !== 'timeout') return state;
  console.warn(`The read permission of the saved folder "${folder.name}" did not answer; it waits for a reconnect.`);
  return 'prompt';
}

/** What {@link isSameFolder} asks of a handle. */
export interface EntryComparable {
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
}

/** Whether `folder` and `other` are the same folder; a comparison that fails or does not answer in time is not. */
export function isSameFolder(
  folder: EntryComparable,
  other: unknown,
  timeoutMs = FOLDER_HANDLE_TIMEOUT_MS,
): Promise<boolean> {
  let compared: Promise<boolean>;
  try {
    compared = folder.isSameEntry(other as FileSystemHandle);
  } catch {
    return Promise.resolve(false);
  }
  return settleWithin(compared, timeoutMs, false);
}
