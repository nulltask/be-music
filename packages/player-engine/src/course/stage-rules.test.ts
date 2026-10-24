import { describe, expect, test } from 'vite-plus/test';
import {
  isCourseHiSpeedLocked,
  isLR2GradeCourse,
  parseBeatorajaCourseData,
  parseLR2CourseFile,
  resolveCourseLaneOptions,
  resolveCourseStagePlaySettings,
  resolveCourseStageSettings,
  resolveLR2GradeCoursePlaySettings,
  type CourseLaneOption,
} from './index.ts';

const MD5_A = '0123456789abcdef0123456789abcdef';

describe('course stage settings', () => {
  test('resolveCourseStageSettings reads the gauge set and judge constraint', () => {
    const course = parseBeatorajaCourseData({
      hash: [{ md5: MD5_A }],
      constraint: ['MIRROR', 'GAUGE_LR2', 'NO_GREAT'],
    })!;
    expect(resolveCourseStageSettings(course)).toEqual({ kind: 'grade', gaugeSet: 'lr2', judge: 'no-great' });
    expect(resolveCourseStageSettings({ ...course, kind: 'expert', constraints: [] })).toEqual({ kind: 'expert' });
  });

  test('resolveCourseLaneOptions follows the lane-option constraint on both sides and DP FLIP', () => {
    const picked = (random1P: CourseLaneOption, random2P: CourseLaneOption = 'RANDOM', dpFlip = true) => ({
      random1P,
      random2P,
      dpFlip,
    });
    const off = { random1P: 'OFF', random2P: 'OFF', dpFlip: false };
    // CLASS turns every lane option and FLIP off.
    expect(resolveCourseLaneOptions(['grade'], picked('MIRROR'))).toEqual(off);
    // MIRROR: a 1P MIRROR plays 2P on MIRROR with FLIP on; anything else turns them all off.
    expect(resolveCourseLaneOptions(['grade_mirror'], picked('MIRROR', 'OFF', false))).toEqual({
      random1P: 'MIRROR',
      random2P: 'MIRROR',
      dpFlip: true,
    });
    expect(resolveCourseLaneOptions(['grade_mirror'], picked('RANDOM', 'MIRROR'))).toEqual(off);
    // RANDOM keeps the plain random family on each side and leaves FLIP alone.
    expect(resolveCourseLaneOptions(['grade_random'], picked('S-RANDOM', 'SCATTER'))).toEqual({
      random1P: 'S-RANDOM',
      random2P: 'OFF',
      dpFlip: true,
    });
    expect(resolveCourseLaneOptions(['gauge_lr2'], picked('SCATTER', 'MIRROR', true))).toEqual(
      picked('SCATTER', 'MIRROR', true),
    );
  });

  test('isCourseHiSpeedLocked reads no_speed', () => {
    expect(isCourseHiSpeedLocked(['no_speed'])).toBe(true);
    expect(isCourseHiSpeedLocked(['grade'])).toBe(false);
  });
});

describe('LR2 GRADE course resets', () => {
  const lr2 = parseLR2CourseFile(
    `<courselist><course><title>Dan</title><type>2</type><hash>${'0'.repeat(10)}2${'0'.repeat(21)}${MD5_A}</hash></course></courselist>`,
  )[0]!;
  const picks = {
    gauge: 'EASY' as const,
    hiddenSudden1P: 'SUDDEN' as const,
    hiddenSudden2P: 'HID+SUD' as const,
    autoScratch1P: true,
    autoScratch2P: true,
    dpFlip: true,
    tempo: 1.2,
    random1P: 'MIRROR' as const,
  };

  test('tells an LR2 GRADE course from a table or beatoraja grade', () => {
    expect(isLR2GradeCourse(lr2)).toBe(true);
    expect(isLR2GradeCourse({ ...lr2, kind: 'expert' })).toBe(false);
    expect(isLR2GradeCourse({ kind: 'grade', source: { format: 'table', legacyGrade: true } })).toBe(false);
  });

  test('turns off what LR2 turns off when a GRADE course starts, keeping the rest', () => {
    expect(resolveLR2GradeCoursePlaySettings(lr2, picks)).toEqual({
      gauge: 'GROOVE',
      hiddenSudden1P: 'OFF',
      hiddenSudden2P: 'OFF',
      autoScratch1P: false,
      autoScratch2P: false,
      dpFlip: false,
      tempo: 1,
      random1P: 'MIRROR',
    });
    // HARD and DEATH stay.
    expect(resolveLR2GradeCoursePlaySettings(lr2, { ...picks, gauge: 'HARD' }).gauge).toBe('HARD');
    // Another course keeps every pick.
    expect(resolveLR2GradeCoursePlaySettings({ ...lr2, kind: 'expert' }, picks)).toBe(picks);
  });
});

