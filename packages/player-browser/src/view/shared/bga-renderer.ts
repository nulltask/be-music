/**
 * The chart's BGA on the built-in and LR2 play screens: composites the base, layer and POOR
 * images (or a stitched NONSTOP chart's per-stage stacks) into the skin's BGA rects, or hands them to a be-music skin
 * that composites the BGA itself, and keeps the BGA videos playing in step with their cues.
 *
 * The functions read and write the scene's state through {@link BGARendererContext}; the play view passes itself.
 */

import { pickSwitchingBGAFrame } from '@be-music/chart-model';
import { DEFAULT_POOR_BGA_DISPLAY_SECONDS } from '@be-music/player-engine/display';
import { Texture } from 'pixi.js';
import {
  buildSkinBGAFrame,
  pickActiveBGACue,
  isMissLayerShown,
  resolveBGAImageRect,
  resolveBGAStacks as resolveBGAStacksOf,
  type BGACue,
  type BGAStack,
} from '../../chart/bga-timeline.ts';
import type { PlaySessionOptions } from '../../session/play/play-options.ts';
import type { ChildPool } from '../../stage/pixi-utils.ts';
import type { BeMusicGameplayBinding } from '../../skin/be-music/binding.ts';
import type { BeMusicImage } from '../../skin/be-music/types.ts';
import type { PlayfieldBGATarget, PlayfieldSkin } from '../types.ts';
import type { PlayfieldRuntime } from './playfield/context.ts';

/** The view's members the BGA passes use: a play view's members of these names. */
export interface BGARendererContext {
  readonly play: PlayfieldRuntime;
  readonly options: Readonly<Pick<PlaySessionOptions, 'bga' | 'autoPlay' | 'nonstop'>>;
  readonly playfieldSkin: PlayfieldSkin;
  readonly bgaLayerPool: ChildPool;
  readonly bgaTargetsScratch: PlayfieldBGATarget[];
  readonly skinBinding: BeMusicGameplayBinding | undefined;
  readonly skinBGACrops: Map<Texture, ImageBitmap | null>;
}

/**
 * Composites the chart's BGA into the skin's BGA rectangles (`PlayfieldSkin.bgaTargets`; the default-family BGA
 * rectangle unless a skin supplies its own). The tracks stack from back to front: base (channel 04 / bmson `bga.events`), layer
 * (channel 07 / bmson `layerEvents`), second overlay (channel 0A), and a POOR override (channel 06 / `poorEvents`) that briefly replaces the
 * base while the player is inside the POOR-judgement window (`DEFAULT_POOR_BGA_DISPLAY_SECONDS`).
 *
 * The renderer is idempotent per frame — it tears down any existing sprites and rebuilds from the active cues, so cue
 * switches show up the next frame without explicit dirty tracking.
 */
/**
 * `cueSeconds` picks which BGA cue is active; `seconds` is the true clock that plays the cue (movie offsets, SWBGA
 * frames). They differ only past an LR2 negative-BPM reversal, where the event pump stops firing new BGA cues but a
 * movie that is already playing keeps running.
 */
