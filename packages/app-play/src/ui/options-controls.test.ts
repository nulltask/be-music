import { describe, expect, test } from 'vite-plus/test';
import { tabRevealScroll } from './options-controls.ts';

describe('tabRevealScroll', () => {
  test('leaves a tab already in view alone', () => {
    expect(tabRevealScroll(120, 200, 100, 400)).toBe(0);
    expect(tabRevealScroll(100, 400, 100, 400)).toBe(0);
  });

  test('scrolls left to show a tab cut off on the left', () => {
    expect(tabRevealScroll(60, 140, 100, 400)).toBe(-40);
  });

  test('scrolls right just far enough to show a tab cut off on the right', () => {
    expect(tabRevealScroll(350, 450, 100, 400)).toBe(50);
  });

  test('shows a tab wider than the bar from its start', () => {
    expect(tabRevealScroll(150, 500, 100, 400)).toBe(50);
    expect(tabRevealScroll(50, 500, 100, 400)).toBe(-50);
  });
});
