import { createEmptyJson } from '@be-music/json';
import { parseBeatorajaCourseData, type NonstopConnection } from '@be-music/player/course';
import type { LibraryChart, LibraryCourse } from '@be-music/scene-model';
import type { BeMusicSongRecord } from '@be-music/skin-sdk';
import { describe, expect, test } from 'vite-plus/test';
import { courseRecordKey, lookupCourseRecord, skipsCourseStageResult } from './course-result.ts';

const MD5 = ['1', '2', '3'].map((digit) => digit.repeat(32));

function song(id: string): LibraryChart {
  return {
    id,
    sourceId: 'drop1',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: `${id}.bms`,
    directoryLabel: 'pack',
    fileLabel: `${id}.bms`,
    title: id,
    totalNotes: 10,
    chart: createEmptyJson('bms'),
  };
}

function course(constraint: string[] = ['MIRROR', 'GAUGE_LR2', 'NO_SPEED', 'HCN']): LibraryCourse {
  const definition = parseBeatorajaCourseData({ name: 'Dan', hash: MD5.map((md5) => ({ md5 })), constraint })!;
  return {
    id: 'dan#0',
    definition,
    stages: ['a', 'b', 'c'].map((id) => ({ title: id, chart: song(id) })),
    playable: true,
  };
}

describe('courseRecordKey', () => {
  test('courseRecordKey is stable across constraint order', () => {
    const a = courseRecordKey(course(['MIRROR', 'GAUGE_LR2']));
    expect(a).toBe(courseRecordKey(course(['GAUGE_LR2', 'MIRROR'])));
    expect(a).toBe(`course:grade:gauge_lr2+grade_mirror:${MD5.join(',')}`);
  });

  test('courseRecordKey keys a NONSTOP course by its connections and placement', () => {
    const base = course([]);
    const nonstop = (connections: NonstopConnection[]): LibraryCourse => ({
      ...base,
      definition: { ...base.definition, kind: 'nonstop', connections },
    });
    const key = courseRecordKey(nonstop(['fade', 'cut', 'blank1']), 'intended');
    expect(key).toBe(courseRecordKey(nonstop(['fade', 'cut', 'blank1', 'blank2']), 'intended'));
    expect(key).not.toBe(courseRecordKey(nonstop(['cut', 'cut', 'blank1']), 'intended'));
    expect(key).not.toBe(courseRecordKey(nonstop(['fade', 'cut', 'blank1']), 'lr2'));
    // Other course kinds have no connections, so the placement does not split them.
    expect(courseRecordKey(base, 'lr2')).toBe(courseRecordKey(base));
  });
});

describe('skipsCourseStageResult', () => {
  test('skips every stage result when stage results are skipped', () => {
    expect(skipsCourseStageResult({ skipStageResults: true, autoPlay: false, courseGoesOn: false })).toBe(true);
  });

  test('skips an auto-played stage the course goes on after, as LR2 does, but not the last one', () => {
    expect(skipsCourseStageResult({ skipStageResults: false, autoPlay: true, courseGoesOn: true })).toBe(true);
    expect(skipsCourseStageResult({ skipStageResults: false, autoPlay: true, courseGoesOn: false })).toBe(false);
    expect(skipsCourseStageResult({ skipStageResults: false, autoPlay: false, courseGoesOn: true })).toBe(false);
  });
});

describe('lookupCourseRecord', () => {
  const dan = (): LibraryCourse => {
    const entry = course(['MIRROR']);
    return {
      ...entry,
      definition: {
        ...entry.definition,
        trophies: [
          { name: 'bronzemedal', missRate: 10, scoreRate: 50 },
          { name: 'goldmedal', missRate: 2.5, scoreRate: 85 },
        ],
      },
    };
  };

  test('reads the record kept under the course key, with the trophy its bests earn', () => {
    const records = new Map<string, BeMusicSongRecord>([
      [courseRecordKey(dan()), { lamp: 'FAILED', exScore: 52, missCount: 0 }],
    ]);
    // 30 notes: 52 / 60 = 86.7 % score, no BP. beatoraja grants trophies on the bests, cleared or not.
    expect(lookupCourseRecord(dan(), records)).toEqual({
      lamp: 'FAILED',
      exScore: 52,
      missCount: 0,
      trophy: 'goldmedal',
    });
    records.set(courseRecordKey(dan()), { lamp: 'NORMAL', exScore: 40, missCount: 3 });
    expect(lookupCourseRecord(dan(), records)?.trophy).toBe('bronzemedal');
  });

  test('has no record for a course never played, a random course or a NEW COURSE bar', () => {
    const records = new Map([[courseRecordKey(dan()), { lamp: 'HARD' as const }]]);
    expect(lookupCourseRecord(course(['GAUGE_LR2']), records)).toBeUndefined();
    expect(lookupCourseRecord({ ...dan(), newCourse: true }, records)).toBeUndefined();
    const random = { ...dan(), random: { name: 'r', stages: [], constraints: [], trophies: [] } };
    expect(lookupCourseRecord(random as unknown as LibraryCourse, records)).toBeUndefined();
    expect(lookupCourseRecord(dan(), records)).toEqual({ lamp: 'HARD' });
  });
});
