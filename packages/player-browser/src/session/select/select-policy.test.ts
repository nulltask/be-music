import { browseCursor, captureBrowse, createBrowseState } from '@be-music/player-scene-model';
import { describe, expect, it } from 'vite-plus/test';
import { openLibrary, restoreSelectBrowse, SELECT_POLICIES } from './select-policy.ts';
import { makeChart, makeCollection, makeCourse, makeCourseFolder } from './test-support.ts';

const LR2 = SELECT_POLICIES.lr2;
const BEATORAJA = SELECT_POLICIES.beatoraja;

describe('SELECT_POLICIES', () => {
  it('has the built-in screens follow LR2, and beatoraja leave at the root', () => {
    expect(SELECT_POLICIES['built-in']).toEqual(LR2);
    expect(LR2).toEqual({
      atRoot: 'stay',
      openSingleFolder: true,
      listOptions: 'play-options',
      keys: 'lr2',
      folderCursorCue: true,
    });
    expect(BEATORAJA).toEqual({
      atRoot: 'exit',
      openSingleFolder: false,
      listOptions: 'browse',
      keys: 'beatoraja',
      folderCursorCue: false,
    });
  });
});

describe('openLibrary', () => {
  const courses = makeCourseFolder('courses', [makeCourse('dan')]);

  it('opens the one chart folder of a library, course folders aside', () => {
    const library = makeCollection([makeChart('a', 'pack'), makeChart('b', 'pack')], [courses]);
    const state = openLibrary(library, LR2, { searchText: 'a' });
    expect(state.path.map((folder) => folder.label)).toEqual(['pack']);
    expect(state.cursors).toEqual([0, 0]);
    expect(state.searchText).toBe('a');
  });

  it('stays at the root of a library of several chart folders, or under a policy that does not open one', () => {
    const several = makeCollection([makeChart('a', 'one'), makeChart('b', 'two')]);
    expect(openLibrary(several, LR2).path).toEqual([]);
    const single = makeCollection([makeChart('a', 'pack')]);
    expect(openLibrary(single, BEATORAJA).path).toEqual([]);
  });

  it('stays at the root of an empty library', () => {
    expect(openLibrary(makeCollection([]), LR2)).toEqual(createBrowseState());
  });
});

describe('restoreSelectBrowse', () => {
  const library = makeCollection(
    [makeChart('a', 'pack'), makeChart('b', 'pack'), makeChart('c', 'other')],
    [makeCourseFolder('courses', [makeCourse('dan')])],
  );

  it('keeps the list options in force when the play options hold them, and takes the snapshot’s otherwise', () => {
    const current = createBrowseState({ list: { sort: 'TITLE' } });
    const snapshot = { folderPath: ['pack'], cursors: [1, 0], list: { sort: 'LEVEL' as const } };
    expect(restoreSelectBrowse(library, snapshot, current, LR2).state.list.sort).toBe('TITLE');
    expect(restoreSelectBrowse(library, snapshot, current, BEATORAJA).state.list.sort).toBe('LEVEL');
    const { list: _list, ...noList } = snapshot;
    expect(restoreSelectBrowse(library, noList, current, BEATORAJA).state.list.sort).toBe('TITLE');
  });

  it('keeps the search in force when the snapshot names none', () => {
    const current = createBrowseState({ searchText: 'Fixture' });
    expect(restoreSelectBrowse(library, { folderPath: [], cursors: [0] }, current, LR2).state.searchText).toBe(
      'Fixture',
    );
    expect(
      restoreSelectBrowse(library, { folderPath: [], cursors: [0], searchText: '' }, current, LR2).state.searchText,
    ).toBe('');
  });

  it('restores a position it captured', () => {
    const current = restoreSelectBrowse(library, { folderPath: ['pack'], cursors: [1, 1] }, createBrowseState(), LR2);
    const again = restoreSelectBrowse(library, captureBrowse(library, current.state), createBrowseState(), LR2);
    expect(again.restoredDepth).toBe(1);
    expect(browseCursor(again.state)).toBe(1);
  });
});
