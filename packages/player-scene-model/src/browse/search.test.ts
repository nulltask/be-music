import { describe, expect, test } from 'vite-plus/test';
import type { LibraryEntry } from '../library/entries.ts';
import { makeChart, makeCourse } from '../test-support/library.ts';
import { browseSearchError, matchesSearchQuery, normalizeSearchQuery, parseBrowseSearch } from './search.ts';

const chartEntry = (overrides: Parameters<typeof makeChart>[2]): LibraryEntry => ({
  kind: 'chart',
  chart: makeChart('id', 'P', { title: 'Untitled', ...overrides }),
});

describe('normalizeSearchQuery', () => {
  test('trims and lower-cases the typed text', () => {
    expect(normalizeSearchQuery('  Alternate IGNITION ')).toBe('alternate ignition');
    expect(normalizeSearchQuery('   ')).toBe('');
  });

  test('only trims a chart filter expression, so its literals keep their case', () => {
    expect(normalizeSearchQuery("  ?title = 'ABC' ")).toBe("?title = 'ABC'");
  });
});

describe('parseBrowseSearch', () => {
  test('reads an empty box, a text search and a chart filter expression', () => {
    expect(parseBrowseSearch('  ')).toEqual({ kind: 'none' });
    expect(parseBrowseSearch(' Ignition')).toEqual({ kind: 'text', query: 'ignition' });
    const filter = parseBrowseSearch('?level >= 12 LIMIT 5');
    expect(filter.kind).toBe('filter');
    expect(filter.kind === 'filter' && filter.query.limit).toBe(5);
  });

  test('`?` alone is an expression still being typed', () => {
    expect(parseBrowseSearch('?')).toEqual({ kind: 'none' });
    expect(parseBrowseSearch(' ?  ')).toEqual({ kind: 'none' });
  });

  test('an expression that does not parse is invalid, with the reason', () => {
    expect(parseBrowseSearch('?level >')).toEqual({ kind: 'invalid', error: 'unexpected end of filter at 7' });
    expect(browseSearchError('?mode = 7')).toBe('ambiguous column name: mode');
    expect(browseSearchError('?level = 1 ORDER BY RANDOM()')).toMatch(/RANDOM\(\) is not supported/u);
    expect(browseSearchError('?level = 1')).toBeUndefined();
    expect(browseSearchError('level >')).toBeUndefined();
  });
});

describe('matchesSearchQuery', () => {
  test('matches every bar on an empty query', () => {
    expect(matchesSearchQuery(chartEntry({ title: 'Whatever' }), '')).toBe(true);
  });

  test("matches a chart's title, artist, genre and subtitle case-insensitively", () => {
    expect(matchesSearchQuery(chartEntry({ title: 'Alternate Ignition' }), 'ignition')).toBe(true);
    expect(matchesSearchQuery(chartEntry({ artist: 'YAMD' }), 'yamd')).toBe(true);
    expect(matchesSearchQuery(chartEntry({ genre: 'Electro' }), 'electro')).toBe(true);
    expect(matchesSearchQuery(chartEntry({ subtitle: 'Insane mix' }), 'insane')).toBe(true);
  });

  test('matches the file label, where authors put difficulty hints', () => {
    expect(matchesSearchQuery(chartEntry({ fileLabel: 'sleepless [7K SP HYPER].bms' }), '7k sp hyper')).toBe(true);
  });

  test('misses when no field holds the query, and skips the fields a chart leaves out', () => {
    expect(matchesSearchQuery(chartEntry({ artist: 'YAMD', genre: 'Electro' }), 'jazz')).toBe(false);
    expect(matchesSearchQuery(chartEntry({}), 'untitled')).toBe(true);
  });

  test('matches a folder on its label and a course on its name', () => {
    const folder: LibraryEntry = { kind: 'folder', folder: { label: 'LunaticCrave', charts: [] } };
    expect(matchesSearchQuery(folder, 'lunatic')).toBe(true);
    expect(matchesSearchQuery(folder, 'unrelated')).toBe(false);
    const course: LibraryEntry = { kind: 'course', course: makeCourse('Satellite 10th Dan') };
    expect(matchesSearchQuery(course, '10th')).toBe(true);
    expect(matchesSearchQuery(course, 'stella')).toBe(false);
  });
});
