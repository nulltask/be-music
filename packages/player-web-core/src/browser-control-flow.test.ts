import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { parseChart } from '@be-music/parser/browser';
import { describe, expect, test } from 'vitest';
import { resolveBrowserSongForGameplay } from './browser-control-flow.ts';
import type { BrowserSongEntry } from './types.ts';

describe('player-web-core browser control flow', () => {
  test('resolves BMS control flow before gameplay', () => {
    const song = createSongEntry(
      parseChart(
        [
          '#RANDOM 2',
          '#IF 1',
          '#BPM 150',
          '#00111:01',
          '#ENDIF',
          '#ENDRANDOM',
          '#00211:02',
        ].join('\n'),
      ),
    );

    const resolvedSong = resolveBrowserSongForGameplay(song, () => 0);

    expect(song.chart.metadata.bpm).toBe(130);
    expect(song.chart.events.some((event) => event.measure === 1 && event.channel === '11')).toBe(false);
    expect(resolvedSong).not.toBe(song);
    expect(resolvedSong.chart.metadata.bpm).toBe(150);
    expect(resolvedSong.chart.events.some((event) => event.measure === 1 && event.channel === '11')).toBe(true);
  });

  test('returns the original song entry when no control flow resolution is needed', () => {
    const song = createSongEntry(createEmptyJson('json'));

    expect(resolveBrowserSongForGameplay(song)).toBe(song);
  });
});

function createSongEntry(chart: BeMusicJson): BrowserSongEntry {
  return {
    id: 'song-id',
    sourceId: 'source-id',
    sourceLabel: 'source',
    sourceKind: 'files',
    chartPath: 'sample.bms',
    directoryLabel: '.',
    fileLabel: 'sample.bms',
    title: 'Sample',
    chart,
  };
}
