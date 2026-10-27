import { describe, expect, it, test } from 'vite-plus/test';
import {
  browseEntryBadge,
  browseEntryCount,
  browseEntryTitle,
  describeCourseCard,
  selectListRows,
} from './select-list.ts';
import type { LibraryChart, LibraryCourse } from './chart.ts';

const entries = Array.from({ length: 20 }, (_, index) => index);

describe('selectListRows', () => {
  it('is exactly the window at rest', () => {
    expect(selectListRows({ entries, firstVisibleIndex: 5, visibleRows: 3, listScroll: 0 }, 30)).toEqual([
      { entryIndex: 5, slot: 0, alpha: 1 },
      { entryIndex: 6, slot: 1, alpha: 1 },
      { entryIndex: 7, slot: 2, alpha: 1 },
    ]);
    expect(selectListRows({ entries, firstVisibleIndex: 5, visibleRows: 3 }, 30)).toHaveLength(3);
  });

  it('moves the rows up and slides the next one in while pulled toward later entries', () => {
    expect(selectListRows({ entries, firstVisibleIndex: 5, visibleRows: 3, listScroll: 15 }, 30)).toEqual([
      { entryIndex: 5, slot: -0.5, alpha: 0.5 },
      { entryIndex: 6, slot: 0.5, alpha: 1 },
      { entryIndex: 7, slot: 1.5, alpha: 1 },
      { entryIndex: 8, slot: 2.5, alpha: 0.5 },
    ]);
  });

  it('moves the rows down and slides the previous one in while pulled toward earlier entries', () => {
    const rows = selectListRows({ entries, firstVisibleIndex: 5, visibleRows: 3, listScroll: -6 }, 30);
    expect(rows.map((row) => row.entryIndex)).toEqual([4, 5, 6, 7]);
    expect(rows[0]!.slot).toBeCloseTo(-0.8);
    expect(rows[0]!.alpha).toBeCloseTo(0.2);
    expect(rows[3]!.alpha).toBeCloseTo(0.8);
  });

  it('leaves out rows past either end of the list', () => {
    expect(
      selectListRows({ entries, firstVisibleIndex: 0, visibleRows: 3, listScroll: -10 }, 30).map((r) => r.entryIndex),
    ).toEqual([0, 1, 2]);
    expect(
      selectListRows({ entries: [0, 1], firstVisibleIndex: 0, visibleRows: 3, listScroll: 0 }, 30).map(
        (r) => r.entryIndex,
      ),
    ).toEqual([0, 1]);
  });

  it('holds the pull under one row', () => {
    const rows = selectListRows({ entries, firstVisibleIndex: 5, visibleRows: 3, listScroll: 90 }, 30);
    expect(rows[0]).toEqual({ entryIndex: 6, slot: 0, alpha: 1 });
  });
});

describe('browse entry row text', () => {
  const chart = {
    id: 's',
    sourceId: 'd',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: 's.bms',
    directoryLabel: 'pack',
    fileLabel: 's.bms',
    title: 'Song',
    playLevel: 12,
    totalNotes: 10,
    chart: {},
  } as unknown as LibraryChart;
  const course = {
    id: 'dan#0',
    definition: { name: 'Dan', kind: 'grade' },
    stages: [{ title: 'Song', chart }, { title: 'Gone' }],
    playable: false,
  } as unknown as LibraryCourse;

  test('titles, counts and badges for charts, folders, course folders and courses', () => {
    expect(browseEntryTitle({ kind: 'chart', chart })).toBe('Song');
    expect(browseEntryCount({ kind: 'chart', chart })).toBeUndefined();
    expect(browseEntryBadge({ kind: 'chart', chart })).toBe('12');
    const folder = { label: 'pack', charts: [chart] };
    expect(browseEntryTitle({ kind: 'folder', folder })).toBe('pack');
    expect(browseEntryCount({ kind: 'folder', folder })).toBe('1 chart');
    expect(browseEntryBadge({ kind: 'folder', folder })).toBe('DIR');
    expect(browseEntryCount({ kind: 'folder', folder: { label: 'dan', charts: [], courses: [course, course] } })).toBe(
      '2 courses',
    );
    expect(browseEntryTitle({ kind: 'course', course })).toBe('Dan');
    expect(browseEntryCount({ kind: 'course', course })).toBe('2 stages · 1 missing');
    expect(browseEntryBadge({ kind: 'course', course })).toBe('DAN');
    expect(
      browseEntryBadge({ kind: 'course', course: { ...course, definition: { ...course.definition, kind: 'expert' } } }),
    ).toBe('CRS');
    const random = {
      ...course,
      stages: [{ title: 'level = 12' }, { title: 'RANDOM' }],
      random: {},
      playable: true,
    } as unknown as LibraryCourse;
    expect(browseEntryCount({ kind: 'course', course: random })).toBe('2 stages · random');
    const newCourse = { ...course, stages: [], newCourse: true } as unknown as LibraryCourse;
    expect(browseEntryCount({ kind: 'course', course: newCourse })).toBe('make a course');
    expect(browseEntryBadge({ kind: 'course', course: newCourse })).toBe('NEW');
    expect(describeCourseCard(newCourse)).toEqual({ title: 'Dan', detail: 'make a course', stages: [] });
    const randomMix = { ...course, stages: [], randomMix: true } as unknown as LibraryCourse;
    expect(browseEntryCount({ kind: 'course', course: randomMix })).toBe('draw a course');
    expect(browseEntryBadge({ kind: 'course', course: randomMix })).toBe('RND');
    expect(describeCourseCard(randomMix)).toEqual({ title: 'Dan', detail: 'draw a course', stages: [] });
    expect(describeCourseCard(course)).toEqual({
      title: 'Dan',
      detail: 'DAN · 2 stages · 1 missing',
      stages: course.stages.map((stage) => stage.title),
    });
    expect(describeCourseCard(random).detail).toBe('RANDOM COURSE · 2 stages · random');
    // The player's record on the course adds its best lamp and trophy; a course never played adds nothing.
    expect(describeCourseCard(course, { lamp: 'EX_HARD', trophy: 'goldmedal' }).detail).toBe(
      'DAN · 2 stages · 1 missing · EX HARD · goldmedal',
    );
    expect(describeCourseCard(course, { lamp: 'NO_PLAY' }).detail).toBe('DAN · 2 stages · 1 missing');
    expect(
      browseEntryCount({
        kind: 'folder',
        folder: { label: 'mine', charts: [], courses: [course, newCourse, randomMix] },
      }),
    ).toBe('1 course');
  });
});
