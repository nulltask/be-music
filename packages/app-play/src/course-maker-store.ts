// The player's own courses (made on the select screen) kept across reloads in IndexedDB, as LR2 keeps them in its
// database: the courses as `.lr2crs` text plus what that format has no room for (the stage titles, the constraints,
// whether each course is ranked and which are a folder's last RANDOM MIX), the default NONSTOP connection and the
// RANDOM MIX settings (LR2's `config.xml` `<course>`).

import {
  LR2_NONSTOP_CONNECTIONS,
  normalizeCourseConstraints,
  parseLR2CourseFile,
  serializeLR2CourseFile,
  DEFAULT_LR2_RANDOM_MIX_SETTINGS,
  normalizeLR2RandomMixSettings,
  type CourseDefinition,
  type LR2RandomMixSettings,
  type NonstopConnection,
} from '@be-music/player-engine/course';

/** Bumped when the stored shape changes; a record with another version is ignored. */
const STORE_VERSION = 1;
const DB_NAME = 'be-music';
const DB_VERSION = 1;
const STORE_NAME = 'courses';
const RECORD_KEY = 'made';

/** What the course maker keeps across reloads. */
export interface MadeCourses {
  /** Newest first. */
  courses: CourseDefinition[];
  defaultConnection: NonstopConnection;
  randomMixSettings: LR2RandomMixSettings;
  /** Those of `courses` that are their folder's last RANDOM MIX, which the next draw there replaces. */
  randomMixes: CourseDefinition[];
}

interface StoredMadeCourses {
  version: number;
  lr2crs: string;
  /** Each course's stage titles, by course and stage index. */
  titles: string[][];
  /** Each course's constraints, which `.lr2crs` has no room for (absent in records saved before they were kept). */
  constraints?: string[][];
  /**
   * Each course's `release` flag, which `.lr2crs` has no room for either (absent in records saved before it was kept;
   * those courses read back released, as they were made).
   */
  release?: boolean[];
  /** Whether each course is its folder's last RANDOM MIX (absent in records saved before RANDOM MIX). */
  randomMix?: boolean[];
  defaultConnection: string;
  /** The RANDOM MIX settings (absent in records saved before RANDOM MIX: LR2's defaults). */
  randomMixSettings?: Record<string, unknown>;
}

/** The stored record of `made`. */
export function serializeMadeCourses(made: MadeCourses): StoredMadeCourses {
  return {
    version: STORE_VERSION,
    lr2crs: serializeLR2CourseFile(made.courses),
    titles: made.courses.map((course) => course.stages.map((stage) => stage.title ?? '')),
    constraints: made.courses.map((course) => [...course.constraints]),
    release: made.courses.map((course) => course.release),
    randomMix: made.courses.map((course) => made.randomMixes.includes(course)),
    defaultConnection: made.defaultConnection,
    randomMixSettings: { ...made.randomMixSettings },
  };
}

/** Reads a stored record back; anything unreadable gives no course, the FADE default and LR2's RANDOM MIX defaults. */
export function parseMadeCourses(value: unknown): MadeCourses {
  const empty: MadeCourses = {
    courses: [],
    defaultConnection: 'fade',
    randomMixSettings: { ...DEFAULT_LR2_RANDOM_MIX_SETTINGS },
    randomMixes: [],
  };
  if (typeof value !== 'object' || value === null) return empty;
  const stored = value as Partial<StoredMadeCourses>;
  if (stored.version !== STORE_VERSION || typeof stored.lr2crs !== 'string') return empty;
  const defaultConnection = LR2_NONSTOP_CONNECTIONS.includes(stored.defaultConnection as NonstopConnection)
    ? (stored.defaultConnection as NonstopConnection)
    : 'fade';
  const titles = Array.isArray(stored.titles) ? stored.titles : [];
  const constraints = Array.isArray(stored.constraints) ? stored.constraints : [];
  const releases: unknown[] = Array.isArray(stored.release) ? stored.release : [];
  const courses = parseLR2CourseFile(stored.lr2crs).map((course, index) => {
    const names = titles[index];
    const kept = constraints[index];
    const release = releases[index];
    return {
      ...course,
      ...(Array.isArray(kept) ? { constraints: normalizeCourseConstraints(kept) } : {}),
      ...(typeof release === 'boolean' ? { release } : {}),
      stages: course.stages.map((stage, stageIndex) => {
        const title = Array.isArray(names) ? names[stageIndex] : undefined;
        return typeof title === 'string' && title.length > 0 ? { ...stage, title } : stage;
      }),
    };
  });
  const flags: unknown[] = Array.isArray(stored.randomMix) ? stored.randomMix : [];
  const randomMixSettings = normalizeLR2RandomMixSettings(
    typeof stored.randomMixSettings === 'object' && stored.randomMixSettings !== null ? stored.randomMixSettings : {},
  );
  return {
    courses,
    defaultConnection,
    randomMixSettings,
    randomMixes: courses.filter((_, index) => flags[index] === true),
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      void migrateLegacyCourses(db).then(
        () => resolve(db),
        (error) => {
          db.close();
          reject(error);
        },
      );
    };
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

/** Move the old database's course record without overwriting courses already saved under the current name. */
async function migrateLegacyCourses(db: IDBDatabase): Promise<void> {
  const previous = await new Promise<IDBDatabase | undefined>((resolve, reject) => {
    const request = indexedDB.open('be-music-demo');
    let missing = false;
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction?.abort();
    };
    request.onerror = () => (missing ? resolve(undefined) : reject(request.error));
    request.onsuccess = () => resolve(request.result);
  });
  if (!previous) return;
  try {
    if (!previous.objectStoreNames.contains(STORE_NAME)) return;
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = previous.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(RECORD_KEY);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
    if (value === undefined) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(RECORD_KEY);
      request.onsuccess = () => {
        if (request.result === undefined) store.put(value, RECORD_KEY);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    // Remove the source only after the destination transaction commits, so clearing courses cannot resurrect it.
    await new Promise<void>((resolve, reject) => {
      const transaction = previous.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(RECORD_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    previous.close();
  }
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = action(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
        request.onsuccess = () => {
          resolve(request.result);
          db.close();
        };
        request.onerror = () => {
          reject(request.error ?? new Error('indexedDB request failed'));
          db.close();
        };
      }),
  );
}

/** The saved courses, or none when IndexedDB is unavailable (a private window, blocked storage). */
export async function loadMadeCourses(): Promise<MadeCourses> {
  try {
    return parseMadeCourses(await run('readonly', (store) => store.get(RECORD_KEY)));
  } catch {
    return parseMadeCourses(undefined);
  }
}

/** Saves the courses; a failure is reported to the caller, which keeps them for this session. */
export async function saveMadeCourses(made: MadeCourses): Promise<void> {
  await run('readwrite', (store) => store.put(serializeMadeCourses(made), RECORD_KEY));
}
