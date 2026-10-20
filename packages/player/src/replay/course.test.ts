import { createEmptyJSON, type BeMusicJSON } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import { manualPlay } from '../index.ts';
import type { PlayerOptions } from '../core/engine.ts';
import {
  aggregateCourseResult,
  createCourseReplay,
  extractCourseStage,
  parseCourseReplay,
  resolveCourseReplayFilename,
  resolveCourseLamp,
  resolveCourseStageStartGauge,
  resolveCourseTrophy,
  serializeCourseReplay,
  simulateCourseReplay,
  type ReplayCourseInfo,
  type ReplayCourseStageEntry,
} from './course.ts';
import type { BeMusicReplay, ReplayCourseStage, ReplayInputEvent, ReplayRulesetResult } from './format.ts';
import { rulesetChartFactsFromReplay } from './rulesets.ts';
import { simulateReplay } from './simulate.ts';

const COURSE: ReplayCourseInfo = {
  name: 'Test Dan',
  kind: 'grade',
  constraints: ['grade_mirror', 'gauge_lr2'],
  trophies: [
    { name: 'silver', missRate: 10, scoreRate: 50 },
    { name: 'gold', missRate: 5, scoreRate: 80 },
  ],
};

function stageResult(overrides: Partial<ReplayRulesetResult> = {}): ReplayRulesetResult {
  return {
    ruleset: 'lr2/0',
    judge: { pgreat: 8, great: 1, good: 1, bad: 0, poor: 0, emptyPoor: 0 },
    fast: 1,
    slow: 1,
    exScore: 17,
    noteCount: 10,
    maxCombo: 10,
    gauge: { type: 'GRADE', final: 80, cleared: true },
    course: { combo: 10, maxCombo: 10 },
    ...overrides,
  };
}

describe('course results', () => {
  test('resolveCourseLamp follows the LR2 pick, the beatoraja class gauge, and full-combo upgrades', () => {
    const base = {
      judge: { pgreat: 5, great: 1, good: 1, bad: 1, poor: 0, emptyPoor: 0 },
      noteCount: 8,
      maxCombo: 4,
      gauge: { type: 'GRADE', final: 50, cleared: true },
    };
    expect(resolveCourseLamp('lr2', base, 'GROOVE')).toBe('NORMAL');
    expect(resolveCourseLamp('lr2', base, 'EASY')).toBe('EASY');
    expect(resolveCourseLamp('lr2', base, 'HARD')).toBe('HARD');
    // LR2 awards HARD only for its HARD-family gauges: a DEATH clear is NORMAL.
    expect(resolveCourseLamp('lr2', base, 'DEATH')).toBe('NORMAL');
    expect(resolveCourseLamp('beatoraja', { ...base, gauge: { ...base.gauge, type: 'EXHARDCLASS' } }, 'GROOVE')).toBe(
      'EX_HARD',
    );
    expect(resolveCourseLamp('lr2', { ...base, gauge: { ...base.gauge, cleared: false } }, 'GROOVE')).toBe('FAILED');
    const perfect = { ...base, judge: { ...base.judge, good: 0, bad: 0 }, maxCombo: 8 };
    expect(resolveCourseLamp('beatoraja', perfect, 'GROOVE')).toBe('PERFECT');
    expect(resolveCourseLamp('lr2', perfect, 'GROOVE')).toBe('FULL_COMBO');
    expect(resolveCourseLamp('beatoraja', { ...perfect, judge: { ...perfect.judge, great: 0 } }, 'GROOVE')).toBe('MAX');
  });

  test('resolveCourseTrophy keeps the last trophy that qualifies', () => {
    expect(resolveCourseTrophy(COURSE.trophies, { missCount: 4, exScore: 170, noteCount: 100 })).toBe('gold');
    expect(resolveCourseTrophy(COURSE.trophies, { missCount: 8, exScore: 170, noteCount: 100 })).toBe('silver');
    expect(resolveCourseTrophy(COURSE.trophies, { missCount: 20, exScore: 170, noteCount: 100 })).toBeUndefined();
    expect(resolveCourseTrophy(COURSE.trophies, { missCount: 0, exScore: 0, noteCount: 0 })).toBeUndefined();
  });

  test('aggregateCourseResult sums the stages and counts unreached notes as misses', () => {
    const cleared = aggregateCourseResult(
      'lr2/0',
      COURSE,
      [stageResult(), stageResult({ course: { combo: 20, maxCombo: 20 } })],
      [10, 10],
      'GROOVE',
    );
    expect(cleared).toMatchObject({
      judge: { pgreat: 16, great: 2, good: 2 },
      exScore: 34,
      noteCount: 20,
      missCount: 0,
      maxCombo: 20,
      stagesPlayed: 2,
      lamp: 'FULL_COMBO',
      gauge: { type: 'GRADE', final: 80, cleared: true },
      trophy: 'gold',
    });
    const failed = aggregateCourseResult(
      'lr2/0',
      COURSE,
      [
        stageResult({
          judge: { pgreat: 0, great: 0, good: 0, bad: 2, poor: 3, emptyPoor: 1 },
          gauge: { type: 'GRADE', final: 0, cleared: false },
        }),
      ],
      [10, 12],
      'GROOVE',
    );
    // 2 BAD + 3 POOR + 1 empty POOR, the 5 notes of stage 1 never judged, and all 12 of stage 2.
    expect(failed).toMatchObject({ missCount: 23, noteCount: 22, stagesPlayed: 1, lamp: 'FAILED' });
    expect(failed.trophy).toBeUndefined();
  });
});

