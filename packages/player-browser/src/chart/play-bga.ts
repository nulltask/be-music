import { collectBmsonBGAFrameKeys } from './bmson-bga.ts';
// BGA resource loading for the play session (`session/play/play-media.ts`), which every gameplay family plays
// through. One place decides which `#BMPxx` / bmson BGA resources a play needs, decodes
// them (stills through the shared texture loader, videos through the video loader with its transcode fallback), keys the
// BMS layer track's black out and cuts the `#BGAxx` sub-region views.

import { Rectangle, Texture } from 'pixi.js';
import { runWithConcurrency } from '@be-music/shared-utils/core';
import {
  parseBMSExBMP,
  buildKeyBoundBGATimeline,
  createTimingResolver,
  resolveBMSExBMPColorKey,
  resolvePoorBGAMode,
  type BmsARGB,
  type KeyBoundBGACue,
  type BmsonBGAEventCue,
} from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import { loadAssetBytes, loadAssetFile, resolveChartBGAAsset } from '../collection/collection.ts';
import type { BrowserAssetSource } from '../collection/types.ts';
import { loadTextureFromBytes, loadVideoTexture, type VideoTranscodeOptions } from '../media/textures.ts';
import { collectBGATextureLoadKeys, isVideoExtension, type BGACue } from './bga-timeline.ts';
import { logger } from '../logger.ts';
import { collectBGASubRegions } from './bga-subregions.ts';

import { createColorKeyVideoTexture } from '../media/color-key-video.ts';
import { keyBoundBGAResourceKey } from './key-bound-bga.ts';

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
  dispose?: () => void;
}

/** Where {@link loadPlayBGA} puts what it decoded, keyed by the timeline's BMP key. */
export interface PlayBGAResources {
  /** Base + POOR track textures (black kept). */
  textures: Map<string, Texture>;
  /** Layer track textures: black keyed out for a BMS chart, kept for bmson (its spec says so). */
  layerTextures: Map<string, Texture>;
  videos: Map<string, PlayBGAVideo>;
  /** Each visible sub-region's position on the 256×256 canvas after composing and clipping aliases. */
  subRegionOrigins: Map<string, { x: number; y: number }>;
}

export { resolvePoorBGAMode, type PoorBGAMode } from '@be-music/chart-model';

/**
 * BMS: a `#BMP00` is the implicit POOR image until an explicit `#xxx06` cue fires, as LR2 starts its miss layer from
 * BMP00. Only `#POORBGA 2` (no POOR image at all) turns it off. Returns that key (`'00'`), or `undefined` when the
 * convention does not apply.
 */
export function resolvePoorBGAFallbackKey(chart: BeMusicJSON): string | undefined {
  const poorBMP00 = chart.resources.bmp['00'] || parseBMSExBMP(chart.bms.exBMP['00'] ?? '')?.filename;
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
  includeBmsonEvents = true,
  bmsonBGACues?: readonly BmsonBGAEventCue[],
): { paths: Map<string, string>; base: Set<string>; layer: Set<string> } {
  const { base, layer } = collectBGATextureLoadKeys(chart, timeline, poorFallbackKey);
  const sequences = includeBmsonEvents
    ? collectBmsonBGAFrameKeys(chart, bmsonBGACues)
    : { layer: new Set<string>(), poor: new Set<string>() };
  const extras = collectBGATextureLoadKeys(
    chart,
    {
      base: [...sequences.poor].map((bmpKey) => ({ seconds: 0, bmpKey })),
      layer: [...sequences.layer].map((bmpKey) => ({ seconds: 0, bmpKey })),
      poor: [],
    },
    undefined,
  );
  for (const key of extras.base) base.add(key);
  for (const key of extras.layer) layer.add(key);
  const referenced = new Set<string>([...base, ...layer]);
  const paths = new Map<string, string>();
  for (const [key, path] of Object.entries(chart.resources.bmp)) {
    if (typeof path === 'string' && referenced.has(key)) paths.set(key, path);
  }
  for (const [key, raw] of Object.entries(chart.bms.exBMP)) {
    if (!referenced.has(key) || paths.get(key)) continue;
    const definition = parseBMSExBMP(raw);
    if (definition) paths.set(key, definition.filename);
  }
  for (const entry of chart.bmson.bga.header) {
    if (referenced.has(entry.name)) paths.set(entry.name, entry.name);
  }
  return { paths, base, layer };
}

