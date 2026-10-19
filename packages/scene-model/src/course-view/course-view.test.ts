import { createEmptyJSON } from '@be-music/json';
import type { CourseDefinition } from '@be-music/player/course';
import { describe, expect, it } from 'vite-plus/test';
import type { LibraryChart, LibraryCourse } from '../library/entries.ts';
import { resolveCourseView } from './course-view.ts';

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
