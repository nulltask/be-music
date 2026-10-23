// Restores and publishes the Debug Menu document. The browser copy is `localStorage`. The durable copy is
// `GET` / `PUT /api/player-settings`: the player Worker keeps it and sets `__Host-be-music.device`, an HttpOnly
// cookie. Safari deletes script-written storage after seven days of Safari use without a visit; a cookie the
// server sets is not in that set, so the next visit can read the document back.

import {
  debugMenuSettingsFromLegacy,
  hasLegacyDebugMenuSettings,
  parseDebugMenuSettingsDocument,
  readStoredDebugMenuSettings,
  writeDebugMenuSettings,
  type DebugMenuSettingsDocument,
} from './debug-menu-settings.ts';

export const PLAYER_SETTINGS_PATH = '/api/player-settings';
/** Set when a reset could not reach the server, so the next boot does not pull the copy just cleared locally. */
const RESET_PENDING_KEY = 'be-music-demo.settings-reset-pending';

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function pageStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function localDocument(now: number): DebugMenuSettingsDocument | undefined {
  const saved = readStoredDebugMenuSettings(storage());
  if (saved) return saved;
  if (!hasLegacyDebugMenuSettings(storage())) return undefined;
  const migrated = debugMenuSettingsFromLegacy(storage(), now);
  writeDebugMenuSettings(migrated, storage());
  return migrated;
}

/**
 * Pulls the server copy when it is newer than this browser's, and publishes this browser's copy when the server has
 * none or an older one. A failed request leaves the local document as it is.
 */
export async function reconcileDebugMenuSettings(doFetch: typeof fetch = fetch, now = Date.now()): Promise<void> {
  const pending = pageStorage()?.getItem(RESET_PENDING_KEY) === '1';
  if (pending) {
    if (await deleteRemoteDebugMenuSettings(doFetch)) pageStorage()?.removeItem(RESET_PENDING_KEY);
    return;
  }
  const local = localDocument(now);
  let remote: DebugMenuSettingsDocument | undefined;
  let reachable = false;
  try {
    const response = await doFetch(PLAYER_SETTINGS_PATH, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(2500),
    });
    reachable = response.ok;
    if (response.ok && response.status !== 204) remote = parseDebugMenuSettingsDocument(await response.text());
  } catch {
    return;
  }
  if (!reachable) return;
  if (remote && (!local || remote.updatedAt > local.updatedAt)) {
    writeDebugMenuSettings(remote, storage());
    return;
  }
  if (local && (!remote || local.updatedAt > remote.updatedAt)) void pushDebugMenuSettings(local, doFetch);
}

/** Publishes `document`. When the server already has a newer one, that one is written locally and returned. */
export async function pushDebugMenuSettings(
  document: DebugMenuSettingsDocument,
  doFetch: typeof fetch = fetch,
): Promise<DebugMenuSettingsDocument | undefined> {
  try {
    const response = await doFetch(PLAYER_SETTINGS_PATH, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(document),
    });
    if (!response.ok) return undefined;
    const stored = parseDebugMenuSettingsDocument(await response.text());
    if (stored && stored.updatedAt !== document.updatedAt) writeDebugMenuSettings(stored, storage());
    return stored;
  } catch {
    return undefined;
  }
}

/** Deletes the server copy. `false` when the request did not succeed, so a later boot must try again. */
export async function deleteRemoteDebugMenuSettings(doFetch: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await doFetch(PLAYER_SETTINGS_PATH, { method: 'DELETE', credentials: 'same-origin' });
    return response.ok;
  } catch {
    return false;
  }
}

/** Remembers that the server copy still needs deleting, across the reload a reset performs. */
export function markDebugMenuSettingsResetPending(): void {
  try {
    pageStorage()?.setItem(RESET_PENDING_KEY, '1');
  } catch {
    // The local keys are already gone; the next visit may restore the server copy.
  }
}