export function renderBGA(ctx: BGARendererContext, seconds: number, cueSeconds: number = seconds): void {
  ctx.bgaLayerPool.begin();
  ctx.bgaTargetsScratch.length = 0;
  // Honor the LR2 panel-1 BGA toggle (`#SRC_BUTTON,type=72`). - `'OFF'` → never render - `'AUTOPLAY_ONLY'` → render
  // only when autoplay is on - `'ON'` (default) → render whenever the chart has BGA
  const bgaMode = ctx.options.bga ?? 'ON';
  if (bgaMode === 'OFF') {
    ctx.bgaLayerPool.end();
    return;
  }
  if (bgaMode === 'AUTOPLAY_ONLY' && !ctx.options.autoPlay) {
    ctx.bgaLayerPool.end();
    return;
  }
  if (!ctx.play.hasBGA) {
    ctx.bgaLayerPool.end();
    return;
  }
  // Render into EVERY rectangle the skin reports this frame (a DP LR2 skin can show several at once).
  const visibleBGAs = ctx.bgaTargetsScratch;
  ctx.playfieldSkin.bgaTargets(visibleBGAs);
  if (visibleBGAs.length === 0) {
    ctx.bgaLayerPool.end();
    return;
  }
  // Drive video BGA playback once per frame (not per-rect) — base / layer cues are global to the chart, every rect
  // shows the same source video. Picking the first visible entry's `noBase` / `noLayer` flags as the controlling ones
  // is fine in practice: the LR2 default skin uses identical flags on every rect, and a future skin that mixes them
  // per-rect would still get a consistent global playback state from this single sync point.
  const controllingBGA = visibleBGAs[0]!;
  const inPoorWindow =
    (ctx.options.nonstop !== undefined || ctx.play.poorBGAMode !== 2) &&
    !controllingBGA.noPoor &&
    isMissLayerShown(ctx.play.lastPoorAt / 1000, ctx.play.playClock() / 1000, DEFAULT_POOR_BGA_DISPLAY_SECONDS);
  // A stitched NONSTOP chart shows one BGA stack per stage, crossfading at the seams; any other chart one stack.
  const stacks = resolveBGAStacks(
    ctx,
    cueSeconds,
    controllingBGA.noBase === true,
    controllingBGA.noLayer === true,
    inPoorWindow,
  );
  const leading = stacks.reduce<(typeof stacks)[number] | undefined>(
    (best, stack) => (best === undefined || stack.alpha >= best.alpha ? stack : best),
    undefined,
  );
  let poorKey = ctx.play.nonstopBGATimelines !== undefined ? leading?.poorKey : undefined;
  if (inPoorWindow && ctx.play.nonstopBGATimelines === undefined) {
    poorKey = leading?.poorKey;
  }
  // BMP00 fallback: when no explicit POOR cue is active but the chart has a `#BMP00` (and no `#POORBGA 2`),
  // paint BMP00 during the miss window. Capped at the first authored POOR cue's chart-time so a chart that does
  // eventually author POOR isn't permanently stuck on the placeholder.
  if (
    inPoorWindow &&
    poorKey === undefined &&
    ctx.play.poorBGAFallbackKey !== undefined &&
    cueSeconds < ctx.play.poorBGAFallbackUntilSeconds
  ) {
    poorKey = ctx.play.poorBGAFallbackKey;
  }
  if (ctx.play.nonstopBGATimelines === undefined && stacks[0] !== undefined) stacks[0].poorKey = poorKey;
  if (ctx.play.audioContextStartTime !== 0) {
    const requests = new Map<string, { track: 'base' | 'layer' | 'layer2' | 'poor'; cue: BGACue }>();
    const add = (track: 'base' | 'layer' | 'layer2' | 'poor', cue: BGACue | undefined) => {
      if (cue?.bmpKey === undefined) return;
      // Stitched stages own disjoint BMP namespaces. The cue key keeps a stage's slot stable while its
      // crossfade weight passes the leading stage or earlier stacks disappear from the visible list.
      const slot = ctx.play.nonstopBGATimelines === undefined ? track : `${track}:${cue.bmpKey}`;
      requests.set(slot, { track, cue });
    };
    for (const stack of stacks) {
      add('base', stack.baseCue);
      add('layer', stack.layerCue);
      add('layer2', stack.layer2Cue);
      if (stack.poorKey !== undefined) {
        const timelines = ctx.play.nonstopBGATimelines ?? [ctx.play.bgaTimeline];
        const poorCue = timelines
          .map((timeline) => pickActiveBGACue(timeline.poor, cueSeconds))
          .find((cue) => cue?.bmpKey === stack.poorKey);
        add('poor', {
          bmpKey: stack.poorKey,
          seconds: poorCue?.seconds ?? seconds - Math.max(0, (ctx.play.playClock() - ctx.play.lastPoorAt) / 1000),
        });
      }
    }
    // Retire departed cues before starting their replacements, including aliases that share a video handle.
    for (const [slot, previous] of Object.entries(ctx.play.bgaActiveVideos)) {
      if (requests.has(slot)) continue;
      if (previous) {
        const video = ctx.play.bgaVideos.get(previous.key)?.video;
        if (video && !video.paused) video.pause();
      }
      delete ctx.play.bgaActiveVideos[slot];
    }
    for (const [slot, { track, cue }] of requests) syncBGAVideo(ctx, track, cue, seconds, slot);
  }

  const binding = ctx.skinBinding;
  if (binding?.drawsBGA) {
    // The skin composites the BGA itself: hand it the images and leave the BGA layer empty.
    const skinFrame = (stack: BGAStack) =>
      buildSkinBGAFrame(
        {
          base:
            stack.baseCue?.bmpKey !== undefined
              ? resolveBGAFrameKey(ctx, stack.baseCue.bmpKey, stack.baseCue.seconds, seconds)
              : undefined,
          layer:
            stack.layerCue?.bmpKey !== undefined
              ? resolveBGAFrameKey(ctx, stack.layerCue.bmpKey, stack.layerCue.seconds, seconds, 'layer')
              : undefined,
          layer2:
            stack.layer2Cue?.bmpKey !== undefined
              ? resolveBGAFrameKey(ctx, stack.layer2Cue.bmpKey, stack.layer2Cue.seconds, seconds, 'layer2')
              : undefined,
          poor:
            stack.poorKey !== undefined
              ? resolveBGAFrameKey(ctx, stack.poorKey, undefined, seconds, 'poor')
              : undefined,
          poorOverlays: stack.poorOverlays,
          opacity: stack.opacity,
          tint: stack.tint,
        },
        (key, track, tint) =>
          tintSkinBGAImage(
            resolveSkinBGAImage(
              ctx,
              (track === 'layer' ? ctx.play.bgaLayerTextures : ctx.play.bgaTextures).get(key),
              ctx.play.bgaSubRegionOrigins?.has(key),
            ),
            tint,
          ),
        ctx.play.bgaSubRegionOrigins,
      );
    const frame = leading !== undefined ? skinFrame(leading) : { poorActive: false };
    binding.setBGA({
      ...frame,
      ...(ctx.play.nonstopBGATimelines !== undefined
        ? {
            stacks: stacks.map((stack) => ({ ...skinFrame(stack), alpha: stack.alpha })),
          }
        : {}),
    });
    ctx.bgaLayerPool.end();
    return;
  }

  for (const bga of visibleBGAs) {
    if (bga.w <= 0 || bga.h <= 0) continue;
    const backdrop = ctx.bgaLayerPool.acquireSprite();
    backdrop.texture = Texture.WHITE;
    backdrop.label = 'bga/background';
    backdrop.position.set(bga.x, bga.y);
    backdrop.width = bga.w;
    backdrop.height = bga.h;
    bga.applyToSprite(backdrop);
    backdrop.tint = 0x000000;
    const drawLayer = (
      key: string | undefined,
      textures: ReadonlyMap<string, Texture>,
      layerName: 'base' | 'layer' | 'layer2' | 'poor',
      cueSeconds: number | undefined,
      alpha = 1,
      overlay = false,
      tint = 0xffffff,
    ): void => {
      if (!key) return;
      const resolvedKey = resolveBGAFrameKey(ctx, key, cueSeconds, seconds, layerName);
      const texture = textures.get(resolvedKey);
      if (!texture) return;
      // The rect stands for the 256x256 BMS canvas: an image that fits it keeps its pixel size there, centered
      // horizontally and top-aligned (a 256x161 frame leaves a band at the bottom), while a larger image or a
      // video fills the rect, as LR2 and beatoraja do.
      const placed =
        ctx.play.bgaVideos.has(resolvedKey) && !ctx.play.bgaSubRegionOrigins.has(resolvedKey)
          ? bga
          : resolveBGAImageRect(
              texture.frame.width,
              texture.frame.height,
              bga,
              ctx.play.bgaSubRegionOrigins.get(resolvedKey),
            );
      if (layerName !== 'layer' && layerName !== 'layer2' && !overlay && (placed.w < bga.w || placed.h < bga.h)) {
        // The base canvas around a small image is black (a 1x1 black BMP blanks the BGA in LR2 and beatoraja), so
        // fill the rect before drawing the image; the layer track's canvas stays transparent.
        const backdrop = ctx.bgaLayerPool.acquireSprite();
        backdrop.texture = Texture.WHITE;
        backdrop.label = `bga/${layerName}/canvas`;
        backdrop.position.set(bga.x, bga.y);
        backdrop.width = bga.w;
        backdrop.height = bga.h;
        bga.applyToSprite(backdrop);
        backdrop.tint = 0x000000;
        backdrop.alpha *= alpha;
      }
      const sprite = ctx.bgaLayerPool.acquireSprite();
      sprite.texture = texture;
      sprite.label = `bga/${layerName}[key=${resolvedKey}]`;
      sprite.position.set(placed.x, placed.y);
      sprite.width = placed.w;
      sprite.height = placed.h;
      bga.applyToSprite(sprite);
      sprite.alpha *= alpha;
      const skinTint = sprite.tint;
      sprite.tint = [16, 8, 0].reduce(
        (value, shift) =>
          value | (Math.round((((skinTint >>> shift) & 255) * ((tint >>> shift) & 255)) / 255) << shift),
        0,
      );
    };
    for (const stack of stacks) {
      if (stack.poorKey && !stack.poorOverlays) {
        // POOR uses base-mode decoding (no chroma key) since it replaces the stack's base+layer composite during its
        // window. POOR has no per-cue origin time we can hand to `drawLayer` for `#SWBGAxx` frame timing; chart
        // authors don't typically pair POOR with switching BGA, and a static frame is the safer fallback.
        drawLayer(
          stack.poorKey,
          ctx.play.bgaTextures,
          'poor',
          undefined,
          stack.alpha * (stack.opacity?.poor ?? 1),
          false,
          stack.tint?.poor,
        );
        continue;
      }
      // `cue.seconds` anchors switching-BGA frame timing — `pickSwitchingBGAFrame` advances frames relative to when
      // the cue fired, not relative to the chart origin.
      drawLayer(
        stack.baseCue?.bmpKey,
        ctx.play.bgaTextures,
        'base',
        stack.baseCue?.seconds,
        stack.alpha * (stack.opacity?.base ?? 1),
        false,
        stack.tint?.base,
      );
      // Layer track is composited on top with black→transparent so the base track shows through where the
      // foreground BMP is empty.
      drawLayer(
        stack.layerCue?.bmpKey,
        ctx.play.bgaLayerTextures,
        'layer',
        stack.layerCue?.seconds,
        stack.alpha * (stack.opacity?.layer ?? 1),
        false,
        stack.tint?.layer,
      );
      drawLayer(
        stack.layer2Cue?.bmpKey,
        ctx.play.bgaLayerTextures,
        'layer2',
        stack.layer2Cue?.seconds,
        stack.alpha * (stack.opacity?.layer2 ?? 1),
        false,
        stack.tint?.layer2,
      );
      if (stack.poorKey && stack.poorOverlays)
        drawLayer(
          stack.poorKey,
          ctx.play.bgaTextures,
          'poor',
          undefined,
          stack.alpha * (stack.opacity?.poor ?? 1),
          true,
          stack.tint?.poor,
        );
    }
  }
  ctx.bgaLayerPool.end();
}

