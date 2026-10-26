// What the player keeps in this browser, read for the local data viewer: its `localStorage` keys, its IndexedDB
// databases and the browser's storage estimate. Reading never writes: databases are opened at their current version and
// only the ones the browser lists are opened, so the viewer creates nothing.

/** What each `localStorage` key of the player holds. */
const LOCAL_STORAGE_KEYS: Readonly<Record<string, string>> = {
  'be-music.debug-menu-settings': 'Every Debug Menu setting',
  'be-music.settings-reset-pending': 'A settings reset still to send to the server',
  'be-music.chart-best-records': 'Best records of each chart, per judge ruleset',
  'be-music.hi-speed': 'The hi-speed the next play starts at',
  'be-music.play-tempo': 'Tempo settings',
  'be-music.replay-view': 'Replay view settings',
  'be-music.render-resolution': 'Render resolution',
  'be-music.compressor-tuning': 'Audio compressor tuning',
  'be-music.volumes': 'Volumes',
  'be-music.built-in-skin': 'The built-in skin',
  'be-music.skin-settings': 'Skin settings',
  'be-music.skin-effects': 'Skin effects',
  'be-music.play-layout': 'Play layout',
  'be-music.recording-format': 'Recording format',
  'be-music.debug-menu-folders': 'Which Debug Menu folders are open',
  'be-music.course-table-urls': 'Difficulty tables whose courses are imported on load',
  'be-music.play-in-silent-mode': 'Play sound with the device in silent mode',
  'be-music.silent-mode-hint-seen': 'The silent-mode hint was shown',
  'be-music.worker-count': 'Background worker count',
};

/** What each IndexedDB database and store of the player holds. */
const DATABASES: Readonly<Record<string, { description: string; stores: Readonly<Record<string, string>> }>> = {
  'be-music': { description: 'Courses you made', stores: { courses: 'Saved courses' } },
  'be-music-replays': {
    description: 'Replay slots',
    stores: {
      replaySlots: 'What each slot holds',
      replaySlotData: 'Each slot’s replay, gzip-compressed',
      meta: 'Storage revision',
    },
  },
};

/** One `localStorage` entry. */
export interface LocalStorageEntry {
  readonly key: string;
  readonly value: string;
  /** UTF-8 bytes of the key and value. */
  readonly bytes: number;
  /** What it holds, for the player's own keys. */
  readonly description?: string;
}

/** One stored IndexedDB record, as read. */
export interface StoredRecord {
  readonly key: string;
  readonly value: unknown;
}

/** One object store of a database. */
export interface StoredObjectStore {
  readonly name: string;
  readonly description?: string;
  readonly count: number;
  /** The first records, up to the read limit. */
  readonly records: readonly StoredRecord[];
}

/** One IndexedDB database. */
export interface StoredDatabase {
  readonly name: string;
  readonly version: number;
  readonly description?: string;
  readonly stores: readonly StoredObjectStore[];
}

/** A stored value as the viewer shows it. */
export interface StoredValueView {
  readonly kind: 'json' | 'text' | 'blob' | 'binary';
  /** Its size in bytes; for JSON, the UTF-8 size of its JSON text, which approximates what the browser keeps. */
  readonly bytes: number;
  /** What to print: pretty JSON, the text, or a line describing binary data. */
  readonly text: string;
}

const encoder = new TextEncoder();

/** UTF-8 bytes of `text`. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/** A byte count for people: `512 B`, `1.5 KB`, `12.0 MB` (powers of 1024). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** What a `localStorage` key holds, for the player's own keys. */
export function describeLocalStorageKey(key: string): string | undefined {
  return LOCAL_STORAGE_KEYS[key];
}

/** Every `localStorage` entry: the player's own (`be-music.`) first, each group by key. */
export function listLocalStorage(storage: Pick<Storage, 'length' | 'key' | 'getItem'>): LocalStorageEntry[] {
  const entries: LocalStorageEntry[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === null) continue;
    const value = storage.getItem(key) ?? '';
    const description = describeLocalStorageKey(key);
    entries.push({ key, value, bytes: utf8Bytes(key) + utf8Bytes(value), ...(description ? { description } : {}) });
  }
  const own = (key: string) => (key.startsWith('be-music.') ? 0 : 1);
  return entries.sort((a, b) => own(a.key) - own(b.key) || a.key.localeCompare(b.key));
}

