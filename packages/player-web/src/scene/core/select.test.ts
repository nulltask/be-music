import { createEmptyJson } from '@be-music/json';
import { describe, expect, it } from 'vite-plus/test';
import {
  CoreSongSelectView,
  cycleSkinPlayOptionValue,
  DEFAULT_PLAY_OPTIONS,
  HISPEED_MAX,
  resolveSelectNavigation,
  resolveSkinPlayOptionValue,
} from './select.ts';
import type { PixiPlayOptions } from './select.ts';
import type {
  BrowserBrowseEntry,
  BrowserCourseEntry,
  BrowserFolderNode,
  BrowserSongEntry,
} from '../../collection/types.ts';

/**
 * Builds a minimal `BrowserSongEntry` for tests: placeholder values that satisfy the type. The search, sort and cursor
 * rules the scene uses are tested with the browse model in `@be-music/scene-model`.
 */
function makeSongEntry(overrides: Partial<BrowserSongEntry>): BrowserBrowseEntry {
  const song: BrowserSongEntry = {
    id: 'test:song',
    sourceId: 'test',
    sourceLabel: 'test',
    sourceKind: 'files',
    chartPath: 'test/song.bms',
    directoryLabel: 'test',
    fileLabel: 'song.bms',
    title: 'Untitled',
    totalNotes: 0,
    chart: createEmptyJson(),
    ...overrides,
  };
  return { kind: 'song', song };
}

describe('DEFAULT_PLAY_OPTIONS', () => {
  it('seeds LR2-style visual options for the first gameplay mount', () => {
    expect(DEFAULT_PLAY_OPTIONS.hiSpeed).toBe(2.0);
    expect(DEFAULT_PLAY_OPTIONS.bga).toBe('ON');
    expect(DEFAULT_PLAY_OPTIONS.bgaSize).toBe('EXTEND');
    expect(DEFAULT_PLAY_OPTIONS.scoreGraph).toBe(true);
    expect(DEFAULT_PLAY_OPTIONS.gauge1P).toBe('GROOVE');
    expect(DEFAULT_PLAY_OPTIONS.gauge2P).toBe('GROOVE');
  });
});

describe('resolveSkinPlayOptionValue', () => {
  it("accepts a value from the option's choices", () => {
    expect(resolveSkinPlayOptionValue('random1P', 'MIRROR')).toBe('MIRROR');
    expect(resolveSkinPlayOptionValue('autoScratch1P', true)).toBe(true);
    expect(resolveSkinPlayOptionValue('sort', 'LEVEL')).toBe('LEVEL');
  });

  it("rejects a value outside the option's choices", () => {
    expect(resolveSkinPlayOptionValue('random1P', 'R-RANDOM')).toBeUndefined();
    expect(resolveSkinPlayOptionValue('autoScratch1P', 1)).toBeUndefined();
    expect(resolveSkinPlayOptionValue('gauge1P', undefined)).toBeUndefined();
  });

  it('clamps the numeric options and rejects non-finite or non-numeric values', () => {
    expect(resolveSkinPlayOptionValue('hiSpeed', 99)).toBe(HISPEED_MAX);
    expect(resolveSkinPlayOptionValue('hiSpeed', 2.5)).toBe(2.5);
    expect(resolveSkinPlayOptionValue('shutter', -1)).toBe(0);
    expect(resolveSkinPlayOptionValue('shutter', Number.NaN)).toBeUndefined();
    expect(resolveSkinPlayOptionValue('hiSpeed', '3')).toBeUndefined();
  });

  it('rejects keys that are not play options', () => {
    // A skin is plain JavaScript at runtime: an unknown key must not grow the play-option object.
    expect(resolveSkinPlayOptionValue('bogus' as keyof PixiPlayOptions, 3)).toBeUndefined();
    expect(resolveSkinPlayOptionValue('toString' as keyof PixiPlayOptions, 3)).toBeUndefined();
  });
});

