import { describe, expect, test } from 'vite-plus/test';
import { wheelArrowPoints } from './wheel.ts';

describe('wheelArrowPoints', () => {
  test('points up on a wheel-up lane and down on a wheel-down lane', () => {
    expect(wheelArrowPoints('wheel-up', 10, 100, 4)).toEqual([10, 96, 6, 104, 14, 104]);
    expect(wheelArrowPoints('wheel-down', 10, 100, 4)).toEqual([10, 104, 6, 96, 14, 96]);
  });

  test('draws nothing on the other lane kinds', () => {
    expect(wheelArrowPoints('scratch', 10, 100, 4)).toBeUndefined();
    expect(wheelArrowPoints('white', 10, 100, 4)).toBeUndefined();
    expect(wheelArrowPoints('black', 10, 100, 4)).toBeUndefined();
  });
});
