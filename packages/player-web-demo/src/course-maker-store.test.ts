import {
  createCourseDraft,
  finishCourseDraft,
  withCourseConstraints,
  withNonstopConnection,
} from '@be-music/player/course';
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
    const grade = withCourseConstraints(made('grade', 'Dan'), ['grade', 'no_speed', 'gauge_7k']);
    const read = parseMadeCourses(
      JSON.parse(JSON.stringify(serializeMadeCourses({ courses: [nonstop, grade], defaultConnection: 'cut' }))),
    );
    expect(read.defaultConnection).toBe('cut');
    expect(read.courses).toEqual([nonstop, grade]);
  });

  test('keeps each course unranked or ranked across a reload', () => {
    const unranked = made('nonstop', 'Mine');
    const ranked = { ...made('grade', 'Dan'), release: true };
    expect(unranked.release).toBe(false);
    const stored = JSON.parse(
      JSON.stringify(serializeMadeCourses({ courses: [unranked, ranked], defaultConnection: 'fade' })),
    );
    expect(parseMadeCourses(stored).courses.map((course) => course.release)).toEqual([false, true]);
    // A record saved before the flag was kept reads its courses back released, as they were made then.
    const { release: _release, ...older } = stored;
    expect(parseMadeCourses(older).courses.map((course) => course.release)).toEqual([true, true]);
  });

  test('reads nothing from a missing, foreign or older record', () => {
    const empty = { courses: [], defaultConnection: 'fade' };
    expect(parseMadeCourses(undefined)).toEqual(empty);
    expect(parseMadeCourses({ version: 0, lr2crs: '' })).toEqual(empty);
    expect(parseMadeCourses({ version: 1, lr2crs: '<courselist/>', defaultConnection: 'warp' })).toEqual(empty);
  });
});
