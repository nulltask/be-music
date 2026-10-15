import { createCourseDraft, finishCourseDraft, withNonstopConnection } from '@be-music/player/course';
import { describe, expect, test } from 'vite-plus/test';
import { parseMadeCourses, serializeMadeCourses } from './course-maker-store.ts';

function made(kind: 'nonstop' | 'grade', name: string) {
  const draft = createCourseDraft(kind, name);
  draft.stages.push(
    { md5: '1'.repeat(32), keyMode: 7, title: 'One' },
    { md5: '2'.repeat(32), keyMode: 7, title: 'Two' },
  );
  return finishCourseDraft(draft)!;
}

describe('made courses storage', () => {
  test('round-trips the courses, their stage titles and the default connection', () => {
    const nonstop = withNonstopConnection(made('nonstop', 'Mine'), 0, 'blank1');
    const grade = made('grade', 'Dan');
    const read = parseMadeCourses(
      JSON.parse(JSON.stringify(serializeMadeCourses({ courses: [nonstop, grade], defaultConnection: 'cut' }))),
    );
    expect(read.defaultConnection).toBe('cut');
    expect(read.courses).toEqual([nonstop, grade]);
  });

  test('reads nothing from a missing, foreign or older record', () => {
    const empty = { courses: [], defaultConnection: 'fade' };
    expect(parseMadeCourses(undefined)).toEqual(empty);
    expect(parseMadeCourses({ version: 0, lr2crs: '' })).toEqual(empty);
    expect(parseMadeCourses({ version: 1, lr2crs: '<courselist/>', defaultConnection: 'warp' })).toEqual(empty);
  });
});