/**
 * The BGA stacks to draw at `cueSeconds` ({@link resolveBGAStacksOf}). The chart's own POOR cue (with its `#BMP00`
 * fallback) is resolved by the caller, so a chart that is not stitched passes no POOR cues.
 */
function resolveBGAStacks(
  ctx: BGARendererContext,
  cueSeconds: number,
  noBase: boolean,
  noLayer: boolean,
  inPoorWindow: boolean,
): BGAStack[] {
  const stages = ctx.options.nonstop?.stages;
  const timelines = ctx.play.nonstopBGATimelines;
  return resolveBGAStacksOf({
    timeline: ctx.play.bgaTimeline,
    poorBGAMode: ctx.play.poorBGAMode,
    nonstop: stages !== undefined && timelines !== undefined ? { stages, timelines } : undefined,
    seconds: cueSeconds,
    noBase,
    noLayer,
    inPoorWindow,
  });
}

/**
 * The slot to show for the BGA cue `key` that fired at `cueSeconds`. BMS spec — `#SWBGAxx fr:tot:lp:ARGB N1 N2 ...`
 * declares an animated BGA: when the cue's slot matches a parsed entry, advance through its frame list at the
 * authored interval and show the source `#BMPxx` of the currently-visible frame. Otherwise (no `#SWBGAxx` entry, or
 * no cue time as for POOR) `key` itself.
 */
