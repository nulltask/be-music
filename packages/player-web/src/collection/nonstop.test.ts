import { createEmptyJSON } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import { resolveChartAudioAsset, resolveChartImageAsset } from './collection.ts';
import { createNonstopAssets, NONSTOP_CHART_PATH } from './nonstop.ts';
import type { BrowserSongAssetSource } from './types.ts';

const bytes = (value: number) => new Uint8Array([value]);

function source(id: string, files: Record<string, Uint8Array>): BrowserSongAssetSource {
  return { id, kind: 'directory', label: id, files: new Map(Object.entries(files)) };
}

describe('createNonstopAssets', () => {
  test('names each stage file by its own source key and serves it to the stitched chart', () => {
    const first = source('a', { 'Pack/Song A/kick.ogg': bytes(1), 'Pack/Song A/bg.png': bytes(2) });
    // Stage 2 is a sub-folder chart whose keysound sits one folder up, as LR2 looks for it.
    const second = source('b', { 'Song B/snare.wav': bytes(3), 'Song B/another/x.bme': bytes(0) });
    const withPathWAV = createEmptyJSON('bms');
    const { source: stitched, assetPath } = createNonstopAssets([
      { chart: createEmptyJSON('bms'), source: first, chartPath: 'Pack/Song A/a.bms' },
      { chart: withPathWAV, source: second, chartPath: 'Song B/another/x.bme' },
    ]);
    // The chart declares `.wav`; the stage has an `.ogg`.
    expect(assetPath(0, 'wav', 'kick.wav')).toBe('s0/Pack/Song A/kick.ogg');
    expect(assetPath(0, 'bmp', 'bg.bmp')).toBe('s0/Pack/Song A/bg.png');
    expect(assetPath(1, 'wav', 'snare.wav')).toBe('s1/Song B/snare.wav');
    // A file that is not there keeps its declared path under the stage's chart folder.
    expect(assetPath(1, 'wav', 'missing.wav')).toBe('s1/Song B/another/missing.wav');

    expect(stitched.files.size).toBe(3);
    expect(resolveChartAudioAsset(stitched, NONSTOP_CHART_PATH, 's0/Pack/Song A/kick.ogg')).toBe(
      first.files.get('Pack/Song A/kick.ogg'),
    );
    expect(resolveChartImageAsset(stitched, NONSTOP_CHART_PATH, 's0/Pack/Song A/bg.png')).toBe(
      first.files.get('Pack/Song A/bg.png'),
    );
    expect(resolveChartAudioAsset(stitched, NONSTOP_CHART_PATH, 's1/Song B/snare.wav')).toBe(
      second.files.get('Song B/snare.wav'),
    );
  });

  test("follows a stage chart's #PATH_WAV", () => {
    const chart = createEmptyJSON('bms');
    chart.bms.pathWAV = 'wav/';
    const files = source('c', { 'Song C/wav/hat.wav': bytes(4) });
    const { assetPath } = createNonstopAssets([{ chart, source: files, chartPath: 'Song C/c.bms' }]);
    expect(assetPath(0, 'wav', 'hat.wav')).toBe('s0/Song C/wav/hat.wav');
  });
});
