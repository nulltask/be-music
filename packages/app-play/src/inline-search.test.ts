import { describe, expect, test } from 'vite-plus/test';
import { placeInlineField, positioningContainer } from './inline-search.ts';

describe('placeInlineField', () => {
  test('places the field over the box, from the canvas into its container', () => {
    expect(
      placeInlineField({ x: 210, y: 697.5, width: 360, height: 56 }, { left: 24, top: 30 }, { left: 0, top: 10 }),
    ).toEqual({ left: 234, top: 717.5, width: 360, height: 56, fontSize: 21 });
  });

  test('keeps the text readable in a small box, and at 16 px on touch screens', () => {
    expect(
      placeInlineField({ x: 0, y: 0, width: 100, height: 14 }, { left: 0, top: 0 }, { left: 0, top: 0 }).fontSize,
    ).toBe(12);
    expect(
      placeInlineField({ x: 0, y: 0, width: 100, height: 20 }, { left: 0, top: 0 }, { left: 0, top: 0 }, true).fontSize,
    ).toBe(16);
  });
});

describe('positioningContainer', () => {
  test('measures from the offset parent, under the header, and from the fallback while hidden', () => {
    const main = { name: 'main' };
    const shell = { name: 'shell' };
    expect(positioningContainer({ offsetParent: main }, shell)).toBe(main);
    expect(positioningContainer({ offsetParent: null }, shell)).toBe(shell);
  });
});
