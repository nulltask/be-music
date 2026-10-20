import { describe, expect, test } from 'vite-plus/test';
import type { LibraryChart, LibraryEntry } from '../library/entries.ts';
import { makeChart, makeCourse } from '../test-support/library.ts';
import { sortLibraryEntries } from './sort.ts';

const charts = (...list: LibraryChart[]): LibraryEntry[] => list.map((chart) => ({ kind: 'chart', chart }));
const ids = (entries: readonly LibraryEntry[]): string[] =>
  entries.map((entry) =>
    entry.kind === 'chart' ? entry.chart.id : entry.kind === 'folder' ? entry.folder.label : entry.course.id,
  );

describe('sortLibraryEntries', () => {
  const a = makeChart('a', 'P', {
    title: 'beta',
    playLevel: 12,
    artist: 'Zed',
    genre: 'Trance',
    bpm: 180,
    totalNotes: 900,
  });
  const b = makeChart('b', 'P', { title: 'Alpha', playLevel: '3', bpm: 120, totalNotes: 300 });
  const c = makeChart('c', 'P', {
    title: 'gamma',
    playLevel: 3,
    artist: 'Amy',
    genre: 'Ambient',
    bpm: 150,
    totalNotes: 600,
  });
  const d = makeChart('d', 'P', { title: 'delta', totalNotes: 100 });
  const list = charts(a, b, c, d);

  test('keeps the library order under OFF and LASTPLAY', () => {
    expect(ids(sortLibraryEntries(list, 'OFF'))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(sortLibraryEntries(list, 'LASTPLAY'))).toEqual(['a', 'b', 'c', 'd']);
  });

  test('sorts by title case-insensitively, and CLEAR by title until records feed it', () => {
    expect(ids(sortLibraryEntries(list, 'TITLE'))).toEqual(['b', 'a', 'd', 'c']);
    expect(ids(sortLibraryEntries(list, 'CLEAR'))).toEqual(['b', 'a', 'd', 'c']);
  });

  test('sorts by level, a text level read as a number, equal levels by title, a missing level last', () => {
    expect(ids(sortLibraryEntries(list, 'LEVEL'))).toEqual(['b', 'c', 'a', 'd']);
  });

  test('sorts by artist and genre with a missing one first, by BPM and by note count', () => {
    expect(ids(sortLibraryEntries(list, 'ARTIST'))).toEqual(['b', 'd', 'c', 'a']);
    expect(ids(sortLibraryEntries(list, 'GENRE'))).toEqual(['b', 'd', 'c', 'a']);
    expect(ids(sortLibraryEntries(list, 'BPM'))).toEqual(['d', 'b', 'c', 'a']);
    expect(ids(sortLibraryEntries(list, 'NOTES'))).toEqual(['d', 'b', 'c', 'a']);
  });

  test('sorts folder bars by label under any order but OFF, and keeps course bars in their order', () => {
    const folders: LibraryEntry[] = [
      { kind: 'folder', folder: { label: 'zeta', charts: [] } },
      { kind: 'folder', folder: { label: 'Alpha', charts: [] } },
    ];
    expect(ids(sortLibraryEntries(folders, 'LEVEL'))).toEqual(['Alpha', 'zeta']);
    expect(ids(sortLibraryEntries(folders, 'OFF'))).toEqual(['zeta', 'Alpha']);
    const courses: LibraryEntry[] = [
      { kind: 'course', course: makeCourse('z') },
      { kind: 'course', course: makeCourse('a') },
    ];
    expect(ids(sortLibraryEntries(courses, 'TITLE'))).toEqual(['z', 'a']);
  });

  test('is stable and returns a new array', () => {
    const twins = charts(makeChart('x', 'P', { title: 'same' }), makeChart('y', 'P', { title: 'Same' }));
    const sorted = sortLibraryEntries(twins, 'TITLE');
    expect(ids(sorted)).toEqual(['x', 'y']);
    expect(sorted).not.toBe(twins);
  });
});
