import { describe, expect, test } from 'vitest';
import type { ChartSelectionEntry } from './chart-selection.ts';
import {
  createChartFocusKey,
  createSongSelectState,
  filterChartSelectionEntries,
  getEntryFocusKey,
} from './song-select-state.ts';

const SAMPLE_ENTRIES: ChartSelectionEntry[] = [
  { kind: 'group', label: 'Alpha' },
  { kind: 'chart', filePath: '/charts/a.bms', fileLabel: 'a.bms', difficulty: 1 },
  { kind: 'chart', filePath: '/charts/b.bms', fileLabel: 'b.bms', difficulty: 2 },
  { kind: 'group', label: 'Beta' },
  { kind: 'chart', filePath: '/charts/c.bms', fileLabel: 'c.bms', difficulty: 2 },
];

describe('song select state', () => {
  test('prepends random only when the difficulty filter leaves visible charts', () => {
    expect(filterChartSelectionEntries(SAMPLE_ENTRIES, 2).map((entry) => entry.kind)).toEqual([
      'random',
      'group',
      'chart',
      'group',
      'chart',
    ]);
    expect(filterChartSelectionEntries(SAMPLE_ENTRIES, 5)).toEqual([]);
  });

  test('retains chart focus across derived view updates', () => {
    const state = createSongSelectState(SAMPLE_ENTRIES, {
      initialFocusKey: createChartFocusKey('/charts/b.bms'),
      initialDifficultyFilter: 2,
    });

    let view = state.view();
    expect(getEntryFocusKey(view.entries[state.selectedIndex()])).toBe('chart:/charts/b.bms');

    state.difficultyFilter(undefined);
    state.ensureSelectedIndex('chart:/charts/b.bms');
    view = state.view();
    expect(getEntryFocusKey(view.entries[state.selectedIndex()])).toBe('chart:/charts/b.bms');
  });

  test('keeps the current entry index when the focused chart disappears but the slot stays selectable', () => {
    const state = createSongSelectState(SAMPLE_ENTRIES, {
      initialFocusKey: createChartFocusKey('/charts/b.bms'),
    });

    state.difficultyFilter(1);
    state.ensureSelectedIndex('chart:/charts/b.bms');

    const view = state.view();
    expect(getEntryFocusKey(view.entries[state.selectedIndex()])).toBe('chart:/charts/a.bms');
  });
});
