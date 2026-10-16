import { describe, expect, it } from 'vite-plus/test';
import type { CoreSongSelectViewOptions } from '../../scene/core/select.ts';
import { SelectSession, type SelectSessionContext } from './select-session.ts';
import { makeChart, makeCollection, makeCourse, makeCourseFolder } from './test-support.ts';

/** A session on a scene that draws nothing, recording the cues it plays. */
function createSession(options: CoreSongSelectViewOptions = {}): { session: SelectSession; cues: string[] } {
  const cues: string[] = [];
  const ctx: SelectSessionContext = {
    options,
    disposed: false,
    themeDesignSize: undefined,
    beMusicRenderer: undefined,
    beMusicNeedsFrame: false,
    songImages: undefined,
    render: () => {},
    refreshChartPreview: () => {},
    noteCursorChange: () => {},
    playOneShotSound: async (name) => {
      cues.push(name);
    },
    applyLr2Timers: () => {},
  };
  return { session: new SelectSession(ctx), cues };
}

function titles(session: SelectSession): string[] {
  return session.currentEntries().map((entry) => (entry.kind === 'song' ? entry.song.title : entry.kind));
}

/** The bar under the cursor: a chart's title, a folder's label or a course's name. */
function focusedTitle(session: SelectSession): string | undefined {
  const entry = session.focusedEntry();
  if (entry === undefined) return undefined;
  if (entry.kind === 'song') return entry.song.title;
  return entry.kind === 'folder' ? entry.folder.label : entry.course.definition.name;
}

/** Two chart folders (`other`, `pack`) and a course folder, listed in that order at the root. */
function makeLibrary() {
  return makeCollection(
    [
      makeChart('a', 'pack', { playLevel: 3 }),
      makeChart('b', 'pack', { playLevel: 1 }),
      makeChart('c', 'pack', { playLevel: 2 }),
      makeChart('x', 'other'),
    ],
    [makeCourseFolder('courses', [makeCourse('one'), makeCourse('two'), makeCourse('three')])],
  );
}

describe('SelectSession key filter', () => {
  it('lists a 24-key chart under no key filter of LR2’s, rather than folding it onto 7 or 14 keys', () => {
    const { session } = createSession();
    session.setCollection(
      makeCollection([
        makeChart('seven', 'pack', { channels: ['11', '18'] }),
        makeChart('fourteen', 'pack', { channels: ['11', '21', '28'] }),
        makeChart('keyboard', 'pack', { modeHint: 'keyboard-24k' }),
        makeChart('keyboard double', 'pack', { modeHint: 'keyboard-24k-double' }),
      ]),
    );
    session.setPlayOptions({ keysFilter: 'KEYS_7' });
    expect(titles(session)).toEqual(['seven']);
    session.setPlayOptions({ keysFilter: 'KEYS_14' });
    expect(titles(session)).toEqual(['fourteen']);
    session.setPlayOptions({ keysFilter: 'ALL' });
    expect(titles(session)).toEqual(['seven', 'fourteen', 'keyboard', 'keyboard double']);
  });
});

describe('SelectSession browse position', () => {
  it('restores a cursor inside a chart folder', () => {
    const { session } = createSession();
    session.setCollection(makeLibrary());
    session.setNavigation({ folderPath: ['pack'], cursors: [1, 1] });
    expect(session.browseStack.map((folder) => folder.label)).toEqual(['pack']);
    expect(focusedTitle(session)).toBe('b');
  });

  it('restores a cursor inside a course folder, clamped to its courses', () => {
    const { session } = createSession();
    session.setCollection(makeLibrary());
    session.setNavigation({ folderPath: ['courses'], cursors: [2, 9] });
    expect(session.browseStack.map((folder) => folder.label)).toEqual(['courses']);
    expect(focusedTitle(session)).toBe('three');
  });

  it('counts the course folders among the root bars', () => {
    const { session } = createSession();
    session.setCollection(makeLibrary());
    session.setNavigation({ folderPath: [], cursors: [2] });
    expect(focusedTitle(session)).toBe('courses');
  });

  it('gives the position back as a snapshot it restores', () => {
    const { session } = createSession();
    session.setCollection(makeLibrary());
    session.setNavigation({ folderPath: ['pack'], cursors: [1, 2] });
    const snapshot = session.getNavigation();
    expect(snapshot).toMatchObject({ folderPath: ['pack'], focusKey: 'chart:c' });
    const { session: other } = createSession({ initialNavigation: snapshot });
    other.setCollection(makeLibrary());
    expect(other.browseStack.map((folder) => folder.label)).toEqual(['pack']);
    expect(focusedTitle(other)).toBe('c');
  });

  it('opens a library of one chart folder when it has no position to restore', () => {
    const { session } = createSession();
    session.setCollection(makeCollection([makeChart('a', 'pack'), makeChart('b', 'pack')]));
    expect(session.browseStack.map((folder) => folder.label)).toEqual(['pack']);
    expect(focusedTitle(session)).toBe('a');
  });

  it('stays at the root, silently, on a back-out there', () => {
    const { session, cues } = createSession();
    session.setCollection(makeLibrary());
    expect(session.leaveFolder()).toBe(false);
    expect(cues).toEqual([]);
    session.activateFocused();
    expect(session.leaveFolder()).toBe(true);
    expect(cues).toEqual(['folder-open', 'folder-close']);
  });
});

