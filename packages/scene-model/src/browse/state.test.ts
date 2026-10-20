import { describe, expect, test } from 'vite-plus/test';
import type { Library, LibraryEntry } from '../library/entries.ts';
import { makeChart, makeChartWith, makeCourse, makeCourseFolder } from '../test-support/library.ts';
import {
  browseCursor,
  browseEntries,
  browseFolder,
  createBrowseState,
  focusedChart,
  focusedCourse,
  focusedEntry,
  isFavorite,
  reduceBrowse,
  wrappedCursorDelta,
  type BrowseCommand,
  type BrowseState,
} from './state.ts';

const labels = (entries: readonly LibraryEntry[]): string[] =>
  entries.map((entry) =>
    entry.kind === 'folder' ? entry.folder.label : entry.kind === 'chart' ? entry.chart.id : entry.course.id,
  );

/** Two chart folders (`Alpha`: a1, a2, a3; `Beta`: b1) and a course folder (`Dan`: first, second, third). */
function makeLibrary(): Library {
  return {
    charts: [
      makeChart('a1', 'Alpha/x', { title: 'Ignition', artist: 'YAMD' }),
      makeChart('a2', 'Alpha/x', { title: 'Sleepless' }),
      makeChart('a3', 'Alpha/y', { title: 'Lapis' }),
      makeChart('b1', 'Beta/z', { title: 'Hikari' }),
    ],
    courseFolders: [makeCourseFolder('Dan', [makeCourse('first'), makeCourse('second'), makeCourse('third 10th')])],
  };
}

/** Applies commands in order and returns the last state. */
function run(library: Library, state: BrowseState, ...commands: BrowseCommand[]): BrowseState {
  return commands.reduce((current, command) => reduceBrowse(library, current, command).state, state);
}

describe('browse list', () => {
  const library = makeLibrary();

  test('lists the chart folders, then the course folders, at the root', () => {
    expect(labels(browseEntries(library, createBrowseState()))).toEqual(['Alpha', 'Beta', 'Dan']);
  });

  test('lists the charts of a chart folder and the courses of a course folder', () => {
    const inAlpha = run(library, createBrowseState(), { type: 'open' });
    expect(labels(browseEntries(library, inAlpha))).toEqual(['a1', 'a2', 'a3']);
    const inDan = run(library, createBrowseState(), { type: 'jump', index: 2 }, { type: 'open' });
    expect(labels(browseEntries(library, inDan))).toEqual(['first', 'second', 'third 10th']);
  });

  test('reuses the list while only the cursor moves', () => {
    const state = createBrowseState();
    const moved = run(library, state, { type: 'move', delta: 1 });
    expect(browseEntries(library, moved)).toBe(browseEntries(library, state));
  });

  test('reads the bar, chart and course under the cursor', () => {
    const root = createBrowseState();
    expect(focusedEntry(library, root)?.kind).toBe('folder');
    // A folder bar is no chart, as beatoraja reads none there (the info panels go blank).
    expect(focusedChart(library, root)).toBeUndefined();
    const inAlpha = run(library, root, { type: 'open' }, { type: 'move', delta: 1 });
    expect(focusedChart(library, inAlpha)?.id).toBe('a2');
    const inDan = run(library, root, { type: 'jump', index: 2 }, { type: 'open' });
    expect(focusedCourse(library, inDan)?.id).toBe('first');
  });
});

