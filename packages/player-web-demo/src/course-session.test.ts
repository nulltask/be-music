import { createEmptyJson } from '@be-music/json';
import { parseBeatorajaCourseData, parseLr2CourseFile } from '@be-music/player/course';
import type { BeMusicPlaylog, PlaylogRulesetResult } from '@be-music/player/playlog';
import type { BrowserCourseEntry, BrowserSongEntry } from '@be-music/player-web/collection';
import type { BeMusicSongRecord } from '@be-music/player-web/skin';
import { describe, expect, test } from 'vite-plus/test';
import {
  buildCourseResultSummary,
  CourseSession,
  courseRecordKey,
  joinCourseStageHistories,
  lookupCourseRecord,
  skipsCourseStageResult,
} from './course-session.ts';

const MD5 = ['1', '2', '3'].map((digit) => digit.repeat(32));

function song(id: string): BrowserSongEntry {
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

function course(constraint: string[] = ['MIRROR', 'GAUGE_LR2', 'NO_SPEED', 'HCN']): BrowserCourseEntry {
  const definition = parseBeatorajaCourseData({ name: 'Dan', hash: MD5.map((md5) => ({ md5 })), constraint })!;
  return {
    id: 'dan#0',
    definition,
    stages: ['a', 'b', 'c'].map((id) => ({ title: id, song: song(id) })),
    playable: true,
  };
}

function stageLog(native: Partial<PlaylogRulesetResult>): BeMusicPlaylog {
  return {
    results: {
      native: {
        ruleset: 'be-music/native',
        judge: { pgreat: 10, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 },
        fast: 0,
        slow: 0,
        exScore: 20,
        noteCount: 10,
        maxCombo: 10,
        gauge: { type: 'GRADE', final: 90, cleared: true },
        course: { combo: 10, maxCombo: 10 },
        ...native,
      },
    },
  } as unknown as BeMusicPlaylog;
}

describe('CourseSession', () => {
  test('plans each stage with the course settings and the state the previous stage left', () => {
    const session = new CourseSession(course());
    const first = session.nextStage()!;
    expect(first).toMatchObject({ index: 0, stageCount: 3, hiSpeedLocked: true });
    expect(first.course).toEqual({ kind: 'grade', gaugeSet: 'lr2' });
    // The HCN constraint applies to a chart that leaves its long-note mode undefined.
    expect(first.song.chart.sourceFormat === 'bms' && first.song.chart.bms.lnMode).toBe(3);
    expect(session.laneOptions({ random1P: 'RANDOM', random2P: 'RANDOM', dpFlip: true })).toEqual({
      random1P: 'OFF',
      random2P: 'OFF',
      dpFlip: false,
    });
    expect(session.laneOptions({ random1P: 'MIRROR', random2P: 'OFF', dpFlip: false })).toEqual({
      random1P: 'MIRROR',
      random2P: 'MIRROR',
      dpFlip: true,
    });

    expect(
      session.recordStage(
        stageLog({ gauge: { type: 'GRADE', final: 71.5, cleared: true }, course: { combo: 4, maxCombo: 10 } }),
      ),
    ).toBe('next');
    expect(session.nextStage()!.course.carryIn).toEqual({ gauge: 71.5, combo: 4, maxCombo: 10 });
  });

  test('names the stage being played for the skins', () => {
    const session = new CourseSession(course());
    expect(session.nextStage()!.courseInfo).toMatchObject({ kind: 'grade', title: 'Dan', stageIndex: 0 });
    expect(session.courseInfo.stageIndex).toBeUndefined();
    session.recordStage(stageLog({}));
    expect(session.courseInfo).toMatchObject({
      stageIndex: 0,
      stages: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
    });
    expect(session.nextStage()!.courseInfo.stageIndex).toBe(1);
  });

  test('records a stage given up with ESC and ends the course there', () => {
    const session = new CourseSession(course([]));
    session.recordStage(stageLog({}));
    const givenUp = stageLog({ gauge: { type: 'GRADE', final: 70, cleared: true } });
    givenUp.play = { mode: 'manual', autoScratch: false, gauge: 'GROOVE', aborted: true };
    session.giveUp(givenUp);
    expect(session.finished).toBe(true);
    expect(session.stagesPlayed).toBe(2);
    expect(session.nextStage()).toBeUndefined();
  });

  test('ends on a failed stage and after the last stage', () => {
    const failing = new CourseSession(course());
    expect(
      failing.recordStage(stageLog({ gauge: { type: 'GRADE', final: 0, cleared: false, failedMidPlay: true } })),
    ).toBe('finished');
    expect(failing.finished).toBe(true);
    expect(failing.nextStage()).toBeUndefined();

    const full = new CourseSession(course([]));
    expect(full.recordStage(stageLog({}))).toBe('next');
    expect(full.recordStage(stageLog({}))).toBe('next');
    expect(full.recordStage(stageLog({}))).toBe('finished');
    expect(full.stagesPlayed).toBe(3);
    // A stage without a play log ends the course too.
    expect(new CourseSession(course()).recordStage(undefined)).toBe('finished');
  });

  test('builds the course play log with each unreached stage’s facts and chart fingerprint', () => {
    const session = new CourseSession(course());
    const failed = stageLog({ gauge: { type: 'GRADE', final: 0, cleared: false, failedMidPlay: true } });
    failed.play = { mode: 'manual', autoScratch: false, gauge: 'GROOVE', course: { kind: 'grade' } };
    session.recordStage(failed);
    const seen: Array<number | undefined> = [];
    const log = session.buildPlaylog(
      (song) => {
        seen.push(song.chart.sourceFormat === 'bms' ? song.chart.bms.lnMode : undefined);
        return {
          sourceFormat: 'bms',
          laneMode: '7keys',
          lnMode: 3,
          judgeRank: { percent: 75 },
          notes: { normal: 10, long: { 1: 0, 2: 0, 3: 0 } },
        };
      },
      { chartFingerprintOf: (song) => `bmfp0:${song.id}` },
    );
    expect(log.stages[0]).toMatchObject({ played: true });
    expect(log.stages.slice(1)).toMatchObject([
      { played: false, md5: MD5[1], chartFingerprint: 'bmfp0:b' },
      { played: false, md5: MD5[2], chartFingerprint: 'bmfp0:c' },
    ]);
    // The unreached stages are read as the course plays them: the HCN constraint applied.
    expect(seen).toEqual([3, 3]);
  });

  test('tells whether the course goes on after a stage before it is recorded', () => {
    const session = new CourseSession(course([]));
    expect(session.goesOnAfter(stageLog({}))).toBe(true);
    expect(session.goesOnAfter(stageLog({ gauge: { type: 'GRADE', final: 0, cleared: false } }))).toBe(false);
    expect(session.goesOnAfter(undefined)).toBe(false);
    // Asking records nothing.
    expect(session.stagesPlayed).toBe(0);
    session.recordStage(stageLog({}));
    session.recordStage(stageLog({}));
    // After the last stage the course result follows.
    expect(session.goesOnAfter(stageLog({}))).toBe(false);
  });

  test('keeps each played stage’s graphs', () => {
    const session = new CourseSession(course([]));
    const history = { gaugeHistory: [{ progress: 1, value: 80 }], scoreHistory: [{ progress: 1, exScore: 20 }] };
    session.recordStage(stageLog({}), history);
    session.giveUp(stageLog({}));
    expect(session.stageHistories).toEqual([history, { gaugeHistory: [], scoreHistory: [] }]);
  });

  test('refuses a course with a missing stage', () => {
    expect(() => new CourseSession({ ...course(), playable: false })).toThrow('not in the collection');
  });

  test('courseRecordKey is stable across constraint order', () => {
    const a = courseRecordKey(course(['MIRROR', 'GAUGE_LR2']));
    expect(a).toBe(courseRecordKey(course(['GAUGE_LR2', 'MIRROR'])));
    expect(a).toBe(`course:grade:gauge_lr2+grade_mirror:${MD5.join(',')}`);
  });
});

describe('buildCourseResultSummary', () => {
  test('reads the course result as one run', () => {
    const summary = buildCourseResultSummary({
      ruleset: 'beatoraja',
      judge: { pgreat: 50, great: 20, good: 5, bad: 2, poor: 3, emptyPoor: 1 },
      fast: 7,
      slow: 9,
      exScore: 120,
      noteCount: 90,
      missCount: 16,
      maxCombo: 40,
      djLevel: 'B',
      gauge: { type: 'CLASS', final: 36.5, cleared: true },
      stagesPlayed: 3,
      lamp: 'NORMAL',
      stages: [],
    });
    expect(summary).toMatchObject({
      total: 90,
      perfect: 50,
      great: 20,
      good: 5,
      bad: 2,
      poor: 3,
      emptyPoor: 1,
      fast: 7,
      slow: 9,
      exScore: 120,
      score: 120,
      gauge: { type: 'CLASS', current: 36.5, cleared: true },
      course: { maxCombo: 40 },
    });
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
  const dan = (): BrowserCourseEntry => {
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
    expect(lookupCourseRecord(random as unknown as BrowserCourseEntry, records)).toBeUndefined();
    expect(lookupCourseRecord(dan(), records)).toEqual({ lamp: 'HARD' });
  });
});

describe('joinCourseStageHistories', () => {
  test('lays the stages side by side by length, the EX score running on, an unreached stage at gauge 0', () => {
    const joined = joinCourseStageHistories(
      [
        {
          gaugeHistory: [
            { progress: 0, value: 100 },
            { progress: 1, value: 60 },
          ],
          scoreHistory: [
            { progress: 0, exScore: 0 },
            { progress: 1, exScore: 30 },
          ],
        },
        {
          gaugeHistory: [
            { progress: 0, value: 60 },
            { progress: 1, value: 10 },
          ],
          scoreHistory: [
            { progress: 0, exScore: 0 },
            { progress: 1, exScore: 10 },
          ],
        },
      ],
      [2, 1, 1],
    );
    expect(joined.gaugeHistory).toEqual([
      { progress: 0, value: 100 },
      { progress: 0.5, value: 60 },
      { progress: 0.5, value: 60 },
      { progress: 0.75, value: 10 },
      { progress: 0.75, value: 0 },
      { progress: 1, value: 0 },
    ]);
    expect(joined.scoreHistory).toEqual([
      { progress: 0, exScore: 0 },
      { progress: 0.5, exScore: 30 },
      { progress: 0.5, exScore: 30 },
      { progress: 0.75, exScore: 40 },
      { progress: 0.75, exScore: 40 },
      { progress: 1, exScore: 40 },
    ]);
  });

  test('shares the width evenly when no stage has a length', () => {
    const joined = joinCourseStageHistories([], [0, 0]);
    expect(joined.gaugeHistory.map((sample) => sample.progress)).toEqual([0, 0.5, 0.5, 1]);
  });
});

describe('CourseSession.playSettings', () => {
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
    const definition = parseLr2CourseFile(
      `<courselist><course><title>Dan</title><type>2</type><hash>${'0'.repeat(10)}2${'0'.repeat(21)}${MD5[0]}</hash></course></courselist>`,
    )[0]!;
    const session = new CourseSession({ ...course(), definition });
    expect(session.playSettings(picks)).toEqual({
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

  test('applies only the lane-option constraint to another course', () => {
    const session = new CourseSession(course(['MIRROR']));
    expect(session.playSettings(picks)).toEqual({ ...picks, random1P: 'OFF', random2P: 'OFF', dpFlip: false });
  });
});