describe('cycleSkinPlayOptionValue', () => {
  it('moves forward and wraps past the last choice', () => {
    expect(cycleSkinPlayOptionValue('gauge1P', 'GROOVE')).toBe('HARD');
    expect(cycleSkinPlayOptionValue('gauge1P', 'EASY', 1)).toBe('GROOVE');
    expect(cycleSkinPlayOptionValue('dpFlip', false)).toBe(true);
  });

  it('moves backwards with step -1 and wraps past the first choice', () => {
    expect(cycleSkinPlayOptionValue('gauge1P', 'HARD', -1)).toBe('GROOVE');
    expect(cycleSkinPlayOptionValue('gauge1P', 'GROOVE', -1)).toBe('EASY');
    expect(cycleSkinPlayOptionValue('random1P', 'OFF', -1)).toBe('SCATTER');
  });

  it('treats any other step as one choice in its direction', () => {
    expect(cycleSkinPlayOptionValue('gauge1P', 'GROOVE', 3)).toBe('HARD');
    expect(cycleSkinPlayOptionValue('gauge1P', 'GROOVE', -5)).toBe('EASY');
  });

  it('lands on the first choice when the current value is not one of them', () => {
    expect(cycleSkinPlayOptionValue('bga', 'BOGUS' as PixiPlayOptions['bga'])).toBe('OFF');
  });

  it('leaves numeric options and unknown keys alone', () => {
    expect(cycleSkinPlayOptionValue('hiSpeed', DEFAULT_PLAY_OPTIONS.hiSpeed)).toBeUndefined();
    expect(cycleSkinPlayOptionValue('shutter', DEFAULT_PLAY_OPTIONS.shutter, -1)).toBeUndefined();
    expect(cycleSkinPlayOptionValue('bogus' as keyof PixiPlayOptions, 0 as never)).toBeUndefined();
  });
});

describe('resolveSelectNavigation', () => {
  const song = (id: string, directoryLabel: string): BrowserSongEntry =>
    (makeSongEntry({ id, directoryLabel }) as { song: BrowserSongEntry }).song;
  const songs = [song('a', 'pack'), song('b', 'pack'), song('c', 'other')];
  const courses = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] as unknown as BrowserCourseEntry[];
  const collection = { songs, courseFolders: [{ label: 'my courses', songs: [], courses }] };

  it('restores a cursor inside a song folder', () => {
    const resolved = resolveSelectNavigation(collection, { folderPath: ['pack'], selectedIndex: 1 });
    expect(resolved?.stack.map((folder) => folder.label)).toEqual(['pack']);
    expect(resolved?.selectedIndex).toBe(1);
  });

  it('restores a cursor inside a course folder, clamped to its courses', () => {
    // A NONSTOP run replaces the collection, so coming back from it restores the cursor on its course bar this way.
    const resolved = resolveSelectNavigation(collection, { folderPath: ['my courses'], selectedIndex: 2 });
    expect(resolved?.stack.map((folder) => folder.label)).toEqual(['my courses']);
    expect(resolved?.selectedIndex).toBe(2);
    expect(resolveSelectNavigation(collection, { folderPath: ['my courses'], selectedIndex: 9 })?.selectedIndex).toBe(
      2,
    );
  });

  it('counts the course folders among the root bars', () => {
    // Root: 'other', 'pack', then 'my courses'.
    expect(resolveSelectNavigation(collection, { folderPath: [], selectedIndex: 2 })?.selectedIndex).toBe(2);
  });

  it('gives up when no saved folder matches', () => {
    expect(resolveSelectNavigation(collection, { folderPath: ['gone'], selectedIndex: 0 })).toBeUndefined();
  });
});

describe('CoreSongSelectView course bars', () => {
  const course = (playable: boolean): BrowserCourseEntry =>
    ({
      id: 'dan#0',
      definition: { name: 'Dan', kind: 'grade', stages: [], constraints: [], trophies: [] },
      stages: [{ title: 'a' }],
      playable,
    }) as unknown as BrowserCourseEntry;

  type CourseBarView = {
    browseStack: BrowserFolderNode[];
    selectedIndex: number;
    activateEntry(entry: BrowserBrowseEntry): void;
    launchFocusedSong(autoPlay: boolean): void;
  };

  /** A view (not mounted, so nothing renders) with the cursor on `entry` inside its course folder. */
  function viewOnCourse(entry: BrowserCourseEntry, options: ConstructorParameters<typeof CoreSongSelectView>[0]) {
    const view = new CoreSongSelectView(options) as unknown as CourseBarView;
    view.browseStack = [{ label: 'Dan', songs: [], courses: [entry] }];
    view.selectedIndex = 0;
    return view;
  }

  it('hands a course with a missing stage to the host, which says why it does not start', () => {
    const selected: BrowserCourseEntry[] = [];
    const missing = course(false);
    const view = viewOnCourse(missing, { onCourseSelected: (picked) => selected.push(picked) });
    view.activateEntry({ kind: 'course', course: missing });
    view.launchFocusedSong(false);
    expect(selected).toEqual([missing, missing]);
  });
});