export interface LoadPlayBGAOptions {
  /** Remapped selections from NONSTOP; omitted uses the chart A5 controls. */
  keyBoundBGACues?: readonly KeyBoundBGACue[];
  bmsonBGACues?: readonly BmsonBGAEventCue[];
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
  await loadBGAResourceSet(options);
  if (options.isCancelled?.()) return;
  const definitions = new Map(
    (options.keyBoundBGACues ?? buildKeyBoundBGATimeline(options.chart, createTimingResolver(options.chart))).map(
      (cue) => [cue.definitionId, cue.definition],
    ),
  );
  for (const [id, definition] of definitions) {
    const into: PlayBGAResources = {
      textures: new Map(),
      layerTextures: new Map(),
      videos: new Map(),
      subRegionOrigins: new Map(),
    };
    await loadBGAResourceSet(
      {
        ...options,
        poorFallbackKey: undefined,
        into,
        timeline: { base: [], poor: [], layer: definition.frames.map((bmpKey) => ({ seconds: 0, bmpKey })) },
      },
      definition.argb,
    );
    for (const [key, texture] of into.layerTextures)
      options.into.layerTextures.set(keyBoundBGAResourceKey(id, key), texture);
    for (const [key, origin] of into.subRegionOrigins)
      options.into.subRegionOrigins.set(keyBoundBGAResourceKey(id, key), origin);
    for (const [key, video] of into.videos) options.into.videos.set(keyBoundBGAResourceKey(id, key), video);
    if (options.isCancelled?.()) return;
  }
}

