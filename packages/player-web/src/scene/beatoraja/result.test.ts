import { BEATORAJA_GAUGE_MODE } from '@be-music/beatoraja-skin';
import { describe, expect, test } from 'vite-plus/test';
import { resolveResultGaugeState } from './result.ts';

describe('resolveResultGaugeState', () => {
  test('names the gauge the play ended on, a course’s class gauge included', () => {
    const gauge = { current: 64, max: 100, clearThreshold: 0 };
    expect(resolveResultGaugeState({ ...gauge, type: 'CLASS' })).toEqual({
      value: 64,
      max: 100,
      border: 0,
      mode: BEATORAJA_GAUGE_MODE.CLASS,
    });
    expect(resolveResultGaugeState({ ...gauge, type: 'GRADE-HARD' })?.mode).toBe(BEATORAJA_GAUGE_MODE.EXCLASS);
    expect(resolveResultGaugeState({ ...gauge, type: 'HARD', clearThreshold: 2 })).toMatchObject({
      border: 2,
      mode: BEATORAJA_GAUGE_MODE.HARD,
    });
  });

  test('has no state without a gauge', () => {
    expect(resolveResultGaugeState(undefined)).toBeUndefined();
    expect(resolveResultGaugeState({ type: 'CLASS', current: 0, max: 0, clearThreshold: 0 })).toBeUndefined();
  });
});
