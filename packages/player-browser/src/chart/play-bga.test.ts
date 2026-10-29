import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { Texture, TextureSource } from 'pixi.js';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { keyBoundBGAResourceKey } from './key-bound-bga.ts';
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

function sourceTexture(): Texture {
  return new Texture({ source: new TextureSource({ width: 512, height: 256 }) });
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
  test('includes an EXBMP-only implicit POOR image and respects POORBGA 2', () => {
    const chart = bmsChart({});
    chart.bms.exBMP['00'] = '0,0,0,0 miss.png';
    expect(resolvePoorBGAFallbackKey(chart)).toBe('00');
    chart.bms.poorBGA = '2';
    expect(resolvePoorBGAFallbackKey(chart)).toBeUndefined();
  });
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
  test('walks reversed dependencies, terminates cycles and stops at explicit BMP/EXBMP declarations', () => {
    const chart = bmsChart({ '09': 'sheet.png', '03': 'direct.png' });
    chart.bms.exBMP['04'] = ',,,,extended.png';
    chart.bms.bga = {
      '02': '09 0 0 64 64 16 16',
      '01': '02 16 16 80 80 32 32',
      '03': '08 0 0 64 64 0 0',
      '04': '08 0 0 64 64 0 0',
      '05': '06 0 0 64 64 0 0',
      '06': '05 0 0 64 64 0 0',
    };
    const original = structuredClone(chart);
    const resources = collectPlayBGAResources(
      chart,
      {
        base: [{ seconds: 0, bmpKey: '03' }],
        layer: [
          { seconds: 0, bmpKey: '01' },
          { seconds: 1, bmpKey: '04' },
          { seconds: 2, bmpKey: '05' },
        ],
        poor: [],
      },
      undefined,
    );
    expect([...resources.paths]).toEqual([
      ['09', 'sheet.png'],
      ['03', 'direct.png'],
      ['04', 'extended.png'],
    ]);
    expect(resources.layer).toEqual(new Set(['01', '02', '09', '04', '05', '06']));
    expect(resources.base).toEqual(new Set(['03']));
    expect(chart).toEqual(original);
  });
  test('loads referenced EXBMP-only resources and preserves explicit BMP paths', () => {
    const chart = bmsChart({ '01': 'explicit.png' });
    chart.bms.exBMP = {
      '00': '0,0,0,0 miss.png',
      '01': '0,0,0,0 ignored.png',
      '02': '0,0,0,0 images/my layer,01.png',
      '03': '0,0,0,0 unused.png',
      '04': 'malformed',
    };
    const original = structuredClone(chart);
    const resources = collectPlayBGAResources(
      chart,
      {
        base: [{ seconds: 0, bmpKey: '01' }],
        layer: [
          { seconds: 0, bmpKey: '02' },
          { seconds: 1, bmpKey: '04' },
        ],
        poor: [],
      },
      resolvePoorBGAFallbackKey(chart),
    );
    expect(Object.fromEntries(resources.paths)).toEqual({
      '00': 'miss.png',
      '01': 'explicit.png',
      '02': 'images/my layer,01.png',
    });
    expect(chart).toEqual(original);
  });
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

  test('loads host-remapped SWBGA frames with long ids even when the stitched chart has no A5 controls', async () => {
    const chart = createEmptyJSON('bmson');
    chart.bms.base = 62;
    chart.resources.bmp.longImage = 'stage/image.png';
    chart.bms.bga.longAlias = 'longImage 0 0 1 1 32 64';
    mocks.loadTextureFromBytes.mockImplementation(
      async () => new Texture({ source: new TextureSource({ resource: new Uint8Array(4), width: 1, height: 1 }) }),
    );
    const resources = emptyResources();
    await loadPlayBGA({
      chart,
      source: SOURCE,
      chartPath: 'course.bmson',
      tempo: 1,
      timeline: { base: [], layer: [], poor: [] },
      into: resources,
      keyBoundBGACues: [
        {
          seconds: 2,
          endSeconds: 4,
          definitionId: 'stage:0:61',
          definition: {
            frameIntervalMs: 100,
            durationMs: 0,
            channel: '11',
            loop: true,
            argb: { a: 255, r: 255, g: 255, b: 255 },
            frames: ['longAlias'],
          },
        },
      ],
    });
    const key = keyBoundBGAResourceKey('stage:0:61', 'longAlias');
    expect(resources.layerTextures.has(key)).toBe(true);
    expect(resources.subRegionOrigins.get(key)).toEqual({ x: 32, y: 64 });
    expect(mocks.loadTextureFromBytes.mock.calls[0]).toMatchObject([
      'stage/image.png',
      expect.any(Uint8Array),
      { swBGAColorKey: { a: 255, r: 255, g: 255, b: 255 } },
    ]);
  });

  test('loads A5-only packed frames, aliases and per-definition color variants without replacing normal images', async () => {
    const chart = bmsChart({ '00': 'strip.png', '05': 'base.png' });
    chart.bms.swBGA = { '61': '500:0:11:1:255,255,255,255 0002', '62': '500:0:12:0:255,0,0,0 00' };
    chart.bms.bga['02'] = '00 0 0 1 1 32 64';
    chart.events = [
      { measure: 0, position: [0, 1], channel: 'A5', value: '61' },
      { measure: 1, position: [0, 1], channel: 'A5', value: '62' },
    ];
    const resources = emptyResources();
    mocks.loadTextureFromBytes.mockImplementation(
      async () => new Texture({ source: new TextureSource({ resource: new Uint8Array(4), width: 1, height: 1 }) }),
    );
    const original = structuredClone(chart);
    await loadPlayBGA({
      chart,
      source: SOURCE,
      chartPath: 'x.bms',
      timeline: { base: [{ seconds: 0, bmpKey: '05' }], layer: [], poor: [] },
      into: resources,
      tempo: 1,
    });
    expect(resources.textures.has('05')).toBe(true);
    expect(resources.layerTextures.has(keyBoundBGAResourceKey('61', '00'))).toBe(true);
    expect(resources.layerTextures.has(keyBoundBGAResourceKey('61', '02'))).toBe(true);
    expect(resources.layerTextures.get(keyBoundBGAResourceKey('61', '00'))).not.toBe(
      resources.layerTextures.get(keyBoundBGAResourceKey('62', '00')),
    );
    expect(resources.subRegionOrigins.get(keyBoundBGAResourceKey('61', '02'))).toEqual({ x: 32, y: 64 });
    expect(mocks.loadTextureFromBytes.mock.calls.map(([path, , options]) => [path, options])).toEqual([
      ['base.png', undefined],
      ['strip.png', { keyOutBlack: false, swBGAColorKey: { a: 255, r: 255, g: 255, b: 255 } }],
      ['strip.png', { keyOutBlack: false, swBGAColorKey: { a: 255, r: 0, g: 0, b: 0 } }],
    ]);
    expect(chart).toEqual(original);
  });

  test.each(['0,0,0,0', '64,127,128,129'])(
    'passes EXBMP color keys before alias cropping on base and layers (%s)',
    async (tuple) => {
      const chart = bmsChart({ '01': 'override.png' });
      chart.bms.exBMP = { '01': '0,127,127,127 ignored.png', '02': `${tuple} colors.png` };
      chart.bms.bga['04'] = '02 0 0 1 1 0 0';
      await loadPlayBGA({
        chart,
        source: SOURCE,
        chartPath: 'x.bms',
        into: emptyResources(),
        tempo: 1,
        timeline: {
          base: [
            { seconds: 0, bmpKey: '01' },
            { seconds: 1, bmpKey: '04' },
          ],
          layer: [{ seconds: 0, bmpKey: '04' }],
          poor: [],
        },
      });
      const [a, r, g, b] = tuple.split(',').map(Number);
      const bmsColorKey = { a, r, g, b };
      expect(mocks.loadTextureFromBytes).toHaveBeenCalledWith('colors.png', expect.any(Uint8Array), { bmsColorKey });
      expect(mocks.loadTextureFromBytes).toHaveBeenCalledWith('colors.png', expect.any(Uint8Array), {
        bmsColorKey,
        keyOutBlack: false,
      });
      expect(mocks.loadTextureFromBytes).toHaveBeenCalledWith('override.png', expect.any(Uint8Array));
    },
  );

  test('binds nested video aliases to independent plane playheads and preserves native crop coordinates', async () => {
    const chart = bmsChart({ '01': 'sheet.webm' });
    chart.bms.bga = { '02': '04 16 32 80 160 32 64', '03': '04 80 32 144 160 128 64', '04': '01 256 0 384 128 16 32' };
    const handles = [0, 1, 2, 3].map((index) => ({
      texture: sourceTexture(),
      objectURL: `blob:${index}`,
      video: { pause: vi.fn(), playbackRate: 1, defaultPlaybackRate: 1 },
    }));
    for (const handle of handles) mocks.loadVideoTextureFromBytes.mockResolvedValueOnce(handle);
    const into = emptyResources();
    await loadPlayBGA({
      chart,
      source: SOURCE,
      chartPath: 'x.bms',
      into,
      tempo: 1.25,
      transcode: { maxLongEdgePx: 128, useWebCodecs: true },
      timeline: {
        base: [{ seconds: 0, bmpKey: '02' }],
        layer: [{ seconds: 1, bmpKey: '02' }],
        layer2: [{ seconds: 2, bmpKey: '03' }],
        poor: [{ seconds: 0, bmpKey: '02' }],
      },
    });
    const layer = String.fromCharCode(0) + 'layer:02';
    const layer2 = String.fromCharCode(0) + 'layer2:03';
    const poor = String.fromCharCode(0) + 'poor:02';
    for (const [key, index] of [
      ['02', 0],
      [layer, 1],
      [layer2, 2],
      [poor, 3],
    ] as const)
      expect(into.videos.get(key)?.video).toBe(handles[index]!.video);
    expect(into.layerTextures.get(layer)?.source).toBe(handles[1]!.texture.source);
    expect(into.layerTextures.get(layer2)?.frame).toMatchObject({ x: 320, y: 0, width: 64, height: 128 });
    expect(into.textures.get(poor)?.source).toBe(handles[3]!.texture.source);
    expect(into.subRegionOrigins.get(layer2)).toEqual({ x: 128, y: 64 });
    expect(mocks.loadAssetBytes).toHaveBeenCalledOnce();
    expect(mocks.loadVideoTextureFromBytes).toHaveBeenCalledTimes(4);
    expect(mocks.loadVideoTextureFromBytes).toHaveBeenCalledWith('sheet.webm', expect.any(Uint8Array), {
      maxLongEdgePx: 0,
      useWebCodecs: true,
    });
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

  test('loads second-overlay assets and separate video playheads for a BMP reused on all tracks', async () => {
    const handles = [0, 1, 2].map((index) => ({
      texture: new Texture(),
      objectURL: `blob:${index}`,
      video: { pause: vi.fn(), playbackRate: 1, defaultPlaybackRate: 1 },
    }));
    for (const handle of handles) mocks.loadVideoTextureFromBytes.mockResolvedValueOnce(handle);
    const into = emptyResources();
    mocks.resolveChartBGAAsset.mockReturnValue({ entry: 'movie.mp4', path: 'movie.mp4' });
    await loadPlayBGA({
      chart: bmsChart({ '01': 'movie.bmp' }),
      source: SOURCE,
      chartPath: 'x.bms',
      timeline: {
        base: [{ seconds: 0, bmpKey: '01' }],
        layer: [{ seconds: 2, bmpKey: '01' }],
        layer2: [{ seconds: 4, bmpKey: '01' }],
        poor: [],
      },
      into,
      tempo: 1.5,
    });
    // A BMP declaration can resolve to a video re-encode.
    expect(mocks.loadTextureFromBytes).not.toHaveBeenCalled();
    expect(into.videos.size).toBe(3);
    expect(into.videos.get(String.fromCharCode(0) + 'layer:01')?.video).toBe(handles[1]!.video);
    expect(into.layerTextures.get(String.fromCharCode(0) + 'layer2:01')).toBe(handles[2]!.texture);
    expect(handles.every((handle) => handle.video.playbackRate === 1.5)).toBe(true);
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
  test('composes nested alias coordinates and clips source and destination on both tracks', () => {
    const chart = bmsChart({ '09': 'sheet.png' });
    // The parent first crops native x=256..384 to canvas x=32..160. The child samples x=16..112,
    // so its first 16 columns are empty; negative destination y clips another 8 source rows.
    chart.bms.bga = { '01': '02 16 48 112 112 200 -8', '02': '09 256 0 384 128 32 48' };
    const into = emptyResources();
    const source = sourceTexture();
    into.textures.set('09', source);
    into.layerTextures.set('09', source);
    registerSubRegionBGATextures(chart, into);
    for (const textures of [into.textures, into.layerTextures]) {
      expect(textures.get('01')?.source).toBe(source.source);
      expect(textures.get('01')?.frame).toMatchObject({ x: 256, y: 8, width: 40, height: 56 });
    }
    expect(into.subRegionOrigins.get('01')).toEqual({ x: 216, y: 0 });
  });

  test('ignores aliases shadowed by direct images, even when the declared image did not load', () => {
    const chart = bmsChart({ '01': 'direct.png', '03': 'missing.png', '09': 'sheet.png' });
    chart.bms.exBMP['02'] = ',,,,extended.png';
    chart.bms.bga = Object.fromEntries(['01', '02', '03'].map((slot) => [slot, '09 8 4 24 20 10 12']));
    const into = emptyResources();
    const source = sourceTexture();
    into.layerTextures.set('09', source);
    into.layerTextures.set('01', source);
    registerSubRegionBGATextures(chart, into);
    expect([...into.layerTextures.keys()]).toEqual(['09', '01']);
    expect(into.subRegionOrigins.size).toBe(0);
  });

  test('keeps wholly clipped aliases empty and terminates missing and cyclic dependencies', () => {
    const chart = bmsChart({ '09': 'sheet.png' });
    chart.bms.bga = {
      '01': '09 600 0 620 20 0 0',
      '02': '01 0 0 256 256 0 0',
      '03': '04 0 0 10 10 0 0',
      '04': '03 0 0 10 10 0 0',
      '05': '08 0 0 10 10 0 0',
    };
    const into = emptyResources();
    const fillRect = vi.fn();
    const canvases: unknown[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = { getContext: () => ({ fillRect, fillStyle: '' }) };
        canvases.push(canvas);
        return canvas;
      },
    });
    const from = vi.spyOn(Texture, 'from').mockImplementation(() => new Texture());
    try {
      into.textures.set('09', sourceTexture());
      into.layerTextures.set('09', sourceTexture());
      registerSubRegionBGATextures(chart, into);
      expect([...into.layerTextures.keys()].sort()).toEqual(['01', '02', '09']);
      expect([...into.textures.keys()].sort()).toEqual(['01', '02', '09']);
      expect(from).toHaveBeenCalledTimes(2);
      expect(fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 256, 256);
      expect(canvases).toHaveLength(2);
      expect(into.layerTextures.get('01')?.source).toBe(into.layerTextures.get('02')?.source);
    } finally {
      from.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  test('resolves a long internal bmson dependency chain without recursive calls', () => {
    const chart = createEmptyJSON('bmson');
    chart.bms.base = 62;
    chart.resources.bmp['root'] = 'sheet.png';
    // All generated IDs are valid base-62 strings, and deliberately list consumers before dependencies.
    for (let index = 0; index < 5000; index++)
      chart.bms.bga[`id${index}`] = `${index === 4999 ? 'root' : `id${index + 1}`} 0 0 256 256 0 0`;
    const into = emptyResources();
    const source = sourceTexture();
    into.layerTextures.set('root', source);
    registerSubRegionBGATextures(chart, into);
    expect(into.layerTextures.size).toBe(5001);
    expect(into.layerTextures.get('id0')?.source).toBe(source.source);
    expect(into.layerTextures.get('id0')?.frame.width).toBe(256);
  });
  test('loads and cuts internal long resource ids from mixed NONSTOP bmson output without truncation', () => {
    const chart = createEmptyJSON('bmson');
    chart.bms.base = 62;
    chart.resources.bmp['101'] = 'source.png';
    chart.bms.bga['100'] = '101 8 4 24 20 10 12';
    const resources = collectPlayBGAResources(
      chart,
      { base: [], layer: [{ seconds: 0, bmpKey: '100' }], poor: [] },
      undefined,
    );
    expect(Object.fromEntries(resources.paths)).toEqual({ '101': 'source.png' });
    const into = emptyResources();
    const source = sourceTexture();
    into.layerTextures.set('101', source);
    registerSubRegionBGATextures(chart, into);
    expect(into.layerTextures.get('100')?.source).toBe(source.source);
    expect(into.subRegionOrigins.get('100')).toEqual({ x: 10, y: 12 });
    expect(into.layerTextures.has('10')).toBe(false);
  });
  test('cuts a view of the loaded source on its track and records the placement', () => {
    const chart = bmsChart({ '04': 'src.png' });
    chart.bms.bga = { '05': '04 8 4 24 20 10 12', '06': '09 0 0 16 16 0 0' };
    const into = emptyResources();
    const source = sourceTexture();
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
