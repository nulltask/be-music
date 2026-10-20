import { computeChartFingerprint } from '@be-music/chart-model';
import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicReplay, ReplayRulesetResult } from '../replay/format.ts';
import { CourseRun, parseBeatorajaCourseData, resolveGivenUpPlaySeconds } from './index.ts';

const MD5 = ['1', '2', '3'].map((digit) => digit.repeat(32));

interface Stage {
  id: string;
  chart: BeMusicJSON;
  chartPath: string;
}

const stage = (id: string): Stage => ({ id, chart: createEmptyJSON('bms'), chartPath: `${id}.bms` });

function definition(constraint: string[] = ['MIRROR', 'GAUGE_LR2', 'NO_SPEED', 'HCN']) {
  return parseBeatorajaCourseData({ name: 'Dan', hash: MD5.map((md5) => ({ md5 })), constraint })!;
}

function run(constraint?: string[]): CourseRun<Stage, { playSeconds?: number; graph?: number[] }> {
  return new CourseRun(definition(constraint), ['a', 'b', 'c'].map(stage));
}

function stageLog(native: Partial<ReplayRulesetResult>, play?: Partial<BeMusicReplay['play']>): BeMusicReplay {
  return {
    ...(play !== undefined ? { play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', ...play } } : {}),
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
  } as unknown as BeMusicReplay;
}

describe('CourseRun', () => {
  test('plans each stage with the course settings and the state the previous stage left', () => {
    const course = run();
    const first = course.nextStage()!;
    expect(first).toMatchObject({ index: 0, stageCount: 3, hiSpeedLocked: true });
    expect(first.course).toEqual({ kind: 'grade', gaugeSet: 'lr2' });
    expect(first.stage.id).toBe('a');
    // The HCN constraint applies to a chart that leaves its long-note mode undefined.
    expect(first.stage.chart.sourceFormat === 'bms' && first.stage.chart.bms.lnMode).toBe(3);

    expect(
      course.recordStage(
        stageLog({ gauge: { type: 'GRADE', final: 71.5, cleared: true }, course: { combo: 4, maxCombo: 10 } }),
      ),
    ).toBe('next');
    const second = course.nextStage()!;
    expect(second.index).toBe(1);
    expect(second.course.carryIn).toEqual({ gauge: 71.5, combo: 4, maxCombo: 10 });
  });

  test('gives back the host’s own stage entries, each chart as the course plays it', () => {
    const plain = stage('a');
    const course = new CourseRun(definition([]), [plain]);
    // Nothing to apply: the entry itself.
    expect(course.stages[0]).toBe(plain);
    const constrained = run().stages;
    expect(constrained.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(constrained.every((entry) => entry.chart.sourceFormat === 'bms' && entry.chart.bms.lnMode === 3)).toBe(true);
  });

  test('carries the stage max combo when a stage has no course combo', () => {
    const course = run([]);
    course.recordStage(stageLog({ maxCombo: 7, course: undefined }));
    expect(course.nextStage()!.course.carryIn).toEqual({ gauge: 90, combo: 0, maxCombo: 7 });
  });

  test('records a stage given up with ESC and ends the run there', () => {
    const course = run([]);
    course.recordStage(stageLog({}));
    course.giveUp(stageLog({ gauge: { type: 'GRADE', final: 70, cleared: true } }, { aborted: true }));
    expect(course.finished).toBe(true);
    expect(course.stagesPlayed).toBe(2);
    expect(course.nextStage()).toBeUndefined();
    // Nothing more is recorded once the run is over.
    expect(course.recordStage(stageLog({}))).toBe('finished');
    expect(course.stagesPlayed).toBe(2);
  });

  test('ends on a failed stage and after the last stage', () => {
    const failing = run();
    expect(
      failing.recordStage(stageLog({ gauge: { type: 'GRADE', final: 0, cleared: false, failedMidPlay: true } })),
    ).toBe('finished');
    expect(failing.finished).toBe(true);
    expect(failing.nextStage()).toBeUndefined();

    const full = run([]);
    expect(full.recordStage(stageLog({}))).toBe('next');
    expect(full.recordStage(stageLog({}))).toBe('next');
    expect(full.recordStage(stageLog({}))).toBe('finished');
    expect(full.stagesPlayed).toBe(3);
    // A stage without a replay ends the run too.
    expect(run().recordStage(undefined)).toBe('finished');
  });

  test('tells whether the run goes on after a stage before it is recorded', () => {
    const course = run([]);
    expect(course.goesOnAfter(stageLog({}))).toBe(true);
    expect(course.goesOnAfter(stageLog({ gauge: { type: 'GRADE', final: 0, cleared: false } }))).toBe(false);
    expect(course.goesOnAfter(undefined)).toBe(false);
    // Asking records nothing.
    expect(course.stagesPlayed).toBe(0);
    course.recordStage(stageLog({}));
    course.recordStage(stageLog({}));
    // After the last stage the course result follows.
    expect(course.goesOnAfter(stageLog({}))).toBe(false);
  });

  test('keeps what the host keeps of each played stage', () => {
    const course = run([]);
    const extras = { graph: [100, 80] };
    course.recordStage(stageLog({}), extras);
    course.giveUp(stageLog({}));
    expect(course.stageExtras).toEqual([extras, undefined]);
  });

  test('adds up the play time of the stages played, a given-up stage up to where it was left', () => {
    const course = run([]);
    course.recordStage(stageLog({}), { playSeconds: 92.5 });
    course.giveUp(stageLog({}, { aborted: true, abortedAtUs: 30_250_000 }));
    expect(course.playSeconds).toBeCloseTo(122.75);
    expect(run([]).playSeconds).toBe(0);
  });

  test('builds the course replay with each unreached stage’s facts, hashes and chart fingerprint', () => {
    const course = run();
    course.recordStage(
      stageLog(
        { gauge: { type: 'GRADE', final: 0, cleared: false, failedMidPlay: true } },
        { course: { kind: 'grade' } },
      ),
    );
    const log = course.buildReplay({ createdAt: '2026-10-16T00:00:00.000Z', recorder: { name: 'test' } });
    expect(log).toMatchObject({
      createdAt: '2026-10-16T00:00:00.000Z',
      recorder: { name: 'test' },
      course: { name: 'Dan', kind: 'grade', constraints: ['grade_mirror', 'gauge_lr2', 'no_speed', 'hcn'] },
    });
    expect(log.stages[0]).toMatchObject({ played: true });
    // The unreached stages are read as the course plays them: the HCN constraint applied.
    const played = course.stages[1]!.chart;
    expect(log.stages.slice(1)).toMatchObject([
      {
        played: false,
        md5: MD5[1],
        chartFingerprint: computeChartFingerprint(played, { chartPath: 'b.bms' }),
        facts: { sourceFormat: 'bms', lnMode: 3 },
      },
      { played: false, md5: MD5[2], facts: { lnMode: 3 } },
    ]);
    expect(log.results?.native).toMatchObject({ stagesPlayed: 1, lamp: 'FAILED' });
  });

  test('marks a course whose runs must not be ranked', () => {
    const unreleased = { ...definition([]), release: false as const };
    expect(new CourseRun(unreleased, ['a', 'b', 'c'].map(stage)).buildReplay().course.release).toBe(false);
    expect(run([]).buildReplay().course).not.toHaveProperty('release');
  });

  test('applies the course’s stage play settings', () => {
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
    expect(run(['MIRROR']).playSettings(picks)).toEqual({ ...picks, random1P: 'OFF', random2P: 'OFF', dpFlip: false });
  });

  test('refuses a course with a missing stage', () => {
    expect(() => new CourseRun(definition(), [stage('a'), undefined, stage('c')])).toThrow(
      'course "Dan" has no chart for stage 2',
    );
  });
});

describe('resolveGivenUpPlaySeconds', () => {
  test('counts a stage left after its chart settled up to its last note', () => {
    const settled = {
      play: { mode: 'manual' as const, autoScratch: false, gauge: 'GROOVE' as const },
      chart: {
        notes: [
          { id: 0, channel: '11', type: 'normal' as const, timeUs: 1_000_000 },
          { id: 1, channel: '12', type: 'long' as const, timeUs: 2_000_000, endTimeUs: 9_500_000 },
          { id: 2, channel: '13', type: 'normal' as const, timeUs: 8_000_000 },
        ],
      },
    } as unknown as BeMusicReplay;
    expect(resolveGivenUpPlaySeconds(settled)).toBe(9.5);
    // An abort without its time says nothing.
    expect(resolveGivenUpPlaySeconds({ play: { ...settled.play, aborted: true } })).toBeUndefined();
    expect(resolveGivenUpPlaySeconds({ play: { ...settled.play, aborted: true, abortedAtUs: 3_000_000 } })).toBe(3);
  });

  test('says nothing for a log without notes', () => {
    expect(resolveGivenUpPlaySeconds({})).toBeUndefined();
  });
});
