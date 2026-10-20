import { describe, expect, test } from 'vite-plus/test';
import {
  designRectToCanvas,
  resolveCanvasPixelRatio,
  resolveDesignTextResolution,
  resolveScaledViewport,
} from './viewport.ts';

describe('resolveScaledViewport', () => {
  test('centers the design rectangle inside a wider screen', () => {
    expect(resolveScaledViewport(1280, 720, 640, 480)).toEqual({
      x: 160,
      y: 0,
      scale: 1.5,
    });
  });

  test('falls back to scale 1 when the input is not usable', () => {
    expect(resolveScaledViewport(0, 480, 640, 480)).toEqual({
      x: -320,
      y: 0,
      scale: 1,
    });
  });
});

describe('resolveDesignTextResolution', () => {
  test('matches one texel to one device pixel', () => {
    expect(resolveDesignTextResolution(1.3125, 2)).toBe(2.63);
    expect(resolveDesignTextResolution(1, 1)).toBe(1);
  });

  test('clamps to [1, 8] and rejects unusable input', () => {
    expect(resolveDesignTextResolution(2.5, 3)).toBe(7.5);
    expect(resolveDesignTextResolution(4, 3)).toBe(8);
    expect(resolveDesignTextResolution(0.4, 1)).toBe(1);
    expect(resolveDesignTextResolution(Number.NaN, 2)).toBe(1);
  });
});

describe('designRectToCanvas', () => {
  test('scales a design rectangle and offsets it by the letterbox', () => {
    const viewport = resolveScaledViewport(1600, 900, 640, 480);
    // scale 1.875, pillarboxed 200 px on each side
    expect(designRectToCanvas({ x: 14, y: 372, width: 290, height: 30 }, viewport)).toEqual({
      x: 200 + 14 * 1.875,
      y: 372 * 1.875,
      width: 290 * 1.875,
      height: 30 * 1.875,
    });
  });
});

describe('resolveCanvasPixelRatio', () => {
  test('gives one canvas pixel per device pixel below the cap', () => {
    expect(resolveCanvasPixelRatio(1920, 1080, 1.5, 4096)).toBe(1.5);
    expect(resolveCanvasPixelRatio(1080, 1920, 2, 4096)).toBe(2);
  });

  test('rounds the width to whole device pixels', () => {
    expect(resolveCanvasPixelRatio(1000, 500, 1.2345, 4096)).toBe(1.235);
  });

  test('caps the width of a landscape stage', () => {
    const ratio = resolveCanvasPixelRatio(1920, 1080, 3, 4096);
    expect(Math.round(1920 * ratio)).toBe(4096);
    expect(Math.round(1080 * ratio)).toBeLessThan(4096);
  });

  test('caps the height of a portrait stage, not only its width', () => {
    // 1080 × 3 = 3240 is under the cap, but 1920 × 3 = 5760 is not.
    const ratio = resolveCanvasPixelRatio(1080, 1920, 3, 4096);
    expect(Math.round(1920 * ratio)).toBe(4096);
    expect(Math.round(1080 * ratio)).toBe(2304);
  });

  test('keeps at least one pixel across the width', () => {
    expect(resolveCanvasPixelRatio(100, 50, 0.001, 4096)).toBe(0.01);
  });
});
