import { expect, test } from 'vite-plus/test';
import { framesPerSecond } from './fps-overlay.ts';

test('the frame rate is the frames over the time, rounded, and 0 over no time', () => {
  expect(framesPerSecond(30, 500)).toBe(60);
  expect(framesPerSecond(29, 500)).toBe(58);
  expect(framesPerSecond(10, 0)).toBe(0);
});
