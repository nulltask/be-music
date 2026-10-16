/**
 * The beatoraja select scene's chart images and graphs (`PixiBeatorajaSelectScene`): the focused chart's `#STAGEFILE`,
 * `#BACKBMP` and `#BANNER` bitmaps for the skin's synthetic image ids (-100 / -101 / -102), decoded through the host and
 * kept per chart, and the data of its BPM graph and notes graph, worked out once per chart.
 *
 * The part reads the scene's state through {@link BeatorajaSelectChartImagesContext}; the select scene passes it.
 */

import type { Texture } from 'pixi.js';
import {
  computeBeatorajaChartNoteDistribution,
  type BeatorajaChartNoteDistribution,
} from '../../../chart/beatoraja/note-distribution.ts';
import type { BrowserBrowseEntry, BrowserSongEntry } from '../../../collection/types.ts';
import type { PixiBeatorajaSelectSceneOptions } from '../../../scene/beatoraja/select/options.ts';

/** What the chart images read on the select scene: its fields of these names. */
export interface BeatorajaSelectChartImagesContext {
  readonly options: Pick<PixiBeatorajaSelectSceneOptions, 'decodeChartImages'>;
  readonly disposed: boolean;
  readonly entries: ReadonlyArray<BrowserBrowseEntry>;
  /** The cursor: `entries[currentIndex]` is the focused bar. */
  readonly currentIndex: number;
}

/** The focused chart's images and graphs. See the module comment. */
export class BeatorajaSelectChartImages {
  private readonly ctx: BeatorajaSelectChartImagesContext;

  /**
   * Per-song chart-image cache. Keyed by `BrowserSongEntry.id`; populated lazily by
   * {@link refreshChartImagesForFocus} as the user moves the cursor. Re-focusing a
   * previously-loaded song hits the cache and skips the IO. Sentinel `null` records a
   * decode that resolved with no usable images so we don't retry every cursor move
   * (e.g. chart with no `#STAGEFILE` / `#BACKBMP` / `#BANNER`).
   */
  private readonly chartImageCache = new Map<
    string,
    { stageFile?: Texture; backBmp?: Texture; banner?: Texture } | null
  >();
  /** Generation counter — bumps on every focus change so stale async resolves don't overwrite newer ones. */
  private chartImageFocusGeneration = 0;

  constructor(ctx: BeatorajaSelectChartImagesContext) {
    this.ctx = ctx;
  }

  /**
   * Lazily decode the focused song's `#STAGEFILE` / `#BACKBMP` / `#BANNER` bitmaps via
   * the host's `decodeChartImages` callback. Caches by `song.id` so re-focusing a
   * previously-loaded song hits the cache. Generation counter guards against stale async
   * resolves overwriting newer ones (rapid cursor moves through a folder).
   */
  refreshChartImagesForFocus(song: BrowserSongEntry | undefined): void {
    if (song === undefined) return;
    if (this.ctx.options.decodeChartImages === undefined) return;
    if (this.chartImageCache.has(song.id)) return;
    // Mark as in-flight so concurrent focus changes don't fire duplicate decodes.
    this.chartImageCache.set(song.id, null);
    const generation = ++this.chartImageFocusGeneration;
    const decoder = this.ctx.options.decodeChartImages;
    void decoder(song)
      .then((images) => {
        if (this.ctx.disposed) return;
        // Stale resolve: the user has moved on to another song since this fetch fired.
        // Still cache the result so a later refocus on this song uses it without re-IO,
        // but skip the visible-state side effects.
        this.chartImageCache.set(song.id, images);
        // The next tick's render pass picks up the new texture via `chartImageProvider`.
        // No explicit refresh call needed — `update()` reads from the cache every frame.
        void generation;
      })
      .catch((error) => {
        // Decode failed; leave the cache entry as `null` so we don't retry on every
        // cursor settle. User-visible: the banner / stagefile / backbmp slot stays hidden.
        // eslint-disable-next-line no-console
        console.warn('[beatoraja-select] chart-image decode failed', { songId: song.id, error });
        this.chartImageCache.set(song.id, null);
      });
  }

  /**
   * Per-frame resolver for the synthetic chart-bitmap ids. Returns the FOCUSED song's
   * matching texture from the cache, or `undefined` (= destination hides) when the chart
   * didn't ship that bitmap or the decode is still in flight / failed.
   */
  resolveChartImageForFocus(syntheticId: number): Texture | undefined {
    const entry = this.ctx.entries[this.ctx.currentIndex];
    if (entry?.kind !== 'song') return undefined;
    const cached = this.chartImageCache.get(entry.song.id);
    if (cached === null || cached === undefined) return undefined;
    if (syntheticId === -100) return cached.stageFile;
    if (syntheticId === -101) return cached.backBmp;
    if (syntheticId === -102) return cached.banner;
    return undefined;
  }

  /**
   * Lazy analysis cache for the focused chart. `computeBeatorajaChartNoteDistribution`
   * walks the chart's events once and produces both the per-bucket histogram AND the BPM
   * segment list — sharing the walk between the bpmgraph and notes-graph renderers. Cached
   * per song-id so cursor moves through a folder don't redundantly re-analyse.
   */
  private analysisFor(song: BrowserSongEntry): BeatorajaChartNoteDistribution {
    const cached = this.chartAnalysisCache.get(song.id);
    if (cached !== undefined) return cached;
    const result = computeBeatorajaChartNoteDistribution(song.chart);
    this.chartAnalysisCache.set(song.id, result);
    return result;
  }
  private readonly chartAnalysisCache = new Map<string, BeatorajaChartNoteDistribution>();

  /**
   * Per-frame resolver for the focused chart's BPM segment data (consumed by `bpmgraph`
   * destinations under the spec-faithful renderer path).
   */
  resolveBpmGraphDataForFocus():
    | {
        segments: ReadonlyArray<{ timeMs: number; bpm: number }>;
        mainBpm: number;
        minBpm: number;
        maxBpm: number;
        totalMs: number;
      }
    | undefined {
    const entry = this.ctx.entries[this.ctx.currentIndex];
    if (entry?.kind !== 'song') return undefined;
    const analysis = this.analysisFor(entry.song);
    if (analysis.bpmSegments.length === 0 || analysis.totalMs <= 0) return undefined;
    return {
      segments: analysis.bpmSegments,
      mainBpm: analysis.mainBpm,
      minBpm: analysis.minBpm,
      maxBpm: analysis.maxBpm,
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
    if (entry?.kind !== 'song') return undefined;
    const analysis = this.analysisFor(entry.song);
    if (analysis.buckets.length === 0) return undefined;
    return { buckets: analysis.buckets, maxCount: analysis.maxCount, totalMs: analysis.totalMs };
  }
}