/** A `localStorage` value as the viewer shows it: pretty JSON when it parses, else the text. */
export function viewLocalStorageValue(value: string): StoredValueView {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null)
      return { kind: 'json', bytes: utf8Bytes(value), text: JSON.stringify(parsed, null, 2) };
  } catch {
    // Not JSON: shown as text.
  }
  return { kind: 'text', bytes: utf8Bytes(value), text: value };
}

/** An IndexedDB value as the viewer shows it. Blobs and binary data are described, not read. */
export function viewStoredValue(value: unknown): StoredValueView {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return {
      kind: 'blob',
      bytes: value.size,
      text: `Blob, ${formatBytes(value.size)}${value.type ? `, ${value.type}` : ''}`,
    };
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value.byteLength;
    return { kind: 'binary', bytes, text: `Binary data, ${formatBytes(bytes)}` };
  }
  if (typeof value === 'string') return { kind: 'text', bytes: utf8Bytes(value), text: value };
  const json = JSON.stringify(value, null, 2) ?? String(value);
  return { kind: 'json', bytes: utf8Bytes(JSON.stringify(value) ?? ''), text: json };
}

/** What a database, or one of its stores, holds, for the player's own. */
export function describeDatabase(name: string, store?: string): string | undefined {
  const database = DATABASES[name];
  return store === undefined ? database?.description : database?.stores[store];
}

/** The player's databases first, then the rest, each group by name. */
export function sortDatabases<T extends { name: string }>(databases: readonly T[]): T[] {
  const own = (name: string) => (name in DATABASES ? 0 : 1);
  return [...databases].sort((a, b) => own(a.name) - own(b.name) || a.name.localeCompare(b.name));
}

function request<T>(target: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    target.onsuccess = () => resolve(target.result);
    target.onerror = () => reject(target.error ?? new Error('indexedDB request failed'));
  });
}

/** Opens an existing database at its current version; an upgrade request (a database that is gone) is aborted. */
function openExisting(factory: IDBFactory, name: string): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name);
    open.onupgradeneeded = () => open.transaction?.abort();
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => (open.error?.name === 'AbortError' ? resolve(undefined) : reject(open.error));
  });
}

/** Reads every database the browser lists for this origin, with up to `limit` records of each store. */
export async function readIndexedDB(factory: IDBFactory, limit = 200): Promise<StoredDatabase[]> {
  const listed = typeof factory.databases === 'function' ? await factory.databases() : [];
  const result: StoredDatabase[] = [];
  for (const info of sortDatabases(listed.flatMap((info) => (info.name ? [{ ...info, name: info.name }] : [])))) {
    const db = await openExisting(factory, info.name);
    if (db === undefined) continue;
    try {
      const stores: StoredObjectStore[] = [];
      for (const name of Array.from(db.objectStoreNames)) {
        const store = db.transaction(name, 'readonly').objectStore(name);
        const [count, keys, values] = await Promise.all([
          request(store.count()),
          request(store.getAllKeys(null, limit)),
          request(store.getAll(null, limit)),
        ]);
        const description = describeDatabase(info.name, name);
        stores.push({
          name,
          count,
          records: keys.map((key, index) => ({ key: formatKey(key), value: values[index] })),
          ...(description ? { description } : {}),
        });
      }
      const description = describeDatabase(info.name);
      result.push({ name: info.name, version: db.version, stores, ...(description ? { description } : {}) });
    } finally {
      db.close();
    }
  }
  return result;
}

/** An IndexedDB key as text. */
export function formatKey(key: IDBValidKey): string {
  if (typeof key === 'string') return key;
  if (typeof key === 'number') return String(key);
  if (key instanceof Date) return key.toISOString();
  if (Array.isArray(key)) return `[${key.map(formatKey).join(', ')}]`;
  return `Binary key, ${formatBytes(key.byteLength)}`;
}

/** The browser's storage estimate for this origin, and whether it is kept from eviction. */
export async function readStorageEstimate(): Promise<{ usage?: number; quota?: number; persisted?: boolean }> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (storage === undefined) return {};
  const [estimate, persisted] = await Promise.all([
    storage.estimate?.().catch(() => undefined),
    storage.persisted?.().catch(() => undefined),
  ]);
  return {
    ...(estimate?.usage !== undefined ? { usage: estimate.usage } : {}),
    ...(estimate?.quota !== undefined ? { quota: estimate.quota } : {}),
    ...(persisted !== undefined ? { persisted } : {}),
  };
}
