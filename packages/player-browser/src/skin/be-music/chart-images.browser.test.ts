import { expect, test } from 'vite-plus/test';
import { makeChartWith } from '../../../../player-scene-model/src/test-support/library.ts';
import type { BrowserAssetSource } from '../../collection/types.ts';
import { ChartImageCache } from './chart-images.ts';

test('decodes chart-relative artwork for a DOM image and closes evicted bitmaps', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 1;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, 1, 1);
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the fixture PNG')))),
  );
  const files = new Map([['tracks/art.png', new Uint8Array(await png.arrayBuffer())]]);
  const source: BrowserAssetSource = { id: 'fixture', kind: 'directory', label: 'Fixture', files };
  const entry = makeChartWith('Track', 'tracks', { chartPath: 'tracks/track.bms' }, { sourceId: source.id });
  entry.chart.metadata.banner = 'art.png';
  entry.chart.metadata.stageFile = 'art.png';
  const cache = new ChartImageCache({ resolveSource: () => source, capacity: 1 });
  try {
    expect(cache.lookupURL(entry, 'banner')).toBeUndefined();
    await expect.poll(() => cache.lookupURL(entry, 'banner')).toMatch(/^data:image\/png;base64,/);
    const banner = cache.lookup(entry, 'banner')!;
    expect([banner.width, banner.height]).toEqual([2, 1]);

    const image = new Image();
    image.src = cache.lookupURL(entry, 'banner')!;
    await image.decode();
    context.clearRect(0, 0, 2, 1);
    context.drawImage(image, 0, 0);
    expect([...context.getImageData(0, 0, 2, 1).data]).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);

    await expect.poll(() => cache.lookup(entry, 'stageFile')).toBeInstanceOf(ImageBitmap);
    expect(cache.size).toBe(1);
    expect([banner.width, banner.height]).toEqual([0, 0]);
    const stage = cache.lookup(entry, 'stageFile')!;
    cache.dispose();
    expect([stage.width, stage.height]).toEqual([0, 0]);
    expect(cache.lookupURL(entry, 'stageFile')).toBeUndefined();
  } finally {
    cache.dispose();
  }
});
