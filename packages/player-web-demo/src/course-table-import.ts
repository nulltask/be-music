// Importing the courses a difficulty table publishes in its header (`header.json`), from the table's URL. The fetch,
// the stored URL list and the group merge live here; `main.ts` only binds the Debug Menu controls and refreshes the
// course folders.
import type { CourseDefinitionGroup } from '@be-music/player-web/collection';
import { fetchTableHeaderCourses, parseTableHeaderCourses, type TableFetchText } from '@be-music/player/course';
import { DEMO_STORAGE_PREFIX } from './debug-menu.ts';

/** `localStorage` key of the difficulty-table URLs whose courses are imported again on load. */
export const COURSE_TABLE_URLS_STORAGE_KEY = `${DEMO_STORAGE_PREFIX}course-table-urls`;

/** A difficulty table's courses, read as one course group. */
export interface ImportedCourseTable {
  group: CourseDefinitionGroup;
  headerUrl: string;
}

/** The trimmed URL when it is an absolute http(s) URL, else `undefined`. */
export function normalizeCourseTableUrl(input: string): string | undefined {
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
export function parseStoredCourseTableUrls(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const urls: string[] = [];
    for (const value of parsed) {
      const url = typeof value === 'string' ? normalizeCourseTableUrl(value) : undefined;
      if (url !== undefined && !urls.includes(url)) urls.push(url);
    }
    return urls;
  } catch {
    return [];
  }
}

/** The remembered table URLs; empty when none are stored or storage is blocked. */
export function readStoredCourseTableUrls(storage: Pick<Storage, 'getItem'> | undefined = defaultStorage()): string[] {
  try {
    return parseStoredCourseTableUrls(storage?.getItem(COURSE_TABLE_URLS_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Adds `url` to the remembered table URLs (once) and returns the new list; blocked storage keeps it for this session. */
export function rememberCourseTableUrl(
  url: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = defaultStorage(),
): string[] {
  const urls = readStoredCourseTableUrls(storage);
  if (!urls.includes(url)) urls.push(url);
  try {
    storage?.setItem(COURSE_TABLE_URLS_STORAGE_KEY, JSON.stringify(urls));
  } catch {
    // Private windows / blocked storage: the import still applies for this session.
  }
  return urls;
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
 * A status line for a failed import. `fetch` rejects with a bare `TypeError` when the request is blocked, which for a
 * difficulty table is almost always a missing CORS header, so that case says so.
 */
export function describeCourseTableImportError(error: unknown): string {
  if (error instanceof TypeError) {
    return (
      'Course table import failed: the site does not let other pages read it. Save the table’s header file ' +
      '(the JSON its page names in <meta name="bmstable">, usually header.json) and drop it here instead'
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Course table import failed: ${message}`;
}

/** Fetches a URL's body as text with the browser `fetch`, rejecting a non-2xx response. */
export async function fetchCourseTableText(url: string): Promise<string> {
  const response = await fetch(url);
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
  return { group: { label: table.label, courses: table.courses }, headerUrl: table.headerUrl };
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