function resolveBGAFrameKey(
  ctx: BGARendererContext,
  key: string,
  cueSeconds: number | undefined,
  seconds: number,
  track: 'base' | 'layer' | 'layer2' | 'poor' = 'base',
): string {
  const swBGA = cueSeconds === undefined ? undefined : ctx.play.switchingBGAs.get(key);
  const frameKey = swBGA ? pickSwitchingBGAFrame(swBGA, Math.max(0, (seconds - cueSeconds!) * 1000)) || key : key;
  const videoKey = String.fromCharCode(0) + track + ':' + frameKey;
  return ctx.play.bgaVideos?.has(videoKey) ? videoKey : frameKey;
}

/** Video crops remain live canvases; their Texture keys disappear with the play session. */
const videoCrops = new WeakMap<Texture, HTMLCanvasElement>();

/**
 * The image behind a loaded BGA texture, for `frame.bga`: the decoded bitmap or the `<video>` element itself, or a
 * cropped copy for a `#BGAxx` sub-region (made on first use, so `undefined` for a frame or two).
 */
function resolveSkinBGAImage(
  ctx: BGARendererContext,
  texture: Texture | undefined,
  subRegion = false,
): BeMusicImage | undefined {
  if (!texture) return undefined;
  const source = texture.source;
  const resource = source.resource as BeMusicImage | undefined;
  if (!resource) return undefined;
  const { frame } = texture;
  if (!subRegion && frame.x === 0 && frame.y === 0 && frame.width === source.width && frame.height === source.height) {
    return resource;
  }
  if ('videoWidth' in resource) {
    let canvas = videoCrops.get(texture);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = frame.width;
      canvas.height = frame.height;
      videoCrops.set(texture, canvas);
    }
    const context = canvas.getContext('2d')!;
    try {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(resource, frame.x, frame.y, frame.width, frame.height, 0, 0, canvas.width, canvas.height);
    } catch {
      // A seeking/not-yet-buffered video gets another opportunity next frame.
    }
    return canvas;
  }
  const crop = ctx.skinBGACrops.get(texture);
  if (crop !== undefined) return crop ?? undefined;
  ctx.skinBGACrops.set(texture, null);
  createImageBitmap(resource, frame.x, frame.y, frame.width, frame.height).then(
    (bitmap) => {
      if (ctx.play.disposed || !ctx.skinBGACrops.has(texture)) bitmap.close();
      else ctx.skinBGACrops.set(texture, bitmap);
    },
    () => {
      // Leave the `null` marker: the crop isn't retried, the sub-region just doesn't show.
    },
  );
  return undefined;
}

