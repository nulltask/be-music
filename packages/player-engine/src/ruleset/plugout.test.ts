import { describe, expect, test } from 'vite-plus/test';
import { resolveClearLamp, resolveCourseClearLamp } from './clear-lamp.ts';
import { resolveRuleset } from './definitions.ts';
import { createEmptyRulesetNoteCounts, type RulesetChartFacts } from './facts.ts';
import { RulesetGauge } from './gauge.ts';
import {
  PLUGOUT_GAUGE_IDS,
  PLUGOUT_SCORE_MAX,
  resolvePlugoutCourseGauge,
  resolvePlugoutDefaultTotal,
  resolvePlugoutGauge,
  resolvePlugoutGaugeId,
  resolvePlugoutGradeStageStart,
  resolvePlugoutJudgeRank,
  resolvePlugoutScore,
  resolvePlugoutWindowTables,
} from './plugout.ts';

describe('resolvePlugoutJudgeRank', () => {
  test('reads an authored rank as plugout does, 0–2 as written and anything else as 3', () => {
    const rank = (sourceRank: number) => resolvePlugoutJudgeRank({ judgeRank: { percent: 75, sourceRank } });
    expect([0, 1, 2, 3, 4, -1, 2.7].map(rank)).toEqual([0, 1, 2, 3, 3, 3, 2]);
  });

  test('falls back to the nearest rank on the LR2 percent axis', () => {
    const rank = (percent: number) => resolvePlugoutJudgeRank({ judgeRank: { percent } });
    expect([25, 50, 75, 100, 125, 10].map(rank)).toEqual([0, 1, 2, 3, 3, 0]);
    expect(rank(Number.NaN)).toBe(2);
  });
});

describe('resolvePlugoutWindowTables', () => {
  test('gives the PGREAT / GREAT / GOOD windows by rank and BAD at 200 ms', () => {
    const windows = [0, 1, 2, 3].map((rank) =>
      resolvePlugoutWindowTables(rank).note.judges.map(([, late]) => late / 1000),
    );
    expect(windows).toEqual([
      [12, 24, 50, 200],
      [15, 30, 100, 200],
      [18, 40, 100, 200],
      [21, 60, 120, 200],
    ]);
    expect(resolvePlugoutWindowTables(2).note.ms).toEqual([0, 1_000_000]);
    const tables = resolvePlugoutWindowTables(2);
    expect(tables.scratch).toBe(tables.note);
  });

  test('takes a long-note end from the GOOD window before it to 200 ms past it', () => {
    const { longNoteEnd, longScratchEnd } = resolvePlugoutWindowTables(1);
    expect(longNoteEnd.judges.slice(0, 3)).toEqual([
      [-200_000, 100_000],
      [-200_000, 100_000],
      [-200_000, 100_000],
    ]);
    expect(longNoteEnd.judges[3]).toEqual([-200_000, 200_000]);
    expect(longScratchEnd).toBe(longNoteEnd);
  });
});

describe('resolvePlugoutDefaultTotal', () => {
  test("follows LR2's curve without the ×0.8, truncated", () => {
    expect([0, 1, 100, 399, 400, 401, 599, 600, 1000].map(resolvePlugoutDefaultTotal)).toEqual([
      200, 200, 220, 279, 280, 280, 359, 360, 440,
    ]);
  });
});

