import { describe, expect, test } from 'vite-plus/test';
import { isTouchDrag, stepTouchScroll } from './touch-scroll.ts';

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
