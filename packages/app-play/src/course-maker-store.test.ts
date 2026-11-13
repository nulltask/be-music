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
    const legacy = JSON.parse(
      JSON.stringify(
        serializeMadeCourses({
          courses: [nonstop],
          defaultConnection: 'cut',
          randomMixSettings: MIX,
          randomMixes: [],
        }),
      ),
    );
    legacy.version = 1;
    expect(parseMadeCourses(legacy)).toEqual({
      courses: [],
      defaultConnection: 'fade',
      randomMixSettings: MIX,
      randomMixes: [],
    });
  });

  test('keeps each course flagged for IR or not across a reload', () => {
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
    // A record saved before the flag was kept reads its courses back unflagged: an absent flag is not an IR flag, so no
    // course turns read-only without the player flagging it.
    const { release: _release, ...older } = stored;
    expect(parseMadeCourses(older).courses.map((course) => course.release)).toEqual([false, false]);
    // So does a course the flags do not reach, or a flag that is not a boolean.
    expect(parseMadeCourses({ ...stored, release: ['yes'] }).courses.map((course) => course.release)).toEqual([
      false,
      false,
    ]);
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

  test('keeps the RANDOM MIX dialog conditions, endless counts included', () => {
    const conditions = {
      keyMode: 14,
      by: 'difficulty' as const,
      minLevel: 3,
      maxLevel: 12,
      difficulties: [4, 5],
      estimateDifficulty: false,
      allowBPMChanges: false,
      count: 'infinity' as const,
    };
    const stored = JSON.parse(
      JSON.stringify(
        serializeMadeCourses({
          courses: [],
          defaultConnection: 'fade',
          randomMixSettings: MIX,
          randomMixConditions: conditions,
          randomMixes: [],
        }),
      ),
    );
    expect(parseMadeCourses(stored).randomMixConditions).toEqual(conditions);
    // A record saved before the dialog has none: the dialog opens on its defaults.
    const { randomMixConditions: _conditions, ...older } = stored;
    expect(parseMadeCourses(older).randomMixConditions).toBeUndefined();
  });

  test('keeps every stage of a long course and a NONSTOP course connections past the hash', () => {
    const draft = createCourseDraft('nonstop', 'Long');
    const base = finishCourseDraft({
      ...draft,
      stages: [{ md5: '1'.repeat(32), keyMode: 7 }],
    })!;
    const md5s = Array.from({ length: 12 }, (_, index) => index.toString(16).padStart(32, '0'));
    const header = base.source.format === 'lr2crs' ? base.source.header : '';
    const long = {
      ...base,
      stages: md5s.map((md5, index) => ({ md5, title: `Stage ${index + 1}` })),
      connections: Array.from({ length: 11 }, (_, index) => (index % 2 === 0 ? 'cut' : 'blank2') as 'cut' | 'blank2'),
      source: { ...base.source, header, hash: `${header}${md5s.join('')}` },
    } as typeof base;
    const read = parseMadeCourses(
      JSON.parse(
        JSON.stringify(
          serializeMadeCourses({ courses: [long], defaultConnection: 'fade', randomMixSettings: MIX, randomMixes: [] }),
        ),
      ),
    );
    expect(read.courses[0]!.stages).toEqual(long.stages);
    expect(read.courses[0]!.connections).toEqual(long.connections);
    // A record saved before the connections were kept reads them from the hash.
    const stored = serializeMadeCourses({
      courses: [long],
      defaultConnection: 'fade',
      randomMixSettings: MIX,
      randomMixes: [],
    });
    const { connections: _connections, ...older } = stored;
    expect(parseMadeCourses(older).courses[0]!.connections).toHaveLength(10);
  });

  test('reads nothing from a missing, foreign or older record', () => {
    const empty = { courses: [], defaultConnection: 'fade', randomMixSettings: MIX, randomMixes: [] };
    expect(parseMadeCourses(undefined)).toEqual(empty);
    expect(parseMadeCourses({ version: 2, lr2crs: '<courselist/>', defaultConnection: 'cut' })).toEqual(empty);
    expect(parseMadeCourses({ version: 1, lr2crs: '<courselist/>', defaultConnection: 'blank1' })).toEqual(empty);
  });
});
