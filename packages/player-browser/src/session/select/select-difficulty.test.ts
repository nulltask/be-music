import { expect, test } from 'vite-plus/test';
import type { LibraryChart, LibraryEntry } from '@be-music/player-scene-model';
import { isSameTrack, nextDifficultyIndex } from './select-difficulty.ts';

const chart = (chartPath: string, sourceId = 's'): LibraryEntry => ({
  kind: 'chart',
  chart: { id: chartPath, sourceId, chartPath } as LibraryChart,
});

test('charts of one track share their source and directory', () => {
  const [a, b, c, d] = [chart('song/n.bms'), chart('song/h.bms'), chart('other/n.bms'), chart('song/n.bms', 't')];
  const charts = [a, b, c, d].map((entry) => (entry as { chart: LibraryChart }).chart);
  expect(isSameTrack(charts[0]!, charts[1]!)).toBe(true);
  expect(isSameTrack(charts[0]!, charts[2]!)).toBe(false);
  expect(isSameTrack(charts[0]!, charts[3]!)).toBe(false);
});

test('steps to the next chart of the track in the list, wrapping, and nowhere from a lone chart or a folder', () => {
  const entries = [chart('a/n.bms'), chart('b/n.bms'), chart('a/h.bms'), chart('a/a.bms')];
  expect(nextDifficultyIndex(entries, 0)).toBe(2);
  expect(nextDifficultyIndex(entries, 2)).toBe(3);
  expect(nextDifficultyIndex(entries, 3)).toBe(0);
  expect(nextDifficultyIndex(entries, 0, -1)).toBe(3);
  expect(nextDifficultyIndex(entries, 1)).toBeUndefined();
  expect(nextDifficultyIndex([{ kind: 'folder' } as unknown as LibraryEntry, ...entries], 0)).toBeUndefined();
});
