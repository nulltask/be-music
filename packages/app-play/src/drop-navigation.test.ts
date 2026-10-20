import type { LibraryChart } from '@be-music/player-scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { navigationAfterDrop } from './drop-navigation.ts';

function chartEntry(id: string, directoryLabel: string): LibraryChart {
  return { id, directoryLabel, sourceLabel: 'source' } as LibraryChart;
}

describe('navigationAfterDrop', () => {
  const old = [chartEntry('a', 'Alpha/One'), chartEntry('b', 'Beta/Two')];
  const before = new Set(old.map((entry) => entry.id));

  test('opens the one folder a drop added', () => {
    const chartEntries = [...old, chartEntry('c', 'Gamma/Three'), chartEntry('d', 'Gamma/Four')];
    expect(navigationAfterDrop(chartEntries, before)).toEqual({ folderPath: ['Gamma'], cursors: [2, 0] });
  });

  test('shows the folder list, on the first added folder, when a drop added several', () => {
    const chartEntries = [...old, chartEntry('c', 'Delta/Three'), chartEntry('d', 'Charlie/Four')];
    // Folders sort by label: Alpha, Beta, Charlie, Delta.
    expect(navigationAfterDrop(chartEntries, before)).toEqual({ folderPath: [], cursors: [2] });
  });

  test('leaves the screen alone when the drop added no songs', () => {
    expect(navigationAfterDrop(old, before)).toBeUndefined();
  });

  test('opens the folder of a first drop into an empty library', () => {
    expect(navigationAfterDrop([chartEntry('c', 'Pack/Song')], new Set())).toEqual({
      folderPath: ['Pack'],
      cursors: [0, 0],
    });
  });
});
