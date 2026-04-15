import { resolveBmsControlFlow } from '@be-music/parser/browser';
import type { BrowserSongEntry } from './types.ts';

export function resolveBrowserSongForGameplay(
  song: BrowserSongEntry,
  randomSource: () => number = Math.random,
): BrowserSongEntry {
  if (song.chart.sourceFormat !== 'bms' || song.chart.bms.controlFlow.length === 0) {
    return song;
  }

  return {
    ...song,
    chart: resolveBmsControlFlow(song.chart, {
      random: randomSource,
    }),
  };
}
