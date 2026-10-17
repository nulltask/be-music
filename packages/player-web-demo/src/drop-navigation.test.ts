import type { BrowserSongEntry } from '@be-music/player-web/collection';
import { describe, expect, test } from 'vite-plus/test';
import { navigationAfterDrop } from './drop-navigation.ts';

function song(id: string, directoryLabel: string): BrowserSongEntry {
  return { id, directoryLabel, sourceLabel: 'source' } as BrowserSongEntry;
}

describe('navigationAfterDrop', () => {
  const old = [song('a', 'Alpha/One'), song('b', 'Beta/Two')];
  const before = new Set(old.map((entry) => entry.id));

  test('opens the one folder a drop added', () => {
    const songs = [...old, song('c', 'Gamma/Three'), song('d', 'Gamma/Four')];
    expect(navigationAfterDrop(songs, before)).toEqual({ folderPath: ['Gamma'], cursors: [2, 0] });
  });

  test('shows the folder list, on the first added folder, when a drop added several', () => {
    const songs = [...old, song('c', 'Delta/Three'), song('d', 'Charlie/Four')];
    // Folders sort by label: Alpha, Beta, Charlie, Delta.
    expect(navigationAfterDrop(songs, before)).toEqual({ folderPath: [], cursors: [2] });
  });

  test('leaves the screen alone when the drop added no songs', () => {
    expect(navigationAfterDrop(old, before)).toBeUndefined();
  });

  test('opens the folder of a first drop into an empty library', () => {
    expect(navigationAfterDrop([song('c', 'Pack/Song')], new Set())).toEqual({
      folderPath: ['Pack'],
      cursors: [0, 0],
    });
  });
});
