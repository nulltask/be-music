// BGA resource loading for the play session (`session/play/play-media.ts`), which every gameplay family plays
// through. One place decides which `#BMPxx` / bmson BGA resources a play needs, decodes
// them (stills through the shared texture loader, videos through the video loader with its transcode fallback), keys the
// BMS layer track's black out and cuts the `#BGAxx` sub-region views.

import { Rectangle, Texture } from 'pixi.js';
import { runWithConcurrency } from '@be-music/shared-utils/core';
import { parseBmsBGA, resolvePoorBGAMode } from '@be-music/chart-model';
import { normalizeObjectKey, resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';
import { loadAssetBytes, resolveChartBGAAsset } from '../collection/collection.ts';
import type { BrowserAssetSource } from '../collection/types.ts';
import { loadTextureFromBytes, loadVideoTextureFromBytes, type VideoTranscodeOptions } from '../media/textures.ts';
import { collectBGATextureLoadKeys, isVideoExtension, type BGACue } from './bga-timeline.ts';
import { logger } from '../logger.ts';

const log = logger('play-bga');

/** BGA resources decoded at once: image / video decoders allocate native memory outside the JS heap. */
const BGA_DECODE_CONCURRENCY = 4;

export interface PlayBGATimeline {
  base: readonly BGACue[];
  layer: readonly BGACue[];
  layer2?: readonly BGACue[];
  poor: readonly BGACue[];
}

/** A video BGA: its `<video>` element and the object URL it plays from (revoke it when the play ends). */
export interface PlayBGAVideo {
  video: HTMLVideoElement;
  objectURL: string;
}

/** Where {@link loadPlayBGA} puts what it decoded, keyed by the timeline's BMP key. */
export interface PlayBGAResources {
  /** Base + POOR track textures (black kept). */
  textures: Map<string, Texture>;
  /** Layer track textures: black keyed out for a BMS chart, kept for bmson (its spec says so). */
  layerTextures: Map<string, Texture>;
  videos: Map<string, PlayBGAVideo>;
  /** A `#BGAxx` sub-region slot's `dx dy` placement. */
  subRegionOrigins: Map<string, { x: number; y: number }>;
}

export { resolvePoorBGAMode, type PoorBGAMode } from '@be-music/chart-model';

/**
 * BMS: a `#BMP00` is the implicit POOR image until an explicit `#xxx06` cue fires, as LR2 starts its miss layer from
 * BMP00. Only `#POORBGA 2` (no POOR image at all) turns it off. Returns that key (`'00'`), or `undefined` when the
 * convention does not apply.
 */
export function resolvePoorBGAFallbackKey(chart: BeMusicJSON): string | undefined {
  const poorBMP00 = chart.resources.bmp['00'];
  return resolvePoorBGAMode(chart.bms.poorBGA) !== 2 && typeof poorBMP00 === 'string' && poorBMP00.length > 0
    ? '00'
    : undefined;
}

/**
 * The BGA resources a play loads: every BMP key its timeline (and the implicit POOR image) references, with the source
 * BMPs of referenced `#BGAxx` sub-regions, mapped to the file to load — `#BMPxx` paths for BMS, the `bga.header[]`
 * names for bmson. `base` / `layer` tell which track(s) each key is drawn on.
 */
export function collectPlayBGAResources(
  chart: BeMusicJSON,
  timeline: PlayBGATimeline,
  poorFallbackKey: string | undefined,
): { paths: Map<string, string>; base: Set<string>; layer: Set<string> } {
  const { base, layer } = collectBGATextureLoadKeys(chart, timeline, poorFallbackKey);
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

export interface LoadPlayBGAOptions {
  /** The resolved chart (after `#RANDOM` / `#IF`). */
  chart: BeMusicJSON;
  source: BrowserAssetSource;
  chartPath: string;
  timeline: PlayBGATimeline;
  poorFallbackKey?: string;
  /** Where the decoded resources land (filled in place). */
  into: PlayBGAResources;
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
export async function loadPlayBGA(options: LoadPlayBGAOptions): Promise<void> {
  const { chart, source, chartPath, into } = options;
  const isCancelled = options.isCancelled ?? (() => false);
  const { paths, base, layer } = collectPlayBGAResources(chart, options.timeline, options.poorFallbackKey);
  // The bmson spec draws layer blacks as black ("Unlike BMS Layer Channel #xxx07"); BMS keys them out.
  const keyOutLayerBlack = chart.sourceFormat !== 'bmson';
  const firstLayer = new Set(options.timeline.layer.map((cue) => cue.bmpKey));
  const secondLayer = new Set(options.timeline.layer2?.map((cue) => cue.bmpKey));
  await runWithConcurrency([...paths], BGA_DECODE_CONCURRENCY, async ([key, path]) => {
    if (isCancelled()) return;
    const resolved = resolveChartBGAAsset(source, chartPath, path);
    const bytes = await loadAssetBytes(resolved?.entry);
    if (!bytes || isCancelled()) return;
    try {
      if (isVideoExtension(resolved?.path ?? path)) {
        // Reused video BMPs need an independent playhead on each track.
        // NUL-prefixed keys are internal and cannot collide with an external asset path.
        const videoKeys = [key];
        if (base.has(key) && firstLayer.has(key)) videoKeys.push(String.fromCharCode(0) + 'layer:' + key);
        if ((base.has(key) || firstLayer.has(key)) && secondLayer.has(key))
          videoKeys.push(String.fromCharCode(0) + 'layer2:' + key);
        for (const videoKey of videoKeys) {
          const handle = await loadVideoTextureFromBytes(resolved?.path ?? path, bytes, options.transcode);
          if (!handle) continue;
          if (isCancelled()) {
            releaseVideo({ video: handle.video, objectURL: handle.objectURL });
            destroyTexture(handle.texture);
            return;
          }
          handle.texture.label = `bga[${key}]:video`;
          handle.video.pause();
          handle.video.defaultPlaybackRate = options.tempo;
          handle.video.playbackRate = options.tempo;
          into.videos.set(videoKey, { video: handle.video, objectURL: handle.objectURL });
          if (videoKey === key && base.has(key)) into.textures.set(key, handle.texture);
          if (layer.has(key)) into.layerTextures.set(videoKey, handle.texture);
        }
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
  if (!isCancelled()) registerSubRegionBGATextures(chart, into);
}

/**
 * Cuts a texture view for every `#BGAxx YY sx sy ex ey dx dy` sub-region from its loaded source `#BMPYY` (on each track
 * the source loaded for), and records the slot's `dx dy` placement. A slot whose source did not load stays empty.
 * The views share their source's `TextureSource`: no extra upload.
 */
export function registerSubRegionBGATextures(chart: BeMusicJSON, into: PlayBGAResources): void {
  const base = resolveBMSBase(chart);
  for (const [bgaSlot, raw] of Object.entries(chart.bms.bga)) {
    const slot = normalizeObjectKey(bgaSlot, base);
    const parsed = parseBmsBGA(raw, base);
    if (!parsed) continue;
    const width = parsed.ex - parsed.sx;
    const height = parsed.ey - parsed.sy;
    if (width <= 0 || height <= 0) continue;
    const sourceBase = into.textures.get(parsed.sourceBMP);
    const sourceLayer = into.layerTextures.get(parsed.sourceBMP);
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
export function releaseVideo({ video, objectURL }: PlayBGAVideo): void {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch {
    // `load()` can throw on a detached video.
  }
  URL.revokeObjectURL(objectURL);
}

function destroyTexture(texture: Texture | undefined): void {
  try {
    texture?.destroy(true);
  } catch {
    // Already destroyed.
  }
}
