import { describe, expect, test } from 'vite-plus/test';
import { makeChart, makeCourse, makeCourseFolder } from '../test-support/library.ts';
import { libraryEntryKey } from './entries.ts';
import { chartFolderLabel, groupChartsByFolder, libraryRootFolders } from './folders.ts';

describe('groupChartsByFolder', () => {
  test('groups charts by the first segment of their directory, folders in Japanese-aware label order', () => {
    const charts = [
      makeChart('a', 'Zeta/SongA'),
      makeChart('b', 'Alpha/SongB'),
      makeChart('c', 'Zeta/SongC'),
      makeChart('d', 'あいう/SongD'),
    ];
    const folders = groupChartsByFolder(charts);
    expect(folders.map((folder) => folder.label)).toEqual(['Alpha', 'Zeta', 'あいう']);
    // A folder keeps its charts in their original order.
    expect(folders[1]!.charts.map((chart) => chart.id)).toEqual(['a', 'c']);
  });

  test('marks a folder when all its charts came from a Bemuse server', () => {
    const remote = makeChart('remote', 'Remote/Song', { bemuseServer: true });
    expect(groupChartsByFolder([remote])[0]?.kind).toBe('bemuse-server');
    expect(groupChartsByFolder([remote, makeChart('local', 'Remote/Local')])[0]?.kind).toBeUndefined();
  });

  test('puts a chart without a directory under its source label', () => {
    const loose = makeChart('loose', '', { sourceLabel: 'dropped files' });
    expect(chartFolderLabel(loose)).toBe('dropped files');
    expect(groupChartsByFolder([loose]).map((folder) => folder.label)).toEqual(['dropped files']);
  });
});

describe('libraryRootFolders', () => {
  test('keeps registered servers in place as their chart folders become available', () => {
    const bemuseServerFolders = ['Bemuse Zeta', 'Bemuse Alpha', 'Bemuse Alpha'];
    const pending = libraryRootFolders({ charts: [], bemuseServerFolders });
    expect(pending).toEqual([
      { label: 'Bemuse Alpha', kind: 'bemuse-server', charts: [], disabled: true },
      { label: 'Bemuse Zeta', kind: 'bemuse-server', charts: [], disabled: true },
    ]);
    const chart = makeChart('a', 'Bemuse Alpha/Track', { bemuseServer: true });
    const loaded = libraryRootFolders({ charts: [chart], bemuseServerFolders });
    expect(loaded).toEqual([{ label: 'Bemuse Alpha', kind: 'bemuse-server', charts: [chart] }, pending[1]]);
  });

  test('lists the chart folders, then the course folders', () => {
    const courses = makeCourseFolder('MY COURSES', [makeCourse('dan')]);
    const library = { charts: [makeChart('a', 'Pack/x')], courseFolders: [courses] };
    expect(libraryRootFolders(library).map((folder) => folder.label)).toEqual(['Pack', 'MY COURSES']);
  });

  test('groups a chart list once, and again when its course folders change', () => {
    const charts = [makeChart('a', 'Pack/x')];
    const first = libraryRootFolders({ charts });
    expect(libraryRootFolders({ charts })).toBe(first);
    const withCourses = libraryRootFolders({ charts, courseFolders: [makeCourseFolder('C', [])] });
    expect(withCourses).not.toBe(first);
    expect(withCourses.map((folder) => folder.label)).toEqual(['Pack', 'C']);
  });
});

describe('libraryEntryKey', () => {
  test('names a chart by id, a folder by label and a course by id', () => {
    expect(libraryEntryKey({ kind: 'chart', chart: makeChart('x', 'P') })).toBe('chart:x');
    expect(libraryEntryKey({ kind: 'folder', folder: { label: 'P', charts: [] } })).toBe('folder:P');
    expect(libraryEntryKey({ kind: 'course', course: makeCourse('dan#0') })).toBe('course:dan#0');
  });
});