describe('resolveCourseStagePlaySettings', () => {
  const picks = {
    random1P: 'RANDOM' as const,
    random2P: 'MIRROR' as const,
    dpFlip: true,
    gauge: 'EASY' as const,
    hiddenSudden1P: 'SUDDEN' as const,
    hiddenSudden2P: 'OFF' as const,
    autoScratch1P: true,
    autoScratch2P: false,
    tempo: 0.9,
  };

  test('resets an LR2 GRADE course’s stage to what LR2 allows, lane options included', () => {
    const definition = parseLR2CourseFile(
      `<courselist><course><title>Dan</title><type>2</type><hash>${'0'.repeat(10)}2${'0'.repeat(21)}${MD5_A}</hash></course></courselist>`,
    )[0]!;
    expect(resolveCourseStagePlaySettings(definition, picks)).toEqual({
      random1P: 'OFF',
      random2P: 'OFF',
      dpFlip: false,
      gauge: 'GROOVE',
      hiddenSudden1P: 'OFF',
      hiddenSudden2P: 'OFF',
      autoScratch1P: false,
      autoScratch2P: false,
      tempo: 1,
    });
  });

  test('applies only the lane-option constraint to another course, passing other fields through', () => {
    const definition = parseBeatorajaCourseData({ hash: [{ md5: MD5_A }], constraint: ['MIRROR'] })!;
    expect(resolveCourseStagePlaySettings(definition, { ...picks, bga: true })).toEqual({
      ...picks,
      bga: true,
      random1P: 'OFF',
      random2P: 'OFF',
      dpFlip: false,
    });
    const free = parseBeatorajaCourseData({ hash: [{ md5: MD5_A }], constraint: [] })!;
    expect(resolveCourseStagePlaySettings(free, picks)).toEqual(picks);
  });
});

test('grade_random keeps R-RANDOM while grade and grade_mirror constrain it', () => {
  const picked = { random1P: 'R-RANDOM', random2P: 'R-RANDOM', dpFlip: true } as const;
  expect(resolveCourseLaneOptions(['grade_random'], picked)).toEqual(picked);
  for (const constraint of ['grade', 'grade_mirror'] as const)
    expect(resolveCourseLaneOptions([constraint], picked)).toEqual({ random1P: 'OFF', random2P: 'OFF', dpFlip: false });
});

test('grade_random permits SPIRAL at source option index 5', () => {
  const picked = { random1P: 'SPIRAL', random2P: 'SPIRAL', dpFlip: false } as const;
  expect(resolveCourseLaneOptions(['grade_random'], picked)).toEqual(picked);
  expect(resolveCourseLaneOptions(['grade'], picked)).toEqual({ random1P: 'OFF', random2P: 'OFF', dpFlip: false });
});

test('grade_random excludes ALL-SCR and H-RANDOM at source option indices above 5', () => {
  expect(
    resolveCourseLaneOptions(['grade_random'], { random1P: 'ALL-SCR', random2P: 'H-RANDOM', dpFlip: true }),
  ).toEqual({ random1P: 'OFF', random2P: 'OFF', dpFlip: true });
});
