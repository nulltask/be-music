import { describe, expect, it } from 'vitest';
import {
  defaultSelectEntryIndexAt,
  DEFAULT_SELECT_LAYOUT,
  isInsideDefaultSelectList,
  isInsideRect,
  resolveDefaultSelectVisibleWindow,
} from './select-layout.ts';

describe('default select layout', () => {
  it('keeps the list rectangle at the historical 320 / 54 origin', () => {
    expect(DEFAULT_SELECT_LAYOUT.listX).toBe(320);
    expect(DEFAULT_SELECT_LAYOUT.listTop).toBe(54);
    expect(DEFAULT_SELECT_LAYOUT.rowHeight).toBe(28);
    expect(isInsideDefaultSelectList(320, 54, 480)).toBe(true);
    expect(isInsideDefaultSelectList(319, 100, 480)).toBe(false);
  });

  it('centers the selected row in the visible window', () => {
    const window = resolveDefaultSelectVisibleWindow(20, 40, 480);
    expect(window.start).toBeLessThanOrEqual(20);
    expect(window.start + window.visibleRows).toBeGreaterThan(20);
  });

  it('maps a click on the first visible row to that entry index', () => {
    expect(defaultSelectEntryIndexAt(54, 0, 10, 480)).toBe(0);
    expect(defaultSelectEntryIndexAt(54 + 28, 0, 10, 480)).toBe(1);
  });

  it('hit-tests PLAY / AUTO / SEARCH from the same rects the chrome draws', () => {
    expect(isInsideRect(40, 320, DEFAULT_SELECT_LAYOUT.play)).toBe(true);
    expect(isInsideRect(40, 300, DEFAULT_SELECT_LAYOUT.play)).toBe(false);
    expect(isInsideRect(200, 320, DEFAULT_SELECT_LAYOUT.auto)).toBe(true);
    expect(isInsideRect(20, 380, DEFAULT_SELECT_LAYOUT.search)).toBe(true);
  });
});