describe('cursor', () => {
  const library = makeLibrary();

  test('wraps past either end of the list, and reports the step asked for so a wrap slides the way the key points', () => {
    const last = reduceBrowse(library, createBrowseState(), { type: 'move', delta: -1 });
    expect(browseCursor(last.state)).toBe(2);
    expect(last.event).toEqual({ kind: 'cursor', from: 0, to: 2, delta: -1 });
    const first = reduceBrowse(library, last.state, { type: 'move', delta: 1 });
    expect(browseCursor(first.state)).toBe(0);
    expect(first.event).toEqual({ kind: 'cursor', from: 2, to: 0, delta: 1 });
  });

  test('moves several bars at once modulo the list length', () => {
    expect(browseCursor(run(library, createBrowseState(), { type: 'move', delta: 10 }))).toBe(1);
  });

  test('jumps to a bar clamped to the list, animating the shortest way around', () => {
    const end = reduceBrowse(library, createBrowseState(), { type: 'jump', index: 99 });
    expect(browseCursor(end.state)).toBe(2);
    expect(end.event).toEqual({ kind: 'cursor', from: 0, to: 2, delta: -1 });
    expect(browseCursor(run(library, end.state, { type: 'jump', index: -4 }))).toBe(0);
  });

  test('picks a random bar other than the focused one from the draw it is given', () => {
    const state = createBrowseState();
    expect(browseCursor(run(library, state, { type: 'random', value: 0.99 }))).toBe(2);
    // The draw lands on the focused bar: the next one is taken, so the player sees the cursor move.
    expect(browseCursor(run(library, state, { type: 'random', value: 0.1 }))).toBe(1);
    const alone = { charts: [makeChart('only', 'Solo/x')] };
    expect(reduceBrowse(alone, createBrowseState(), { type: 'random', value: 0.5 }).event).toEqual({ kind: 'none' });
  });

  test('does nothing on an empty list', () => {
    const empty = { charts: [] };
    expect(reduceBrowse(empty, createBrowseState(), { type: 'move', delta: 1 }).event).toEqual({ kind: 'none' });
    expect(reduceBrowse(empty, createBrowseState(), { type: 'jump', index: 3 }).event).toEqual({ kind: 'none' });
  });
});

describe('folders', () => {
  const library = makeLibrary();

  test('opens the focused folder at its first bar and backs out onto the folder bar it was opened from', () => {
    const onBeta = run(library, createBrowseState(), { type: 'move', delta: 1 });
    const opened = reduceBrowse(library, onBeta, { type: 'open' });
    expect(opened.event).toMatchObject({ kind: 'folder-opened', folder: { label: 'Beta' } });
    expect(browseFolder(opened.state)?.label).toBe('Beta');
    expect(opened.state.cursors).toEqual([1, 0]);
    const closed = reduceBrowse(library, opened.state, { type: 'close' });
    expect(closed.event).toMatchObject({ kind: 'folder-closed', folder: { label: 'Beta' } });
    expect(closed.state.path).toEqual([]);
    expect(browseCursor(closed.state)).toBe(1);
  });

  test('backs out of a course folder onto the course folder bar', () => {
    const inDan = run(
      library,
      createBrowseState(),
      { type: 'jump', index: 2 },
      { type: 'open' },
      { type: 'move', delta: 2 },
    );
    expect(browseCursor(run(library, inDan, { type: 'close' }))).toBe(2);
  });

  test('opens nothing from a chart or course bar', () => {
    const inAlpha = run(library, createBrowseState(), { type: 'open' });
    const transition = reduceBrowse(library, inAlpha, { type: 'open' });
    expect(transition.event).toEqual({ kind: 'none' });
    expect(transition.state).toBe(inAlpha);
  });

  test('reports a close at the root, so the screen can leave', () => {
    const transition = reduceBrowse(library, createBrowseState(), { type: 'close' });
    expect(transition.event).toEqual({ kind: 'at-root' });
  });

  test('backs out onto the folder bar wherever a sort changed while the folder was open moved it', () => {
    // Without a sort the root lists the chart folders, then the course folders; a sort orders every folder by label.
    const shuffled: Library = {
      charts: [makeChart('z1', 'Zeta/x'), makeChart('b1', 'Beta/x')],
      courseFolders: [makeCourseFolder('Dan', [makeCourse('first')])],
    };
    const inZeta = run(shuffled, createBrowseState(), { type: 'jump', index: 1 }, { type: 'open' });
    expect(browseFolder(inZeta)?.label).toBe('Zeta');
    const closed = run(shuffled, inZeta, { type: 'list', options: { sort: 'TITLE' } }, { type: 'close' });
    expect(labels(browseEntries(shuffled, closed))).toEqual(['Beta', 'Dan', 'Zeta']);
    expect(browseCursor(closed)).toBe(2);
  });

  test('clamps the parent cursor when the parent list shrank while the folder was open', () => {
    // Open Dan (the third root bar), then search: back at the root the search lists the matching charts only.
    const inDan = run(library, createBrowseState(), { type: 'jump', index: 2 }, { type: 'open' });
    const searched = run(library, inDan, { type: 'search', text: 'ignition' });
    const closed = run(library, searched, { type: 'close' });
    expect(labels(browseEntries(library, closed))).toEqual(['a1']);
    expect(browseCursor(closed)).toBe(0);
  });
});

