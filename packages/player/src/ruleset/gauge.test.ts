import { describe, expect, test } from 'vite-plus/test';
import type { GaugeSpec } from './definitions.ts';
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
