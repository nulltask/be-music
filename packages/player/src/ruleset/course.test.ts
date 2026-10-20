import { describe, expect, test } from 'vite-plus/test';
import {
  applyCourseJudgeConstraint,
  resolveCourseGauge,
  resolveCourseGaugeId,
  resolveDefaultCourseGaugeSet,
} from './course.ts';
import { resolveLR2HardDamageMultiplier, resolveRuleset, type RulesetWindowTables } from './definitions.ts';
import { createEmptyRulesetNoteCounts, type RulesetChartFacts } from './facts.ts';
import { RulesetGauge } from './gauge.ts';

function facts(laneMode = '7-key-sp', notes = 500): RulesetChartFacts {
  const counts = createEmptyRulesetNoteCounts();
  counts.normal = notes;
  return { sourceFormat: 'bms', laneMode, lnMode: 1, judgeRank: { percent: 75 }, notes: counts };
}

describe('resolveCourseGaugeId', () => {
  test('LR2 picks its grade line for grade courses and its course line otherwise', () => {
    expect(resolveCourseGaugeId('lr2', 'grade', 'GROOVE')).toBe('GRADE');
    expect(resolveCourseGaugeId('lr2', 'grade', 'EASY')).toBe('GRADE');
    expect(resolveCourseGaugeId('lr2', 'grade', 'HARD')).toBe('GRADE-HARD');
    expect(resolveCourseGaugeId('lr2', 'grade', 'DEATH')).toBe('GRADE-DEATH');
    expect(resolveCourseGaugeId('lr2', 'expert', 'GROOVE')).toBe('COURSE');
    expect(resolveCourseGaugeId('lr2', 'nonstop', 'EASY')).toBe('COURSE-EASY');
    expect(resolveCourseGaugeId('lr2', 'expert', 'HARD')).toBe('COURSE-HARD');
  });

  test('beatoraja and IIDX map the pick onto the class gauges whatever the course kind', () => {
    expect(resolveCourseGaugeId('beatoraja', 'expert', 'EASY')).toBe('CLASS');
    expect(resolveCourseGaugeId('beatoraja', 'grade', 'GROOVE')).toBe('CLASS');
    expect(resolveCourseGaugeId('beatoraja', 'grade', 'HARD')).toBe('EXCLASS');
    expect(resolveCourseGaugeId('iidx', 'grade', 'DEATH')).toBe('EXHARDCLASS');
  });
});

describe('resolveCourseGauge', () => {
  test('LR2 course gauges start full, have no 2 % floor, the death border and the low-HP guts', () => {
    const grade = resolveCourseGauge('lr2', 'GRADE', { kind: 'grade' }, '7-key-sp', 1);
    expect(grade).toEqual({
      id: 'GRADE',
      min: 0,
      max: 100,
      initial: 100,
      border: 0,
      survival: true,
      death: 2,
      values: [0.1, 0.1, 0.04, -2, -3, -2],
      guts: [{ threshold: 32, multiplier: 0.6 }],
    });
    expect(resolveCourseGauge('lr2', 'COURSE-EASY', { kind: 'expert' }, '7-key-sp', 1).values).toEqual([
      0.12, 0.12, 0.048, -1.2, -1.6, -1.2,
    ]);
    expect(resolveCourseGauge('lr2', 'COURSE-DEATH', { kind: 'expert' }, '7-key-sp', 1).values).toEqual([
      0, 0, 0, -100, -100, 0,
    ]);
  });

  test('LR2 HARD course gauges scale their damage by the stage chart multiplier', () => {
    expect(resolveCourseGauge('lr2', 'GRADE-HARD', { kind: 'grade' }, '7-key-sp', 2).values).toEqual([
      0.1, 0.1, 0.04, -12, -20, -4,
    ]);
    expect(resolveCourseGauge('lr2', 'COURSE-HARD', { kind: 'expert' }, '7-key-sp', 1).values).toEqual([
      0.1, 0.1, 0.05, -6, -10, -2,
    ]);
  });

  test('beatoraja class gauges come from the course gauge set, else from the play mode', () => {
    expect(resolveCourseGauge('beatoraja', 'CLASS', { kind: 'grade' }, '7-key-sp', 1)).toMatchObject({
      id: 'CLASS',
      initial: 100,
      survival: true,
      values: [0.15, 0.12, 0.06, -1.5, -3, -1.5],
    });
    expect(resolveCourseGauge('beatoraja', 'CLASS', { kind: 'grade' }, '9-key', 1).values).toEqual([
      0.15, 0.12, 0.06, -1.5, -3, -3,
    ]);
    expect(resolveCourseGauge('beatoraja', 'EXCLASS', { kind: 'grade', gaugeSet: 'lr2' }, '7-key-sp', 1)).toMatchObject(
      {
        id: 'EXCLASS',
        values: [0.1, 0.1, 0.05, -6, -10, -2],
        guts: [{ threshold: 30, multiplier: 0.6 }],
      },
    );
    expect(resolveCourseGauge('iidx', 'EXHARDCLASS', { kind: 'grade', gaugeSet: '5k' }, '7-key-sp', 1).values).toEqual([
      0.01, 0.01, 0, -2.5, -5, -2.5,
    ]);
  });

  test('a carried-in gauge value replaces the start value, clamped to the range', () => {
    expect(resolveCourseGauge('lr2', 'GRADE', { kind: 'grade', initialGauge: 63.5 }, '7-key-sp', 1).initial).toBe(63.5);
    expect(resolveCourseGauge('beatoraja', 'CLASS', { kind: 'grade', initialGauge: 140 }, '7-key-sp', 1).initial).toBe(
      100,
    );
  });

  test('resolveDefaultCourseGaugeSet follows the play mode', () => {
    expect(resolveDefaultCourseGaugeSet('5-key-sp')).toBe('5k');
    expect(resolveDefaultCourseGaugeSet('10-key-dp')).toBe('5k');
    expect(resolveDefaultCourseGaugeSet('9-key')).toBe('9k');
    expect(resolveDefaultCourseGaugeSet('24-key-sp')).toBe('24k');
    expect(resolveDefaultCourseGaugeSet('14-key-dp')).toBe('7k');
  });

  test('the LR2 grade gauge softens damage below 32 % and pins at 0 below 2 %', () => {
    const gauge = new RulesetGauge(resolveCourseGauge('lr2', 'GRADE', { kind: 'grade', initialGauge: 31 }, '', 1));
    gauge.applyJudge(4);
    expect(gauge.value).toBeCloseTo(29.2, 9);
    const dying = new RulesetGauge(resolveCourseGauge('lr2', 'GRADE', { kind: 'grade', initialGauge: 3 }, '', 1));
    dying.applyJudge(3);
    expect(dying.value).toBe(0);
    expect(dying.failedMidPlay).toBe(true);
  });
});

