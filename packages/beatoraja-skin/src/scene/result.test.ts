import { describe, expect, it } from 'vite-plus/test';
import { BEATORAJA_GAUGE_MODE } from '../elements/gauge.ts';
import { BEATORAJA_NUM, BEATORAJA_OP, BEATORAJA_TEXT } from '../runtime-ids.ts';
import {
  beatorajaEarlyLateFromTimings,
  beatorajaTimingStats,
  resolveBeatorajaResultGaugePercent,
  resolveBeatorajaResultGaugeState,
  resolveBeatorajaResultGraphValue,
  resolveBeatorajaResultJudgeGraph,
  resolveBeatorajaResultNumber,
  resolveBeatorajaResultOps,
  resolveBeatorajaResultPolyline,
  resolveBeatorajaResultText,
  type BeatorajaResultFacts,
  type BeatorajaResultInput,
} from './result.ts';

const TIMINGS = [
  { deltaMs: -10, judge: 'PERFECT' },
  { deltaMs: 6, judge: 'PERFECT' },
  { deltaMs: 0, judge: 'GREAT' },
  { deltaMs: -30, judge: 'GOOD' },
  { deltaMs: 20, judge: 'POOR' },
  { deltaMs: 14, judge: 'BAD' },
];

function facts(overrides: Partial<BeatorajaResultFacts> = {}): BeatorajaResultFacts {
  return {
    score: { total: 10, perfect: 6, great: 2, good: 1, bad: 0, poor: 1, exScore: 14, score: 140_000 },
    fast: 3,
    slow: 2,
    maxCombo: 8,
    cleared: true,
    lamp: 'HARD',
    gaugeHistory: [
      { progress: 0, value: 100 },
      { progress: 1, value: 64 },
    ],
    scoreHistory: [
      { progress: 0, exScore: 0 },
      { progress: 1, exScore: 14 },
    ],
    judgeTimings: TIMINGS,
    ...overrides,
  };
}

function input(overrides: Partial<BeatorajaResultInput> = {}): BeatorajaResultInput {
  return {
    result: facts(),
    gauge: { current: 64, max: 100, clearThreshold: 0, effectiveTotal: 300, type: 'HARD' },
    ...overrides,
  };
}

describe('resolveBeatorajaResultNumber', () => {
  it("reads the run's score numbers, its max combo as the combo too", () => {
    const result = input();
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.POINT, result)).toBe(140_000);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.SCORE_RATE, result)).toBe(70);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.COMBO, result)).toBe(8);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.MAXCOMBO_LIVE, result)).toBe(8);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.GROOVEGAUGE, result)).toBe(64);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.BMS_TOTAL, result)).toBe(300);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.TOTALEARLY, result)).toBe(3);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.TOTALLATE, result)).toBe(2);
  });

  it('counts the early / late rows from the timings, the MISS rows reading POOR', () => {
    const result = input();
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.EARLY_PERFECT, result)).toBe(1);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.LATE_PERFECT, result)).toBe(1);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.EARLY_GREAT, result)).toBe(0);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.EARLY_GOOD, result)).toBe(1);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.LATE_BAD, result)).toBe(1);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.LATE_POOR, result)).toBe(1);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.LATE_MISS, result)).toBe(1);
    // A play's own early / late counts win over counting the timings.
    const counted = input({ result: facts({ earlyLate: { PERFECT: { early: 4, late: 5 } } }) });
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.EARLY_PERFECT, counted)).toBe(4);
  });

  it('reads the mean (unsigned) and standard deviation of the timings', () => {
    const result = input({
      result: facts({
        judgeTimings: [
          { deltaMs: -10.5, judge: 'GREAT' },
          { deltaMs: -20.25, judge: 'GOOD' },
        ],
      }),
    });
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.AVERAGE_TIMING, result)).toBe(15);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.AVERAGE_TIMING_AFTERDOT, result)).toBe(37);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.STDDEV_TIMING, result)).toBe(4);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.STDDEV_TIMING_AFTERDOT, result)).toBe(87);
  });

  it('reads 0 for the records nothing feeds yet, number 75 included', () => {
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.BEST_MAXCOMBO, input())).toBe(0);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.TARGET_SCORE, input())).toBe(0);
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.HISPEED, input())).toBe(0);
  });

  it("falls back on the result's gauge percentage without the engine's gauge", () => {
    const result = input({ gauge: undefined, result: facts({ gauge: 42.5, gaugeType: 'CLASS' }) });
    expect(resolveBeatorajaResultNumber(BEATORAJA_NUM.GROOVEGAUGE, result)).toBe(42);
    expect(resolveBeatorajaResultGaugeState(result)).toEqual({
      value: 42.5,
      max: 100,
      border: 0,
      mode: BEATORAJA_GAUGE_MODE.CLASS,
    });
  });
});

