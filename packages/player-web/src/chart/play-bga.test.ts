import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { Texture } from 'pixi.js';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { BrowserSongAssetSource } from '../collection/types.ts';
import {
  collectPlayBgaResources,
  loadPlayBga,
  registerSubRegionBgaTextures,
  resolvePoorBgaFallbackKey,
  type PlayBgaResources,
} from './play-bga.ts';

const mocks = vi.hoisted(() => ({
  loadAssetBytes: vi.fn(),
  resolveChartBgaAsset: vi.fn(),
  loadTextureFromBytes: vi.fn(),
  loadVideoTextureFromBytes: vi.fn(),
}));

vi.mock('../collection/collection.ts', () => ({
  loadAssetBytes: mocks.loadAssetBytes,
  resolveChartBgaAsset: mocks.resolveChartBgaAsset,
}));

vi.mock('../media/textures.ts', () => ({
  loadTextureFromBytes: mocks.loadTextureFromBytes,
  loadVideoTextureFromBytes: mocks.loadVideoTextureFromBytes,
}));

const SOURCE = {} as BrowserSongAssetSource;

function bmsChart(bmp: Record<string, string>): BeMusicJson {
  const chart = createEmptyJson('bms');
  chart.resources.bmp = bmp;
  return chart;
}

function emptyResources(): PlayBgaResources {
  return { textures: new Map(), layerTextures: new Map(), videos: new Map(), subRegionOrigins: new Map() };
}

describe('resolvePoorBgaFallbackKey', () => {
  test('uses #BMP00 as the POOR image only when the chart declares no #POORBGA', () => {
    expect(resolvePoorBgaFallbackKey(bmsChart({ '00': 'miss.bmp' }))).toBe('00');
    expect(resolvePoorBgaFallbackKey(bmsChart({ '01': 'a.bmp' }))).toBeUndefined();
    const withPoorBga = bmsChart({ '00': 'miss.bmp' });
    withPoorBga.bms.poorBga = '1';
    expect(resolvePoorBgaFallbackKey(withPoorBga)).toBeUndefined();
  });
});

describe('collectPlayBgaResources', () => {
  test('maps the referenced keys to their files, per track, with sub-region sources and the POOR fallback', () => {
    const chart = bmsChart({
      '00': 'miss.bmp',
      '01': 'base.bmp',
      '02': 'layer.bmp',
      '03': 'unused.bmp',
      '04': 'src.png',
    });
    chart.bms.bga = { '05': '04 0 0 16 16 0 0' };
    const resources = collectPlayBgaResources(
      chart,
      {
        base: [{ seconds: 0, bmpKey: '01' }],
        layer: [
          { seconds: 1, bmpKey: '02' },
          { seconds: 2, bmpKey: '05' },
        ],
        poor: [],
      },
      '00',
    );
    expect(Object.fromEntries(resources.paths)).toEqual({
      '00': 'miss.bmp',
      '01': 'base.bmp',
      '02': 'layer.bmp',
      '04': 'src.png',
    });
    expect([...resources.base].sort()).toEqual(['00', '01']);
    expect([...resources.layer].sort()).toEqual(['02', '04', '05']);
  });

  test('loads a bmson BGA by its header name', () => {
    const chart = createEmptyJson('bmson');
    chart.bmson.bga.header = [{ id: 1, name: 'movie.mp4' }];
    const resources = collectPlayBgaResources(
      chart,
      { base: [{ seconds: 0, bmpKey: 'movie.mp4' }], layer: [], poor: [] },
      undefined,
    );
    expect(Object.fromEntries(resources.paths)).toEqual({ 'movie.mp4': 'movie.mp4' });
  });
});

