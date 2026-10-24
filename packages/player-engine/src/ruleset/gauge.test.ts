import { describe, expect, test } from 'vite-plus/test';
import type { GaugeSpec } from './definitions.ts';
import { createInitialPlayerSummary } from '../core/bootstrap.ts';
import { resolveRuleset } from './definitions.ts';
import { RulesetGauge } from './gauge.ts';

const GROOVE: GaugeSpec = {
  id: 'GROOVE',
  min: 2,
  max: 100,
  initial: 20,
  border: 80,
  survival: false,
  values: [1, 1, 0.5, -4, -6, -2],
  guts: [],
};

describe('RulesetGauge', () => {
  test('drainToZero empties the gauge below its floor, fails the clear, and ignores later judgments', () => {
    // LR2 sets HP = 0 outright when a play ends with notes unjudged after a negative-BPM reversal
    // (OpenLR2 `LR2f.cpp:12980-12982`) — below the GROOVE gauge's 2 % floor, which ordinary damage never crosses.
    const gauge = new RulesetGauge(GROOVE);
    for (let index = 0; index < 80; index += 1) {
      gauge.applyJudge(0);
    }
    expect(gauge.cleared()).toBe(true);

    gauge.drainToZero();
    expect(gauge.value).toBe(0);
    expect(gauge.cleared()).toBe(false);
    expect(gauge.failedMidPlay).toBe(false);

    gauge.applyJudge(0);
    gauge.applyRawDelta(50);
    expect(gauge.value).toBe(0);
  });

  test('drainToZero fails a survival gauge too', () => {
    const gauge = new RulesetGauge({ ...GROOVE, id: 'HARD', initial: 100, border: 0, min: 0, survival: true });
    gauge.drainToZero();
    expect(gauge.value).toBe(0);
    expect(gauge.cleared()).toBe(false);
  });
});

test('SURVIVAL TO GROOVE keeps NORMAL running from chart start, including the fatal judgment', () => {
  const hazard = {
    ...GROOVE,
    id: 'HAZARD',
    min: 0,
    initial: 100,
    border: 0,
    survival: true,
    values: [0, 0, 0, -100, -100, 0] as const,
  };
  const gauge = new RulesetGauge(hazard, { ...GROOVE, id: 'NORMAL' });
  for (let i = 0; i < 8; i++) gauge.applyJudge(0);
  expect(gauge.spec.id).toBe('HAZARD');
  expect(gauge.value).toBe(100);
  gauge.applyJudge(3);
  expect(gauge.spec.id).toBe('NORMAL');
  expect(gauge.value).toBe(24); // 20 + 8 PG - 4 BAD, not a fresh 20 or transferred 0.
  expect(gauge.failedMidPlay).toBe(false);
  expect(gauge.cleared()).toBe(false);
  gauge.applyJudge(0);
  expect(gauge.value).toBe(25);
  for (let i = 0; i < 55; i++) gauge.applyJudge(0);
  expect(gauge.cleared()).toBe(true);
});

test('parallel NORMAL receives HCN fractions and raw mine damage before the switch', () => {
  const hard = { ...GROOVE, id: 'HARD', min: 0, initial: 3, border: 0, survival: true };
  const gauge = new RulesetGauge(hard, { ...GROOVE, id: 'NORMAL' });
  gauge.applyJudge(1, 0.5);
  gauge.applyJudge(3, 0.5);
  expect(gauge.spec.id).toBe('HARD');
  gauge.applyRawDelta(-2);
  expect(gauge.spec.id).toBe('NORMAL');
  expect(gauge.value).toBe(16.5); // 20 + 0.5 - 2 - 2.
  gauge.applyRawDelta(-1000);
  expect(gauge.value).toBe(2);
  expect(gauge.failedMidPlay).toBe(false);
});

test('explicit forced failure does not get rescued by a parallel gauge', () => {
  const gauge = new RulesetGauge({ ...GROOVE, id: 'HARD', min: 0, initial: 100, survival: true }, GROOVE);
  gauge.drainToZero();
  gauge.applyJudge(0);
  expect(gauge.value).toBe(0);
  expect(gauge.spec.id).toBe('HARD');
  expect(gauge.cleared()).toBe(false);
});

test('the live summary follows the effective gauge and restores the original parallel state on reset', () => {
  const config = resolveRuleset(
    {
      sourceFormat: 'bms',
      laneMode: '7K',
      lnMode: 1,
      judgeRank: { percent: 75 },
      notes: { normal: 100, long: { 1: 0, 2: 0, 3: 0 } },
    },
    'beatoraja',
    { selectedGauge: 'DEATH', gaugeAutoShift: 'SURVIVAL_TO_GROOVE' },
  );
  const live = createInitialPlayerSummary(config, 100);
  live.applyGaugeJudge('PERFECT');
  live.applyGaugeDelta(-100);
  expect(live.summary.gauge).toMatchObject({
    type: 'NORMAL',
    survival: false,
    failedMidPlay: false,
    current: 2,
    clearThreshold: 80,
    initial: 20,
  });
  live.reset();
  expect(live.summary.gauge).toMatchObject({
    type: 'HAZARD',
    survival: true,
    failedMidPlay: false,
    current: 100,
    clearThreshold: 0,
    initial: 100,
  });
  live.applyGaugeJudge('POOR');
  expect(live.summary.gauge?.type).toBe('NORMAL');
});

