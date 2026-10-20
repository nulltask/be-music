import { describe, expect, test } from 'vite-plus/test';
import type { LibraryEntry } from '../library/entries.ts';
import { makeChart, makeCourse } from '../test-support/library.ts';
import { matchesSearchQuery, normalizeSearchQuery } from './search.ts';

const chartEntry = (overrides: Parameters<typeof makeChart>[2]): LibraryEntry => ({
  kind: 'chart',
  chart: makeChart('id', 'P', { title: 'Untitled', ...overrides }),
});

describe('normalizeSearchQuery', () => {
  test('trims and lower-cases the typed text', () => {
    expect(normalizeSearchQuery('  Alternate IGNITION ')).toBe('alternate ignition');
    expect(normalizeSearchQuery('   ')).toBe('');
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
