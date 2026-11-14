import { describe, expect, test } from 'vite-plus/test';
import { isCourseStageFailed } from '../ruleset/course.ts';
import { BE_MUSIC_COURSE_REPLAY_FORMAT, simulateCourseReplay, type BeMusicCourseReplay } from './course.ts';
import {
  BE_MUSIC_REPLAY_FORMAT,
  BE_MUSIC_REPLAY_VERSION,
  parseReplay,
  type BeMusicReplay,
  type ReplayInputEvent,
  type ReplayNote,
} from './format.ts';
import { resolveReplayGaugeHistories } from './gauge-histories.ts';
import { findReplayNotSimulatedReason, rejudgeCourseReplay, rejudgeReplay } from './rejudge.ts';
import { resolveRulesetResultLamp } from './result-lamp.ts';
import { simulateReplay } from './simulate.ts';

/* A replay's source-qualified gauge (`play.gauge: 'lr2:HARD'`, #1171) is carried under every ruleset (ADR 0019). */

/** Ten notes on lane 11, every 200 ms from 1 s. */
const NOTES: ReplayNote[] = Array.from({ length: 10 }, (_, id) => ({
  id,
  channel: '11',
  type: 'normal',
  timeUs: 1_000_000 + id * 200_000,
}));

/** A press on each of the first `count` notes, dead on. */
function presses(count: number): Array<Omit<ReplayInputEvent, 'seq'>> {
  return NOTES.slice(0, count).flatMap((note) => [
    { timeUs: note.timeUs, action: 'down' as const, channels: ['11'], source: 0 },
    { timeUs: note.timeUs + 50_000, action: 'up' as const, channels: ['11'], source: 0 },
  ]);
}

function makeReplay(
  play: Partial<BeMusicReplay['play']> = {},
  inputs: Array<Omit<ReplayInputEvent, 'seq'>> = presses(NOTES.length),
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
      total: 300,
      noteCount: NOTES.length,
      notes: NOTES,
    },
    inputs: inputs.map((input, seq) => ({ ...input, seq })),
    play: {
      mode: 'manual',
      autoScratch: false,
      gauge: 'GROOVE',
      ...play,
      inputSources: play.inputSources ?? [{ id: 0, kind: 'key', device: 'keyboard', label: 'z' }],
    },
  };
}

describe('parsing', () => {
  test('a replay keeps a qualified gauge for either player', () => {
    const replay = makeReplay({ gauge: 'lr2:HARD', gauge2P: '____:EASY', judgeRuleset: 'beatoraja' });
    const parsed = parseReplay(JSON.parse(JSON.stringify(replay)));
    expect(parsed.play.gauge).toBe('lr2:HARD');
    expect(parsed.play.gauge2P).toBe('____:EASY');
  });

  test('a gauge its source does not define is refused', () => {
    for (const gauge of ['lr2:EX-HARD', 'beatoraja:P-ATTACK', '____:DEATH', 'other:HARD']) {
      const raw = JSON.parse(JSON.stringify(makeReplay()));
      raw.play.gauge = gauge;
      expect(() => parseReplay(raw), gauge).toThrow(/play\.gauge/);
    }
  });

  test('a result names the source of a gauge that is not the judging ruleset’s own', () => {
    const replay = makeReplay({ gauge: 'lr2:HARD', judgeRuleset: 'beatoraja' });
    replay.results = { native: simulateReplay(replay, { ruleset: 'beatoraja' }) };
    expect(replay.results.native!.gauge).toMatchObject({ type: 'HARD', source: 'lr2' });
    expect(parseReplay(JSON.parse(JSON.stringify(replay))).results!.native!.gauge.source).toBe('lr2');
    const raw = JSON.parse(JSON.stringify(replay));
    raw.results.native.gauge.source = 'nanasi';
    expect(() => parseReplay(raw)).toThrow(/gauge\.source/);
  });
});

