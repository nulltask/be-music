/**
 * The beatoraja select view's chart images and graphs (`BeatorajaSelectView`): the focused chart's `#STAGEFILE`,
 * `#BACKBMP` and `#BANNER` bitmaps for the skin's synthetic image ids (-100 / -101 / -102), decoded through the view and
 * kept per chart until the part is disposed, and the data of its BPM graph and notes graph, worked out once per chart.
 *
 * The part reads the view's state through {@link BeatorajaSelectChartImagesContext}; the select view passes it.
 */

import type { Texture } from 'pixi.js';
import {
  computeBeatorajaChartNoteDistribution,
  type BeatorajaChartNoteDistribution,
} from '../../../chart/beatoraja/note-distribution.ts';
import type { LibraryChart, LibraryEntry } from '@be-music/scene-model';
import { logger } from '../../../logger.ts';
import { destroyTextureAndRevokeBlobURL } from '../../../media/textures.ts';
import type { BeatorajaChartImages } from '../../../skin/beatoraja/chart-images.ts';

const log = logger('beatoraja-select');

/** What the chart images read on the select view: its fields of these names. */
export interface BeatorajaSelectChartImagesContext {
  /** Decodes a chart's own images; without it the synthetic image ids stay hidden. */
  readonly decodeChartImages: ((chartEntry: LibraryChart) => Promise<BeatorajaChartImages>) | undefined;
  readonly disposed: boolean;
  readonly entries: ReadonlyArray<LibraryEntry>;
  /** The cursor: `entries[currentIndex]` is the focused bar. */
  readonly currentIndex: number;
}

/** The focused chart's images and graphs. See the module comment. */
export class BeatorajaSelectChartImages {
  private readonly ctx: BeatorajaSelectChartImagesContext;

  /**
   * Per-song chart-image cache. Keyed by `LibraryChart.id`; populated lazily by
   * {@link refreshChartImagesForFocus} as the user moves the cursor. Re-focusing a
   * previously-loaded song hits the cache and skips the IO. Sentinel `null` records a
   * decode in flight, or one that failed, so we don't retry every cursor move.
   */
  private readonly chartImageCache = new Map<string, BeatorajaChartImages | null>();
  private disposed = false;

  constructor(ctx: BeatorajaSelectChartImagesContext) {
    this.ctx = ctx;
  }

  /**
   * Lazily decode the focused song's `#STAGEFILE` / `#BACKBMP` / `#BANNER` bitmaps via the context's
   * `decodeChartImages`. Caches by `song.id` so re-focusing a previously-loaded song hits the cache. Images that land
   * after the cursor moved on are kept for when it comes back; those that land after the part is disposed are
   * destroyed.
   */
  refreshChartImagesForFocus(chartEntry: LibraryChart | undefined): void {
    if (chartEntry === undefined) return;
    const decoder = this.ctx.decodeChartImages;
    if (decoder === undefined) return;
    if (this.chartImageCache.has(chartEntry.id)) return;
    // Mark as in-flight so concurrent focus changes don't fire duplicate decodes.
    this.chartImageCache.set(chartEntry.id, null);
    void decoder(chartEntry)
      .then((images) => {
        if (this.ctx.disposed || this.disposed) {
          destroyChartImages(images);
          return;
        }
        // The next frame picks up the new texture via `chartImageProvider`, which reads the cache every frame.
        this.chartImageCache.set(chartEntry.id, images);
      })
      .catch((error: unknown) => {
        // Decode failed; leave the cache entry as `null` so we don't retry on every cursor settle. User-visible: the
        // banner / stagefile / backbmp slot stays hidden.
        log.warn('chart-image decode failed', { chartId: chartEntry.id, error });
        this.chartImageCache.set(chartEntry.id, null);
      });
  }

  /** Destroys the decoded images; nothing decodes after. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const images of this.chartImageCache.values()) {
      if (images !== null) destroyChartImages(images);
    }
    this.chartImageCache.clear();
  }

  /**
   * Per-frame resolver for the synthetic chart-bitmap ids. Returns the FOCUSED song's
   * matching texture from the cache, or `undefined` (= destination hides) when the chart
   * didn't ship that bitmap or the decode is still in flight / failed.
   */
  resolveChartImageForFocus(syntheticId: number): Texture | undefined {
    const entry = this.ctx.entries[this.ctx.currentIndex];
    if (entry?.kind !== 'chart') return undefined;
    const cached = this.chartImageCache.get(entry.chart.id);
    if (cached === null || cached === undefined) return undefined;
    if (syntheticId === -100) return cached.stageFile;
    if (syntheticId === -101) return cached.backBMP;
    if (syntheticId === -102) return cached.banner;
    return undefined;
  }

  /**
   * Lazy analysis cache for the focused chart. `computeBeatorajaChartNoteDistribution`
   * walks the chart's events once and produces both the per-bucket histogram AND the BPM
   * segment list — sharing the walk between the bpmgraph and notes-graph renderers. Cached
   * per song-id so cursor moves through a folder don't redundantly re-analyse.
   */
  private analysisFor(chartEntry: LibraryChart): BeatorajaChartNoteDistribution {
    const cached = this.chartAnalysisCache.get(chartEntry.id);
    if (cached !== undefined) return cached;
    const result = computeBeatorajaChartNoteDistribution(chartEntry.chart);
    this.chartAnalysisCache.set(chartEntry.id, result);
    return result;
  }
  private readonly chartAnalysisCache = new Map<string, BeatorajaChartNoteDistribution>();

  /**
   * Per-frame resolver for the focused chart's BPM segment data (consumed by `bpmgraph`
   * destinations under the spec-faithful renderer path).
   */
  resolveBPMGraphDataForFocus():
    | {
        segments: ReadonlyArray<{ timeMs: number; bpm: number }>;
        mainBPM: number;
        minBPM: number;
        maxBPM: number;
        totalMs: number;
      }
    | undefined {
    const entry = this.ctx.entries[this.ctx.currentIndex];
    if (entry?.kind !== 'chart') return undefined;
    const analysis = this.analysisFor(entry.chart);
    if (analysis.bpmSegments.length === 0 || analysis.totalMs <= 0) return undefined;
    return {
      segments: analysis.bpmSegments,
      mainBPM: analysis.mainBPM,
      minBPM: analysis.minBPM,
      maxBPM: analysis.maxBPM,
      totalMs: analysis.totalMs,
    };
  }

  /**
   * Per-frame resolver for the focused chart's note-distribution histogram (judgegraph
   * type=0 under the spec-faithful renderer path). Returns the per-second × per-category
   * bucket data the renderer needs for the upstream `SkinNoteDistributionGraph` look.
   */
  resolveNoteDistributionForFocus():
    | { buckets: ReadonlyArray<ReadonlyArray<number>>; maxCount: number; totalMs: number }
    | undefined {
    const entry = this.ctx.entries[this.ctx.currentIndex];
    if (entry?.kind !== 'chart') return undefined;
    const analysis = this.analysisFor(entry.chart);
    if (analysis.buckets.length === 0) return undefined;
    return { buckets: analysis.buckets, maxCount: analysis.maxCount, totalMs: analysis.totalMs };
  }
}

function destroyChartImages(images: BeatorajaChartImages): void {
  for (const texture of [images.stageFile, images.backBMP, images.banner]) {
    if (texture !== undefined) destroyTextureAndRevokeBlobURL(texture, true);
  }
}