/** BPM 240: eight notes on `11`, one per quarter of measures 1 and 2 (1.0 s to 2.75 s). */
function stageChart(): BeMusicJSON {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 240;
  json.metadata.rank = 2;
  json.events = Array.from({ length: 8 }, (_, index) => ({
    measure: 1 + Math.floor(index / 4),
    channel: '11',
    position: [index % 4, 4] as const,
    value: '01',
  }));
  return json;
}

function presses(hit: (index: number) => boolean): ReplayInputEvent[] {
  const events: ReplayInputEvent[] = [];
  for (let index = 0; index < 8; index += 1) {
    if (!hit(index)) continue;
    const timeUs = 1_000_000 + index * 250_000;
    events.push({ seq: events.length, timeUs, action: 'down', channels: ['11'] });
    events.push({ seq: events.length, timeUs: timeUs + 40_000, action: 'up', channels: ['11'] });
  }
  return events;
}

async function playStage(
  inputs: readonly ReplayInputEvent[],
  course: ReplayCourseStage,
  extra: PlayerOptions = {},
): Promise<BeMusicReplay> {
  let replay: BeMusicReplay | undefined;
  await manualPlay(stageChart(), {
    speed: 16,
    leadInMs: 0,
    audio: false,
    tui: false,
    replayInputs: inputs,
    course,
    recordReplay: {},
    onReplayRecorded: (recorded) => {
      replay = recorded;
    },
    ...extra,
  });
  return replay!;
}

/** Carries a stage's native result into the next stage, as a host does. */
function carryFrom(log: BeMusicReplay): ReplayCourseStage['carryIn'] {
  const native = log.results!.native!;
  return { gauge: native.gauge.final, combo: native.course!.combo, maxCombo: native.course!.maxCombo };
}

