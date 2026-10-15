import { createEmptyJson } from '@be-music/json';
import { parseBeatorajaCourseData } from '@be-music/player/course';
import { describe, expect, test } from 'vite-plus/test';
import {
  applyCourseLongNoteConstraint,
  createSongHashLookup,
  isCourseFilePath,
  isCourseHiSpeedLocked,
  readCourseFile,
  resolveCourseFolders,
  resolveCourseLaneOption,
  resolveCourseStageSettings,
} from './course.ts';
import type { BrowserSongEntry } from './types.ts';

const MD5_A = '0123456789abcdef0123456789abcdef';
const SHA_B = 'b'.repeat(64);

function song(id: string, title: string): BrowserSongEntry {
  return {
    id,
    sourceId: 'drop1',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: `${id}.bms`,
    directoryLabel: 'pack',
    fileLabel: `${id}.bms`,
    title,
    totalNotes: 100,
    chart: createEmptyJson('bms'),
  };
}

describe('course files', () => {
  test('isCourseFilePath accepts .lr2crs anywhere and JSON only under a course folder', () => {
    expect(isCourseFilePath('Courses/dan.LR2CRS')).toBe(true);
    expect(isCourseFilePath('beatoraja/course/dan.json')).toBe(true);
    expect(isCourseFilePath('course/dan.json')).toBe(true);
    expect(isCourseFilePath('skin/select.json')).toBe(false);
    expect(isCourseFilePath('songs/chart.bms')).toBe(false);
  });

  test('readCourseFile reads both formats into a group named after the file', () => {
    const lr2 = `<courselist><course><title>Dan</title><type>2</type><hash>${'0'.repeat(32)}${MD5_A}</hash></course></courselist>`;
    expect(readCourseFile('a/dan.lr2crs', new TextEncoder().encode(lr2))).toMatchObject({
      label: 'dan',
      courses: [{ name: 'Dan', kind: 'grade' }],
    });
    const json = JSON.stringify([{ name: 'Expert', hash: [{ md5: MD5_A }] }]);
    expect(readCourseFile('course\\expert.json', new TextEncoder().encode(json))).toMatchObject({
      label: 'expert',
      courses: [{ name: 'Expert', kind: 'expert' }],
    });
    expect(readCourseFile('course/empty.json', new TextEncoder().encode('[]'))).toBeUndefined();
  });
});

describe('resolveCourseFolders', () => {
  test('matches stages by hash and marks a course with a missing stage unplayable', () => {
    const a = song('a', 'Song A');
    const b = song('b', 'Song B');
    const lookup = createSongHashLookup([
      { song: a, md5: MD5_A.toUpperCase() },
      { song: b, sha256: SHA_B },
      { song: song('dup', 'Duplicate'), md5: MD5_A },
    ]);
    const full = parseBeatorajaCourseData({ name: 'Full', hash: [{ md5: MD5_A }, { sha256: SHA_B }] })!;
    const missing = parseBeatorajaCourseData({
      name: 'Missing',
      hash: [{ md5: MD5_A }, { md5: 'f'.repeat(32), title: 'Gone' }],
    })!;
    const [folder] = resolveCourseFolders(
      [
        { label: 'dan', courses: [full, missing] },
        { label: 'empty', courses: [] },
      ],
      lookup,
    );
    expect(folder).toMatchObject({ label: 'dan', songs: [] });
    expect(folder!.courses!.map((course) => [course.id, course.playable])).toEqual([
      ['dan#0', true],
      ['dan#1', false],
    ]);
    expect(folder!.courses![0]!.stages).toEqual([
      { title: 'Song A', song: a },
      { title: 'Song B', song: b },
    ]);
    expect(folder!.courses![1]!.stages[1]).toEqual({ title: 'Gone' });
  });
});

describe('course stage settings', () => {
  test('resolveCourseStageSettings reads the gauge set and judge constraint', () => {
    const course = parseBeatorajaCourseData({
      hash: [{ md5: MD5_A }],
      constraint: ['MIRROR', 'GAUGE_LR2', 'NO_GREAT'],
    })!;
    expect(resolveCourseStageSettings(course)).toEqual({ kind: 'grade', gaugeSet: 'lr2', judge: 'no-great' });
    expect(resolveCourseStageSettings({ ...course, kind: 'expert', constraints: [] })).toEqual({ kind: 'expert' });
  });

  test('resolveCourseLaneOption follows the lane-option constraint', () => {
    expect(resolveCourseLaneOption(['grade'], 'MIRROR')).toBe('OFF');
    expect(resolveCourseLaneOption(['grade_mirror'], 'MIRROR')).toBe('MIRROR');
    expect(resolveCourseLaneOption(['grade_mirror'], 'RANDOM')).toBe('OFF');
    expect(resolveCourseLaneOption(['grade_random'], 'S-RANDOM')).toBe('S-RANDOM');
    expect(resolveCourseLaneOption(['grade_random'], 'SCATTER')).toBe('OFF');
    expect(resolveCourseLaneOption(['gauge_lr2'], 'SCATTER')).toBe('SCATTER');
  });

  test('isCourseHiSpeedLocked reads no_speed', () => {
    expect(isCourseHiSpeedLocked(['no_speed'])).toBe(true);
    expect(isCourseHiSpeedLocked(['grade'])).toBe(false);
  });

  test('applyCourseLongNoteConstraint sets the mode only on charts that leave it undefined', () => {
    const bms = createEmptyJson('bms');
    expect(
      applyCourseLongNoteConstraint(bms, ['hcn']).sourceFormat === 'bms' && applyCourseLongNoteConstraint(bms, ['hcn']),
    ).toMatchObject({
      bms: { lnMode: 3 },
    });
    expect(bms.bms.lnMode).toBeUndefined();
    const declared = createEmptyJson('bms');
    declared.bms.lnMode = 1;
    expect(applyCourseLongNoteConstraint(declared, ['cn'])).toBe(declared);
    expect(applyCourseLongNoteConstraint(bms, ['grade'])).toBe(bms);
    const bmson = createEmptyJson('bmson');
    expect(applyCourseLongNoteConstraint(bmson, ['cn'])).toMatchObject({ bmson: { info: { lnType: 2 } } });
  });
});
