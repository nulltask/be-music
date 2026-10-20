import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { Texture } from 'pixi.js';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { BrowserAssetSource } from '../collection/types.ts';
import {
  collectPlayBGAResources,
  loadPlayBGA,
  registerSubRegionBGATextures,
  resolvePoorBGAFallbackKey,
  resolvePoorBGAMode,
  type PlayBGAResources,
} from './play-bga.ts';

const mocks = vi.hoisted(() => ({
  loadAssetBytes: vi.fn(),
  resolveChartBGAAsset: vi.fn(),
  loadTextureFromBytes: vi.fn(),
  loadVideoTextureFromBytes: vi.fn(),
}));

vi.mock('../collection/collection.ts', () => ({
  loadAssetBytes: mocks.loadAssetBytes,
  resolveChartBGAAsset: mocks.resolveChartBGAAsset,
}));

vi.mock('../media/textures.ts', () => ({
  loadTextureFromBytes: mocks.loadTextureFromBytes,
  loadVideoTextureFromBytes: mocks.loadVideoTextureFromBytes,
}));

const SOURCE = {} as BrowserAssetSource;

function bmsChart(bmp: Record<string, string>): BeMusicJSON {
  const chart = createEmptyJSON('bms');
  chart.resources.bmp = bmp;
  return chart;
}

function emptyResources(): PlayBGAResources {
  return { textures: new Map(), layerTextures: new Map(), videos: new Map(), subRegionOrigins: new Map() };
}

describe('resolvePoorBGAMode', () => {
  test('parses 0..2 and treats a missing, unparsable or out-of-range value as 0', () => {
    expect(resolvePoorBGAMode(undefined)).toBe(0);
    expect(resolvePoorBGAMode('0')).toBe(0);
    expect(resolvePoorBGAMode('1')).toBe(1);
    expect(resolvePoorBGAMode(' 2 ')).toBe(2);
    expect(resolvePoorBGAMode('02')).toBe(2);
    expect(resolvePoorBGAMode('3')).toBe(0);
    expect(resolvePoorBGAMode('-1')).toBe(0);
    expect(resolvePoorBGAMode('abc')).toBe(0);
    expect(resolvePoorBGAMode('')).toBe(0);
  });
});

describe('resolvePoorBGAFallbackKey', () => {
  test('uses #BMP00 as the POOR image unless #POORBGA is 2', () => {
    expect(resolvePoorBGAFallbackKey(bmsChart({ '00': 'miss.bmp' }))).toBe('00');
    expect(resolvePoorBGAFallbackKey(bmsChart({ '01': 'a.bmp' }))).toBeUndefined();
    for (const value of ['0', '1', 'x', '5']) {
      const chart = bmsChart({ '00': 'miss.bmp' });
      chart.bms.poorBGA = value;
      expect(resolvePoorBGAFallbackKey(chart)).toBe('00');
    }
    const hidden = bmsChart({ '00': 'miss.bmp' });
    hidden.bms.poorBGA = '2';
    expect(resolvePoorBGAFallbackKey(hidden)).toBeUndefined();
  });
});

describe('collectPlayBGAResources', () => {
  test('maps the referenced keys to their files, per track, with sub-region sources and the POOR fallback', () => {
    const chart = bmsChart({
      '00': 'miss.bmp',
      '01': 'base.bmp',
      '02': 'layer.bmp',
      '03': 'unused.bmp',
      '04': 'src.png',
    });
    chart.bms.bga = { '05': '04 0 0 16 16 0 0' };
    const resources = collectPlayBGAResources(
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
    const chart = createEmptyJSON('bmson');
    chart.bmson.bga.header = [{ id: 1, name: 'movie.mp4' }];
    const resources = collectPlayBGAResources(
      chart,
      { base: [{ seconds: 0, bmpKey: 'movie.mp4' }], layer: [], poor: [] },
      undefined,
    );
    expect(Object.fromEntries(resources.paths)).toEqual({ 'movie.mp4': 'movie.mp4' });
  });
});

describe('loadPlayBGA', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.resolveChartBGAAsset.mockImplementation((_source, _chartPath, path: string) => ({ entry: path, path }));
    mocks.loadAssetBytes.mockImplementation(async (path: string) => new TextEncoder().encode(path));
    mocks.loadTextureFromBytes.mockImplementation(async () => new Texture());
  });

  test('keys the layer track black out for BMS but not for bmson', async () => {
    const timeline = { base: [{ seconds: 0, bmpKey: '01' }], layer: [{ seconds: 0, bmpKey: '01' }], poor: [] };
    const into = emptyResources();
    await loadPlayBGA({
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
    const bmson = createEmptyJSON('bmson');
    bmson.bmson.bga.header = [{ id: 1, name: 'a.png' }];
    await loadPlayBGA({
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
    mocks.resolveChartBGAAsset.mockReturnValue({ entry: 'bga.mp4', path: 'bga.mp4' });
    mocks.loadVideoTextureFromBytes.mockResolvedValue({ video, texture, objectURL: 'blob:1' });
    const into = emptyResources();
    await loadPlayBGA({
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
    expect(into.videos.get('01')).toEqual({ video, objectURL: 'blob:1' });
    expect(into.textures.get('01')).toBe(texture);
    expect(into.layerTextures.has('01')).toBe(false);
  });

  test('loads nothing once the play is cancelled', async () => {
    const into = emptyResources();
    await loadPlayBGA({
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

describe('registerSubRegionBGATextures', () => {
  test('cuts a view of the loaded source on its track and records the placement', () => {
    const chart = bmsChart({ '04': 'src.png' });
    chart.bms.bga = { '05': '04 8 4 24 20 10 12', '06': '09 0 0 16 16 0 0' };
    const into = emptyResources();
    const source = new Texture();
    into.layerTextures.set('04', source);
    registerSubRegionBGATextures(chart, into);
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
