import { createEmptyJSON } from '@be-music/chart-source';
import type { CourseDefinition } from '@be-music/player-engine/course';
import { describe, expect, it } from 'vite-plus/test';
import type { LibraryChart, LibraryCourse } from '../library/entries.ts';
import { resolveCourseView, scrollCourseStages, type CourseView } from './course-view.ts';

function chart(title: string, extra: Partial<LibraryChart> = {}): LibraryChart {
  return { id: title, title, chart: createEmptyJSON('bms'), ...extra } as LibraryChart;
}

const definition = {
  kind: 'grade',
  name: 'Dan 1',
  stages: [],
  constraints: [],
  trophies: [],
} as unknown as CourseDefinition;

describe('resolveCourseView', () => {
  it('lists the stage charts with their subtitle and level', () => {
    const course: LibraryCourse = {
      id: 'dan#0',
      definition,
      stages: [
        { title: 'A', chart: chart('A', { subtitle: '[SPA]', playLevel: 12 }) },
        { title: 'B', chart: chart('B', { playLevel: '★3' }) },
        { title: 'C', chart: chart('C', { playLevel: '7' }) },
      ],
      playable: true,
    };
    expect(resolveCourseView(course, 1)).toEqual({
      kind: 'grade',
      title: 'Dan 1',
      stages: [{ title: 'A', subtitle: '[SPA]', level: 12 }, { title: 'B' }, { title: 'C', level: 7 }],
      stageIndex: 1,
    });
  });

  it('carries each stage chart’s artist and genre', () => {
    const course: LibraryCourse = {
      id: 'dan#0',
      definition,
      stages: [{ title: 'A', chart: chart('A', { artist: 'Composer', genre: 'TECHNO' }) }],
      playable: true,
    };
    expect(resolveCourseView(course).stages).toEqual([{ title: 'A', artist: 'Composer', genre: 'TECHNO' }]);
  });

  it('carries each stage chart’s difficulty', () => {
    const hyper = chart('H');
    hyper.chart.metadata.difficulty = 3;
    const course: LibraryCourse = {
      id: 'dan#0',
      definition,
      stages: [{ title: 'H', chart: hyper }],
      playable: true,
    };
    expect(resolveCourseView(course).stages).toEqual([{ title: 'H', difficulty: 3 }]);
  });

  it("lists a NONSTOP course's connections", () => {
    const nonstop = {
      ...definition,
      kind: 'nonstop',
      connections: ['fade', 'cut-fit'],
      source: { format: 'beatoraja-json' },
    } as unknown as CourseDefinition;
    const course: LibraryCourse = { id: 'ns#0', definition: nonstop, stages: [{ title: 'A' }], playable: false };
    expect(resolveCourseView(course).connections).toEqual(['fade', 'cut-fit']);
  });

  it("keeps the course file's title for a missing stage and leaves the stage index out on select", () => {
    const course: LibraryCourse = { id: 'dan#0', definition, stages: [{ title: 'NOT FOUND' }], playable: false };
    expect(resolveCourseView(course)).toEqual({ kind: 'grade', title: 'Dan 1', stages: [{ title: 'NOT FOUND' }] });
  });
});

describe('scrollCourseStages', () => {
  const view = (count: number, stageIndex?: number): CourseView => ({
    kind: 'expert',
    title: 'Mix',
    stages: Array.from({ length: count }, (_, index) => ({ title: `S${index + 1}` })),
    ...(stageIndex !== undefined ? { stageIndex } : {}),
  });
  const titles = (course: CourseView) => course.stages.map((stage) => stage.title);

  it('scrolls up one stage per step until the last stage is on the bottom row, then starts over', () => {
    const course = view(7);
    expect(scrollCourseStages(course, 0, 5)).toBe(course);
    expect(titles(scrollCourseStages(course, 1999, 5))[0]).toBe('S1');
    expect(titles(scrollCourseStages(course, 2000, 5)).slice(0, 5)).toEqual(['S2', 'S3', 'S4', 'S5', 'S6']);
    expect(titles(scrollCourseStages(course, 4000, 5)).slice(0, 5)).toEqual(['S3', 'S4', 'S5', 'S6', 'S7']);
    expect(scrollCourseStages(course, 6000, 5)).toBe(course);
    expect(titles(scrollCourseStages(course, 500, 5, 250))[0]).toBe('S3');
  });

  it('leaves a course that fits, a stage being played and a bad clock alone', () => {
    const fits = view(5);
    expect(scrollCourseStages(fits, 4000, 5)).toBe(fits);
    const playing = view(7, 2);
    expect(scrollCourseStages(playing, 4000, 5)).toBe(playing);
    const course = view(7);
    expect(scrollCourseStages(course, Number.NaN, 5)).toBe(course);
    expect(scrollCourseStages(course, -1, 5)).toBe(course);
    expect(scrollCourseStages(course, 4000, 5, 0)).toBe(course);
  });
});
