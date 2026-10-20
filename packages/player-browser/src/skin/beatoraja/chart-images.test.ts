import { createEmptyJSON } from '@be-music/chart-source';
import { Texture } from 'pixi.js';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { BrowserAssetSource } from '../../collection/types.ts';
import { loadBeatorajaChartImages, resolveBeatorajaChartImage } from './chart-images.ts';

const decoded = vi.hoisted(() => [] as string[]);

vi.mock('../lr2/textures.ts', () => ({
  loadTextureFromBytes: vi.fn(async (path: string, bytes: Uint8Array) => {
    decoded.push(path);
    if (bytes[0] === 0) throw new Error('malformed');
    return { label: path } as unknown as Texture;
  }),
}));

function source(paths: Record<string, number>): BrowserAssetSource {
  return {
    id: 'source',
    kind: 'directory',
    label: 'Source',
    files: new Map(Object.entries(paths).map(([path, byte]) => [path, new Uint8Array([byte])])),
  };
}

function chart(chartPath: string, images: { stageFile?: string; backBMP?: string; banner?: string }) {
  const json = createEmptyJSON('bms');
  Object.assign(json.metadata, images);
  return { chart: json, chartPath };
}

const labelOf = (texture: Texture | undefined): string | undefined => texture?.label;

describe('resolveBeatorajaChartImage', () => {
  it('maps synthetic chart image ids to supplied textures', () => {
    const stageFile = Texture.EMPTY;
    const backBMP = Texture.WHITE;
    const banner = Texture.EMPTY;

    expect(resolveBeatorajaChartImage({ stageFile, backBMP, banner }, -100)).toBe(stageFile);
    expect(resolveBeatorajaChartImage({ stageFile, backBMP, banner }, -101)).toBe(backBMP);
    expect(resolveBeatorajaChartImage({ stageFile, backBMP, banner }, -102)).toBe(banner);
    expect(resolveBeatorajaChartImage({ stageFile }, -999)).toBeUndefined();
    expect(resolveBeatorajaChartImage(undefined, -100)).toBeUndefined();
  });
});

describe('loadBeatorajaChartImages', () => {
  beforeEach(() => {
    decoded.length = 0;
  });

  it("decodes the stage file, back image and banner from the chart's folder", async () => {
    const images = await loadBeatorajaChartImages(
      chart('song/chart.bms', { stageFile: 'stage.png', backBMP: '/back.png', banner: 'banner.png' }),
      source({ 'song/stage.png': 1, 'song/back.png': 1, 'song/banner.png': 1 }),
    );
    expect(labelOf(images.stageFile)).toBe('song/stage.png');
    expect(labelOf(images.backBMP)).toBe('song/back.png');
    expect(labelOf(images.banner)).toBe('song/banner.png');
  });

  it("falls back to the source's root, and leaves out an image it lacks or cannot decode", async () => {
    const images = await loadBeatorajaChartImages(
      chart('song/chart.bms', { stageFile: 'stage.png', backBMP: 'broken.png', banner: 'missing.png' }),
      source({ 'stage.png': 1, 'song/broken.png': 0 }),
    );
    expect(labelOf(images.stageFile)).toBe('stage.png');
    expect(images).not.toHaveProperty('backBMP');
    expect(images).not.toHaveProperty('banner');
    expect(decoded).toEqual(['stage.png', 'song/broken.png']);
  });

  it('loads nothing without a source or for a chart without images', async () => {
    expect(await loadBeatorajaChartImages(chart('chart.bms', { stageFile: 'stage.png' }), undefined)).toEqual({});
    expect(await loadBeatorajaChartImages(chart('chart.bms', {}), source({ 'stage.png': 1 }))).toEqual({});
    expect(decoded).toEqual([]);
  });
});
