import { describe, expect, test } from 'vite-plus/test';
import {
  isTouchDrag,
  isWheelNotch,
  releaseVelocity,
  stepFling,
  stepTouchScroll,
  stepWheelScroll,
} from './touch-scroll.ts';

describe('isTouchDrag', () => {
  test('a touch that stays within the threshold is a tap', () => {
    expect(isTouchDrag(3, 4)).toBe(false);
    expect(isTouchDrag(6, 8)).toBe(false);
    expect(isTouchDrag(0, 11)).toBe(true);
    expect(isTouchDrag(4, 0, 3)).toBe(true);
  });
});

describe('stepTouchScroll', () => {
  test('dragging up a full row moves the cursor forward and keeps the remainder', () => {
    expect(stepTouchScroll(0, -45, 30)).toEqual({ steps: 1, carry: 15 });
    expect(stepTouchScroll(15, -20, 30)).toEqual({ steps: 1, carry: 5 });
  });

  test('dragging down moves the cursor back', () => {
    expect(stepTouchScroll(0, 65, 30)).toEqual({ steps: -2, carry: -5 });
  });

  test('a short drag carries over without stepping', () => {
    expect(stepTouchScroll(0, -10, 30)).toEqual({ steps: 0, carry: 10 });
  });

  test('reversing direction eats the carried travel first', () => {
    expect(stepTouchScroll(10, 15, 30)).toEqual({ steps: 0, carry: -5 });
  });

  test('a non-positive row pitch never steps', () => {
    expect(stepTouchScroll(5, -100, 0)).toEqual({ steps: 0, carry: 0 });
  });
});

describe('isWheelNotch', () => {
  test('line and page mode events are notches', () => {
    expect(isWheelNotch({ deltaMode: 1, deltaY: 3 })).toBe(true);
    expect(isWheelNotch({ deltaMode: 2, deltaY: 1 })).toBe(true);
  });

  test('pixel mode is a notch when the legacy delta is a multiple of 120', () => {
    expect(isWheelNotch({ deltaMode: 0, deltaY: 100, wheelDeltaY: -120 })).toBe(true);
    expect(isWheelNotch({ deltaMode: 0, deltaY: 200, wheelDeltaY: -240 })).toBe(true);
    expect(isWheelNotch({ deltaMode: 0, deltaY: 4, wheelDeltaY: -12 })).toBe(false);
    expect(isWheelNotch({ deltaMode: 0, deltaY: 4 })).toBe(false);
    expect(isWheelNotch({ deltaMode: 0, deltaY: 0, wheelDeltaY: 0 })).toBe(false);
  });
});

describe('stepWheelScroll', () => {
  test('small deltas add up to one step per row of travel', () => {
    let state = { steps: 0, carry: 0 };
    let total = 0;
    for (let i = 0; i < 10; i += 1) {
      state = stepWheelScroll(state.carry, 4, 30);
      total += state.steps;
    }
    expect(total).toBe(1);
    expect(state.carry).toBeCloseTo(10);
  });

  test('a long flick steps several entries', () => {
    expect(stepWheelScroll(0, 95, 30)).toEqual({ steps: 3, carry: 5 });
    expect(stepWheelScroll(0, -65, 30)).toEqual({ steps: -2, carry: -5 });
  });

  test('a reversal drops the carry', () => {
    expect(stepWheelScroll(25, -10, 30)).toEqual({ steps: 0, carry: -10 });
  });

  test('a non-positive pitch never steps', () => {
    expect(stepWheelScroll(10, 50, 0)).toEqual({ steps: 0, carry: 0 });
  });
});

describe('releaseVelocity', () => {
  test('measures the travel over the last 100 ms', () => {
    const samples = [
      { at: 0, y: 0 },
      { at: 100, y: 10 },
      { at: 150, y: 60 },
      { at: 200, y: 110 },
    ];
    expect(releaseVelocity(samples, 205)).toBeCloseTo(1);
  });

  test('a finger that stopped before lifting does not fling', () => {
    expect(
      releaseVelocity(
        [
          { at: 0, y: 0 },
          { at: 16, y: 20 },
        ],
        200,
      ),
    ).toBe(0);
  });

  test('a single sample has no velocity', () => {
    expect(releaseVelocity([{ at: 0, y: 0 }], 0)).toBe(0);
    expect(releaseVelocity([], 0)).toBe(0);
  });
});

describe('stepFling', () => {
  test('slows down exponentially and covers the same ground at any frame rate', () => {
    let fast = { distance: 0, velocity: 2 };
    let travelledFast = 0;
    for (let i = 0; i < 60; i += 1) {
      fast = stepFling(fast.velocity, 1000 / 60);
      travelledFast += fast.distance;
    }
    let slow = { distance: 0, velocity: 2 };
    let travelledSlow = 0;
    for (let i = 0; i < 30; i += 1) {
      slow = stepFling(slow.velocity, 1000 / 30);
      travelledSlow += slow.distance;
    }
    expect(travelledFast).toBeCloseTo(travelledSlow, 6);
    expect(fast.velocity).toBeCloseTo(slow.velocity, 9);
    expect(Math.abs(fast.velocity)).toBeLessThan(2);
  });

  test('a fling in total travels velocity × time constant', () => {
    expect(stepFling(1, 1e9).distance).toBeCloseTo(325);
  });

  test('no time, no travel', () => {
    expect(stepFling(1, 0)).toEqual({ distance: 0, velocity: 1 });
  });
});
