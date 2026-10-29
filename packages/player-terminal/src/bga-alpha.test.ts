import { expect, test } from 'vite-plus/test';
import { getANSIFrameAlpha, setANSIFrameAlpha } from './bga-alpha.ts';
import { createSolidANSIFrame } from './bga-frame.ts';

test('keeps binary frames compact and retains their pixels when fractional coverage is introduced', () => {
  const frame = createSolidANSIFrame(3, 1, 255, 0, 0, 0);
  setANSIFrameAlpha(frame, 0, 255);
  expect(frame.alpha).toBeUndefined();
  setANSIFrameAlpha(frame, 2, 128);
  expect([...frame.alpha!]).toEqual([255, 0, 128]);
  setANSIFrameAlpha(frame, 1, 1);
  expect([0, 1, 2].map((pixel) => getANSIFrameAlpha(frame, pixel))).toEqual([255, 1, 128]);
  setANSIFrameAlpha(frame, 0, 0);
  expect([...frame.opaqueMask]).toEqual([0, 1, 1]);
  expect(getANSIFrameAlpha(frame, 0)).toBe(0);
  expect(getANSIFrameAlpha(frame, 3)).toBe(0);
});

test('normalizes coverage bytes and lets the binary mask suppress invalid stale alpha data', () => {
  const frame = createSolidANSIFrame(2, 1, 255, 0, 0, 1);
  setANSIFrameAlpha(frame, 0, 127.6);
  setANSIFrameAlpha(frame, 1, 300);
  expect([...frame.alpha!]).toEqual([128, 255]);
  frame.opaqueMask[0] = 0;
  expect(getANSIFrameAlpha(frame, 0)).toBe(0);
  setANSIFrameAlpha(frame, 1, NaN);
  expect(getANSIFrameAlpha(frame, 1)).toBe(0);
});
