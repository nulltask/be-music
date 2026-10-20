import { describe, expect, it, vi } from 'vite-plus/test';
import { ChartImageCache, resolveChartImagePath } from './chart-images.ts';
import type { LibraryChart } from '@be-music/scene-model';
import type { BrowserAssetSource } from '../../collection/types.ts';

function chartEntry(
  chartPath: string,
  metadata: { stageFile?: string; banner?: string; backBMP?: string },
): LibraryChart {
  return { sourceId: 'src', chartPath, chart: { metadata } } as unknown as LibraryChart;
}

const SOURCE = { id: 'src' } as BrowserAssetSource;

interface FakeBitmap {
  path: string;
  close: ReturnType<typeof vi.fn>;
}

function fakeBitmap(path: string): FakeBitmap {
  return { path, close: vi.fn() };
}

/** A loader whose loads resolve when the test says so. */
function deferredLoader() {
  const calls: { path: string; resolve: (image: FakeBitmap | undefined) => void }[] = [];
  const load = vi.fn(
    (_source: BrowserAssetSource, _song: LibraryChart, path: string) =>
      new Promise<ImageBitmap | undefined>((resolve) => {
        calls.push({ path, resolve: (image) => resolve(image as unknown as ImageBitmap | undefined) });
      }),
  );
  return { load, calls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('resolveChartImagePath', () => {
  it('maps each kind to its chart header', () => {
    const entry = chartEntry('a.bms', { stageFile: 'stage.png', banner: 'banner.bmp', backBMP: 'back.jpg' });
    expect(resolveChartImagePath(entry, 'stageFile')).toBe('stage.png');
    expect(resolveChartImagePath(entry, 'banner')).toBe('banner.bmp');
    expect(resolveChartImagePath(entry, 'backBMP')).toBe('back.jpg');
  });

  it('treats a missing or blank header as no image', () => {
    expect(resolveChartImagePath(chartEntry('a.bms', {}), 'banner')).toBeUndefined();
    expect(resolveChartImagePath(chartEntry('a.bms', { banner: '  ' }), 'banner')).toBeUndefined();
  });
});

describe('ChartImageCache', () => {
  it('loads on the first miss, notifies, and then answers from the cache', async () => {
    const { load, calls } = deferredLoader();
    const onLoaded = vi.fn();
    const cache = new ChartImageCache({ resolveSource: () => SOURCE, onLoaded, load });
    const entry = chartEntry('a.bms', { stageFile: 'stage.png' });

    expect(cache.lookup(entry, 'stageFile')).toBeUndefined();
    expect(cache.lookup(entry, 'stageFile')).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);

    const image = fakeBitmap('stage.png');
    calls[0]!.resolve(image);
    await flush();
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(cache.lookup(entry, 'stageFile')).toBe(image);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('remembers images that are missing or fail to decode', async () => {
    const { load, calls } = deferredLoader();
    const resolveSource = vi.fn(() => SOURCE);
    const cache = new ChartImageCache({ resolveSource, load });
    const noHeader = chartEntry('a.bms', {});
    expect(cache.lookup(noHeader, 'banner')).toBeUndefined();
    expect(cache.lookup(noHeader, 'banner')).toBeUndefined();
    expect(load).not.toHaveBeenCalled();

    const broken = chartEntry('b.bms', { banner: 'broken.bmp' });
    cache.lookup(broken, 'banner');
    calls[0]!.resolve(undefined);
    await flush();
    expect(cache.lookup(broken, 'banner')).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('answers undefined without loading when the host has no source for the song', () => {
    const { load } = deferredLoader();
    const cache = new ChartImageCache({ resolveSource: () => undefined, load });
    expect(cache.lookup(chartEntry('a.bms', { banner: 'banner.bmp' }), 'banner')).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('closes the least recently used image once over capacity', async () => {
    const { load, calls } = deferredLoader();
    const cache = new ChartImageCache({ resolveSource: () => SOURCE, load, capacity: 2 });
    const a = chartEntry('a.bms', { banner: 'a.bmp' });
    const b = chartEntry('b.bms', { banner: 'b.bmp' });
    const c = chartEntry('c.bms', { banner: 'c.bmp' });
    const images = [fakeBitmap('a.bmp'), fakeBitmap('b.bmp'), fakeBitmap('c.bmp')];

    cache.lookup(a, 'banner');
    cache.lookup(b, 'banner');
    calls[0]!.resolve(images[0]);
    calls[1]!.resolve(images[1]);
    await flush();
    // Touch `a` so `b` becomes the least recently used.
    expect(cache.lookup(a, 'banner')).toBe(images[0]);
    cache.lookup(c, 'banner');
    calls[2]!.resolve(images[2]);
    await flush();

    expect(cache.size).toBe(2);
    expect(images[1]!.close).toHaveBeenCalledTimes(1);
    expect(images[0]!.close).not.toHaveBeenCalled();
    expect(cache.lookup(a, 'banner')).toBe(images[0]);
    expect(cache.lookup(c, 'banner')).toBe(images[2]);
  });

  it('closes every image on dispose, including one that arrives afterwards', async () => {
    const { load, calls } = deferredLoader();
    const onLoaded = vi.fn();
    const cache = new ChartImageCache({ resolveSource: () => SOURCE, onLoaded, load });
    const loaded = fakeBitmap('a.bmp');
    const late = fakeBitmap('b.bmp');
    cache.lookup(chartEntry('a.bms', { banner: 'a.bmp' }), 'banner');
    calls[0]!.resolve(loaded);
    await flush();
    cache.lookup(chartEntry('b.bms', { banner: 'b.bmp' }), 'banner');

    cache.dispose();
    expect(loaded.close).toHaveBeenCalledTimes(1);
    calls[1]!.resolve(late);
    await flush();
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(cache.lookup(chartEntry('a.bms', { banner: 'a.bmp' }), 'banner')).toBeUndefined();
  });

  it('drops loads started before a clear and retries afterwards', async () => {
    const { load, calls } = deferredLoader();
    const cache = new ChartImageCache({ resolveSource: () => SOURCE, load });
    const entry = chartEntry('a.bms', { banner: 'a.bmp' });
    cache.lookup(entry, 'banner');
    cache.clear();
    const stale = fakeBitmap('a.bmp');
    calls[0]!.resolve(stale);
    await flush();
    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
    cache.lookup(entry, 'banner');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
