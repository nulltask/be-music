import { describe, expect, test } from 'vite-plus/test';
import { loadChartSiblings } from './chart-siblings.ts';
import type { BrowserAssetEntry } from './types.ts';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('loadChartSiblings', () => {
  test('finds an LRX chart header and the BGA file it names, ignoring case', async () => {
    const lrh = bytes('<LRH><information moviepath="_movie_dp.lrm" /></LRH>');
    const lrm = bytes('<LRM />');
    const files = new Map<string, BrowserAssetEntry>([
      ['Song/001/02.LRH', lrh],
      ['Song/001/_Movie_DP.lrm', lrm],
      ['Song/001/_movie.lrm', bytes('<LRM default />')],
    ]);
    expect(await loadChartSiblings(files, 'Song/001/02.lrs', bytes('<LRS />'))).toEqual({ lrh, lrm });
  });

  test('falls back to the default BGA file and reads nothing for other charts', async () => {
    const lrm = bytes('<LRM />');
    const files = new Map<string, BrowserAssetEntry>([
      ['01.lrs', bytes('<LRS />')],
      ['_movie.lrm', lrm],
    ]);
    expect(await loadChartSiblings(files, '01.lrs', bytes('<LRS />'))).toEqual({ lrm });
    expect(await loadChartSiblings(files, 'song/a.bms', bytes('#TITLE a'))).toBeUndefined();
  });
});
