import { describe, expect, test } from 'vitest';
import { clampFontSize, isDestinationVisible, resolveScaledViewport } from './scene-render.ts';
import type { Lr2DestinationRect } from '@be-music/lr2-skin';

function destination(overrides: Partial<Lr2DestinationRect> = {}): Lr2DestinationRect {
  return {
    time: 0,
    x: 0,
    y: 0,
    w: 100,
    h: 20,
    acc: 0,
    alpha: 1,
    r: 255,
    g: 255,
    b: 255,
    blend: 0,
    filter: 0,
    angle: 0,
    center: 0,
    loop: -1,
    timer: 0,
    ops: [],
    op4: 0,
    ...overrides,
  };
}

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

describe('isDestinationVisible', () => {
  test('requires the destination timer to be active', () => {
    expect(isDestinationVisible(destination({ timer: 12 }), new Set(), (timer) => timer === 0)).toBe(false);
    expect(isDestinationVisible(destination({ timer: 12 }), new Set(), (timer) => timer === 12)).toBe(true);
  });

  test('honors positive and negated op gates', () => {
    const gated = destination({ ops: [41, -55, 0] });
    expect(isDestinationVisible(gated, new Set([41]), () => true)).toBe(true);
    expect(isDestinationVisible(gated, new Set(), () => true)).toBe(false);
    expect(isDestinationVisible(gated, new Set([41, 55]), () => true)).toBe(false);
  });
});

describe('clampFontSize', () => {
  test('floors finite values and clamps them into range', () => {
    expect(clampFontSize(18.9, 8, 64)).toBe(18);
    expect(clampFontSize(4, 8, 64)).toBe(8);
    expect(clampFontSize(99, 8, 64)).toBe(64);
  });

  test('uses the minimum for non-finite values', () => {
    expect(clampFontSize(Number.NaN, 8, 64)).toBe(8);
    expect(clampFontSize(Number.POSITIVE_INFINITY, 8, 64)).toBe(8);
  });
});
