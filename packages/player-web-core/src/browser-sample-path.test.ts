import { describe, expect, test } from 'vitest';
import { resolveBrowserSampleFile } from './browser-sample-path.ts';
import type { BrowserSongAssetSource } from './types.ts';

describe('player-web-core browser sample path resolution', () => {
  test('resolves chart-relative sample paths with extension fallback and case-insensitive lookup', () => {
    const source: BrowserSongAssetSource = {
      id: 'source',
      kind: 'directory',
      label: 'Source',
      files: new Map([
        ['folder/KICK.WAV', Uint8Array.of(1)],
        ['shared/snare.ogg', Uint8Array.of(2)],
      ]),
    };

    const kick = resolveBrowserSampleFile(source, 'folder/chart.bms', 'kick');
    const snare = resolveBrowserSampleFile(source, 'folder/chart.bms', '../shared/snare.ogg');

    expect(kick?.path).toBe('folder/KICK.WAV');
    expect(snare?.path).toBe('shared/snare.ogg');
  });

  test('falls back to source-root paths when the chart-relative path is missing', () => {
    const source: BrowserSongAssetSource = {
      id: 'source',
      kind: 'zip',
      label: 'Source',
      files: new Map([['samples/hihat.mp3', Uint8Array.of(3)]]),
    };

    const resolved = resolveBrowserSampleFile(source, 'charts/song/chart.bms', 'samples/hihat.mp3');

    expect(resolved?.path).toBe('samples/hihat.mp3');
  });
});