describe('search', () => {
  const library = makeLibrary();

  test('lists every matching chart of the library at the root, flattened out of the folders', () => {
    const transition = reduceBrowse(library, createBrowseState(), { type: 'search', text: 'i' });
    expect(transition.event).toEqual({ kind: 'list-changed' });
    expect(labels(browseEntries(library, transition.state))).toEqual(['a1', 'a3', 'b1']);
  });

  test('filters the charts of the open folder, and the courses of a course folder by name', () => {
    const inAlpha = run(library, createBrowseState(), { type: 'open' }, { type: 'search', text: 'SLEEP' });
    expect(labels(browseEntries(library, inAlpha))).toEqual(['a2']);
    const inDan = run(
      library,
      createBrowseState(),
      { type: 'jump', index: 2 },
      { type: 'open' },
      { type: 'search', text: '10th' },
    );
    expect(labels(browseEntries(library, inDan))).toEqual(['third 10th']);
  });

  test('searches by the trimmed, lower-cased text and keeps the text as typed', () => {
    const state = run(library, createBrowseState(), { type: 'search', text: '  YAMD ' });
    expect(state.searchText).toBe('  YAMD ');
    expect(labels(browseEntries(library, state))).toEqual(['a1']);
  });

  test('puts the cursor back on top when the query changes, and keeps it when only the spacing does', () => {
    const inAlpha = run(library, createBrowseState(), { type: 'open' }, { type: 'move', delta: 2 });
    const changed = run(library, inAlpha, { type: 'search', text: 'a' });
    expect(browseCursor(changed)).toBe(0);
    const moved = run(library, changed, { type: 'move', delta: 1 });
    const respaced = reduceBrowse(library, moved, { type: 'search', text: 'a ' });
    expect(respaced.event).toEqual({ kind: 'none' });
    expect(browseCursor(respaced.state)).toBe(1);
  });
});

describe('list options', () => {
  const library: Library = {
    charts: [
      makeChartWith('five-hyper', 'Pack/x', { channels: ['11'], difficulty: 3 }, { title: 'Zulu', playLevel: 9 }),
      makeChartWith(
        'seven-normal',
        'Pack/x',
        { channels: ['11', '18'], difficulty: 2 },
        { title: 'Echo', playLevel: 3 },
      ),
      makeChartWith(
        'seven-hyper',
        'Pack/x',
        { channels: ['11', '18'], difficulty: 3 },
        { title: 'Alpha', playLevel: 7 },
      ),
    ],
    courseFolders: [makeCourseFolder('Dan', [makeCourse('seven', {}, 7), makeCourse('five', {}, 5)])],
  };
  const inPack = run(library, createBrowseState(), { type: 'open' });

  test('filters the charts by key mode and difficulty, and the courses by key mode', () => {
    const sevenKeys = run(library, inPack, { type: 'list', options: { keysFilter: 'KEYS_7' } });
    expect(labels(browseEntries(library, sevenKeys))).toEqual(['seven-normal', 'seven-hyper']);
    const hyper = run(library, sevenKeys, { type: 'list', options: { difficultyFilter: 'HYPER' } });
    expect(labels(browseEntries(library, hyper))).toEqual(['seven-hyper']);
    const inDan = run(library, sevenKeys, { type: 'close' }, { type: 'jump', index: 1 }, { type: 'open' });
    expect(labels(browseEntries(library, inDan))).toEqual(['seven']);
  });

  test('keeps every folder bar at the root whatever the filters', () => {
    const filtered = createBrowseState({ list: { keysFilter: 'KEYS_14', difficultyFilter: 'INSANE' } });
    expect(labels(browseEntries(library, filtered))).toEqual(['Pack', 'Dan']);
  });

  test('sorts the list', () => {
    const byTitle = run(library, inPack, { type: 'list', options: { sort: 'TITLE' } });
    expect(labels(browseEntries(library, byTitle))).toEqual(['seven-hyper', 'seven-normal', 'five-hyper']);
    const byLevel = run(library, inPack, { type: 'list', options: { sort: 'LEVEL' } });
    expect(labels(browseEntries(library, byLevel))).toEqual(['seven-normal', 'seven-hyper', 'five-hyper']);
  });

  test('keeps the cursor on the focused bar when it is still listed', () => {
    const onZulu = run(library, inPack, { type: 'jump', index: 0 });
    const sorted = reduceBrowse(library, onZulu, { type: 'list', options: { sort: 'TITLE' } });
    expect(sorted.event).toEqual({ kind: 'list-changed' });
    expect(focusedChart(library, sorted.state)?.id).toBe('five-hyper');
    expect(browseCursor(sorted.state)).toBe(2);
  });

  test('keeps the cursor on its row, clamped, when the focused bar is filtered out', () => {
    const onLast = run(library, inPack, { type: 'jump', index: 2 });
    const filtered = run(library, onLast, { type: 'list', options: { keysFilter: 'KEYS_5' } });
    expect(browseCursor(filtered)).toBe(0);
    expect(focusedChart(library, filtered)?.id).toBe('five-hyper');
  });

  test('does nothing when the options do not change', () => {
    const transition = reduceBrowse(library, inPack, { type: 'list', options: { sort: 'OFF' } });
    expect(transition.event).toEqual({ kind: 'none' });
    expect(transition.state).toBe(inPack);
  });
});

