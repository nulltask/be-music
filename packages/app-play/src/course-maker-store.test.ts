import {
  createCourseDraft,
  DEFAULT_LR2_RANDOM_MIX_SETTINGS,
  finishCourseDraft,
  withCourseConstraints,
  withNonstopConnection,
} from '@be-music/player-engine/course';
import { describe, expect, test } from 'vite-plus/test';
import { parseMadeCourses, serializeMadeCourses } from './course-maker-store.ts';

const MIX = DEFAULT_LR2_RANDOM_MIX_SETTINGS;

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
      JSON.parse(
        JSON.stringify(
          serializeMadeCourses({
            courses: [nonstop, grade],
            defaultConnection: 'cut',
            randomMixSettings: MIX,
            randomMixes: [],
          }),
        ),
      ),
    );
    expect(read.defaultConnection).toBe('cut');
    expect(read.courses).toEqual([nonstop, grade]);
  });

  test('keeps each course unranked or ranked across a reload', () => {
    const unranked = made('nonstop', 'Mine');
    const ranked = { ...made('grade', 'Dan'), release: true };
    expect(unranked.release).toBe(false);
    const stored = JSON.parse(
      JSON.stringify(
        serializeMadeCourses({
          courses: [unranked, ranked],
          defaultConnection: 'fade',
          randomMixSettings: MIX,
          randomMixes: [],
        }),
      ),
    );
    expect(parseMadeCourses(stored).courses.map((course) => course.release)).toEqual([false, true]);
    // A record saved before the flag was kept reads its courses back released, as they were made then.
    const { release: _release, ...older } = stored;
    expect(parseMadeCourses(older).courses.map((course) => course.release)).toEqual([true, true]);
  });

  test('keeps the RANDOM MIX settings and which courses are a folder last RANDOM MIX', () => {
    const mix = made('nonstop', 'RANDOM MIX');
    const mine = made('grade', 'Dan');
    const settings = { ...MIX, maxBPM: 200, stageCount: 0 };
    const stored = JSON.parse(
      JSON.stringify(
        serializeMadeCourses({
          courses: [mix, mine],
          defaultConnection: 'fade',
          randomMixSettings: settings,
          randomMixes: [mix],
        }),
      ),
    );
    const read = parseMadeCourses(stored);
    expect(read.randomMixSettings).toEqual(settings);
    expect(read.randomMixes).toEqual([read.courses[0]]);
    // A record saved before RANDOM MIX reads LR2's defaults and no draw.
    const { randomMix: _randomMix, randomMixSettings: _settings, ...older } = stored;
    expect(parseMadeCourses(older)).toMatchObject({ randomMixSettings: MIX, randomMixes: [] });
  });

  test('reads nothing from a missing, foreign or older record', () => {
    const empty = { courses: [], defaultConnection: 'fade', randomMixSettings: MIX, randomMixes: [] };
    expect(parseMadeCourses(undefined)).toEqual(empty);
    expect(parseMadeCourses({ version: 0, lr2crs: '' })).toEqual(empty);
    expect(parseMadeCourses({ version: 1, lr2crs: '<courselist/>', defaultConnection: 'warp' })).toEqual(empty);
  });
});
