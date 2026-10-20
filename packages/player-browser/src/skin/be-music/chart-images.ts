import { loadAssetBytes, resolveChartImageAsset } from '../../collection/collection.ts';
import type { LibraryChart } from '@be-music/player-scene-model';
import type { BrowserAssetSource } from '../../collection/types.ts';
import { loadImageBitmapFromBytes } from '../../media/textures.ts';
import { logger } from '../../logger.ts';
import type { BeMusicChartImageKind, BeMusicChartImageLookup } from './types.ts';

const log = logger('be-music-chart-images');

/**
 * How many decoded song images a cache keeps before closing the least recently used one. Comfortably above what one
 * screen shows (a select list's banners plus the focused song's stage file and back image).
 */
export const DEFAULT_SONG_IMAGE_CAPACITY = 32;

/** The chart-relative path of `song`'s `kind` image (`#STAGEFILE`, `#BANNER`, `#BACKBMP`), when the chart names one. */
export function resolveChartImagePath(chartEntry: LibraryChart, kind: BeMusicChartImageKind): string | undefined {
  const metadata = chartEntry.chart.metadata;
  const path = kind === 'stageFile' ? metadata.stageFile : kind === 'banner' ? metadata.banner : metadata.backBMP;
  return path !== undefined && path.trim().length > 0 ? path : undefined;
}

export interface ChartImageCacheOptions {
  /** The asset source holding `song`'s files, or `undefined` when the host has none for it. */
  resolveSource(chartEntry: LibraryChart): BrowserAssetSource | undefined;
  /** Called after an image finished loading, so the screen can be redrawn (select bumps its `revision`). */
  onLoaded?: () => void;
  /** Most images kept decoded at once. Default {@link DEFAULT_SONG_IMAGE_CAPACITY}. */
  capacity?: number;
  /** Reads and decodes one image. Defaults to the chart-asset loader plus `createImageBitmap`; tests swap it. */
  load?: (source: BrowserAssetSource, chartEntry: LibraryChart, path: string) => Promise<ImageBitmap | undefined>;
}

/**
 * Decoded song images for be-music skins, behind the synchronous {@link lookup} the frames hand out as `chartImage`. A
 * miss starts loading the image and answers `undefined`; once it decodes, `onLoaded` fires and later lookups return it.
 * Images that are missing or fail to decode are remembered so they aren't retried every frame. At most `capacity`
 * bitmaps are kept: the least recently looked-up one is `close()`d to make room, and {@link dispose} closes the rest.
 * A skin should therefore look an image up on every draw rather than keep the bitmap.
 */
export class ChartImageCache {
  private readonly images = new Map<string, ImageBitmap>();
  private readonly pending = new Set<string>();
  private readonly unavailable = new Set<string>();
  private readonly options: ChartImageCacheOptions;
  private readonly capacity: number;
  private generation = 0;
  private disposed = false;

  constructor(options: ChartImageCacheOptions) {
    this.options = options;
    this.capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_SONG_IMAGE_CAPACITY));
  }

  /** Number of decoded images held right now. */
  get size(): number {
    return this.images.size;
  }

  readonly lookup: BeMusicChartImageLookup = (chartEntry, kind) => {
    if (this.disposed) return undefined;
    const key = `${chartEntry.sourceId}\u0000${chartEntry.chartPath}\u0000${kind}`;
    const cached = this.images.get(key);
    if (cached) {
      // Re-insert so the map's insertion order doubles as the recency order the eviction walks.
      this.images.delete(key);
      this.images.set(key, cached);
      return cached;
    }
    if (this.pending.has(key) || this.unavailable.has(key)) return undefined;
    const path = resolveChartImagePath(chartEntry, kind);
    const source = path !== undefined ? this.options.resolveSource(chartEntry) : undefined;
    if (path === undefined || source === undefined) {
      this.unavailable.add(key);
      return undefined;
    }
    this.pending.add(key);
    void this.load(key, source, chartEntry, path, this.generation);
    return undefined;
  };

  /** Closes every image and forgets what was missing (e.g. after the song collection was replaced). */
  clear(): void {
    this.generation += 1;
    for (const image of this.images.values()) image.close();
    this.images.clear();
    this.pending.clear();
    this.unavailable.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }

  private async load(
    key: string,
    source: BrowserAssetSource,
    chartEntry: LibraryChart,
    path: string,
    generation: number,
  ): Promise<void> {
    let image: ImageBitmap | undefined;
    try {
      image = await (this.options.load ?? loadSongImage)(source, chartEntry, path);
    } catch (error) {
      log.debug('song image failed to load', { path, error });
    }
    if (this.disposed || generation !== this.generation) {
      image?.close();
      return;
    }
    this.pending.delete(key);
    if (!image) {
      this.unavailable.add(key);
      return;
    }
    this.images.set(key, image);
    this.evict();
    this.options.onLoaded?.();
  }

  private evict(): void {
    for (const [key, image] of this.images) {
      if (this.images.size <= this.capacity) return;
      this.images.delete(key);
      image.close();
    }
  }
}

async function loadSongImage(
  source: BrowserAssetSource,
  chartEntry: LibraryChart,
  path: string,
): Promise<ImageBitmap | undefined> {
  const bytes = await loadAssetBytes(resolveChartImageAsset(source, chartEntry.chartPath, path));
  return bytes ? loadImageBitmapFromBytes(path, bytes) : undefined;
}
