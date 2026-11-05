import { describe, expect, test } from 'vite-plus/test';
import { OptionRow, tabRevealScroll } from './options-controls.ts';

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

describe('OptionRow disabled and unavailable', () => {
  /** A row element with one input, as far as the row touches it. */
  function fakeRow() {
    const input = { disabled: false, dataset: {}, classList: { contains: () => false } };
    const attributes = new Set<string>();
    const element = {
      hidden: false,
      toggleAttribute: (name: string, on: boolean) => (on ? attributes.add(name) : attributes.delete(name)),
      querySelectorAll: () => [input],
    };
    return { row: new OptionRow(element as unknown as HTMLElement, undefined), input, attributes, element };
  }

  test('an unavailable row stays in place, dimmed and disabled', () => {
    const { row, input, attributes, element } = fakeRow();
    row.unavailable = true;
    expect(element.hidden).toBe(false);
    expect(input.disabled).toBe(true);
    expect(attributes.has('data-disabled')).toBe(true);
    row.unavailable = false;
    expect(input.disabled).toBe(false);
    expect(attributes.has('data-disabled')).toBe(false);
  });

  test("a play's lock ending does not enable a row the other options make unavailable, nor the reverse", () => {
    const { row, input } = fakeRow();
    row.unavailable = true;
    row.disabled = true;
    row.disabled = false;
    expect(input.disabled).toBe(true);
    row.disabled = true;
    row.unavailable = false;
    expect(input.disabled).toBe(true);
    row.disabled = false;
    expect(input.disabled).toBe(false);
  });
});