describe('loadPlayBga', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.resolveChartBgaAsset.mockImplementation((_source, _chartPath, path: string) => ({ entry: path, path }));
    mocks.loadAssetBytes.mockImplementation(async (path: string) => new TextEncoder().encode(path));
    mocks.loadTextureFromBytes.mockImplementation(async () => new Texture());
  });

  test('keys the layer track black out for BMS but not for bmson', async () => {
    const timeline = { base: [{ seconds: 0, bmpKey: '01' }], layer: [{ seconds: 0, bmpKey: '01' }], poor: [] };
    const into = emptyResources();
    await loadPlayBga({
      chart: bmsChart({ '01': 'a.bmp' }),
      source: SOURCE,
      chartPath: 'x.bms',
      timeline,
      into,
      tempo: 1,
    });
    expect(mocks.loadTextureFromBytes).toHaveBeenCalledWith('a.bmp', expect.any(Uint8Array));
    expect(mocks.loadTextureFromBytes).toHaveBeenCalledWith('a.bmp', expect.any(Uint8Array), { keyOutBlack: true });
    expect(into.textures.has('01')).toBe(true);
    expect(into.layerTextures.has('01')).toBe(true);

    mocks.loadTextureFromBytes.mockClear();
    const bmson = createEmptyJson('bmson');
    bmson.bmson.bga.header = [{ id: 1, name: 'a.png' }];
    await loadPlayBga({
      chart: bmson,
      source: SOURCE,
      chartPath: 'x.bmson',
      timeline: { base: [], layer: [{ seconds: 0, bmpKey: 'a.png' }], poor: [] },
      into: emptyResources(),
      tempo: 1,
    });
    expect(mocks.loadTextureFromBytes).toHaveBeenCalledWith('a.png', expect.any(Uint8Array), { keyOutBlack: false });
  });

  test('starts a video paused at the play tempo, under the file name it was found as', async () => {
    const video = { pause: vi.fn(), playbackRate: 1, defaultPlaybackRate: 1 };
    const texture = new Texture();
    mocks.resolveChartBgaAsset.mockReturnValue({ entry: 'bga.mp4', path: 'bga.mp4' });
    mocks.loadVideoTextureFromBytes.mockResolvedValue({ video, texture, objectUrl: 'blob:1' });
    const into = emptyResources();
    await loadPlayBga({
      chart: bmsChart({ '01': 'bga.mpg' }),
      source: SOURCE,
      chartPath: 'x.bms',
      timeline: { base: [{ seconds: 0, bmpKey: '01' }], layer: [], poor: [] },
      into,
      transcode: { maxLongEdgePx: 640 },
      tempo: 1.25,
    });
    expect(mocks.loadVideoTextureFromBytes).toHaveBeenCalledWith('bga.mp4', expect.any(Uint8Array), {
      maxLongEdgePx: 640,
    });
    expect(video.pause).toHaveBeenCalled();
    expect(video.playbackRate).toBe(1.25);
    expect(video.defaultPlaybackRate).toBe(1.25);
    expect(into.videos.get('01')).toEqual({ video, objectUrl: 'blob:1' });
    expect(into.textures.get('01')).toBe(texture);
    expect(into.layerTextures.has('01')).toBe(false);
  });

  test('loads nothing once the play is cancelled', async () => {
    const into = emptyResources();
    await loadPlayBga({
      chart: bmsChart({ '01': 'a.bmp' }),
      source: SOURCE,
      chartPath: 'x.bms',
      timeline: { base: [{ seconds: 0, bmpKey: '01' }], layer: [], poor: [] },
      into,
      tempo: 1,
      isCancelled: () => true,
    });
    expect(mocks.loadAssetBytes).not.toHaveBeenCalled();
    expect(into.textures.size).toBe(0);
  });
});

describe('registerSubRegionBgaTextures', () => {
  test('cuts a view of the loaded source on its track and records the placement', () => {
    const chart = bmsChart({ '04': 'src.png' });
    chart.bms.bga = { '05': '04 8 4 24 20 10 12', '06': '09 0 0 16 16 0 0' };
    const into = emptyResources();
    const source = new Texture();
    into.layerTextures.set('04', source);
    registerSubRegionBgaTextures(chart, into);
    const view = into.layerTextures.get('05');
    expect(view?.source).toBe(source.source);
    expect(view?.frame).toMatchObject({ x: 8, y: 4, width: 16, height: 16 });
    expect(into.textures.has('05')).toBe(false);
    expect(into.subRegionOrigins.get('05')).toEqual({ x: 10, y: 12 });
    // Its source never loaded: no view, no placement.
    expect(into.layerTextures.has('06')).toBe(false);
    expect(into.subRegionOrigins.has('06')).toBe(false);
  });
});