describe('re-judging', () => {
  test('a qualified gauge is its source’s under every ruleset, where the bare one is not simulated', () => {
    const bare = makeReplay({ gauge: 'P-ATTACK', judgeRuleset: 'lr2' });
    const qualified = makeReplay({ gauge: 'lr2:P-ATTACK', judgeRuleset: 'lr2' });
    for (const ruleset of ['beatoraja', '____'] as const) {
      expect(findReplayNotSimulatedReason(bare, ruleset)).toBe('gauge');
      expect(findReplayNotSimulatedReason(qualified, ruleset)).toBeUndefined();
      const outcome = rejudgeReplay(qualified, { ruleset });
      expect(outcome.status).toBe('simulated');
      if (outcome.status === 'simulated')
        expect(outcome.result.gauge).toMatchObject({ type: 'P-ATTACK', source: 'lr2', cleared: true });
    }
    const exHard = makeReplay({ gauge: 'beatoraja:EX-HARD', judgeRuleset: 'beatoraja' });
    const underLR2 = rejudgeReplay(exHard, { ruleset: 'lr2' });
    expect(underLR2.status).toBe('simulated');
    if (underLR2.status === 'simulated')
      expect(underLR2.result.gauge).toMatchObject({ type: 'EX-HARD', source: 'beatoraja' });
  });

  test('a bare gauge still reads as each target ruleset’s own', () => {
    const replay = makeReplay({ gauge: 'GROOVE', judgeRuleset: 'lr2' });
    expect(simulateReplay(replay, { ruleset: 'lr2' }).gauge.type).toBe('GROOVE');
    expect(simulateReplay(replay, { ruleset: 'beatoraja' }).gauge).toMatchObject({ type: 'NORMAL' });
    expect(simulateReplay(replay, { ruleset: 'beatoraja' }).gauge).not.toHaveProperty('source');
  });

  test('the gauge’s lamp follows its source; the full-combo lamps stay the judging ruleset’s', () => {
    const full = simulateReplay(makeReplay({ gauge: 'lr2:DEATH' }), { ruleset: 'beatoraja' });
    expect(full.gauge).toMatchObject({ type: 'DEATH', source: 'lr2', cleared: true });
    // A full combo of PGREATs is beatoraja's MAX whatever the gauge.
    expect(resolveRulesetResultLamp(full, 'beatoraja')).toBe('MAX');
    // Without the full combo the clear keeps LR2's reading of DEATH (a NORMAL clear), not beatoraja's EX HARD.
    const broken = { ...full, judge: { ...full.judge, pgreat: 9, bad: 1 } };
    expect(resolveRulesetResultLamp(broken, 'beatoraja')).toBe('NORMAL');
    expect(resolveRulesetResultLamp({ ...broken, gauge: { ...broken.gauge, source: undefined } }, 'beatoraja')).toBe(
      'EX_HARD',
    );
    // beatoraja's HAZARD under LR2 judging keeps its own lamp, capped at LR2's top lamp.
    const hazard = simulateReplay(makeReplay({ gauge: 'beatoraja:DEATH' }), { ruleset: 'lr2' });
    expect(hazard.gauge).toMatchObject({ type: 'HAZARD', source: 'beatoraja', cleared: true });
    expect(resolveRulesetResultLamp({ ...hazard, judge: { ...hazard.judge, pgreat: 9, bad: 1 } }, 'lr2')).toBe(
      'FULL_COMBO',
    );
    const hard = simulateReplay(makeReplay({ gauge: '____:HARD' }), { ruleset: 'lr2' });
    expect(resolveRulesetResultLamp({ ...hard, judge: { ...hard.judge, pgreat: 9, bad: 1 } }, 'lr2')).toBe('HARD');
  });

  test('the result’s gauge graphs step through the gauge’s own source’s line-up', () => {
    const replay = makeReplay({ gauge: 'lr2:HARD', judgeRuleset: 'beatoraja' });
    expect(resolveReplayGaugeHistories(replay).map((history) => history.gauge)).toEqual([
      'EASY',
      'GROOVE',
      'HARD',
      'DEATH',
    ]);
  });
});

describe('courses', () => {
  function makeCourse(stages: BeMusicReplay[]): BeMusicCourseReplay {
    return {
      format: BE_MUSIC_COURSE_REPLAY_FORMAT,
      version: BE_MUSIC_REPLAY_VERSION,
      course: { name: 'Test', kind: 'expert', constraints: [], trophies: [] },
      stages: stages.map((replay) => ({ played: true, replay })),
    };
  }
  const stage = (gauge: BeMusicReplay['play']['gauge'], hits: number): BeMusicReplay =>
    makeReplay({ gauge, judgeRuleset: 'beatoraja', course: { kind: 'expert' } }, presses(hits));

  test('each stage carries the source’s course gauge into the next, under every ruleset', () => {
    const course = makeCourse([stage('lr2:GROOVE', 9), stage('lr2:GROOVE', 10)]);
    const own = makeCourse(
      course.stages.flatMap((entry) =>
        entry.played
          ? [
              {
                ...entry.replay,
                play: { ...entry.replay.play, gauge: 'GROOVE' as const, judgeRuleset: 'lr2' as const },
              },
            ]
          : [],
      ),
    );
    const reference = simulateCourseReplay(own, { ruleset: 'lr2' });
    for (const ruleset of ['lr2', 'beatoraja', '____'] as const) {
      const outcome = rejudgeCourseReplay(course, { ruleset });
      expect(outcome.status, ruleset).toBe('simulated');
      if (outcome.status !== 'simulated') continue;
      const { result } = outcome;
      expect(result.stages.map((entry) => entry.gauge.type)).toEqual(['COURSE', 'COURSE']);
      expect(result.gauge.source, ruleset).toBe(ruleset === 'lr2' ? undefined : 'lr2');
      // Dead-on presses are PGREATs under every ruleset, so the carried gauge is the one LR2 itself computes.
      expect(result.stages.map((entry) => entry.gauge.final)).toEqual(
        reference.stages.map((entry) => entry.gauge.final),
      );
      expect(result.stages[0]!.gauge.final).toBeLessThan(100);
    }
  });

  test('a stage fails by its gauge’s own source’s rule', () => {
    // LR2's course gauges end a run below 2 %; a class gauge only at 0.
    expect(isCourseStageFailed('beatoraja', { final: 1, source: 'lr2' })).toBe(true);
    expect(isCourseStageFailed('beatoraja', { final: 1 })).toBe(false);
    expect(isCourseStageFailed('lr2', { final: 1, source: 'beatoraja' })).toBe(false);
    expect(isCourseStageFailed('lr2/0', { final: 1 })).toBe(true);
  });
});
