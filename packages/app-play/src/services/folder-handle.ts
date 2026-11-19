// Calls on a remembered folder's handle that the page waits on. Chrome can leave every call on a saved folder's handle
// unanswered (`queryPermission`, `requestPermission`, `isSameEntry`, reading it), across reloads and restarts, while a
// handle saved afresh for the same folder works: the start-up restore then never finished, so the select screen, the
// Bemuse servers, the difficulty tables and every later drop waited on it for good. Each call here gives up after a
// while and answers as for a folder that cannot be used now. A handle that did not answer is remembered for the page
// ({@link isUnansweredFolder}): it is not asked again, and the player picks its folder again to replace it.

/** How long a handle call may take before the page goes on without its answer. */
export const FOLDER_HANDLE_TIMEOUT_MS = 3000;
/**
 * How long a permission request may take. Longer than {@link FOLDER_HANDLE_TIMEOUT_MS}: the browser may be showing the
 * player a prompt.
 */
export const FOLDER_PERMISSION_REQUEST_TIMEOUT_MS = 15_000;

/** The handles that left a call unanswered on this page. */
const unanswered = new WeakSet<object>();

/** Whether a call on `folder` went unanswered on this page: its folder has to be picked again. */
export function isUnansweredFolder(folder: object): boolean {
  return unanswered.has(folder);
}

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

/** What {@link folderReadPermission} and {@link requestFolderReadPermission} ask of a handle. */
export interface PermissionQueryable {
  readonly name: string;
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' }): Promise<PermissionState>;
}

/** The answer of `ask`, `prompt` when it fails, and `prompt` (with `folder` remembered as unanswered) when it is late. */
async function permissionWithin(
  folder: PermissionQueryable,
  ask: () => Promise<PermissionState>,
  timeoutMs: number,
): Promise<PermissionState> {
  if (unanswered.has(folder)) return 'prompt';
  let asked: Promise<PermissionState>;
  try {
    asked = ask();
  } catch {
    return 'prompt';
  }
  const state = await settleWithin<PermissionState | 'timeout'>(
    asked.catch(() => 'prompt' as const),
    timeoutMs,
    'timeout',
  );
  if (state !== 'timeout') return state;
  unanswered.add(folder);
  console.warn(`The saved folder "${folder.name}" did not answer; pick it again to load it.`);
  return 'prompt';
}

/**
 * Whether the page may read `folder` now. A query that fails or does not answer in time reads as `prompt`: the folder
 * waits for the player, as one whose permission lapsed does.
 */
export function folderReadPermission(
  folder: PermissionQueryable,
  timeoutMs = FOLDER_HANDLE_TIMEOUT_MS,
): Promise<PermissionState> {
  return permissionWithin(folder, () => folder.queryPermission({ mode: 'read' }), timeoutMs);
}

/** Asks the player to let the page read `folder` (`requestPermission`), as {@link folderReadPermission} answers. */
export function requestFolderReadPermission(
  folder: PermissionQueryable,
  timeoutMs = FOLDER_PERMISSION_REQUEST_TIMEOUT_MS,
): Promise<PermissionState> {
  return permissionWithin(
    folder,
    () => folder.requestPermission?.({ mode: 'read' }) ?? Promise.resolve('prompt'),
    timeoutMs,
  );
}

/** What {@link isSameFolder} asks of a handle. */
export interface EntryComparable {
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
}

/**
 * Whether `folder` and `other` are the same folder. A comparison with a handle that went unanswered, or one that fails
 * or does not answer in time, is not.
 */
export function isSameFolder(
  folder: EntryComparable,
  other: unknown,
  timeoutMs = FOLDER_HANDLE_TIMEOUT_MS,
): Promise<boolean> {
  if (unanswered.has(folder) || (typeof other === 'object' && other !== null && unanswered.has(other))) {
    return Promise.resolve(false);
  }
  let compared: Promise<boolean>;
  try {
    compared = folder.isSameEntry(other as FileSystemHandle);
  } catch {
    return Promise.resolve(false);
  }
  return settleWithin(compared, timeoutMs, false);
}
