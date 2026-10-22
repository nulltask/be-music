import { describe, expect, test } from 'vite-plus/test';
import {
  createCourseReplay,
  resolveCoursePlayedRuleset,
  simulateCourseReplay,
  simulateReplay,
  type BeMusicReplay,
  type ReplayCourseStage,
} from '@be-music/player-engine/replay';
import { makeChart, makeReplay } from '../test-support/support.ts';
import { checkCourseRun } from './verify.ts';

const CHART = makeChart(['#00111:01010101', '#00211:01010101', '#00311:0101']);

function stage(course: ReplayCourseStage, play: Partial<BeMusicReplay['play']> = {}): BeMusicReplay {
  return makeReplay(CHART, { noteCount: 10, hits: 10, play: { gauge: 'GROOVE', course, ...play } });
}

function carryAfter(log: BeMusicReplay): ReplayCourseStage['carryIn'] {
  const result = simulateReplay(log, { ruleset: 'lr2' });
  return { gauge: result.gauge.final, combo: result.course!.combo, maxCombo: result.course!.maxCombo };
}

function run(constraints: string[], stages: BeMusicReplay[]) {
  const log = createCourseReplay({
    course: { name: 'Dan', kind: 'grade', constraints, trophies: [] },
    stages: stages.map((replay) => ({ played: true as const, replay })),
  });
  return { log, simulated: simulateCourseReplay(log, { ruleset: 'lr2' }) };
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

describe('a NONSTOP run', () => {
  /** A NONSTOP run whose stitched play is `stitched`; its two cut-out stages carry no settings of their own. */
  function nonstopRun(constraints: string[], stitched: BeMusicReplay) {
    const cut = stage({ kind: 'nonstop' });
    const log = createCourseReplay({
      course: { name: 'Nonstop', kind: 'nonstop', constraints, trophies: [] },
      stages: [cut, cut].map((replay) => ({ played: true as const, replay })),
      nonstop: {
        connections: ['cut'],
        placement: 'intended',
        replay: stitched,
        stages: [
          { offsetUs: 0, windowStartUs: 0, windowEndUs: 3_000_000, rate: 1 },
          { offsetUs: 2_000_000, windowStartUs: 3_000_000, rate: 1 },
        ],
        noteStages: stitched.chart.notes.map((note) => (note.timeUs < 3_000_000 ? 0 : 1)),
      },
    });
    return { log, simulated: simulateCourseReplay(log, { ruleset: 'lr2' }) };
  }

  test('is judged under the ruleset of its stitched play', () => {
    const { log } = nonstopRun([], stage({ kind: 'nonstop' }, { judgeRuleset: 'iidx' }));
    expect(resolveCoursePlayedRuleset(log)).toBe('iidx');
  });

  test('checks only the stitched play against the constraints, given up or not', () => {
    const settings: ReplayCourseStage = { kind: 'nonstop', gaugeSet: 'lr2' };
    const cleared = nonstopRun(['gauge_lr2', 'grade'], stage(settings));
    expect(checkCourseRun(cleared.log, cleared.simulated)).toEqual({ ok: true });
    const givenUp = nonstopRun(['gauge_lr2'], stage(settings, { aborted: true, abortedAtUs: 2_000_000 }));
    expect(checkCourseRun(givenUp.log, givenUp.simulated)).toEqual({ ok: true });
    const mirrored = nonstopRun(['gauge_lr2', 'grade'], stage(settings, { randomLane: { p1: 'MIRROR' } }));
    expect(checkCourseRun(mirrored.log, mirrored.simulated)).toEqual({
      ok: false,
      reason: 'course-constraint-mismatch',
    });
  });
});