describe('favourites', () => {
  const library = makeLibrary();

  test('marks and unmarks the focused chart in either list', () => {
    const inAlpha = run(library, createBrowseState(), { type: 'open' }, { type: 'move', delta: 1 });
    const marked = reduceBrowse(library, inAlpha, { type: 'favorite', list: 'charts' });
    expect(marked.event).toEqual({ kind: 'favorite', chartId: 'a2', list: 'charts', favorite: true });
    expect(isFavorite(marked.state, 'a2', 'charts')).toBe(true);
    expect(isFavorite(marked.state, 'a2', 'music')).toBe(false);
    const music = run(library, marked.state, { type: 'favorite', list: 'music' });
    expect(music.favorites).toEqual({ music: ['a2'], charts: ['a2'] });
    const unmarked = run(library, music, { type: 'favorite', list: 'charts' });
    expect(unmarked.favorites).toEqual({ music: ['a2'], charts: [] });
  });

  test('marks nothing on a folder bar', () => {
    expect(reduceBrowse(library, createBrowseState(), { type: 'favorite', list: 'charts' }).event).toEqual({
      kind: 'none',
    });
  });
});

describe('createBrowseState', () => {
  test('starts at the top of the root list with the given search, list options and favourites', () => {
    const state = createBrowseState({ searchText: 'x', list: { sort: 'LEVEL' }, favorites: { charts: ['c'] } });
    expect(state.path).toEqual([]);
    expect(state.cursors).toEqual([0]);
    expect(state.searchText).toBe('x');
    expect(state.list).toEqual({ sort: 'LEVEL', keysFilter: 'ALL', difficultyFilter: 'ALL' });
    expect(state.favorites).toEqual({ music: [], charts: ['c'] });
  });

  test('never changes the state a command is given', () => {
    const library = makeLibrary();
    const state = createBrowseState();
    const frozen = JSON.stringify(state);
    run(library, state, { type: 'move', delta: 1 }, { type: 'open' }, { type: 'search', text: 'a' });
    reduceBrowse(library, state, { type: 'open' });
    expect(JSON.stringify(state)).toBe(frozen);
  });
});

describe('wrappedCursorDelta', () => {
  test('returns 0 for an empty list', () => {
    expect(wrappedCursorDelta(0, 0)).toBe(0);
    expect(wrappedCursorDelta(5, 0)).toBe(0);
  });

  test('passes short trips through unchanged', () => {
    expect(wrappedCursorDelta(1, 10)).toBe(1);
    expect(wrappedCursorDelta(-1, 10)).toBe(-1);
    expect(wrappedCursorDelta(3, 10)).toBe(3);
    expect(wrappedCursorDelta(-4, 10)).toBe(-4);
  });

  test('collapses long forward jumps to a backward step and vice versa', () => {
    expect(wrappedCursorDelta(9, 10)).toBe(-1);
    expect(wrappedCursorDelta(-9, 10)).toBe(1);
    expect(wrappedCursorDelta(8, 10)).toBe(-2);
  });

  test('keeps the direction of the key on rings of two and three bars', () => {
    expect(wrappedCursorDelta(1, 2)).toBe(1);
    expect(wrappedCursorDelta(-1, 2)).toBe(-1);
    expect(wrappedCursorDelta(1, 3)).toBe(1);
    expect(wrappedCursorDelta(-1, 3)).toBe(-1);
    expect(wrappedCursorDelta(-2, 3)).toBe(1);
    expect(wrappedCursorDelta(2, 3)).toBe(-1);
  });
});