describe('plugout gauges', () => {
  test('maps the Be-Music gauge picks onto the plugout types', () => {
    const picks = ['GROOVE', 'EASY', 'HARD', 'DEATH', 'DEATH-CORRECTED', 'EX-GROOVE', 'EX-EASY', 'EX-HARD', 'EX-DEATH'];
    expect(picks.map(resolvePlugoutGaugeId)).toEqual([
      'NORMAL',
      'EASY',
      'HARD',
      'HAZARD',
      'HAZARD',
      'EX-NORMAL',
      'EX-EASY',
      'EX-HARD',
      'EX-HAZARD',
    ]);
    for (const id of PLUGOUT_GAUGE_IDS) expect(resolvePlugoutGauge(id, 200, 100).id).toBe(id);
  });

  test('NORMAL recovers TOTAL / n, GOOD half, and stays at 2 % or more', () => {
    const spec = resolvePlugoutGauge('NORMAL', 200, 100);
    expect(spec).toMatchObject({ initial: 20, min: 2, border: 80, survival: false });
    expect(spec.values).toEqual([2, 2, 1, -3, -8, -2]);
    const gauge = new RulesetGauge(spec);
    for (let index = 0; index < 10; index++) gauge.applyJudge(4);
    expect(gauge.value).toBe(2);
  });

  test('EX-NORMAL clears only at 100 % and EX-EASY at 4 %', () => {
    expect(resolvePlugoutGauge('EX-NORMAL', 200, 100).border).toBe(100);
    expect(resolvePlugoutGauge('EASY', 200, 100)).toMatchObject({ border: 80, values: [2, 2, 1, -2.4, -6.4, -1.6] });
    expect(resolvePlugoutGauge('EX-EASY', 200, 100).border).toBe(4);
  });

  test('HARD gets ×0.7 below 30 % for a POOR or empty POOR, never for a BAD', () => {
    const gauge = new RulesetGauge(resolvePlugoutGauge('HARD', 200, 100));
    for (let index = 0; index < 4; index++) gauge.applyJudge(4);
    expect(gauge.value).toBeCloseTo(28, 9);
    gauge.applyJudge(4);
    expect(gauge.value).toBeCloseTo(28 - 18 * 0.7, 9);
    gauge.applyJudge(3);
    expect(gauge.value).toBeCloseTo(28 - 18 * 0.7 - 9, 9);
  });

  test('EX-HAZARD fails on a GREAT-or-worse chain and HAZARD on a BAD, but not on an empty POOR', () => {
    const exHazard = new RulesetGauge(resolvePlugoutGauge('EX-HAZARD', 200, 100));
    exHazard.applyJudge(1);
    expect(exHazard.value).toBe(98);
    exHazard.applyJudge(2);
    expect(exHazard.failedMidPlay).toBe(true);
    const hazard = new RulesetGauge(resolvePlugoutGauge('HAZARD', 200, 100));
    hazard.applyJudge(5);
    expect(hazard.value).toBe(100);
    hazard.applyJudge(3);
    expect(hazard.failedMidPlay).toBe(true);
  });
});

describe('plugout course gauges', () => {
  test('an EXPERT course scales NORMAL damage by the stage note count and never recovers', () => {
    const stage = (noteCount: number) => resolvePlugoutCourseGauge('NORMAL', 'expert', noteCount).values;
    expect(stage(50)).toEqual([0, 0, 0, -2, -4, -2]);
    expect(stage(350)).toEqual([0, 0, 0, -1.5, -3, -1.5]);
    expect(stage(500)).toEqual([0, 0, 0, -1, -2, -1]);
    expect(resolvePlugoutCourseGauge('COURSE-HARD', 'expert', 500)).toMatchObject({
      id: 'COURSE-HARD',
      initial: 100,
      survival: true,
    });
  });

  test('a grade course swaps the HARD tables and scales NORMAL damage by the gauge', () => {
    expect(resolvePlugoutCourseGauge('HARD', 'grade', 500).values).toEqual([0, 0, 0, -5, -10, -2]);
    expect(resolvePlugoutCourseGauge('EX-HARD', 'grade', 500).values).toEqual([0, 0, 0, -9, -18, -4]);
    const gauge = new RulesetGauge(resolvePlugoutCourseGauge('GRADE', 'grade', 500));
    gauge.applyJudge(4);
    // −2 × (3 × 100 + 100) / 400.
    expect(gauge.value).toBeCloseTo(98, 9);
  });

  test('a grade NORMAL gauge plays on 24 lives once it empties: BAD and empty POOR one each, POOR two', () => {
    // A stage that starts with nothing carried: 0.01 %, gone at the first POOR.
    const gauge = new RulesetGauge({ ...resolvePlugoutCourseGauge('GRADE', 'grade', 500), initial: 0.01 });
    gauge.applyJudge(4);
    expect(gauge.value).toBe(0);
    expect(gauge.livesRemaining).toBe(24);
    expect(gauge.cleared()).toBe(true);
    gauge.applyJudge(3);
    gauge.applyJudge(5);
    gauge.applyJudge(4);
    expect(gauge.livesRemaining).toBe(20);
    gauge.applyJudge(0);
    expect(gauge.value).toBe(0);
    for (let index = 0; index < 10; index++) gauge.applyJudge(4);
    expect(gauge.livesRemaining).toBe(0);
    expect(gauge.cleared()).toBe(false);
    expect(gauge.failedMidPlay).toBe(true);
  });

  test('a grade stage starts at what the last left, never below 0.01 %', () => {
    expect(resolvePlugoutGradeStageStart(0)).toBe(0.01);
    expect(resolvePlugoutGradeStageStart(42)).toBe(42);
  });
});