describe('resolveBeatorajaResultOps', () => {
  it('lights the ranks, the verdict, the lamp and the judgment-exists ops', () => {
    expect(resolveBeatorajaResultOps(input())).toEqual([
      BEATORAJA_OP.P1_RANK_A,
      BEATORAJA_OP.RANK_A,
      BEATORAJA_OP.RESULT_RANK_A_1P,
      BEATORAJA_OP.RESULT_CLEAR,
      BEATORAJA_OP.CLEAR_LAMP_HARD,
      BEATORAJA_OP.PERFECT_EXIST,
      BEATORAJA_OP.GREAT_EXIST,
      BEATORAJA_OP.GOOD_EXIST,
      BEATORAJA_OP.POOR_EXIST,
      BEATORAJA_OP.MISS_EXIST,
    ]);
  });

  it('lights RESULT_FAIL, the zero rank, NO PLAY without a lamp, and the course stage ops', () => {
    const ops = resolveBeatorajaResultOps(
      input({
        result: facts({
          score: { total: 10, perfect: 0, great: 0, good: 0, bad: 0, poor: 0, exScore: 0, score: 0 },
          cleared: false,
          lamp: undefined,
          course: { kind: 'grade', title: 'Dan', stages: [{ title: 'a' }, { title: 'b' }], stageIndex: 1 },
        }),
      }),
    );
    expect(ops).toContain(BEATORAJA_OP.RESULT_RANK_ZERO_1P);
    expect(ops).toContain(BEATORAJA_OP.RESULT_FAIL);
    expect(ops).toContain(BEATORAJA_OP.CLEAR_LAMP_NOPLAY);
    expect(ops).toContain(BEATORAJA_OP.MODE_COURSE);
    expect(ops).toContain(BEATORAJA_OP.COURSE_STAGE_FINAL);
  });
});

describe('resolveBeatorajaResultText', () => {
  const song = { title: 'Song', subtitle: 'sub', artist: 'Artist' };

  it('reads the song and skin texts, and a course run its title on the title texts', () => {
    expect(resolveBeatorajaResultText(BEATORAJA_TEXT.FULLTITLE, input({ song }))).toBe('Song sub');
    expect(resolveBeatorajaResultText(BEATORAJA_TEXT.SKIN_AUTHOR, input({ skin: { author: 'Maker' } }))).toBe('Maker');
    expect(resolveBeatorajaResultText(BEATORAJA_TEXT.TABLE_NAME, input({ song }))).toBeUndefined();
    const course = { kind: 'grade' as const, title: 'Dan', stages: [{ title: 'a' }, { title: 'b' }] };
    const run = input({ song, result: facts({ course }) });
    expect(resolveBeatorajaResultText(BEATORAJA_TEXT.TITLE, run)).toBe('Dan');
    expect(resolveBeatorajaResultText(BEATORAJA_TEXT.FULLTITLE, run)).toBe('Dan');
    expect(resolveBeatorajaResultText(BEATORAJA_TEXT.ARTIST, run)).toBe('Artist');
    expect(resolveBeatorajaResultText(BEATORAJA_TEXT.COURSE1_TITLE + 1, run)).toBe('b');
    // A stage's result keeps the stage's chart on the title.
    const stage = input({ song, result: facts({ course: { ...course, stageIndex: 0 } }) });
    expect(resolveBeatorajaResultText(BEATORAJA_TEXT.TITLE, stage)).toBe('Song');
  });
});

describe('result graphs', () => {
  it('fills the gauge and EX-rate bars and draws the score and gauge graphs', () => {
    const result = input();
    expect(resolveBeatorajaResultGraphValue(1, result)).toBe(0.64);
    expect(resolveBeatorajaResultGraphValue(6, result)).toBe(0.64);
    expect(resolveBeatorajaResultGraphValue(7, result)).toBe(0.7);
    expect(resolveBeatorajaResultGraphValue(2, result)).toBeUndefined();
    expect(resolveBeatorajaResultGaugePercent(result)).toBe(64);
    expect(resolveBeatorajaResultPolyline(110, result)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0.7 },
    ]);
    expect(resolveBeatorajaResultPolyline(107, result)).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 0.64 },
    ]);
    expect(resolveBeatorajaResultPolyline(113, result)).toBeUndefined();
    expect(resolveBeatorajaResultGaugeState(result)).toMatchObject({ value: 64, mode: BEATORAJA_GAUGE_MODE.HARD });
  });

  it('draws the note kinds, the counts and the FAST / SLOW counts as judge graphs', () => {
    const breakdown = { normal: 7, ln: 1, scratch: 2, bss: 0 };
    const result = input({ breakdown });
    expect(resolveBeatorajaResultJudgeGraph(0, result)).toEqual([7, 1, 2, 0]);
    expect(resolveBeatorajaResultJudgeGraph(1, result)).toEqual([6, 2, 1, 0, 1]);
    expect(resolveBeatorajaResultJudgeGraph(2, result)).toEqual([3, 2]);
    expect(resolveBeatorajaResultJudgeGraph(0, input())).toBeUndefined();
    expect(resolveBeatorajaResultJudgeGraph(3, result)).toBeUndefined();
  });
});

describe('timing statistics', () => {
  it('counts early and late per judgment and keeps the counts per timing list', () => {
    const counts = beatorajaEarlyLateFromTimings(TIMINGS);
    expect(counts).toEqual({
      PERFECT: { early: 1, late: 1 },
      GREAT: { early: 0, late: 0 },
      GOOD: { early: 1, late: 0 },
      BAD: { early: 0, late: 1 },
      POOR: { early: 0, late: 1 },
    });
    expect(beatorajaEarlyLateFromTimings(TIMINGS)).toBe(counts);
  });

  it('reads 0 and 0 without timings', () => {
    expect(beatorajaTimingStats([])).toEqual({ mean: 0, stddev: 0 });
    expect(beatorajaTimingStats([{ deltaMs: 2 }, { deltaMs: 6 }])).toEqual({ mean: 4, stddev: 2 });
  });
});
