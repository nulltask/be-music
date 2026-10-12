import { describe, expect, test } from 'vite-plus/test';
import { resolveDesignTextResolution, resolveScaledViewport } from './viewport.ts';

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
