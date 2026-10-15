import { createEmptyJson } from '@be-music/json';
import { parseBeatorajaCourseData } from '@be-music/player/course';
import type { BeMusicPlaylog, PlaylogRulesetResult } from '@be-music/player/playlog';
import type { BrowserCourseEntry, BrowserSongEntry } from '@be-music/player-web/collection';
import { describe, expect, test } from 'vite-plus/test';
import { CourseSession, courseRecordKey } from './course-session.ts';

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
    expect(session.laneOption('RANDOM')).toBe('OFF');
    expect(session.laneOption('MIRROR')).toBe('MIRROR');

    expect(
      session.recordStage(
        stageLog({ gauge: { type: 'GRADE', final: 71.5, cleared: true }, course: { combo: 4, maxCombo: 10 } }),
      ),
    ).toBe('next');
    expect(session.nextStage()!.course.carryIn).toEqual({ gauge: 71.5, combo: 4, maxCombo: 10 });
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

  test('refuses a course with a missing stage', () => {
    expect(() => new CourseSession({ ...course(), playable: false })).toThrow('not in the collection');
  });

  test('courseRecordKey is stable across constraint order', () => {
    const a = courseRecordKey(course(['MIRROR', 'GAUGE_LR2']));
    expect(a).toBe(courseRecordKey(course(['GAUGE_LR2', 'MIRROR'])));
    expect(a).toBe(`course:grade:gauge_lr2+grade_mirror:${MD5.join(',')}`);
  });
});
