import { createEmptyJson } from '@be-music/json';
import { parseChart } from '@be-music/parser/browser';
import { describe, expect, test } from 'vitest';
import {
  resolveBrowserFallbackPreviewIdentity,
  resolveBrowserPreviewContinueKey,
  resolveBrowserPreviewSampleFile,
} from './browser-preview-identity.ts';
import type { BrowserSongAssetSource } from './types.ts';

describe('player-web-core browser preview identity', () => {
  test('resolves preview continue key from #PREVIEW and source files', () => {
    const chart = parseChart(['#PATH_WAV assets', '#PREVIEW preview.wav', '#00111:01'].join('\n'));
    const source = createSource({
      'charts/song.bms': new Uint8Array(),
      'charts/assets/preview.wav': new Uint8Array([1, 2, 3]),
    });

    expect(resolveBrowserPreviewContinueKey(chart, source, 'charts/song.bms')).toBe('charts/assets/preview.wav');
  });

  test('resolves preview sample file from #PREVIEW and PATH_WAV', () => {
    const chart = parseChart(['#PATH_WAV assets', '#PREVIEW preview.wav', '#00111:01'].join('\n'));
    const source = createSource({
      'charts/song.bms': new Uint8Array(),
      'charts/assets/preview.wav': new Uint8Array([1, 2, 3]),
    });

    expect(resolveBrowserPreviewSampleFile(chart, source, 'charts/song.bms')?.path).toBe(
      'charts/assets/preview.wav',
    );
  });

  test('falls back to a deterministic signature when no preview file is declared', () => {
    const chart = parseChart(['#BPM 150', '#00111:01', '#00211:02'].join('\n'));
    const source = createSource({
      'song.bms': new Uint8Array(),
      '01.wav': new Uint8Array([1]),
      '02.wav': new Uint8Array([2]),
    });

    const key = resolveBrowserPreviewContinueKey(chart, source, 'song.bms');

    expect(key).toMatch(/^fallback:/);
  });

  test('derives fallback preview identity and start offset from the first trigger', () => {
    const chart = parseChart(['#BPM 120', '#00211:01'].join('\n'));

    expect(resolveBrowserFallbackPreviewIdentity(chart)).toEqual({
      continueKey: expect.stringMatching(/^fallback:/),
      startSeconds: 4,
    });
  });

  test('returns undefined when no preview identity can be derived', () => {
    const chart = createEmptyJson('json');

    expect(resolveBrowserPreviewContinueKey(chart, createSource({}), 'song.json')).toBeUndefined();
  });
});

function createSource(files: Record<string, Uint8Array>): BrowserSongAssetSource {
  return {
    id: 'source',
    kind: 'files',
    label: 'source',
    files: new Map(Object.entries(files)),
  };
}
