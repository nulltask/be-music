// Local edits are synchronous. Remote operations run in order; resets retain a durable retry marker and the server
// retains only a version barrier, so an older request cannot recreate settings that were reset.
import {
  debugMenuSettingsFromLegacy,
  hasLegacyDebugMenuSettings,
  parseDebugMenuSettingsDocument,
  readStoredDebugMenuSettings,
  writeDebugMenuSettings,
  type DebugMenuSettingsDocument,
} from './debug-menu-settings.ts';
import { clearPlayerSettings, type DebugMenuStorage } from './debug-menu-storage.ts';

export const PLAYER_SETTINGS_PATH = '/api/player-settings';
export const RESET_PENDING_KEY = 'be-music.settings-reset-pending';
const REQUEST_TIMEOUT_MS = 2500;

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function sameDocument(
  left: DebugMenuSettingsDocument | undefined,
  right: DebugMenuSettingsDocument | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** One owner for immediate browser persistence and ordered, debounced remote publication. */
export class DebugMenuSettingsSync {
  private readonly storage: DebugMenuStorage | undefined;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private clock = 0;
  private generation = 0;
  private resetting = false;
  private pending: DebugMenuSettingsDocument | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();

  public constructor(options: { storage?: DebugMenuStorage; fetch?: typeof fetch; now?: () => number } = {}) {
    this.storage = options.storage ?? defaultStorage();
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  /** Persists immediately, even when the page closes before the remote debounce expires. */
  public save(document: DebugMenuSettingsDocument): void {
    if (this.resetting) return;
    const saved = { ...document, updatedAt: this.nextTimestamp(document.updatedAt) };
    writeDebugMenuSettings(saved, this.storage);
    this.pending = saved;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 300);
  }

  /** Publishes the latest pending edit, after earlier requests. Safe to call when the page is hidden. */
  public flush(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const document = this.pending;
    this.pending = undefined;
    const generation = this.generation;
    if (document)
      void this.enqueue(async () => {
        if (generation !== this.generation || this.resetting) return;
        if (!(await this.retryReset())) return;
        const outgoing = this.local() ?? document;
        const stored = await this.request('PUT', outgoing);
        if (stored && generation === this.generation && !this.resetting && sameDocument(this.local(), outgoing)) {
          this.apply(stored);
        }
      });
    return this.queue;
  }

  /** Reconciles before constructing the UI. A request never overwrites an edit made while it was in flight. */
  public async reconcile(): Promise<void> {
    await this.enqueue(async () => {
      if (this.resetting || !(await this.retryReset())) return;
      let local = this.local();
      if (!local && hasLegacyDebugMenuSettings(this.storage)) {
        local = debugMenuSettingsFromLegacy(this.storage, this.nextTimestamp(this.now()));
        writeDebugMenuSettings(local, this.storage);
      }
      const generation = this.generation;
      let response: Response;
      try {
        response = await this.doFetch(PLAYER_SETTINGS_PATH, {
          credentials: 'same-origin',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) return;
        const remote = response.status === 204 ? undefined : parseDebugMenuSettingsDocument(await response.text());
        if (remote) this.clock = Math.max(this.clock, remote.updatedAt);
        if (generation !== this.generation || this.resetting || !sameDocument(this.local(), local)) return;
        if (remote && (!local || remote.updatedAt > local.updatedAt)) this.apply(remote);
        else if (local && (!remote || local.updatedAt > remote.updatedAt)) {
          const stored = await this.request('PUT', local);
          if (stored && generation === this.generation && !this.resetting && sameDocument(this.local(), local))
            this.apply(stored);
        }
      } catch {
        // Offline: the immediate local copy remains authoritative for this visit.
      }
    });
  }

  /** Clears locally first, invalidates queued saves, then deletes remotely after any in-flight request finishes. */
  public async reset(): Promise<void> {
    const reset: DebugMenuSettingsDocument = {
      version: 0,
      updatedAt: this.nextTimestamp(this.now()),
      settings: {},
      deleted: true,
    };
    this.generation++;
    this.resetting = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    clearPlayerSettings(this.storage);
    try {
      this.storage?.setItem(RESET_PENDING_KEY, JSON.stringify(reset));
    } catch {
      // Blocked storage cannot retain a retry marker, but still resets the current visit.
    }
    await this.enqueue(async () => {
      await this.retryReset(reset);
    });
  }

  private local(): DebugMenuSettingsDocument | undefined {
    return readStoredDebugMenuSettings(this.storage);
  }

  private resetPending(): DebugMenuSettingsDocument | undefined {
    try {
      const document = parseDebugMenuSettingsDocument(this.storage?.getItem(RESET_PENDING_KEY));
      return document?.deleted ? document : undefined;
    } catch {
      return undefined;
    }
  }

  private nextTimestamp(now: number): number {
    this.clock = Math.max(
      now,
      this.clock + 1,
      (this.local()?.updatedAt ?? 0) + 1,
      (this.resetPending()?.updatedAt ?? 0) + 1,
    );
    return this.clock;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(operation).catch(() => {
      /* A failed request must not block later local edits or reset. */
    });
    return this.queue;
  }

  private apply(document: DebugMenuSettingsDocument): void {
    this.clock = Math.max(this.clock, document.updatedAt);
    if (document.deleted) clearPlayerSettings(this.storage);
    else writeDebugMenuSettings(document, this.storage);
  }

  private async retryReset(document = this.resetPending()): Promise<boolean> {
    if (!document) return true;
    const stored = await this.request('DELETE', document);
    if (!stored?.deleted) return false;
    const local = this.local();
    if (local && local.updatedAt > document.updatedAt) {
      // Edits made after an offline reset must remain causally newer than the acknowledged remote reset.
      writeDebugMenuSettings({ ...local, updatedAt: this.nextTimestamp(stored.updatedAt) }, this.storage);
    }
    try {
      // A newer reset from another tab still needs its own acknowledgement.
      if (sameDocument(this.resetPending(), document)) this.storage?.removeItem(RESET_PENDING_KEY);
    } catch {
      /* Retry again next visit if storage is blocked. */
    }
    return true;
  }

  private async request(
    method: 'PUT' | 'DELETE',
    document: DebugMenuSettingsDocument,
  ): Promise<DebugMenuSettingsDocument | undefined> {
    try {
      const response = await this.doFetch(PLAYER_SETTINGS_PATH, {
        method,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(document),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        keepalive: true,
      });
      if (!response.ok) return undefined;
      const stored = parseDebugMenuSettingsDocument(await response.text());
      if (stored) this.clock = Math.max(this.clock, stored.updatedAt);
      return stored;
    } catch {
      return undefined;
    }
  }
}

export const debugMenuSettingsSync = new DebugMenuSettingsSync();
