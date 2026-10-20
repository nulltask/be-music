import { describe, expect, it } from 'vite-plus/test';
import { clampSlot, wrapIndex } from './select-bars.ts';

describe('clampSlot', () => {
  it('keeps a slot inside the layout', () => {
    expect(clampSlot(3, 10)).toBe(3);
    expect(clampSlot(0, 10)).toBe(0);
    expect(clampSlot(9, 10)).toBe(9);
  });

  it('clamps a slot past either end to the nearest one', () => {
    expect(clampSlot(-2, 10)).toBe(0);
    expect(clampSlot(12, 10)).toBe(9);
  });

  it('truncates a fractional slot', () => {
    expect(clampSlot(4.8, 10)).toBe(4);
    expect(clampSlot(-0.5, 10)).toBe(0);
  });

  it('returns 0 for a layout without slots', () => {
    expect(clampSlot(5, 0)).toBe(0);
  });
});

describe('wrapIndex', () => {
  it('maps an index inside the list to itself', () => {
    expect(wrapIndex(0, 5)).toBe(0);
    expect(wrapIndex(4, 5)).toBe(4);
  });

  it('wraps past the end and before the start, like a circular rail', () => {
    expect(wrapIndex(5, 5)).toBe(0);
    expect(wrapIndex(7, 5)).toBe(2);
    expect(wrapIndex(-1, 5)).toBe(4);
    expect(wrapIndex(-6, 5)).toBe(4);
  });

  it('returns undefined for an empty list', () => {
    expect(wrapIndex(0, 0)).toBeUndefined();
    expect(wrapIndex(3, 0)).toBeUndefined();
  });
});
