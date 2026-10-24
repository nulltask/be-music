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
