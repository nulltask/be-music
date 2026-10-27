import { expect, test } from 'vite-plus/test';
import { createLR2GoodAttackGauge, createLR2PerfectAttackGauge } from './lr2-attack.ts';
import { RulesetGauge } from './gauge.ts';
import { resolveRuleset, resolveLR2HardDamageMultiplier } from './definitions.ts';
import { resolveCourseGauge, resolveCourseGaugeId } from './course.ts';
import type { RulesetChartFacts } from './facts.ts';

const facts: RulesetChartFacts = {
  sourceFormat: 'bms',
  laneMode: '7keys',
  lnMode: 1,
  judgeRank: { percent: 75 },
  notes: { normal: 1000, long: { 1: 0, 2: 0, 3: 0 } },
  total: 300,
};

test('P.ATTACK uses fixed source deltas, independent of note count and TOTAL', () => {
  const spec = createLR2PerfectAttackGauge();
  expect(spec).toMatchObject({
    id: 'P-ATTACK',
    initial: 100,
    min: 0,
    max: 100,
    border: 0,
    death: 2,
    survival: true,
    values: [0.1, -1, -100, -100, -100, -100],
  });
  for (const total of [80, 300, 1000])
    for (const count of [1, 100, 1000]) {
      const chart = { ...facts, total, notes: { ...facts.notes, normal: count } };
      expect(resolveRuleset(chart, 'lr2', { selectedGauge: 'P-ATTACK' }).gauge).toEqual(spec);
    }
});

test('GREAT always drains one, including below 32, and the exact 2% border survives until the next GREAT', () => {
  const gauge = new RulesetGauge(createLR2PerfectAttackGauge());
  for (let index = 0; index < 98; index++) gauge.applyJudge(1);
  expect(gauge.value).toBe(2);
  expect(gauge.cleared()).toBe(true);
  gauge.applyJudge(1);
  expect(gauge.value).toBe(0);
  expect(gauge.failedMidPlay).toBe(true);
  gauge.applyJudge(0);
  expect(gauge.value).toBe(0);
});

test('PGREAT recovers 0.1 and clamps at 100; GOOD and every worse judgment are fatal at high and low HP', () => {
  const gauge = new RulesetGauge({ ...createLR2PerfectAttackGauge(), initial: 99.95 });
  gauge.applyJudge(0);
  expect(gauge.value).toBe(100);
  for (const initial of [100, 31])
    for (const judge of [2, 3, 4, 5] as const) {
      const run = new RulesetGauge({ ...createLR2PerfectAttackGauge(), initial });
      run.applyJudge(judge);
      expect(run.value).toBe(0);
      expect(run.failedMidPlay).toBe(true);
    }
});

test('P.ATTACK uses the same table on all course kinds and preserves carried gauge', () => {
  for (const kind of ['grade', 'expert', 'nonstop'] as const) {
    expect(resolveCourseGaugeId('lr2', kind, 'P-ATTACK')).toBe('P-ATTACK');
    const spec = resolveCourseGauge('lr2', 'P-ATTACK', { kind, initialGauge: 31 }, '7keys', 5);
    expect(spec.values).toEqual(createLR2PerfectAttackGauge().values);
    const gauge = new RulesetGauge(spec);
    gauge.applyJudge(1);
    expect(gauge.value).toBe(30);
    expect(
      resolveRuleset(facts, 'lr2', { selectedGauge: 'P-ATTACK', course: { kind, initialGauge: 31 } }).gauge,
    ).toEqual(spec);
  }
});

test('P.ATTACK is rejected by other source rulesets instead of becoming a custom gauge or CLASS', () => {
  for (const ruleset of ['beatoraja', '____'] as const) {
    expect(() => resolveRuleset(facts, ruleset, { selectedGauge: 'P-ATTACK' })).toThrow(/only for LR2/);
    expect(() => resolveRuleset(facts, ruleset, { gauge: 'P-ATTACK' })).toThrow(/only for LR2/);
    expect(() => resolveCourseGaugeId(ruleset, 'expert', 'P-ATTACK')).toThrow(/only for LR2/);
    expect(() => resolveCourseGauge(ruleset, 'P-ATTACK', { kind: 'expert' }, '7keys', 1)).toThrow(/only for LR2/);
  }
});