async function loadBGAResourceSet(options: LoadPlayBGAOptions, swBGAColorKey?: BmsARGB): Promise<void> {
  const { chart, source, chartPath, into } = options;
  const isCancelled = options.isCancelled ?? (() => false);
  const { paths, base, layer } = collectPlayBGAResources(
    chart,
    options.timeline,
    options.poorFallbackKey,
    swBGAColorKey === undefined,
    options.bmsonBGACues,
  );
  // The bmson spec draws layer blacks as black ("Unlike BMS Layer Channel #xxx07"); BMS keys them out.
  const keyOutLayerBlack = chart.sourceFormat !== 'bmson' && swBGAColorKey === undefined;
  const aliasSources = new Set([...collectBGASubRegions(chart).values()].map((region) => region.sourceBMP));
  const trackKeys = (cues: readonly BGACue[]) =>
    collectBGATextureLoadKeys(chart, { base: cues, layer: [], poor: [] }, undefined).base;
  const sequenceKeys =
    swBGAColorKey === undefined
      ? collectBmsonBGAFrameKeys(chart, options.bmsonBGACues)
      : { layer: new Set<string>(), poor: new Set<string>() };
  const firstLayer = trackKeys([
    ...options.timeline.layer,
    ...[...sequenceKeys.layer].map((bmpKey) => ({ seconds: 0, bmpKey })),
  ]);
  const secondLayer = trackKeys(options.timeline.layer2 ?? []);
  const baseOnly = trackKeys(options.timeline.base);
  const poor = trackKeys([
    ...options.timeline.poor,
    ...[...sequenceKeys.poor].map((bmpKey) => ({ seconds: 0, bmpKey })),
    ...(options.poorFallbackKey ? [{ seconds: 0, bmpKey: options.poorFallbackKey }] : []),
  ]);
  await runWithConcurrency([...paths], BGA_DECODE_CONCURRENCY, async ([key, path]) => {
    if (isCancelled()) return;
    const resolved = resolveChartBGAAsset(source, chartPath, path);
    try {
      if (isVideoExtension(resolved?.path ?? path)) {
        // A video plays (and transcodes) from its file, which is not read into memory.
        const file = await loadAssetFile(resolved?.entry);
        if (!file || isCancelled()) return;
        // Reused video BMPs need an independent playhead on each track.
        // NUL-prefixed keys are internal and cannot collide with an external asset path.
        const videoKeys = [key];
        if (base.has(key) && firstLayer.has(key)) videoKeys.push(String.fromCharCode(0) + 'layer:' + key);
        if ((base.has(key) || firstLayer.has(key)) && secondLayer.has(key))
          videoKeys.push(String.fromCharCode(0) + 'layer2:' + key);
        if (poor.has(key) && baseOnly.has(key)) videoKeys.push(String.fromCharCode(0) + 'poor:' + key);
        for (const videoKey of videoKeys) {
          const handle = await loadVideoTexture(
            resolved?.path ?? path,
            file,
            aliasSources.has(key) ? { ...options.transcode, maxLongEdgePx: 0 } : options.transcode,
          );
          if (!handle) continue;
          if (isCancelled()) {
            releaseVideo({ video: handle.video, objectURL: handle.objectURL });
            destroyTexture(handle.texture);
            return;
          }
          let texture = handle.texture;
          let dispose: (() => void) | undefined;
          const bmsColorKey = resolveBMSExBMPColorKey(chart, key);
          if (swBGAColorKey || bmsColorKey) {
            try {
              const keyed = createColorKeyVideoTexture(handle.video, { swBGAColorKey, bmsColorKey });
              texture = keyed.texture;
              dispose = keyed.dispose;
              (base.has(key) ? into.textures : into.layerTextures).set(
                `${String.fromCharCode(0)}native:${videoKey}`,
                handle.texture,
              );
            } catch (error) {
              releaseVideo(handle);
              destroyTexture(handle.texture);
              throw error;
            }
          }
          texture.label = `bga[${key}]:video`;
          handle.video.pause();
          handle.video.defaultPlaybackRate = options.tempo;
          handle.video.playbackRate = options.tempo;
          into.videos.set(videoKey, {
            video: handle.video,
            objectURL: handle.objectURL,
            ...(dispose ? { dispose } : {}),
          });
          if ((videoKey === key || videoKey.startsWith(String.fromCharCode(0) + 'poor:')) && base.has(key))
            into.textures.set(videoKey, texture);
          if (layer.has(key)) into.layerTextures.set(videoKey, texture);
        }
        return;
      }
      const bytes = await loadAssetBytes(resolved?.entry);
      if (!bytes || isCancelled()) return;
      const bmsColorKey = resolveBMSExBMPColorKey(chart, key);
      if (base.has(key)) {
        const texture = bmsColorKey
          ? await loadTextureFromBytes(path, bytes, { bmsColorKey })
          : await loadTextureFromBytes(path, bytes);
        if (isCancelled()) return destroyTexture(texture);
        if (texture) into.textures.set(key, texture);
      }
      if (layer.has(key)) {
        const texture = await loadTextureFromBytes(path, bytes, {
          keyOutBlack: keyOutLayerBlack && bmsColorKey === undefined,
          ...(bmsColorKey ? { bmsColorKey } : {}),
          ...(swBGAColorKey ? { swBGAColorKey } : {}),
        });
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
 * Cuts texture views for `#BGAxx YY sx sy ex ey dx dy` sub-regions, composing chained aliases from their loaded root
 * image on each track. Records the visible rectangle's placement after clipping; missing/cyclic aliases stay absent.
 * The views share their source's `TextureSource`: no extra upload.
 */
export function registerSubRegionBGATextures(chart: BeMusicJSON, into: PlayBGAResources): void {
  const regions = collectBGASubRegions(chart);
  for (const textures of [into.textures, into.layerTextures]) {
    const visited = new Set<string>();
    for (const root of regions.keys()) {
      const path: string[] = [];
      let current = root;
      while (!visited.has(current) && !textures.has(current) && regions.has(current)) {
        visited.add(current);
        path.push(current);
        current = regions.get(current)!.sourceBMP;
      }
      // Dependencies are registered before their consumers, independent of declaration order. Cycles have no
      // loaded source, so none of their texture views are created.
      for (const slot of path.reverse()) {
        const region = regions.get(slot)!;
        const parent = textures.get(region.sourceBMP);
        if (!parent) continue;
        const origin = into.subRegionOrigins.get(region.sourceBMP) ?? { x: 0, y: 0 };
        // A parent's texture contains only its visible rectangle, located at origin on a 256×256 alias canvas.
        // Root images retain their native coordinates; each alias clips both the source and destination edges.
        const left = Math.max(0, region.dx, region.dx + origin.x - region.sx);
        const top = Math.max(0, region.dy, region.dy + origin.y - region.sy);
        const right = Math.min(
          256,
          region.dx + region.ex - region.sx,
          region.dx + origin.x + parent.frame.width - region.sx,
        );
        const bottom = Math.min(
          256,
          region.dy + region.ey - region.sy,
          region.dy + origin.y + parent.frame.height - region.sy,
        );
        if (right <= left || bottom <= top) {
          // Keep a real canvas resource so Canvas skins can display a blank base/POOR too, and avoid sharing
          // Texture.EMPTY's global source with the session's owned textures.
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 256;
          // WebGPU requires a canvas with a rendering context, including the transparent layer canvas.
          const context = canvas.getContext('2d')!;
          if (textures === into.textures) {
            context.fillStyle = '#000000';
            context.fillRect(0, 0, 256, 256);
          }
          textures.set(slot, Texture.from(canvas));
          into.subRegionOrigins.set(slot, { x: 0, y: 0 });
          continue;
        }
        const frame = new Rectangle(
          parent.frame.x + region.sx + left - region.dx - origin.x,
          parent.frame.y + region.sy + top - region.dy - origin.y,
          right - left,
          bottom - top,
        );
        textures.set(slot, new Texture({ source: parent.source, frame }));
        into.subRegionOrigins.set(slot, { x: left, y: top });
        const video = into.videos.get(region.sourceBMP);
        if (video) into.videos.set(slot, video);
        // Each plane keeps its own root video/playhead, while aliases share that plane's root. A transition
        // between aliases still uses a different cue key and restarts the root at the new cue's offset.
        for (const track of textures === into.textures ? ['poor'] : ['layer', 'layer2']) {
          const parentKey = String.fromCharCode(0) + track + ':' + region.sourceBMP;
          const parentVideo = into.videos.get(parentKey);
          const parentTexture = textures.get(parentKey);
          if (!parentVideo || !parentTexture) continue;
          const key = String.fromCharCode(0) + track + ':' + slot;
          textures.set(key, new Texture({ source: parentTexture.source, frame: frame.clone() }));
          into.subRegionOrigins.set(key, { x: left, y: top });
          into.videos.set(key, parentVideo);
        }
      }
    }
  }
}

/** Stops a video BGA and frees its object URL. Pause before destroying its texture: in-flight frame callbacks throw. */
export function releaseVideo({ video, objectURL, dispose }: PlayBGAVideo): void {
  dispose?.();
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