describe('course replays', () => {
  test('a course given up with ESC counts as a failed run, whatever the gauge', async () => {
    const first = await playStage(
      presses(() => true),
      { kind: 'grade' },
    );
    const second = await playStage(
      presses(() => true),
      { kind: 'grade', carryIn: carryFrom(first) },
    );
    // Given up halfway through the last stage: the notes after 1.5 s were never judged.
    second.play.aborted = true;
    second.play.abortedAtUs = 1_500_000;
    second.inputs = second.inputs.filter((input) => input.timeUs < 1_500_000);
    const log = createCourseReplay({
      course: COURSE,
      stages: [
        { played: true, replay: first },
        { played: true, replay: second },
      ],
    });
    const simulated = simulateCourseReplay(log, { ruleset: 'lr2' });
    expect(simulated.gauge.cleared).toBe(false);
    expect(simulated.lamp).toBe('FAILED');
    expect(simulated.stagesPlayed).toBe(2);
    expect(simulated.missCount).toBeGreaterThan(0);
    expect(log.results?.native?.lamp).toBe('FAILED');
  });

  test('the engine’s course result is lamped by the judge ruleset the run was played on', async () => {
    // LR2: an EASY pick lamps a grade course EASY, though it plays on the GRADE gauge.
    const easyFirst = await playStage(
      presses((index) => index !== 3),
      { kind: 'grade' },
      { gauge: 'EASY' },
    );
    const easySecond = await playStage(
      presses(() => true),
      { kind: 'grade', carryIn: carryFrom(easyFirst) },
      { gauge: 'EASY' },
    );
    const easy = createCourseReplay({
      course: COURSE,
      stages: [
        { played: true, replay: easyFirst },
        { played: true, replay: easySecond },
      ],
    });
    expect(easy.results?.native?.lamp).toBe('EASY');
    expect(simulateCourseReplay(easy, { ruleset: 'lr2' }).lamp).toBe('EASY');

    // beatoraja: every note a PGREAT is a MAX, beyond LR2's FULL COMBO.
    const maxFirst = await playStage(
      presses(() => true),
      { kind: 'grade' },
      { judgeRuleset: 'beatoraja' },
    );
    const maxSecond = await playStage(
      presses(() => true),
      { kind: 'grade', carryIn: carryFrom(maxFirst) },
      { judgeRuleset: 'beatoraja' },
    );
    const max = createCourseReplay({
      course: COURSE,
      stages: [
        { played: true, replay: maxFirst },
        { played: true, replay: maxSecond },
      ],
    });
    expect(max.results?.native?.lamp).toBe('MAX');
    expect(simulateCourseReplay(max, { ruleset: 'beatoraja' }).lamp).toBe('MAX');
  });

  test('a cleared course re-simulates to the result the engine recorded', async () => {
    const first = await playStage(
      presses((index) => index !== 3),
      { kind: 'grade' },
    );
    const second = await playStage(
      presses(() => true),
      { kind: 'grade', carryIn: carryFrom(first) },
    );
    const log = createCourseReplay({
      course: COURSE,
      stages: [
        { played: true, replay: first },
        { played: true, replay: second },
      ],
      createdAt: '2026-10-15T00:00:00.000Z',
    });
    const native = log.results!.native!;
    expect(native).toMatchObject({ stagesPlayed: 2, noteCount: 16, maxCombo: 12, lamp: 'NORMAL' });
    expect(native.gauge.cleared).toBe(true);

    const simulated = simulateCourseReplay(log, { ruleset: 'lr2' });
    expect(simulated).toMatchObject({
      judge: native.judge,
      exScore: native.exScore,
      maxCombo: native.maxCombo,
      missCount: native.missCount,
      lamp: native.lamp,
      gauge: native.gauge,
    });

    // A stage comes out as a standalone log that re-simulates to its own stage result.
    const stage = extractCourseStage(log, 1)!;
    expect(stage.play.course?.carryIn).toEqual(carryFrom(first));
    expect(simulateReplay(stage, { ruleset: 'lr2' }).gauge.final).toBe(native.stages[1]!.gauge.final);
    expect(extractCourseStage(log, 5)).toBeUndefined();

    // The course log round-trips.
    expect(parseCourseReplay(serializeCourseReplay(log))).toEqual(log);
  });

  test('a failed course stops at the failed stage and counts the unreached stage as misses', async () => {
    // GRADE-DEATH: the first POOR empties the gauge. Stage 1 is played clean; stage 2 is not touched, so it fails at
    // its first note and the run never reaches stage 3.
    const death = { gauge: 'DEATH' } as const;
    const first = await playStage(
      presses(() => true),
      { kind: 'grade' },
      death,
    );
    const failing = await playStage([], { kind: 'grade', carryIn: carryFrom(first) }, death);
    expect(failing.results?.native?.gauge.failedMidPlay).toBe(true);
    const unreached: ReplayCourseStageEntry = { played: false, facts: rulesetChartFactsFromReplay(failing) };
    const log = createCourseReplay({
      course: COURSE,
      stages: [{ played: true, replay: first }, { played: true, replay: failing }, unreached],
    });
    const native = log.results!.native!;
    expect(native).toMatchObject({ stagesPlayed: 2, noteCount: 24, lamp: 'FAILED' });
    expect(native.gauge.cleared).toBe(false);
    // Stage 2's first POOR, its seven notes never judged, and stage 3's eight.
    expect(native.missCount).toBe(16);

    const simulated = simulateCourseReplay(log, { ruleset: 'lr2' });
    expect(simulated).toMatchObject({ stagesPlayed: 2, missCount: 16, lamp: 'FAILED', judge: native.judge });
    expect(parseCourseReplay(JSON.parse(serializeCourseReplay(log)))).toEqual(log);
  });

  test('keeps an unreleased course marked, and rejects a release that is not a boolean', async () => {
    const played = await playStage([], { kind: 'grade' }, { gauge: 'DEATH' } as const);
    const json = JSON.parse(
      serializeCourseReplay(createCourseReplay({ course: COURSE, stages: [{ played: true, replay: played }] })),
    );
    expect(parseCourseReplay({ ...json, course: { ...json.course, release: false } }).course.release).toBe(false);
    expect(parseCourseReplay({ ...json, course: { ...json.course, release: true } }).course.release).toBeUndefined();
    expect(() => parseCourseReplay({ ...json, course: { ...json.course, release: 'no' } })).toThrow(/course.release/u);
  });

  test('resolveCourseReplayFilename names the file after the course and the time', () => {
    const log = createCourseReplay({
      course: { ...COURSE, name: 'Dan: 1/2 ' },
      stages: [
        {
          played: false,
          facts: {
            sourceFormat: 'bms',
            laneMode: '7-key-sp',
            lnMode: 1,
            judgeRank: { percent: 75 },
            notes: { normal: 1, long: { 1: 0, 2: 0, 3: 0 } },
          },
        },
      ],
      createdAt: '2026-10-15T01:02:03.004Z',
    });
    expect(resolveCourseReplayFilename(log)).toBe('Dan 1 2-2026-10-15T01-02-03-004Z.bmcourse.json');
    expect(resolveCourseReplayFilename({ ...log, createdAt: undefined, course: { ...log.course, name: '' } })).toBe(
      'course-unknown-time.bmcourse.json',
    );
  });

  test('parseCourseReplay names the stage and field of a structural problem', () => {
    const log = createCourseReplay({
      course: COURSE,
      stages: [
        {
          played: false,
          facts: {
            sourceFormat: 'bms',
            laneMode: '7-key-sp',
            lnMode: 1,
            judgeRank: { percent: 75 },
            notes: { normal: 4, long: { 1: 0, 2: 0, 3: 0 } },
          },
        },
      ],
    });
    const corrupt = (mutate: (value: any) => void): unknown => {
      const value = JSON.parse(serializeCourseReplay(log));
      mutate(value);
      return value;
    };
    expect(() => parseCourseReplay('{')).toThrow('invalid JSON');
    expect(() => parseCourseReplay(corrupt((value) => (value.format = 'be-music-replay')))).toThrow('format');
    expect(() => parseCourseReplay(corrupt((value) => (value.course.kind = 'dan')))).toThrow('course.kind');
    expect(() => parseCourseReplay(corrupt((value) => (value.stages = [])))).toThrow(
      'stages: expected a non-empty array',
    );
    expect(() => parseCourseReplay(corrupt((value) => (value.stages[0].facts.lnMode = 4)))).toThrow(
      'stages[0].facts.lnMode',
    );
    expect(() =>
      parseCourseReplay(corrupt((value) => (value.stages[0] = { played: true, replay: { format: 'x' } }))),
    ).toThrow('stages[0].replay: format');
  });
});

describe('resolveCourseStageStartGauge', () => {
  test('starts the first stage on a full course gauge named after the pick', () => {
    expect(resolveCourseStageStartGauge('lr2', { kind: 'grade' }, 'GROOVE')).toEqual({
      type: 'GRADE',
      initial: 100,
      max: 100,
      border: 0,
      survival: true,
    });
    expect(resolveCourseStageStartGauge('lr2', { kind: 'expert' }, 'EASY').type).toBe('COURSE-EASY');
    expect(resolveCourseStageStartGauge('beatoraja', { kind: 'grade' }, 'HARD').type).toBe('EXCLASS');
  });

  test('starts a later stage on the gauge carried in, clamped to the range', () => {
    const carryIn = { gauge: 64, combo: 3, maxCombo: 12 };
    expect(resolveCourseStageStartGauge('lr2', { kind: 'grade', carryIn }, 'GROOVE').initial).toBe(64);
    const over = { kind: 'expert' as const, carryIn: { ...carryIn, gauge: 140 } };
    expect(resolveCourseStageStartGauge('beatoraja', over, 'GROOVE').initial).toBe(100);
  });
});
