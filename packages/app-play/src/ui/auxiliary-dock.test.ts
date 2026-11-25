import { describe, expect, it } from 'vite-plus/test';
import {
  AUXILIARY_PANELS,
  auxiliaryPanelOrder,
  auxiliaryPanelShowsOn,
  auxiliaryPanelsToClose,
} from './auxiliary-dock.ts';

describe('auxiliary dock rules', () => {
  it('orders warnings, then replay slots, then the course being made, then settings', () => {
    expect(auxiliaryPanelOrder()).toEqual(['chart-diagnostics', 'replay-slots', 'course-maker', 'skin-config']);
  });

  it('gives every panel its own place in the row', () => {
    const orders = Object.values(AUXILIARY_PANELS).map((rule) => rule.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('shows each panel only on the screens it belongs to', () => {
    expect(auxiliaryPanelShowsOn('chart-diagnostics', 'select')).toBe(true);
    expect(auxiliaryPanelShowsOn('chart-diagnostics', 'decide')).toBe(true);
    expect(auxiliaryPanelShowsOn('chart-diagnostics', 'play')).toBe(false);
    expect(auxiliaryPanelShowsOn('replay-slots', 'result')).toBe(true);
    expect(auxiliaryPanelShowsOn('replay-slots', 'play')).toBe(false);
    expect(auxiliaryPanelShowsOn('course-maker', 'select')).toBe(true);
    expect(auxiliaryPanelShowsOn('course-maker', 'result')).toBe(false);
    expect(auxiliaryPanelShowsOn('skin-config', 'play')).toBe(true);
    expect(auxiliaryPanelShowsOn('skin-config', 'result')).toBe(false);
  });

  it('shows nothing on the start screen', () => {
    for (const name of auxiliaryPanelOrder()) expect(auxiliaryPanelShowsOn(name, 'start')).toBe(false);
  });

  it('closes every open panel but the one just opened', () => {
    expect(auxiliaryPanelsToClose('b', ['a', 'b', 'c'])).toEqual(['a', 'c']);
    expect(auxiliaryPanelsToClose('b', ['b'])).toEqual([]);
  });
});
