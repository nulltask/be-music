import { describe, expect, test } from 'vite-plus/test';
import type { Library } from '../library/entries.ts';
import { makeChart, makeCourse, makeCourseFolder } from '../test-support/library.ts';
import { captureBrowse, restoreBrowse } from './snapshot.ts';
import {
  browseCursor,
  browseFolder,
  createBrowseState,
  focusedChart,
  focusedCourse,
  reduceBrowse,
  type BrowseCommand,
  type BrowseState,
} from './state.ts';

function makeLibrary(): Library {
  return {
    charts: [
      makeChart('one-a', 'one/x'),
      makeChart('two-a', 'two/x'),
      makeChart('two-b', 'two/x'),
      makeChart('two-c', 'two/x'),
    ],
    courseFolders: [makeCourseFolder('Dan', [makeCourse('first'), makeCourse('second'), makeCourse('third')])],
  };
}

function run(library: Library, state: BrowseState, ...commands: BrowseCommand[]): BrowseState {
  return commands.reduce((current, command) => reduceBrowse(library, current, command).state, state);
}

describe('captureBrowse / restoreBrowse', () => {
  test('keeps the live cursor at the deepest depth and every parent cursor', () => {
    // beatoraja saved the cursor kept for the folder as it was entered (always 0), so coming back from a play landed on
    // the folder's first bar: the snapshot keeps the live one.
    const library = makeLibrary();
    const state = run(
      library,
      createBrowseState(),
      { type: 'move', delta: 1 },
      { type: 'open' },
      { type: 'move', delta: 2 },
    );
    const snapshot = captureBrowse(library, state);
    expect(snapshot).toMatchObject({ folderPath: ['two'], cursors: [1, 2], focusKey: 'chart:two-c' });
    const { state: restored, restoredDepth } = restoreBrowse(library, snapshot);
    expect(restoredDepth).toBe(1);
    expect(browseFolder(restored)?.label).toBe('two');
    expect(focusedChart(library, restored)?.id).toBe('two-c');
    // Backing out lands on the folder bar the folder was opened from.
    expect(browseCursor(run(library, restored, { type: 'close' }))).toBe(1);
  });

  test('restores a cursor left in a course folder, listed after the chart folders at the root', () => {
    const library = makeLibrary();
    const inDan = run(
      library,
      createBrowseState(),
      { type: 'jump', index: 2 },
      { type: 'open' },
      { type: 'move', delta: 2 },
    );
    const { state } = restoreBrowse(library, captureBrowse(library, inDan));
    expect(focusedCourse(library, state)?.id).toBe('third');
    expect(state.cursors).toEqual([2, 2]);
  });

  test('puts the cursor back on the course bar after a course, over the library the course left behind', () => {
    // The host captures the browse state when a course starts; a NONSTOP run replaces the library with one holding its
    // stitched chart, and the course folders are built again: the course bar is found again by its key.
    const library = makeLibrary();
    const atStart = captureBrowse(
      library,
      run(library, createBrowseState(), { type: 'jump', index: 2 }, { type: 'open' }, { type: 'move', delta: 1 }),
    );
    const after: Library = {
      charts: [...library.charts, makeChart('stitched', 'one/x')],
      courseFolders: [makeCourseFolder('Dan', [makeCourse('first'), makeCourse('second'), makeCourse('third')])],
    };
    const { state } = restoreBrowse(after, atStart);
    expect(focusedCourse(after, state)?.id).toBe('second');
  });

  test('follows the focused bar when the rebuilt library moved it', () => {
    const library = makeLibrary();
    const onTwoB = run(
      library,
      createBrowseState(),
      { type: 'move', delta: 1 },
      { type: 'open' },
      { type: 'move', delta: 1 },
    );
    const rebuilt: Library = {
      charts: [makeChart('two-0', 'two/x'), ...library.charts],
      courseFolders: library.courseFolders,
    };
    const { state } = restoreBrowse(rebuilt, captureBrowse(library, onTwoB));
    expect(focusedChart(rebuilt, state)?.id).toBe('two-b');
    expect(browseCursor(state)).toBe(2);
  });

  test('clamps the saved cursor when the focused bar is gone', () => {
    const library = makeLibrary();
    const onTwoC = run(
      library,
      createBrowseState(),
      { type: 'move', delta: 1 },
      { type: 'open' },
      { type: 'jump', index: 2 },
    );
    const shrunk: Library = { charts: library.charts.slice(0, 2) };
    const { state } = restoreBrowse(shrunk, captureBrowse(library, onTwoC));
    expect(focusedChart(shrunk, state)?.id).toBe('two-a');
  });

  test('stops at a folder that is gone, near where the player was', () => {
    const library = makeLibrary();
    const snapshot = captureBrowse(
      library,
      run(library, createBrowseState(), { type: 'move', delta: 1 }, { type: 'open' }, { type: 'move', delta: 2 }),
    );
    const without: Library = { charts: [makeChart('one-a', 'one/x'), makeChart('three-a', 'three/x')] };
    const { state, restoredDepth } = restoreBrowse(without, snapshot);
    expect(restoredDepth).toBe(0);
    expect(state.path).toEqual([]);
    // The root cursor saved for the folder bar that is gone: the bar now in its place.
    expect(browseCursor(state)).toBe(1);
  });

  test('takes back the search, list options and favourites', () => {
    const library = makeLibrary();
    const state = run(
      library,
      createBrowseState({ favorites: { music: ['m'] } }),
      { type: 'search', text: 'two' },
      { type: 'list', options: { sort: 'TITLE', keysFilter: 'KEYS_7' } },
    );
    const { state: restored } = restoreBrowse(library, JSON.parse(JSON.stringify(captureBrowse(library, state))));
    expect(restored.searchText).toBe('two');
    expect(restored.list).toEqual({ sort: 'TITLE', keysFilter: 'KEYS_7', difficultyFilter: 'ALL' });
    expect(restored.favorites).toEqual({ music: ['m'], charts: [] });
  });
});

describe('restoreBrowse over the cursors a select screen kept', () => {
  test('restores the cursor on the course a select screen left it on, the root cursor on its folder bar', () => {
    const library = makeLibrary();
    const { state } = restoreBrowse(library, { folderPath: ['Dan'], cursors: [0, 2] });
    expect(focusedCourse(library, state)?.id).toBe('third');
    // The root cursor saved (0) pointed at the wrong bar; the model puts it on the Dan folder bar.
    expect(state.cursors).toEqual([2, 2]);
  });

  test('finds a parent cursor the snapshot did not keep', () => {
    const library = makeLibrary();
    const { state, restoredDepth } = restoreBrowse(library, { folderPath: ['two'], cursors: [0, 1] });
    expect(restoredDepth).toBe(1);
    expect(focusedChart(library, state)?.id).toBe('two-b');
    // The saved parent cursor (0) is on the first folder bar; the model backs out onto the folder's.
    expect(browseCursor(run(library, state, { type: 'close' }))).toBe(1);
  });

  test('clamps the cursor to the restored list and reports a folder path that matched nothing', () => {
    const library = makeLibrary();
    expect(browseCursor(restoreBrowse(library, { folderPath: ['Dan'], cursors: [0, 9] }).state)).toBe(2);
    expect(restoreBrowse(library, { folderPath: ['gone'], cursors: [0, 0] }).restoredDepth).toBe(0);
  });
});