describe('applyCourseJudgeConstraint', () => {
  const set = {
    judges: [
      [-20, 20],
      [-60, 60],
      [-150, 150],
      [-280, 220],
    ],
    ms: [-500, 150],
  } as const;
  const tables = { note: set, scratch: set, longNoteEnd: set, longScratchEnd: set } as unknown as RulesetWindowTables;

  test('no-good gives GOOD the GREAT window and no-great gives GREAT and GOOD the PGREAT window', () => {
    expect(applyCourseJudgeConstraint(tables, 'no-good').note.judges).toEqual([
      [-20, 20],
      [-60, 60],
      [-60, 60],
      [-280, 220],
    ]);
    const noGreat = applyCourseJudgeConstraint(tables, 'no-great');
    expect(noGreat.longScratchEnd.judges).toEqual([
      [-20, 20],
      [-20, 20],
      [-20, 20],
      [-280, 220],
    ]);
    expect(noGreat.note.ms).toEqual([-500, 150]);
    expect(applyCourseJudgeConstraint(tables, undefined)).toBe(tables);
  });
});

describe('resolveRuleset with a course', () => {
  test('a course stage runs on the course gauge and the constrained windows', () => {
    const single = resolveRuleset(facts(), 'beatoraja', { selectedGauge: 'HARD' });
    const stage = resolveRuleset(facts(), 'beatoraja', {
      selectedGauge: 'HARD',
      course: { kind: 'grade', judge: 'no-good', initialGauge: 80 },
    });
    expect(stage.gauge).toMatchObject({ id: 'EXCLASS', initial: 80 });
    expect(stage.windows.note.judges[2]).toEqual(single.windows.note.judges[1]);
    expect(stage.windowsAt(0)).toBe(stage.windows);
  });

  test('LR2 course gauges take the HARD damage multiplier of the stage chart', () => {
    const stage = resolveRuleset(facts('7-key-sp', 100), 'lr2', { selectedGauge: 'HARD', course: { kind: 'grade' } });
    const damage = resolveLR2HardDamageMultiplier(stage.effectiveTotal, 100);
    expect(stage.gauge.id).toBe('GRADE-HARD');
    expect(stage.gauge.values[3]).toBeCloseTo(-6 * damage, 9);
  });

  test('LR2 constrains the #EXRANK timeline tables too', () => {
    const chart = facts();
    chart.judgeRank.timeline = [{ timeUs: 1_000_000, exRankValue: 25 }];
    const stage = resolveRuleset(chart, 'lr2', { course: { kind: 'grade', judge: 'no-great' } });
    const later = stage.windowsAt(2_000_000).note.judges;
    expect(later[1]).toEqual(later[0]);
    expect(later[2]).toEqual(later[0]);
  });
});