describe('SelectSession list options', () => {
  it('keeps the cursor on the focused bar when the player changes the sort', () => {
    const { session, cues } = createSession();
    session.setCollection(makeLibrary());
    session.setNavigation({ folderPath: ['pack'], cursors: [1, 2] });
    expect(focusedTitle(session)).toBe('c');
    session.setPlayOption('sort', 'LEVEL');
    expect(titles(session)).toEqual(['b', 'c', 'a']);
    expect(focusedTitle(session)).toBe('c');
    expect(cues).toEqual(['option-change']);
  });

  it('keeps the cursor on the focused bar when the host changes the sort or a filter', () => {
    const { session } = createSession();
    session.setCollection(makeLibrary());
    session.setNavigation({ folderPath: ['pack'], cursors: [1, 0] });
    session.setPlayOptions({ sort: 'LEVEL' });
    expect(focusedTitle(session)).toBe('a');
    session.setPlayOptions({ keysFilter: 'KEYS_7' });
    expect(focusedTitle(session)).toBe('a');
  });

  it('keeps the cursor on the focused bar through a filter, and on its row when the filter takes the bar out', () => {
    const { session } = createSession();
    session.setCollection(
      makeCollection([
        makeChart('beginner', 'pack', { difficulty: 1 }),
        makeChart('normal', 'pack', { difficulty: 2 }),
        makeChart('hyper', 'pack', { difficulty: 3 }),
        makeChart('another', 'pack', { difficulty: 4 }),
      ]),
    );
    session.setNavigation({ folderPath: ['pack'], cursors: [0, 2] });
    session.cyclePlayOption('difficultyFilter', ['ALL', 'HYPER']);
    expect(titles(session)).toEqual(['hyper']);
    expect(focusedTitle(session)).toBe('hyper');
    session.setPlayOption('difficultyFilter', 'ALL');
    expect(focusedTitle(session)).toBe('hyper');
    session.stepCursor(1);
    session.setPlayOption('difficultyFilter', 'NORMAL');
    // `another` is not a NORMAL chart: the cursor stays on the row it was on, clamped to the one bar listed.
    expect(focusedTitle(session)).toBe('normal');
  });
});

describe('SelectSession restore', () => {
  it('puts the parent cursor on the bar of the folder opened, so backing out lands on it', () => {
    const { session } = createSession();
    session.setCollection(makeLibrary());
    // A snapshot that saved no parent cursor (a drop opening its folder) still backs out onto the folder.
    session.setNavigation({ folderPath: ['pack'], cursors: [0, 0] });
    session.leaveFolder();
    expect(focusedTitle(session)).toBe('pack');
    session.setNavigation({ folderPath: ['courses'], cursors: [0, 1] });
    session.leaveFolder();
    expect(focusedTitle(session)).toBe('courses');
  });

  it('restores nothing when the saved folder is gone', () => {
    const { session } = createSession();
    session.setCollection(makeLibrary());
    session.setNavigation({ folderPath: [], cursors: [1] });
    session.setNavigation({ folderPath: ['gone'], cursors: [2, 0] });
    expect(session.browseStack).toEqual([]);
    expect(focusedTitle(session)).toBe('pack');
  });
});