/** How far (seconds) a BGA video may drift from the chart's time since its cue before it is set back in step. */
export const BGA_VIDEO_DRIFT_SECONDS = 0.25;

/**
 * Where a BGA video playing its cue should be set to keep in step with the chart: `expectedSeconds` (the chart time
 * since the cue, which the video runs at the play tempo) when it has drifted more than {@link BGA_VIDEO_DRIFT_SECONDS}
 * from it — a seek, a stall, a throttled tab — and the video has not played out; `undefined` while it is in step.
 */
export function resolveBGAVideoResync(
  currentSeconds: number,
  expectedSeconds: number,
  durationSeconds: number,
): number | undefined {
  if (!Number.isFinite(expectedSeconds) || expectedSeconds < 0) return undefined;
  if (Number.isFinite(durationSeconds) && expectedSeconds >= durationSeconds) return undefined;
  return Math.abs(currentSeconds - expectedSeconds) > BGA_VIDEO_DRIFT_SECONDS ? expectedSeconds : undefined;
}

/**
 * Drives playback of a video BGA on one of the four planes. When the cue's key matches a known video: -
 * first time it fires, `play()` from the cue's start offset - re-firing the same cue is a no-op (video keeps playing)
 * - switching keys pauses the previous video, then plays the new
 *
 * Static (non-video) cues just clear the active-video record so the next video transition starts fresh. The seek
 * offset uses `seconds - cue.seconds` directly because BMS BGA semantics are "start playing this video from t=0 the
 * moment the cue fires".
 */
