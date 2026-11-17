// Importing the courses a difficulty table publishes in its header (`header.json`), from the table's URL. The fetch,
// the stored URL list and the group merge live here; the Options dialog's Course folder only binds the controls, and the
// library service (`services/library.ts`) refreshes the course folders.
import type { CourseDefinitionGroup } from '@be-music/player-browser/collection';
import { fetchTableHeaderCourses, parseTableHeaderCourses, type TableFetchText } from '@be-music/player-engine/course';
import { PLAYER_STORAGE_PREFIX } from './ui/options/folders.ts';
import { resolveURLLoadFetchURL } from './url-load.ts';

/** `localStorage` key of the difficulty-table URLs whose courses are imported again on load. */
export const COURSE_TABLE_URLS_STORAGE_KEY = `${PLAYER_STORAGE_PREFIX}course-table-urls`;
/** `localStorage` key of the well-known tables ({@link DEFAULT_COURSE_TABLE_URLS}) the player removed from the list. */
export const REMOVED_DEFAULT_COURSE_TABLE_URLS_STORAGE_KEY = `${PLAYER_STORAGE_PREFIX}course-table-removed-defaults`;

/**
 * Well-known difficulty tables whose headers list courses, imported until the player stores a list of their own. Each
 * is the page URL players share; its `bmstable` meta names the header. Tables whose header lists no course (Overjoy,
 * DP Stella) are left out, since an import of one only reports that it has none.
 */
export const DEFAULT_COURSE_TABLE_URLS: readonly string[] = [
  // NEW GENERATION 通常難易度表 (▽) and 発狂難易度表 (▼)
  'https://rattoto10.jounin.jp/table.html',
  'https://rattoto10.jounin.jp/table_insane.html',
  // Satellite, Stella, DP Satellite
  'https://stellabms.xyz/sl/table.html',
  'https://stellabms.xyz/st/table.html',
  'https://stellabms.xyz/dp/table.html',
  // Stardust, Starlight
  'https://mqppppp.neocities.org/StardustTable.html',
  'https://djkuroakari.github.io/starlighttable.html',
  // Luminous (LN)
  'https://ladymade-star.github.io/luminous/table.html',
];

/** A difficulty table's courses, read as one course group. */
export interface ImportedCourseTable {
  group: CourseDefinitionGroup;
  headerURL: string;
  /** The table's song list (`data_url`), where the download pages of its courses' stages are looked up. */
  dataURL?: string;
}

/** The trimmed URL when it is an absolute http(s) URL, else `undefined`. */
export function normalizeCourseTableURL(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Stored table URLs, keeping only valid, distinct http(s) URLs in their stored order. */
export function parseStoredCourseTableURLs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const urls: string[] = [];
    for (const value of parsed) {
      const url = typeof value === 'string' ? normalizeCourseTableURL(value) : undefined;
      if (url !== undefined && !urls.includes(url)) urls.push(url);
    }
    return urls;
  } catch {
    return [];
  }
}

/**
 * The remembered table URLs: the stored list, or {@link DEFAULT_COURSE_TABLE_URLS} while none is stored, less the
 * well-known tables the player removed. Empty when storage is blocked. A stored empty list reads as none: builds before
 * the well-known tables stored one with every Options save (and synced it to their account), so it says nothing about
 * the tables the player wants; removing the last table records the removed well-known tables instead.
 */
export function readStoredCourseTableURLs(storage: Pick<Storage, 'getItem'> | undefined = defaultStorage()): string[] {
  if (storage === undefined) return [];
  try {
    const urls = parseStoredCourseTableURLs(storage.getItem(COURSE_TABLE_URLS_STORAGE_KEY));
    const removed = parseStoredCourseTableURLs(storage.getItem(REMOVED_DEFAULT_COURSE_TABLE_URLS_STORAGE_KEY));
    return (urls.length > 0 ? urls : [...DEFAULT_COURSE_TABLE_URLS]).filter((url) => !removed.includes(url));
  } catch {
    return [];
  }
}

/** The well-known tables `urls` lacks: what a stored list records as removed, so an empty list stays empty. */
export function removedDefaultCourseTableURLs(urls: readonly string[]): string[] {
  return DEFAULT_COURSE_TABLE_URLS.filter((url) => !urls.includes(url));
}

