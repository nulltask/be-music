import { describe, expect, test } from 'vite-plus/test';
import { fitBGACameraRect } from './bga-camera-fit.ts';

describe('fitBGACameraRect', () => {
  test('fits a wide camera whole in a square frame, with bands above and below', () => {
    expect(fitBGACameraRect(1280, 720, { x: 10, y: 20, w: 256, h: 256 })).toEqual({ x: 10, y: 76, w: 256, h: 144 });
  });

  test('fits a tall camera whole, with bands at the sides', () => {
    expect(fitBGACameraRect(720, 1280, { x: 0, y: 0, w: 256, h: 256 })).toEqual({ x: 56, y: 0, w: 144, h: 256 });
  });

  test('fills a frame of the same proportions', () => {
    expect(fitBGACameraRect(640, 480, { x: 5, y: 5, w: 320, h: 240 })).toEqual({ x: 5, y: 5, w: 320, h: 240 });
  });

  test('fills the frame while the camera has no size yet', () => {
    const rect = { x: 1, y: 2, w: 3, h: 4 };
    expect(fitBGACameraRect(0, 0, rect)).toBe(rect);
  });
});
