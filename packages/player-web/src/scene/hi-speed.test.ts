import { describe, expect, test } from 'vite-plus/test';
import { HISPEED_MAX, HISPEED_MIN, HISPEED_STEP, snapHiSpeed } from './hi-speed.ts';

describe('snapHiSpeed', () => {
  test('absorbs the float drift of repeated steps', () => {
    let value = 1;
    for (let i = 0; i < 3; i++) value += HISPEED_STEP;
    expect(value).not.toBe(1.3);
    expect(snapHiSpeed(value)).toBe(1.3);
  });

  test('clamps to the selectable range', () => {
    expect(snapHiSpeed(0)).toBe(HISPEED_MIN);
    expect(snapHiSpeed(-3)).toBe(HISPEED_MIN);
    expect(snapHiSpeed(42)).toBe(HISPEED_MAX);
    expect(snapHiSpeed(2.5)).toBe(2.5);
  });

  test('returns undefined for non-finite input', () => {
    expect(snapHiSpeed(Number.NaN)).toBeUndefined();
    expect(snapHiSpeed(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