function bankConfig(bottom: 'ASSIST-EASY' | 'EASY' | 'GROOVE' = 'ASSIST-EASY') {
  return resolveRuleset(
    {
      sourceFormat: 'bms',
      laneMode: '7K',
      lnMode: 1,
      judgeRank: { percent: 75 },
      total: 300,
      notes: { normal: 1000, long: { 1: 0, 2: 0, 3: 0 } },
    },
    'beatoraja',
    { selectedGauge: 'GROOVE', gaugeAutoShift: 'BEST_CLEAR', bottomShiftableGauge: bottom },
  );
}

test('BEST CLEAR follows the highest qualified parallel gauge, then the chosen lower bound', () => {
  const config = bankConfig('EASY');
  const gauge = new RulesetGauge(config.gauge, undefined, config.gaugeBank);
  expect(gauge.spec.id).toBe('HAZARD');
  expect(Object.keys(gauge.values!)).toEqual(['ASSIST-EASY', 'EASY', 'NORMAL', 'HARD', 'EX-HARD', 'HAZARD']);
  gauge.applyJudge(4);
  expect(gauge.spec.id).toBe('EX-HARD');
  const first = gauge.values!;
  gauge.applyRawDelta(-1000);
  expect(gauge.spec.id).toBe('EASY');
  expect(gauge.cleared()).toBe(false);
  expect(gauge.failedMidPlay).toBe(false);
  expect(gauge.values!.HARD).toBe(0);
  expect(first.HARD).toBeGreaterThan(0); // Prior snapshots stay immutable.
  for (let i = 0; i < 400; i++) gauge.applyJudge(0);
  expect(gauge.spec.id).toBe('NORMAL');
  expect(gauge.cleared()).toBe(true);
  expect(gauge.values!.HAZARD).toBe(0);
});

test('BEST CLEAR never raises the lower bound above an already selected lower gauge', () => {
  const config = bankConfig('GROOVE');
  const gauge = new RulesetGauge(config.gauge, undefined, config.gaugeBank);
  gauge.applyRawDelta(-1000);
  expect(gauge.spec.id).toBe('NORMAL');
  const lower = new RulesetGauge(config.gauge, undefined, { specs: config.gaugeBank!.specs, bottomIndex: 0 });
  lower.applyRawDelta(-1000);
  expect(lower.spec.id).toBe('ASSIST-EASY');
  const deadSurvival = config.gaugeBank!.specs.map((spec) => (spec.survival ? { ...spec, initial: 0 } : spec));
  const startsBelow = new RulesetGauge(deadSurvival[0]!, undefined, { specs: deadSurvival, bottomIndex: 2 });
  expect(startsBelow.spec.id).toBe('ASSIST-EASY');
  startsBelow.applyJudge(5);
  expect(startsBelow.spec.id).toBe('ASSIST-EASY');
});

test('BEST CLEAR ignores HCN tick scaling only where each source gauge specifies zero gain', () => {
  const config = bankConfig();
  const gauge = new RulesetGauge(config.gauge, undefined, config.gaugeBank);
  const before = gauge.values!;
  gauge.applyJudge(1, 0.5);
  expect(gauge.values!.NORMAL).toBeCloseTo(before.NORMAL! + config.gaugeBank!.specs[2]!.values[1] * 0.5);
  expect(gauge.values!.HAZARD).toBe(100);
});

test('dead class gauges do not revive while the remaining family continues across course stages', () => {
  const config = resolveRuleset(
    {
      sourceFormat: 'bms',
      laneMode: '7K',
      lnMode: 1,
      judgeRank: { percent: 75 },
      notes: { normal: 100, long: { 1: 0, 2: 0, 3: 0 } },
    },
    'beatoraja',
    {
      selectedGauge: 'DEATH',
      gaugeAutoShift: 'BEST_CLEAR',
      bottomShiftableGauge: 'GROOVE',
      course: { kind: 'grade', initialGauge: 40, initialGauges: { CLASS: 60, EXCLASS: 40, EXHARDCLASS: 0 } },
    },
  );
  const gauge = new RulesetGauge(config.gauge, undefined, config.gaugeBank);
  expect(gauge.spec.id).toBe('EXCLASS');
  expect(gauge.values).toEqual({ CLASS: 60, EXCLASS: 40, EXHARDCLASS: 0 });
  gauge.applyJudge(0);
  expect(gauge.values!.EXHARDCLASS).toBe(0);
  expect(gauge.values!.CLASS).toBeGreaterThan(60);
  gauge.applyRawDelta(-1000);
  expect(gauge.spec.id).toBe('CLASS');
  expect(gauge.failedMidPlay).toBe(true);
  expect(gauge.cleared()).toBe(false);
});
