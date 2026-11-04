import { expect, test } from 'vite-plus/test';
import { fitVideoBGARect } from './bga-layout.ts';
test('keeps video monitor height and horizontal center for wide and portrait movies', () => {
  const rect = { x: 100, y: 50, w: 200, h: 200 };
  expect(fitVideoBGARect(rect, 1600, 900, 400)).toEqual({ x: 200 - 1600 / 9, y: 50, w: 3200 / 9, h: 200 });
  expect(fitVideoBGARect(rect, 900, 1600, 400)).toEqual({ x: 143.75, y: 50, w: 112.5, h: 200 });
  expect(fitVideoBGARect(rect, 1600, 900, 250).w).toBe(250);
  expect(fitVideoBGARect(rect, 0, 900, 400)).toBe(rect);
});
