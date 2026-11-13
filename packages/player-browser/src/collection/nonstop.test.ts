import { createEmptyJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import { resolveChartAudioAsset, resolveChartImageAsset } from './collection.ts';
import { createNonstopAssets, NONSTOP_CHART_PATH } from './nonstop.ts';
import type { BrowserAssetSource } from './types.ts';

const bytes = (value: number) => new Uint8Array([value]);

function source(id: string, files: Record<string, Uint8Array>): BrowserAssetSource {
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

  test('looks the declared files up ahead of the stitch, yielding between slices, and files only what is asked for', async () => {
    const chart = createEmptyJSON('bms');
    chart.resources.wav = { '01': 'kick.wav', '02': 'snare.wav', '03': 'gone.wav' };
    chart.resources.bmp = { '01': 'bg.bmp' };
    const kick = bytes(1);
    const files = source('a', { 'Song/kick.ogg': kick, 'Song/snare.wav': bytes(2), 'Song/bg.png': bytes(3) });
    const lookups = { count: 0 };
    const counted: BrowserAssetSource = {
      ...files,
      files: new Proxy(files.files as Map<string, Uint8Array>, {
        get(target, property) {
          if (property === 'has') lookups.count += 1;
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
    };
    const assets = createNonstopAssets([{ chart, source: counted, chartPath: 'Song/a.bms' }]);
    let clock = 0;
    let yields = 0;
    // Every lookup takes 10 ms on this clock, past the slice, so the prefetch yields after each one.
    await assets.prefetch({
      now: () => (clock += 10),
      yieldToHost: async () => {
        yields += 1;
      },
    });
    expect(yields).toBe(4);
    expect(assets.source.files.size).toBe(0);
    const prefetched = lookups.count;
    expect(assets.assetPath(0, 'wav', 'kick.wav')).toBe('s0/Song/kick.ogg');
    expect(assets.assetPath(0, 'wav', 'gone.wav')).toBe('s0/Song/gone.wav');
    expect(assets.assetPath(0, 'bmp', 'bg.bmp')).toBe('s0/Song/bg.png');
    // The stitch found every lookup done.
    expect(lookups.count).toBe(prefetched);
    expect([...assets.source.files.keys()]).toEqual(['s0/Song/kick.ogg', 's0/Song/bg.png']);
    expect(assets.source.audioFallbacks?.get('s0/Song/kick.ogg')).toEqual([kick]);
  });

  test('follows the #PATH_WAV of the stage charts as played', () => {
    const loaded = createEmptyJSON('bms');
    const played = createEmptyJSON('bms');
    played.bms.pathWAV = 'wav/';
    const files = source('c', { 'Song C/wav/hat.wav': bytes(4), 'Song C/hat.wav': bytes(5) });
    const assets = createNonstopAssets([{ chart: loaded, source: files, chartPath: 'Song C/c.bms' }]);
    expect(assets.assetPath(0, 'wav', 'hat.wav')).toBe('s0/Song C/hat.wav');
    assets.setStageCharts([played]);
    expect(assets.assetPath(0, 'wav', 'hat.wav')).toBe('s0/Song C/wav/hat.wav');
  });

  test("follows a stage chart's #PATH_WAV", () => {
    const chart = createEmptyJSON('bms');
    chart.bms.pathWAV = 'wav/';
    const files = source('c', { 'Song C/wav/hat.wav': bytes(4) });
    const { assetPath } = createNonstopAssets([{ chart, source: files, chartPath: 'Song C/c.bms' }]);
    expect(assetPath(0, 'wav', 'hat.wav')).toBe('s0/Song C/wav/hat.wav');
  });
});

test('NONSTOP retains codec retries across prefix, bare path and parent-folder candidates', () => {
  const chart = createEmptyJSON('bms');
  chart.bms.pathWAV = 'audio/';
  const files = source('a', {
    'Song/sub/audio/kick.opus': bytes(1),
    'Song/sub/kick.opus': bytes(2),
    'Song/kick.m4a': bytes(3),
  });
  const { source: stitched, assetPath } = createNonstopAssets([
    { chart, source: files, chartPath: 'Song/sub/main.bms' },
  ]);
  const path = assetPath(0, 'wav', 'kick.wav');
  const excludedEntries = new Set<Uint8Array>();
  for (const name of ['Song/sub/audio/kick.opus', 'Song/sub/kick.opus', 'Song/kick.m4a']) {
    const entry = resolveChartAudioAsset(stitched, NONSTOP_CHART_PATH, path, { excludedEntries });
    expect(entry).toBe(files.files.get(name));
    excludedEntries.add(entry as Uint8Array);
  }
  expect(resolveChartAudioAsset(stitched, NONSTOP_CHART_PATH, path, { excludedEntries })).toBeUndefined();
});