/**
 * Stores `urls` as the remembered tables, with the well-known tables it lacks as removed, and returns what was stored;
 * blocked storage keeps it for this session.
 */
export function storeCourseTableURLs(
  urls: readonly string[],
  storage: Pick<Storage, 'setItem'> | undefined = defaultStorage(),
): string[] {
  const stored = parseStoredCourseTableURLs(JSON.stringify(urls));
  try {
    storage?.setItem(COURSE_TABLE_URLS_STORAGE_KEY, JSON.stringify(stored));
    storage?.setItem(
      REMOVED_DEFAULT_COURSE_TABLE_URLS_STORAGE_KEY,
      JSON.stringify(removedDefaultCourseTableURLs(stored)),
    );
  } catch {
    // Private windows / blocked storage: the list still applies for this session.
  }
  return stored;
}

/** Adds `url` to the remembered table URLs (once) and returns the new list; blocked storage keeps it for this session. */
export function rememberCourseTableURL(
  url: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = defaultStorage(),
): string[] {
  const urls = readStoredCourseTableURLs(storage);
  if (urls.includes(url)) return urls;
  return storeCourseTableURLs([...urls, url], storage);
}

/** `groups` with `group` added, replacing the group that has the same label in place. */
export function mergeCourseGroup(
  groups: readonly CourseDefinitionGroup[],
  group: CourseDefinitionGroup,
): CourseDefinitionGroup[] {
  const index = groups.findIndex((existing) => existing.label === group.label);
  if (index < 0) return [...groups, group];
  return groups.map((existing, i) => (i === index ? group : existing));
}

/**
 * A status line for a failed import. `fetch` rejects with a bare `TypeError` when the request never completes (offline,
 * or a host that serves no proxy route and a table site that sends no CORS header), so that case says what to do.
 */
export function describeCourseTableImportError(error: unknown): string {
  if (error instanceof TypeError) {
    return (
      'Course table import failed: the table could not be fetched from here. Save the table’s header file ' +
      '(the JSON its page names in <meta name="bmstable">, usually header.json) and drop it here instead'
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Course table import failed: ${message}`;
}

/**
 * Fetches a URL's body as text with the browser `fetch`, rejecting a non-2xx response. A cross-origin URL goes through
 * the player's same-origin proxy (as `?music=` archives do), since most table sites send no CORS header. Relative
 * header URLs still resolve against `url` itself, not the proxy.
 */
export async function fetchCourseTableText(url: string): Promise<string> {
  const response = await fetch(resolveURLLoadFetchURL(url));
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

/** Reads a difficulty table's courses from its page or header URL. Throws when the table has no course. */
export async function importCourseTable(
  url: string,
  fetchText: TableFetchText = fetchCourseTableText,
): Promise<ImportedCourseTable> {
  const table = await fetchTableHeaderCourses(url, fetchText);
  if (table.courses.length === 0) throw new Error(`${table.label} lists no course`);
  return {
    group: { label: table.label, courses: table.courses },
    headerURL: table.headerURL,
    ...(table.dataURL !== undefined ? { dataURL: table.dataURL } : {}),
  };
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Whether a dropped file may be a saved difficulty-table header: a JSON file named `header.json`, as tables name it. */
export function isTableHeaderFilePath(path: string): boolean {
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? path;
  return name.toLowerCase() === 'header.json';
}

/**
 * Reads a saved difficulty-table header (`header.json`) into its course group, the way a table URL import reads it:
 * labelled with the table's `name` (else its `symbol`, else `fallbackLabel`). `undefined` when the text is not a JSON
 * object or lists no course, so the file can go on to the other loaders.
 */
export function readTableHeaderFile(text: string, fallbackLabel: string): CourseDefinitionGroup | undefined {
  let header: unknown;
  try {
    header = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header)) return undefined;
  const courses = parseTableHeaderCourses(header).flat();
  if (courses.length === 0) return undefined;
  const { name, symbol } = header as { name?: unknown; symbol?: unknown };
  const label =
    typeof name === 'string' && name.trim().length > 0
      ? name.trim()
      : typeof symbol === 'string' && symbol.trim().length > 0
        ? symbol.trim()
        : fallbackLabel;
  return { label, courses };
}
