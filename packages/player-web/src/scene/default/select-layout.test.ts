import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SELECT_LAYOUT,
  defaultSelectEntryIndexAt,
  defaultSelectListWidth,
  isInsideDefaultSelectList,
  resolveDefaultSelectVisibleWindow,
} from './select-layout.ts';

describe('resolveDefaultSelectVisibleWindow', () => {
  it('keeps the selected row near the vertical center on the 640×480 canvas', () => {
    const { start, visibleRows } = resolveDefaultSelectVisibleWindow(20, 80, 480);
    expect(visibleRows).toBe(Math.floor((480 - 26 - 54) / 28));
    expect(start).toBe(20 - Math.floor(visibleRows / 2));
  });

  it('clamps to the start of a short list', () => {
    expect(resolveDefaultSelectVisibleWindow(0, 3, 480).start).toBe(0);
  });
});

describe('isInsideDefaultSelectList', () => {
  it('matches the historic fallback list rectangle', () => {
    expect(isInsideDefaultSelectList(320, 54, 480)).toBe(true);
    expect(isInsideDefaultSelectList(319, 54, 480)).toBe(false);
    expect(isInsideDefaultSelectList(400, 53, 480)).toBe(false);
    expect(isInsideDefaultSelectList(400, 454, 480)).toBe(true);
    expect(isInsideDefaultSelectList(400, 455, 480)).toBe(false);
  });
});

describe('defaultSelectEntryIndexAt', () => {
  it('maps a y coordinate onto the visible window', () => {
    expect(defaultSelectEntryIndexAt(54, 10, 40)).toBe(10);
    expect(defaultSelectEntryIndexAt(54 + 28, 10, 40)).toBe(11);
    expect(defaultSelectEntryIndexAt(54, 0, 0)).toBeUndefined();
  });
});

describe('defaultSelectListWidth', () => {
  it('leaves the same right gutter the fallback chrome used', () => {
    expect(defaultSelectListWidth(640)).toBe(640 - DEFAULT_SELECT_LAYOUT.listX - DEFAULT_SELECT_LAYOUT.listRightInset);
  });
});
