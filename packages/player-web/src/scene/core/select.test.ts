import { createEmptyJson } from '@be-music/json';
import { describe, expect, it } from 'vite-plus/test';
import { CoreSongSelectView, resolveSelectNavigation } from './select.ts';
import type {
  BrowserBrowseEntry,
  BrowserCourseEntry,
  BrowserFolderNode,
  BrowserSongEntry,
} from '../../collection/types.ts';

/**
 * Builds a minimal `BrowserSongEntry` for tests: placeholder values that satisfy the type. The search, sort, cursor and
 * play-option rules the scene uses are tested with the browse and play options models in `@be-music/scene-model`.
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
    session: { browseStack: BrowserFolderNode[] };
    selectedIndex: number;
    activateEntry(entry: BrowserBrowseEntry): void;
    launchFocusedSong(autoPlay: boolean): void;
  };

  /** A view (not mounted, so nothing renders) with the cursor on `entry` inside its course folder. */
  function viewOnCourse(entry: BrowserCourseEntry, options: ConstructorParameters<typeof CoreSongSelectView>[0]) {
    const view = new CoreSongSelectView(options) as unknown as CourseBarView;
    view.session.browseStack = [{ label: 'Dan', songs: [], courses: [entry] }];
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
