import { describe, expect, test } from 'vite-plus/test';
import {
  createCoursePlaylog,
  simulateCoursePlaylog,
  simulatePlaylog,
  type BeMusicPlaylog,
  type PlaylogCourseStage,
} from '@be-music/player/playlog';
import { makeChart, makePlaylog } from '../../test/support.ts';
import { checkCourseRun, resolveCoursePlayedRuleset } from './verify.ts';

const CHART = makeChart(['#00111:01010101', '#00211:01010101', '#00311:0101']);

function stage(course: PlaylogCourseStage, play: Partial<BeMusicPlaylog['play']> = {}): BeMusicPlaylog {
  return makePlaylog(CHART, { noteCount: 10, hits: 10, play: { gauge: 'GROOVE', course, ...play } });
}

function carryAfter(log: BeMusicPlaylog): PlaylogCourseStage['carryIn'] {
  const result = simulatePlaylog(log, { ruleset: 'lr2' });
  return { gauge: result.gauge.final, combo: result.course!.combo, maxCombo: result.course!.maxCombo };
}

function run(constraints: string[], stages: BeMusicPlaylog[]) {
  const log = createCoursePlaylog({
    course: { name: 'Dan', kind: 'grade', constraints, trophies: [] },
    stages: stages.map((playlog) => ({ played: true as const, playlog })),
  });
  return { log, simulated: simulateCoursePlaylog(log, { ruleset: 'lr2' }) };
}

describe('resolveCoursePlayedRuleset', () => {
  test('is the ruleset every stage shares, or undefined when they differ', () => {
    const first = stage({ kind: 'grade' });
    expect(resolveCoursePlayedRuleset(run([], [first, first]).log)).toBe('lr2');
    const other = stage({ kind: 'grade' }, { judgeRuleset: 'beatoraja' });
    expect(resolveCoursePlayedRuleset(run([], [first, other]).log)).toBeUndefined();
  });
});

describe('checkCourseRun', () => {
  test('accepts stages that carry in what the previous stage left', () => {
    const first = stage({ kind: 'grade', gaugeSet: 'lr2', judge: 'no-good' });
    const second = stage({ kind: 'grade', gaugeSet: 'lr2', judge: 'no-good', carryIn: carryAfter(first) });
    const { log, simulated } = run(['gauge_lr2', 'NO_GOOD'], [first, second]);
    expect(checkCourseRun(log, simulated)).toEqual({ ok: true });
  });

  test('needs the stage settings and lane options the constraints give', () => {
    const missingGaugeSet = run(['gauge_lr2'], [stage({ kind: 'grade' })]);
    expect(checkCourseRun(missingGaugeSet.log, missingGaugeSet.simulated)).toEqual({
      ok: false,
      reason: 'course-constraint-mismatch',
      stage: 0,
    });
    const mirror = run(['grade_mirror'], [stage({ kind: 'grade' }, { randomLane: { p1: 'mirror' } })]);
    expect(checkCourseRun(mirror.log, mirror.simulated)).toEqual({ ok: true });
    const random = run(['grade'], [stage({ kind: 'grade' }, { randomLane: { p1: 'MIRROR' } })]);
    expect(checkCourseRun(random.log, random.simulated)).toMatchObject({ reason: 'course-constraint-mismatch' });
  });

  test('refuses a first stage with a carry-in and a later one without the right one', () => {
    const carried = run([], [stage({ kind: 'grade', carryIn: { gauge: 100, combo: 0, maxCombo: 0 } })]);
    expect(checkCourseRun(carried.log, carried.simulated)).toEqual({
      ok: false,
      reason: 'course-carry-in-mismatch',
      stage: 0,
    });
    const first = stage({ kind: 'grade' });
    const wrongCombo = run([], [first, stage({ kind: 'grade', carryIn: { ...carryAfter(first)!, combo: 3 } })]);
    expect(checkCourseRun(wrongCombo.log, wrongCombo.simulated)).toEqual({
      ok: false,
      reason: 'course-carry-in-mismatch',
      stage: 1,
    });
  });
});
