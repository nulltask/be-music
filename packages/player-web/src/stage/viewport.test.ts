import { describe, expect, test } from 'vite-plus/test';
import { designRectToCanvas, resolveDesignTextResolution, resolveScaledViewport } from './viewport.ts';

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
