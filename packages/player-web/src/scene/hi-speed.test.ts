import { describe, expect, test } from 'vite-plus/test';
import {
  HISPEED_MAX,
  HISPEED_MIN,
  HISPEED_STEP,
  HISPEED_TRANSITION_MS,
  HiSpeedTransition,
  easeHiSpeed,
  snapHiSpeed,
  stepPlayerHiSpeed,
} from './hi-speed.ts';

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

describe('easeHiSpeed', () => {
  test('holds the start value until the transition starts and the target from its end on', () => {
    expect(easeHiSpeed(2, 3, 1000, 900, 200)).toBe(2);
    expect(easeHiSpeed(2, 3, 1000, 1000, 200)).toBe(2);
    expect(easeHiSpeed(2, 3, 1000, 1200, 200)).toBe(3);
    expect(easeHiSpeed(2, 3, 1000, 5000, 200)).toBe(3);
  });

  test('eases out: past the linear midpoint halfway through, rising monotonically', () => {
    expect(easeHiSpeed(2, 3, 0, 100, 200)).toBeCloseTo(2.875, 10);
    let previous = 2;
    for (let now = 10; now <= 200; now += 10) {
      const value = easeHiSpeed(2, 3, 0, now, 200);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  test('eases downwards as well', () => {
    expect(easeHiSpeed(3, 2, 0, 100, 200)).toBeCloseTo(2.125, 10);
  });

  test('jumps straight to the target for a non-positive duration', () => {
    expect(easeHiSpeed(2, 3, 0, 0, 0)).toBe(3);
    expect(easeHiSpeed(2, 3, 0, 0, -5)).toBe(3);
  });
});

describe('HiSpeedTransition', () => {
  test('starts settled at the initial value', () => {
    const transition = new HiSpeedTransition(2);
    expect(transition.target).toBe(2);
    expect(transition.valueAt(0)).toBe(2);
  });

  test('glides to a new target over the transition time', () => {
    const transition = new HiSpeedTransition(2, 200);
    transition.retarget(3, 1000);
    expect(transition.target).toBe(3);
    expect(transition.valueAt(1000)).toBe(2);
    expect(transition.valueAt(1100)).toBeCloseTo(2.875, 10);
    expect(transition.valueAt(1200)).toBe(3);
  });

  test('retargets mid-glide from the current scroll value without a jump', () => {
    const transition = new HiSpeedTransition(2, 200);
    transition.retarget(3, 0);
    const mid = transition.valueAt(100);
    transition.retarget(4, 100);
    expect(transition.valueAt(100)).toBe(mid);
    expect(transition.valueAt(300)).toBe(4);
  });

  test('ignores a retarget to the current target', () => {
    const transition = new HiSpeedTransition(2, 200);
    transition.retarget(3, 0);
    transition.retarget(3, 150);
    expect(transition.valueAt(200)).toBe(3);
  });

  test('jumps without a glide', () => {
    const transition = new HiSpeedTransition(2, 200);
    transition.retarget(3, 0);
    transition.jump(1.5);
    expect(transition.valueAt(50)).toBe(1.5);
    expect(transition.target).toBe(1.5);
  });

  test('defaults to the shared transition time', () => {
    const transition = new HiSpeedTransition(2);
    transition.retarget(3, 0);
    expect(transition.valueAt(HISPEED_TRANSITION_MS - 1)).toBeLessThan(3);
    expect(transition.valueAt(HISPEED_TRANSITION_MS)).toBe(3);
  });
});

describe('stepPlayerHiSpeed', () => {
  test("steps the player's hi-speed on its own grid and scales the drawn one by HS-FIX", () => {
    // HS-FIX at 2/3 (e.g. MAXBPM 225 on a 150 BPM chart): the player's 3.0 draws at 2.0.
    expect(stepPlayerHiSpeed(3, HISPEED_STEP, 2 / 3)).toEqual({ player: 3.1, drawn: 2.067 });
    expect(stepPlayerHiSpeed(3, -HISPEED_STEP, 2 / 3)).toEqual({ player: 2.9, drawn: 1.933 });
    expect(stepPlayerHiSpeed(3, 0, 2 / 3)).toEqual({ player: 3, drawn: 2 });
  });

  test('draws at the player hi-speed without HS-FIX', () => {
    expect(stepPlayerHiSpeed(2, HISPEED_STEP, 1)).toEqual({ player: 2.1, drawn: 2.1 });
  });

  test('clamps both to the hi-speed range', () => {
    expect(stepPlayerHiSpeed(HISPEED_MAX, HISPEED_STEP, 2)).toEqual({ player: HISPEED_MAX, drawn: HISPEED_MAX });
    expect(stepPlayerHiSpeed(HISPEED_MIN, -HISPEED_STEP, 0.5)).toEqual({ player: HISPEED_MIN, drawn: HISPEED_MIN });
  });

  test('ignores non-finite input', () => {
    expect(stepPlayerHiSpeed(Number.NaN, HISPEED_STEP, 1)).toBeUndefined();
    expect(stepPlayerHiSpeed(2, HISPEED_STEP, Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
