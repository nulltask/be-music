import { createEmptyJson } from '@be-music/json';
import type { CourseDefinition } from '@be-music/player/course';
import { describe, expect, it } from 'vite-plus/test';
import type { BrowserCourseEntry, BrowserSongEntry } from '../collection/types.ts';
import { resolveSceneCourseInfo } from './course-info.ts';

function song(title: string, extra: Partial<BrowserSongEntry> = {}): BrowserSongEntry {
  return { id: title, title, chart: createEmptyJson('bms'), ...extra } as BrowserSongEntry;
}

const definition = {
  kind: 'grade',
  name: 'Dan 1',
  stages: [],
  constraints: [],
  trophies: [],
} as unknown as CourseDefinition;

describe('resolveSceneCourseInfo', () => {
  it('lists the stage charts with their subtitle and level', () => {
    const course: BrowserCourseEntry = {
      id: 'dan#0',
      definition,
      stages: [
        { title: 'A', song: song('A', { subtitle: '[SPA]', playLevel: 12 }) },
        { title: 'B', song: song('B', { playLevel: '★3' }) },
        { title: 'C', song: song('C', { playLevel: '7' }) },
      ],
      playable: true,
    };
    expect(resolveSceneCourseInfo(course, 1)).toEqual({
      kind: 'grade',
      title: 'Dan 1',
      stages: [{ title: 'A', subtitle: '[SPA]', level: 12 }, { title: 'B' }, { title: 'C', level: 7 }],
      stageIndex: 1,
    });
  });

  it("keeps the course file's title for a missing stage and leaves the stage index out on select", () => {
    const course: BrowserCourseEntry = { id: 'dan#0', definition, stages: [{ title: 'NOT FOUND' }], playable: false };
    expect(resolveSceneCourseInfo(course)).toEqual({ kind: 'grade', title: 'Dan 1', stages: [{ title: 'NOT FOUND' }] });
  });
});
