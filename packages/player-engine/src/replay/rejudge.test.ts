import { describe, expect, test } from 'vite-plus/test';
import { BE_MUSIC_COURSE_REPLAY_FORMAT, type BeMusicCourseReplay } from './course.ts';
import {
  BE_MUSIC_REPLAY_FORMAT,
  BE_MUSIC_REPLAY_VERSION,
  type BeMusicReplay,
  type ReplayInputEvent,
  type ReplayNote,
} from './format.ts';
import { rulesetChartFactsFromReplay } from './rulesets.ts';
import { findReplayNotSimulatedReason, rejudgeCourseReplay, rejudgeReplay, rejudgeReplayRulesets } from './rejudge.ts';
import { simulateReplay } from './simulate.ts';
import { DEFAULT_BEATORAJA_CUSTOM_JUDGE } from '../ruleset/custom-judge.ts';

/** Three notes on lane 11, at 1 s, 1.5 s and 2 s. */
const NOTES: ReplayNote[] = [0, 1, 2].map((id) => ({
  id,
  channel: '11',
  type: 'normal',
  timeUs: 1_000_000 + id * 500_000,
}));

function makeReplay(
  play: Partial<BeMusicReplay['play']> = {},
  inputs: Array<Omit<ReplayInputEvent, 'seq'>> = [],
): BeMusicReplay {
  return {
    format: BE_MUSIC_REPLAY_FORMAT,
    version: BE_MUSIC_REPLAY_VERSION,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75, sourceRank: 2 },
      noteCount: NOTES.length,
      notes: NOTES,
    },
    inputs: inputs.map((input, seq) => ({ ...input, seq })),
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', ...play },
  };
}

/**
 * A DEATH play under LR2 rules that ended on failure: the press 110 ms early is LR2's BAD, which empties DEATH at
 * 0.89 s, so nothing after it was recorded. The same press is a GOOD under beatoraja, whose HAZARD survives it.
 */
const FAILED_EARLY = makeReplay({ gauge: 'DEATH', judgeRuleset: 'lr2', endOnFailure: true }, [
  { timeUs: 890_000, action: 'down', channels: ['11'] },
]);

describe('findReplayNotSimulatedReason', () => {
  test('a bare gauge the ruleset does not define is never mapped to a lookalike', () => {
    expect(findReplayNotSimulatedReason(makeReplay({ gauge: 'P-ATTACK' }), 'beatoraja')).toBe('gauge');
    expect(findReplayNotSimulatedReason(makeReplay({ gauge: 'P-ATTACK' }), 'lr2')).toBeUndefined();
    expect(findReplayNotSimulatedReason(makeReplay({ gauge: 'EX-HARD', judgeRuleset: 'beatoraja' }), 'lr2')).toBe(
      'gauge',
    );
    expect(findReplayNotSimulatedReason(makeReplay({ gauge: 'DEATH' }), '____')).toBe('gauge');
    // A course stage plays the pick on the course gauges, which AC takes from beatoraja.
    expect(findReplayNotSimulatedReason(makeReplay({ gauge: 'DEATH', course: { kind: 'grade' } }), '____')).toBe(
      undefined,
    );
    // The second player's own gauge decides for that side.
    const couple = makeReplay({ gauge: 'GROOVE', gauge2P: 'G-ATTACK', battleMode: 'TWO-PLAYER' });
    expect(findReplayNotSimulatedReason(couple, 'beatoraja', 1)).toBeUndefined();
    expect(findReplayNotSimulatedReason(couple, 'beatoraja', 2)).toBe('gauge');
  });

  test('CUSTOM JUDGE and gauge auto-shift have no reading outside beatoraja yet', () => {
    const customJudge = makeReplay({
      judgeRuleset: 'beatoraja',
      customJudge: { ...DEFAULT_BEATORAJA_CUSTOM_JUDGE },
    });
    expect(findReplayNotSimulatedReason(customJudge, 'beatoraja')).toBeUndefined();
    expect(findReplayNotSimulatedReason(customJudge, 'lr2')).toBe('custom-judge');
    const autoShift = makeReplay({ judgeRuleset: 'beatoraja', gaugeAutoShift: 'CONTINUE' });
    expect(findReplayNotSimulatedReason(autoShift, '____')).toBe('gauge-auto-shift');
    expect(
      findReplayNotSimulatedReason({ ...autoShift, play: { ...autoShift.play, gaugeAutoShift: 'NONE' } }, 'lr2'),
    ).toBe(undefined);
  });
});