test('G.ATTACK scales only PGREAT, POOR and empty POOR, while GREAT, GOOD and BAD stay fixed', () => {
  for (const damage of [1, 2, 10]) {
    expect(createLR2GoodAttackGauge(damage)).toMatchObject({
      id: 'G-ATTACK',
      initial: 100,
      death: 2,
      min: 0,
      survival: true,
      values: [-10 * damage, -1, 0.1, -6, -10 * damage, -2 * damage],
    });
  }
  for (const total of [80, 300, 1000])
    for (const count of [1, 30, 1000]) {
      const chart = { ...facts, total, notes: { ...facts.notes, normal: count } };
      const expected = createLR2GoodAttackGauge(resolveLR2HardDamageMultiplier(total, count));
      expect(resolveRuleset(chart, 'lr2', { selectedGauge: 'G-ATTACK' }).gauge).toEqual(expected);
    }
});

test('G.ATTACK low-HP softening applies only to BAD/POOR/empty POOR', () => {
  const expected = [21, 30, 31.1, 27.4, 25, 29.8];
  for (const judge of [0, 1, 2, 3, 4, 5] as const) {
    const gauge = new RulesetGauge({ ...createLR2GoodAttackGauge(1), initial: 31 });
    gauge.applyJudge(judge);
    expect(gauge.value).toBeCloseTo(expected[judge]!);
  }
  const border = new RulesetGauge({ ...createLR2GoodAttackGauge(1), initial: 32 });
  border.applyJudge(3);
  expect(border.value).toBe(26);
});

test('G.ATTACK caps GOOD recovery and latches failure below the exact two-percent border', () => {
  const recovered = new RulesetGauge({ ...createLR2GoodAttackGauge(1), initial: 99.95 });
  recovered.applyJudge(2);
  expect(recovered.value).toBe(100);
  const border = new RulesetGauge({ ...createLR2GoodAttackGauge(1), initial: 12 });
  border.applyJudge(0);
  expect(border.value).toBe(2);
  expect(border.cleared()).toBe(true);
  border.applyJudge(1);
  expect(border.value).toBe(0);
  border.applyJudge(2);
  expect(border.value).toBe(0);
  expect(border.failedMidPlay).toBe(true);
});

test('G.ATTACK expert/nonstop gauges use stage damage and carry HP, while grade selection becomes GRADE', () => {
  for (const kind of ['expert', 'nonstop'] as const) {
    expect(resolveCourseGaugeId('lr2', kind, 'G-ATTACK')).toBe('G-ATTACK');
    const spec = resolveCourseGauge('lr2', 'G-ATTACK', { kind, initialGauge: 31 }, '7keys', 2);
    expect(spec.values).toEqual(createLR2GoodAttackGauge(2).values);
    const gauge = new RulesetGauge(spec);
    gauge.applyJudge(0);
    expect(gauge.value).toBe(11); // PGREAT is not softened.
  }
  expect(resolveCourseGaugeId('lr2', 'grade', 'G-ATTACK')).toBe('GRADE');
  expect(resolveRuleset(facts, 'lr2', { selectedGauge: 'G-ATTACK', course: { kind: 'grade' } }).gauge.id).toBe('GRADE');
});

test('G.ATTACK cannot become a custom gauge under another reference ruleset', () => {
  for (const ruleset of ['beatoraja', '____'] as const) {
    expect(() => resolveRuleset(facts, ruleset, { selectedGauge: 'G-ATTACK' })).toThrow(/only for LR2/);
    expect(() => resolveRuleset(facts, ruleset, { gauge: 'G-ATTACK' })).toThrow(/only for LR2/);
    expect(() => resolveCourseGaugeId(ruleset, 'expert', 'G-ATTACK')).toThrow(/only for LR2/);
    expect(() => resolveCourseGauge(ruleset, 'G-ATTACK', { kind: 'expert' }, '7keys', 1)).toThrow(/only for LR2/);
  }
});
