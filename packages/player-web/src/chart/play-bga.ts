// BGA resource loading for the play session (`session/play/play-media.ts`), which every gameplay family plays
// through. One place decides which `#BMPxx` / bmson BGA resources a play needs, decodes
// them (stills through the shared texture loader, videos through the video loader with its transcode fallback), keys the
// BMS layer track's black out and cuts the `#BGAxx` sub-region views.

import { Rectangle, Texture } from 'pixi.js';
import { runWithConcurrency } from '@be-music/utils/core';
import { parseBmsBga } from '@be-music/chart';
import { normalizeObjectKey, resolveBmsBase, type BeMusicJson } from '@be-music/json';
import { loadAssetBytes, resolveChartBgaAsset } from '../collection/collection.ts';
import type { BrowserSongAssetSource } from '../collection/types.ts';
import { loadTextureFromBytes, loadVideoTextureFromBytes, type VideoTranscodeOptions } from '../media/textures.ts';
import { collectBgaTextureLoadKeys, isVideoExtension, type BgaCue } from '../scene/core/gameplay-bga.ts';
import { logger } from '../logger.ts';

const log = logger('play-bga');

/** BGA resources decoded at once: image / video decoders allocate native memory outside the JS heap. */
const BGA_DECODE_CONCURRENCY = 4;

export interface PlayBgaTimeline {
  base: readonly BgaCue[];
  layer: readonly BgaCue[];
  poor: readonly BgaCue[];
}

/** A video BGA: its `<video>` element and the object URL it plays from (revoke it when the play ends). */
export interface PlayBgaVideo {
  video: HTMLVideoElement;
  objectUrl: string;
}

/** Where {@link loadPlayBga} puts what it decoded, keyed by the timeline's BMP key. */
export interface PlayBgaResources {
  /** Base + POOR track textures (black kept). */
  textures: Map<string, Texture>;
  /** Layer track textures: black keyed out for a BMS chart, kept for bmson (its spec says so). */
  layerTextures: Map<string, Texture>;
  videos: Map<string, PlayBgaVideo>;
  /** A `#BGAxx` sub-region slot's `dx dy` placement. */
  subRegionOrigins: Map<string, { x: number; y: number }>;
}

/**
 * BMS: with no `#POORBGA` but a `#BMP00`, BMP00 is the implicit POOR image until an explicit `#xxx06` cue fires.
 * Returns that key (`'00'`), or `undefined` when the convention does not apply.
 */
export function resolvePoorBgaFallbackKey(chart: BeMusicJson): string | undefined {
  const poorBmp00 = chart.resources.bmp['00'];
  return typeof chart.bms.poorBga !== 'string' && typeof poorBmp00 === 'string' && poorBmp00.length > 0
    ? '00'
    : undefined;
}

/**
 * The BGA resources a play loads: every BMP key its timeline (and the implicit POOR image) references, with the source
 * BMPs of referenced `#BGAxx` sub-regions, mapped to the file to load — `#BMPxx` paths for BMS, the `bga.header[]`
 * names for bmson. `base` / `layer` tell which track(s) each key is drawn on.
 */
export function collectPlayBgaResources(
  chart: BeMusicJson,
  timeline: PlayBgaTimeline,
  poorFallbackKey: string | undefined,
): { paths: Map<string, string>; base: Set<string>; layer: Set<string> } {
  const { base, layer } = collectBgaTextureLoadKeys(chart, timeline, poorFallbackKey);
  const referenced = new Set<string>([...base, ...layer]);
  const paths = new Map<string, string>();
  for (const [key, path] of Object.entries(chart.resources.bmp)) {
    if (typeof path === 'string' && referenced.has(key)) paths.set(key, path);
  }
  for (const entry of chart.bmson.bga.header) {
    if (referenced.has(entry.name)) paths.set(entry.name, entry.name);
  }
  return { paths, base, layer };
}

export interface LoadPlayBgaOptions {
  /** The resolved chart (after `#RANDOM` / `#IF`). */
  chart: BeMusicJson;
  source: BrowserSongAssetSource;
  chartPath: string;
  timeline: PlayBgaTimeline;
  poorFallbackKey?: string;
  /** Where the decoded resources land (filled in place). */
  into: PlayBgaResources;
  /** How a video the browser can't play is transcoded. */
  transcode?: VideoTranscodeOptions;
  /** The play tempo: videos run at it, so their time stays the chart time since their cue. */
  tempo: number;
  /** True once the play was abandoned: what is still loading is dropped and freed. */
  isCancelled?: () => boolean;
}