describe('rejudgeReplay', () => {
  test('reports a ruleset that cannot read the replay as not simulated instead of throwing', () => {
    const replay = makeReplay({ gauge: 'P-ATTACK' });
    expect(() => simulateReplay(replay, { ruleset: 'beatoraja' })).toThrow();
    expect(rejudgeReplay(replay, { ruleset: 'beatoraja' })).toEqual({ status: 'not-simulated', reason: 'gauge' });
    expect(rejudgeReplay(replay, { ruleset: 'lr2' }).status).toBe('simulated');
  });

  test('judges a run that ended on failure only up to that point, and marks a survivor truncated', () => {
    const played = rejudgeReplay(FAILED_EARLY, { ruleset: 'lr2' });
    expect(played.status).toBe('simulated');
    if (played.status !== 'simulated') return;
    expect(played.result.gauge).toMatchObject({ failedMidPlay: true });
    const failures: number[] = [];
    simulateReplay(FAILED_EARLY, { ruleset: 'lr2', onFailure: (atUs) => failures.push(atUs) });
    expect(failures).toEqual([890_000]);

    const other = rejudgeReplay(FAILED_EARLY, { ruleset: 'beatoraja' });
    expect(other.status).toBe('truncated');
    if (other.status !== 'truncated') return;
    expect(other.stoppedAtUs).toBe(890_000);
    // The two notes after the stop are neither judged nor missed: no inputs are synthesized for them.
    expect(other.result.judge).toMatchObject({ good: 1, bad: 0, poor: 0 });
    // Without the cut, the unrecorded notes would have been missed and failed HAZARD.
    expect(simulateReplay(FAILED_EARLY, { ruleset: 'beatoraja' }).gauge.failedMidPlay).toBe(true);
  });

  test('a ruleset whose gauge fails by the same point is simulated in full', () => {
    // 120 ms early is a BAD under both, which empties both DEATH and HAZARD at once.
    const replay = makeReplay({ gauge: 'DEATH', judgeRuleset: 'lr2', endOnFailure: true }, [
      { timeUs: 880_000, action: 'down', channels: ['11'] },
    ]);
    const outcome = rejudgeReplay(replay, { ruleset: 'beatoraja' });
    expect(outcome.status).toBe('simulated');
    if (outcome.status === 'simulated') expect(outcome.result.gauge.failedMidPlay).toBe(true);
  });

  test('a run that did not end on failure is never truncated', () => {
    const kept = { ...FAILED_EARLY, play: { ...FAILED_EARLY.play, endOnFailure: false } };
    expect(rejudgeReplay(kept, { ruleset: 'beatoraja' }).status).toBe('simulated');
    const givenUp = { ...FAILED_EARLY, play: { ...FAILED_EARLY.play, aborted: true, abortedAtUs: 900_000 } };
    expect(rejudgeReplay(givenUp, { ruleset: 'beatoraja' }).status).toBe('simulated');
  });

  test('rejudgeReplayRulesets keys each ruleset’s outcome', () => {
    const outcomes = rejudgeReplayRulesets(FAILED_EARLY, ['lr2', 'beatoraja', '____']);
    expect(Object.fromEntries(Object.entries(outcomes).map(([ruleset, outcome]) => [ruleset, outcome.status]))).toEqual(
      {
        lr2: 'simulated',
        beatoraja: 'truncated',
        ____: 'not-simulated',
      },
    );
  });
});

describe('rejudgeCourseReplay', () => {
  function makeCourse(stage: BeMusicReplay): BeMusicCourseReplay {
    return {
      format: BE_MUSIC_COURSE_REPLAY_FORMAT,
      version: BE_MUSIC_REPLAY_VERSION,
      course: { name: 'Test', kind: 'expert', constraints: [], trophies: [] },
      stages: [
        { played: true, replay: stage },
        { played: false, facts: rulesetChartFactsFromReplay(stage) },
      ],
    };
  }

  test('a stage log the ruleset cannot read makes the run not simulated, naming the stage', () => {
    const stage = makeReplay({ gauge: 'P-ATTACK', course: { kind: 'expert' } }, []);
    expect(rejudgeCourseReplay(makeCourse(stage), { ruleset: 'beatoraja' })).toEqual({
      status: 'not-simulated',
      reason: 'gauge',
      stage: 0,
    });
    expect(rejudgeCourseReplay(makeCourse(stage), { ruleset: 'lr2' }).status).toBe('simulated');
  });

  test('a run the played ruleset ended at a failed stage is truncated where another gauge carries on', () => {
    const stage = { ...FAILED_EARLY, play: { ...FAILED_EARLY.play, course: { kind: 'expert' as const } } };
    const course = makeCourse(stage);
    expect(rejudgeCourseReplay(course, { ruleset: 'lr2' }).status).toBe('simulated');
    const other = rejudgeCourseReplay(course, { ruleset: 'beatoraja' });
    expect(other.status).toBe('truncated');
    if (other.status === 'truncated') expect(other.result.stages[0]!.judge).toMatchObject({ good: 1, poor: 0 });
  });
});