function syncBGAVideo(
  ctx: BGARendererContext,
  track: 'base' | 'layer' | 'layer2' | 'poor',
  cue: BGACue | undefined,
  seconds: number,
  slot: string = track,
): void {
  // Hold off on every video state mutation until the chart-start gate has fired and `audioContextStartTime` is
  // anchored to the audio clock. Without this guard `renderBGA` (which runs every tick from the moment `start()`
  // reveals the scene) picks up the t=0 BGA cue while we're still in the LR2 LOADING phase and `play()`s the video —
  // the user sees the BGA running behind the LOADING / DONE chrome. By short-circuiting we also avoid populating
  // `bgaActiveVideos[slot]`, so when PLAY START fires the next sync call still sees `previous = undefined` and
  // re-enters the "first cue" branch with the correct seek offset.
  if (ctx.play.audioContextStartTime === 0) {
    return;
  }
  const previous = ctx.play.bgaActiveVideos[slot];
  const cueKey = cue?.bmpKey;
  const independentKey = String.fromCharCode(0) + track + ':' + cueKey;
  const key = ctx.play.bgaVideos?.has(independentKey) ? independentKey : cueKey;
  const handle = key ? ctx.play.bgaVideos.get(key) : undefined;
  if (!handle) {
    // Cue points at a still image (or nothing). If we were playing a video, pause it.
    if (previous) {
      const prevHandle = ctx.play.bgaVideos.get(previous.key);
      if (prevHandle && !prevHandle.video.paused) {
        prevHandle.video.pause();
      }
      ctx.play.bgaActiveVideos[slot] = undefined;
    }
    return;
  }
  if (previous !== undefined && previous.key === key && previous.cueSeconds === (cue?.seconds ?? 0)) {
    // Same cue still active: the video plays forward on its own and the Pixi VideoSource pulls fresh frames each tick;
    // one that drifted from the chart is set back in step.
    const video = handle.video;
    if (video.paused || video.seeking) return;
    const resync = resolveBGAVideoResync(video.currentTime, seconds - previous.cueSeconds, video.duration);
    if (resync === undefined) return;
    try {
      video.currentTime = resync;
    } catch {
      // Not seekable yet: the next frame tries again.
    }
    return;
  }
  if (previous) {
    const prevHandle = ctx.play.bgaVideos.get(previous.key);
    if (prevHandle && !prevHandle.video.paused) {
      prevHandle.video.pause();
    }
  }
  const cueSeconds = cue?.seconds ?? 0;
  ctx.play.bgaActiveVideos[slot] = { key: key!, cueSeconds };
  const offset = Math.max(0, seconds - cueSeconds);
  // The video runs at the play tempo, so its time stays the chart time since its cue.
  handle.video.playbackRate = ctx.play.tempo;
  try {
    handle.video.currentTime = Math.min(offset, Math.max(0, handle.video.duration - 0.05) || offset);
  } catch {
    // Some browsers throw on currentTime assignment before the video has its initial buffer. Best-effort — play()
    // below will retry once the buffer arrives.
  }
  // A paused play (one sought while paused) shows the cue's frame; resuming plays the active videos.
  if (ctx.play.paused) return;
  void handle.video.play().catch(() => {
    // Autoplay policy / codec rejections — silently swallow so the still-image fallback keeps working.
  });
}

const tintedSkinImages = new WeakMap<BeMusicImage, Map<number, HTMLCanvasElement>>();
/** Canvas skins receive already-tinted pixels, so existing skins honor the same plane controls as Pixi scenes. */
function tintSkinBGAImage(image: BeMusicImage | undefined, tint = 0xffffff): BeMusicImage | undefined {
  if (!image || tint === 0xffffff) return image;
  let colors = tintedSkinImages.get(image);
  if (!colors) {
    colors = new Map();
    tintedSkinImages.set(image, colors);
  }
  const existing = colors.get(tint);
  if (existing && ('naturalWidth' in image || (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)))
    return existing;
  const canvas = existing ?? document.createElement('canvas');
  if (!existing) {
    if (colors.size >= 4) colors.delete(colors.keys().next().value!);
    colors.set(tint, canvas);
  }
  const source = image as {
    videoWidth?: number;
    videoHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const width = source.videoWidth ?? source.naturalWidth ?? source.width ?? 0;
  const height = source.videoHeight ?? source.naturalHeight ?? source.height ?? 0;
  if (!width || !height) return undefined;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  try {
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      pixels.data[offset] = Math.round((pixels.data[offset]! * ((tint >>> 16) & 255)) / 255);
      pixels.data[offset + 1] = Math.round((pixels.data[offset + 1]! * ((tint >>> 8) & 255)) / 255);
      pixels.data[offset + 2] = Math.round((pixels.data[offset + 2]! * (tint & 255)) / 255);
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  } catch {
    return undefined;
  }
}
