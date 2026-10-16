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
    expect(folders[1]!.songs.map((chart) => chart.id)).toEqual(['a', 'c']);
  });

  test('puts a chart without a directory under its source label', () => {
    const loose = makeChart('loose', '', { sourceLabel: 'dropped files' });
    expect(chartFolderLabel(loose)).toBe('dropped files');
    expect(groupChartsByFolder([loose]).map((folder) => folder.label)).toEqual(['dropped files']);
  });
});

describe('libraryRootFolders', () => {
  test('lists the chart folders, then the course folders', () => {
    const courses = makeCourseFolder('MY COURSES', [makeCourse('dan')]);
    const library = { songs: [makeChart('a', 'Pack/x')], courseFolders: [courses] };
    expect(libraryRootFolders(library).map((folder) => folder.label)).toEqual(['Pack', 'MY COURSES']);
  });

  test('groups a chart list once, and again when its course folders change', () => {
    const songs = [makeChart('a', 'Pack/x')];
    const first = libraryRootFolders({ songs });
    expect(libraryRootFolders({ songs })).toBe(first);
    const withCourses = libraryRootFolders({ songs, courseFolders: [makeCourseFolder('C', [])] });
    expect(withCourses).not.toBe(first);
    expect(withCourses.map((folder) => folder.label)).toEqual(['Pack', 'C']);
  });
});

describe('libraryEntryKey', () => {
  test('names a chart by id, a folder by label and a course by id', () => {
    expect(libraryEntryKey({ kind: 'song', song: makeChart('x', 'P') })).toBe('chart:x');
    expect(libraryEntryKey({ kind: 'folder', folder: { label: 'P', songs: [] } })).toBe('folder:P');
    expect(libraryEntryKey({ kind: 'course', course: makeCourse('dan#0') })).toBe('course:dan#0');
  });
});