/**
 * Loads every BGA resource the play's timeline references into `options.into`. Each resource is read on demand (lazy
 * `File` entries), found through the image / video resolver (`foo.bmp` shipped as `foo.png`, `_bga.mpg` re-encoded to
 * `_bga.mp4`), and decoded with bounded parallelism. Videos start paused, muted and at the play tempo; a file that
 * fails to decode is skipped so the rest of the chart still renders.
 */
export async function loadPlayBga(options: LoadPlayBgaOptions): Promise<void> {
  const { chart, source, chartPath, into } = options;
  const isCancelled = options.isCancelled ?? (() => false);
  const { paths, base, layer } = collectPlayBgaResources(chart, options.timeline, options.poorFallbackKey);
  // The bmson spec draws layer blacks as black ("Unlike BMS Layer Channel #xxx07"); BMS keys them out.
  const keyOutLayerBlack = chart.sourceFormat !== 'bmson';
  await runWithConcurrency([...paths], BGA_DECODE_CONCURRENCY, async ([key, path]) => {
    if (isCancelled()) return;
    const resolved = resolveChartBgaAsset(source, chartPath, path);
    const bytes = await loadAssetBytes(resolved?.entry);
    if (!bytes || isCancelled()) return;
    try {
      if (isVideoExtension(path)) {
        // The file found may be a re-encode under another extension: name it as found.
        const handle = await loadVideoTextureFromBytes(resolved?.path ?? path, bytes, options.transcode);
        if (!handle) return;
        if (isCancelled()) {
          releaseVideo({ video: handle.video, objectUrl: handle.objectUrl });
          destroyTexture(handle.texture);
          return;
        }
        handle.texture.label = `bga[${key}]:video`;
        // Paused until its cue fires; one texture serves both tracks (keying a moving video's blacks looks worse).
        handle.video.pause();
        handle.video.defaultPlaybackRate = options.tempo;
        handle.video.playbackRate = options.tempo;
        into.videos.set(key, { video: handle.video, objectUrl: handle.objectUrl });
        if (base.has(key)) into.textures.set(key, handle.texture);
        if (layer.has(key)) into.layerTextures.set(key, handle.texture);
        return;
      }
      if (base.has(key)) {
        const texture = await loadTextureFromBytes(path, bytes);
        if (isCancelled()) return destroyTexture(texture);
        if (texture) into.textures.set(key, texture);
      }
      if (layer.has(key)) {
        const texture = await loadTextureFromBytes(path, bytes, { keyOutBlack: keyOutLayerBlack });
        if (isCancelled()) return destroyTexture(texture);
        if (texture) into.layerTextures.set(key, texture);
      }
    } catch (error) {
      log.debug('bga decode skipped', { key, path, error });
    }
  });
  if (!isCancelled()) registerSubRegionBgaTextures(chart, into);
}

/**
 * Cuts a texture view for every `#BGAxx YY sx sy ex ey dx dy` sub-region from its loaded source `#BMPYY` (on each track
 * the source loaded for), and records the slot's `dx dy` placement. A slot whose source did not load stays empty.
 * The views share their source's `TextureSource`: no extra upload.
 */
export function registerSubRegionBgaTextures(chart: BeMusicJson, into: PlayBgaResources): void {
  const base = resolveBmsBase(chart);
  for (const [bgaSlot, raw] of Object.entries(chart.bms.bga)) {
    const slot = normalizeObjectKey(bgaSlot, base);
    const parsed = parseBmsBga(raw, base);
    if (!parsed) continue;
    const width = parsed.ex - parsed.sx;
    const height = parsed.ey - parsed.sy;
    if (width <= 0 || height <= 0) continue;
    const sourceBase = into.textures.get(parsed.sourceBmp);
    const sourceLayer = into.layerTextures.get(parsed.sourceBmp);
    if (!sourceBase && !sourceLayer) continue;
    const frame = new Rectangle(parsed.sx, parsed.sy, width, height);
    into.subRegionOrigins.set(slot, { x: parsed.dx, y: parsed.dy });
    if (sourceBase && !into.textures.has(slot)) {
      into.textures.set(slot, new Texture({ source: sourceBase.source, frame }));
    }
    if (sourceLayer && !into.layerTextures.has(slot)) {
      into.layerTextures.set(slot, new Texture({ source: sourceLayer.source, frame }));
    }
  }
}

/** Stops a video BGA and frees its object URL. Pause before destroying its texture: in-flight frame callbacks throw. */
export function releaseVideo({ video, objectUrl }: PlayBgaVideo): void {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch {
    // `load()` can throw on a detached video.
  }
  URL.revokeObjectURL(objectUrl);
}

function destroyTexture(texture: Texture | undefined): void {
  try {
    texture?.destroy(true);
  } catch {
    // Already destroyed.
  }
}