describe('plugout score and lamps', () => {
  test('integer-divides each judgment term and tops out at 100000', () => {
    expect(resolvePlugoutScore({ pgreat: 3, great: 0, good: 0 }, 3)).toBe(PLUGOUT_SCORE_MAX);
    expect(resolvePlugoutScore({ pgreat: 1, great: 1, good: 1 }, 3)).toBe(33333 + 16666 + 8333);
  });

  test('lights the gauge lamps, FULL COMBO for HAZARD and PERFECT for EX-HAZARD', () => {
    const lamp = (gauge: string, perfect = 90) =>
      resolveClearLamp({ ruleset: 'plugout', cleared: true, gauge, score: { total: 100, perfect, great: 5, good: 0 } });
    expect(
      ['NORMAL', 'EX-NORMAL', 'EASY', 'EX-EASY', 'HARD', 'EX-HARD', 'HAZARD', 'EX-HAZARD'].map((id) => lamp(id)),
    ).toEqual(['NORMAL', 'NORMAL', 'EASY', 'EASY', 'HARD', 'HARD', 'FULL_COMBO', 'PERFECT']);
  });

  test('a full combo tops out at PERFECT, which also needs no empty POOR', () => {
    const lamp = (emptyPoor: number, great = 0) =>
      resolveClearLamp({
        ruleset: 'plugout',
        cleared: true,
        gauge: 'NORMAL',
        score: { total: 100, perfect: 100 - great, great, good: 0, emptyPoor },
      });
    expect(lamp(0)).toBe('PERFECT');
    expect(lamp(1)).toBe('FULL_COMBO');
  });

  test('a course clear lights its gauge type', () => {
    const facts = (gauge: string): Parameters<typeof resolveCourseClearLamp>[0] => ({
      ruleset: 'plugout',
      gauge,
      gaugeType: 'HARD',
      cleared: true,
      noteCount: 100,
      maxCombo: 50,
      judge: { great: 40, good: 5 },
    });
    expect(resolveCourseClearLamp(facts('COURSE-HARD'))).toBe('HARD');
    expect(resolveCourseClearLamp(facts('GRADE'))).toBe('NORMAL');
  });
});

describe("resolveRuleset('plugout')", () => {
  const chart: RulesetChartFacts = {
    sourceFormat: 'bms',
    laneMode: '7keys',
    lnMode: 1,
    judgeRank: { percent: 75, sourceRank: 1 },
    notes: { ...createEmptyRulesetNoteCounts(), normal: 90, long: { 1: 5, 2: 0, 3: 0 } },
  };

  test('plays every long note as a charge note with a held-tail rule, re-judging only notes the press has reached', () => {
    const config = resolveRuleset(chart, 'plugout');
    expect(config).toMatchObject({
      selection: 'lowest',
      multiBad: true,
      multiBadAheadUs: 3000,
      longNoteStyle: 'charge',
      headBadSkipsTail: true,
      plugoutScore: true,
      heldChargeTail: { note: 'BAD', scratch: 'PGREAT', earlyRelease: 'BAD' },
    });
    // 90 taps and 5 long notes judged at the head and the tail.
    expect(config.noteCount).toBe(100);
    expect(config.effectiveTotal).toBe(220);
    expect(config.gauge.id).toBe('NORMAL');
  });

  test('takes the EX picks and refuses the gauges plugout lacks', () => {
    expect(resolveRuleset(chart, 'plugout', { selectedGauge: 'EX-DEATH' }).gauge.id).toBe('EX-HAZARD');
    expect(() => resolveRuleset(chart, 'plugout', { selectedGauge: 'ASSIST-EASY' })).toThrow(RangeError);
    expect(() => resolveRuleset(chart, 'lr2', { selectedGauge: 'EX-GROOVE' })).toThrow(RangeError);
    expect(resolveRuleset(chart, 'beatoraja', { selectedGauge: 'plugout:EX-EASY' }).gauge.id).toBe('EX-EASY');
  });
});
