/**
 * The chart's BGA on the built-in and LR2 gameplay scenes (`CoreGameplayView`): composites the base, layer and POOR
 * images (or a stitched NONSTOP chart's per-stage stacks) into the theme's BGA rects, or hands them to a be-music skin
 * that composites the BGA itself, and keeps the BGA videos playing in step with their cues.
 *
 * The functions read and write the scene's state through {@link BgaRendererContext}; the scene passes itself.
 */

import { pickSwitchingBgaFrame, resolveBmsBmpArgb } from '@be-music/chart';
import { DEFAULT_POOR_BGA_DISPLAY_SECONDS } from '@be-music/player/core/bga-timeline';
import { Texture } from 'pixi.js';
import {
  buildSkinBgaFrame,
  pickActiveBgaCue,
  pickActiveBgaKey,
  resolveBgaImageRect,
  resolveNonstopBgaAlpha,
  type BgaCue,
} from '../../scene/core/gameplay-bga.ts';
import type { GameplayBgaTarget, GameplayThemeHooks } from '../../scene/core/gameplay-theme.ts';
import type { CoreGameplayViewOptions } from '../../scene/core/gameplay-options.ts';
import type { ChildPool } from '../../scene/pixi-utils.ts';
import type { BeMusicGameplayBinding } from '../../skin/be-music/binding.ts';
import type { BeMusicImage } from '../../skin/be-music/types.ts';
import type { PlayfieldRuntime } from './playfield/context.ts';

/** The scene's members the BGA passes use: `CoreGameplayView`'s members of these names. */
export interface BgaRendererContext {
  readonly play: PlayfieldRuntime;
  readonly options: Readonly<Pick<CoreGameplayViewOptions, 'bga' | 'autoPlay' | 'nonstop'>>;
  readonly theme: GameplayThemeHooks;
  readonly bgaLayerPool: ChildPool;
  readonly bgaTargetsScratch: GameplayBgaTarget[];
  readonly skinBinding: BeMusicGameplayBinding | undefined;
  readonly skinBgaCrops: Map<Texture, ImageBitmap | null>;
}

/**
 * Composites the chart's BGA into the theme's BGA rectangles ({@link collectBgaTargets}; the default-family BGA
 * rectangle unless a theme supplies its own). Three layers stack from back to front: base (channel 04 / bmson `bga.events`), layer
 * (channel 07 / 0A / bmson `layerEvents`), and a POOR override (channel 06 / `poorEvents`) that briefly replaces the
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
export function renderBga(ctx: BgaRendererContext, seconds: number, cueSeconds: number = seconds): void {
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
  if (!ctx.play.hasBga) {
    ctx.bgaLayerPool.end();
    return;
  }
  // Render into EVERY rectangle the theme reports this frame (a DP LR2 skin can show several at once).
  const visibleBgas = ctx.bgaTargetsScratch;
  ctx.theme.collectBgaTargets(visibleBgas);
  if (visibleBgas.length === 0) {
    ctx.bgaLayerPool.end();
    return;
  }
  // Drive video BGA playback once per frame (not per-rect) — base / layer cues are global to the chart, every rect
  // shows the same source video. Picking the first visible entry's `noBase` / `noLayer` flags as the controlling ones
  // is fine in practice: the LR2 default skin uses identical flags on every rect, and a future skin that mixes them
  // per-rect would still get a consistent global playback state from this single sync point.
  const controllingBga = visibleBgas[0]!;
  const poorWindowMs = DEFAULT_POOR_BGA_DISPLAY_SECONDS * 1000;
  const inPoorWindow =
    !controllingBga.noPoor && ctx.play.lastPoorAt > 0 && ctx.play.playClock() - ctx.play.lastPoorAt < poorWindowMs;
  // A stitched NONSTOP chart shows one BGA stack per stage, crossfading at the seams; any other chart one stack.
  const stacks = resolveBgaStacks(
    ctx,
    cueSeconds,
    controllingBga.noBase === true,
    controllingBga.noLayer === true,
    inPoorWindow,
  );
  const leading = stacks.reduce<(typeof stacks)[number] | undefined>(
    (best, stack) => (best === undefined || stack.alpha >= best.alpha ? stack : best),
    undefined,
  );
  const baseCue = leading?.baseCue;
  const layerCue = leading?.layerCue;
  const baseKey = baseCue?.bmpKey;
  const layerKey = layerCue?.bmpKey;
  let poorKey = ctx.play.nonstopBgaTimelines !== undefined ? leading?.poorKey : undefined;
  if (inPoorWindow && ctx.play.nonstopBgaTimelines === undefined) {
    poorKey = pickActiveBgaKey(ctx.play.bgaTimeline.poor, cueSeconds);
  }
  // BMP00 fallback: when no explicit POOR cue is active but the chart left `#POORBGA` blank with a `#BMP00` defined,
  // paint BMP00 during the miss window. Capped at the first authored POOR cue's chart-time so a chart that does
  // eventually author POOR isn't permanently stuck on the placeholder.
  if (
    inPoorWindow &&
    poorKey === undefined &&
    ctx.play.poorBgaFallbackKey !== undefined &&
    cueSeconds < ctx.play.poorBgaFallbackUntilSeconds
  ) {
    poorKey = ctx.play.poorBgaFallbackKey;
  }
  if (ctx.play.nonstopBgaTimelines === undefined && stacks[0] !== undefined) stacks[0].poorKey = poorKey;
  syncBgaVideo(ctx, 'base', baseCue, seconds);
  syncBgaVideo(ctx, 'layer', layerCue, seconds);

  const binding = ctx.skinBinding;
  if (binding?.drawsBga) {
    // The skin composites the BGA itself: hand it the images and leave the BGA layer empty.
    binding.setBga(
      buildSkinBgaFrame(
        {
          base: baseKey !== undefined ? resolveBgaFrameKey(ctx, baseKey, baseCue?.seconds, seconds) : undefined,
          layer: layerKey !== undefined ? resolveBgaFrameKey(ctx, layerKey, layerCue?.seconds, seconds) : undefined,
          poor: poorKey,
        },
        (key, track) =>
          resolveSkinBgaImage(ctx, (track === 'layer' ? ctx.play.bgaLayerTextures : ctx.play.bgaTextures).get(key)),
      ),
    );
    ctx.bgaLayerPool.end();
    return;
  }

  for (const bga of visibleBgas) {
    if (bga.w <= 0 || bga.h <= 0) continue;
    const drawLayer = (
      key: string | undefined,
      textures: ReadonlyMap<string, Texture>,
      layerName: 'base' | 'layer' | 'poor',
      cueSeconds: number | undefined,
      alpha = 1,
    ): void => {
      if (!key) return;
      const resolvedKey = resolveBgaFrameKey(ctx, key, cueSeconds, seconds);
      const texture = textures.get(resolvedKey);
      if (!texture) return;
      // The rect stands for the 256x256 BMS canvas: an image that fits it keeps its pixel size there, centered
      // horizontally and top-aligned (a 256x161 frame leaves a band at the bottom), while a larger image or a
      // video fills the rect, as LR2 and beatoraja do.
      const placed = ctx.play.bgaVideos.has(resolvedKey)
        ? bga
        : resolveBgaImageRect(
            texture.frame.width,
            texture.frame.height,
            bga,
            ctx.play.bgaSubRegionOrigins.get(resolvedKey),
          );
      if (layerName !== 'layer' && (placed.w < bga.w || placed.h < bga.h)) {
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
      // BMS spec — `#ARGBxx AARRGGBB` (and the ARGB tuple embedded in `#EXBMPxx a,r,g,b,filename`) declare the BMP
      // slot's alpha + RGB tint for layer composition. Apply the parsed values via Pixi's per-sprite `tint` (RGB
      // multiply) and `alpha` (overall opacity); the default `#FFFFFFFF` round-trips to `tint = 0xFFFFFF` / `alpha =
      // 1` which is the no-op identity, so charts that omit both directives see no change. `resolveBmsBmpArgb`
      // prefers `#ARGBxx` over the `#EXBMPxx`-embedded tuple when both target the same slot, matching the LR2 /
      // beatoraja precedence. BGA-cue keys come from `buildBgaTimelines`, which routes through `normalizeObjectKey` —
      // exactly the same key normalization the parser applies to the `chart.bms.argb` / `chart.bms.exBmp` maps, so
      // the direct lookup matches.
      const resolvedChart = ctx.play.resolvedChart;
      if (resolvedChart) {
        // Tint resolution honors the original cue key first (so `#ARGBxx 01` applies even when `#SWBGA01` is ALSO
        // active and the per-frame source slot lacks its own tint). Falling back to the resolved frame key catches
        // the inverse case: chart tints the source `#BMPYY` slot but not the `#SWBGA01` alias.
        const argb = resolveBmsBmpArgb(resolvedChart, key) ?? resolveBmsBmpArgb(resolvedChart, resolvedKey);
        if (argb) {
          sprite.tint = (argb.r << 16) | (argb.g << 8) | argb.b;
          // Compose with the call-site alpha that `applyToSprite` may have already written (e.g. skin-driven LR2
          // fades) so the chart-level α stacks multiplicatively rather than overriding it.
          sprite.alpha *= argb.a / 255;
        }
      }
    };
    for (const stack of stacks) {
      if (stack.poorKey) {
        // POOR uses base-mode decoding (no chroma key) since it replaces the stack's base+layer composite during its
        // window. POOR has no per-cue origin time we can hand to `drawLayer` for `#SWBGAxx` frame timing; chart
        // authors don't typically pair POOR with switching BGA, and a static frame is the safer fallback.
        drawLayer(stack.poorKey, ctx.play.bgaTextures, 'poor', undefined, stack.alpha);
        continue;
      }
      // `cue.seconds` anchors switching-BGA frame timing — `pickSwitchingBgaFrame` advances frames relative to when
      // the cue fired, not relative to the chart origin.
      drawLayer(stack.baseCue?.bmpKey, ctx.play.bgaTextures, 'base', stack.baseCue?.seconds, stack.alpha);
      // Layer track is composited on top with black→transparent so the base track shows through where the
      // foreground BMP is empty.
      drawLayer(stack.layerCue?.bmpKey, ctx.play.bgaLayerTextures, 'layer', stack.layerCue?.seconds, stack.alpha);
    }
  }
  ctx.bgaLayerPool.end();
}

/**
 * The BGA stacks to draw at `cueSeconds`: the chart's base and layer cues at full opacity, or for a stitched NONSTOP
 * chart each stage's own cues (and, during a POOR, its own POOR image) at the opacity of its crossfade, earlier
 * stages first.
 */
function resolveBgaStacks(
  ctx: BgaRendererContext,
  cueSeconds: number,
  noBase: boolean,
  noLayer: boolean,
  inPoorWindow: boolean,
): Array<{ alpha: number; baseCue: BgaCue | undefined; layerCue: BgaCue | undefined; poorKey?: string }> {
  const pick = (
    timeline: { base: readonly BgaCue[]; layer: readonly BgaCue[]; poor?: readonly BgaCue[] },
    alpha: number,
  ) => ({
    alpha,
    baseCue: noBase ? undefined : pickActiveBgaCue(timeline.base, cueSeconds),
    layerCue: noLayer ? undefined : pickActiveBgaCue(timeline.layer, cueSeconds),
    ...(inPoorWindow && timeline.poor !== undefined ? { poorKey: pickActiveBgaKey(timeline.poor, cueSeconds) } : {}),
  });
  const stages = ctx.options.nonstop?.stages;
  const timelines = ctx.play.nonstopBgaTimelines;
  if (stages === undefined || timelines === undefined) {
    // The chart's own POOR cue (with its `#BMP00` fallback) is resolved by the caller.
    return [pick({ base: ctx.play.bgaTimeline.base, layer: ctx.play.bgaTimeline.layer }, 1)];
  }
  return stages.flatMap((stage, index) => {
    const alpha = resolveNonstopBgaAlpha(stage, cueSeconds);
    return alpha > 0 ? [pick(timelines[index]!, alpha)] : [];
  });
}

/**
 * The slot to show for the BGA cue `key` that fired at `cueSeconds`. BMS spec — `#SWBGAxx fr:tot:lp:ARGB N1 N2 ...`
 * declares an animated BGA: when the cue's slot matches a parsed entry, advance through its frame list at the
 * authored interval and show the source `#BMPxx` of the currently-visible frame. Otherwise (no `#SWBGAxx` entry, or
 * no cue time as for POOR) `key` itself.
 */
function resolveBgaFrameKey(
  ctx: BgaRendererContext,
  key: string,
  cueSeconds: number | undefined,
  seconds: number,
): string {
  if (cueSeconds === undefined) return key;
  const swBga = ctx.play.switchingBgas.get(key);
  if (!swBga) return key;
  const elapsedMs = Math.max(0, (seconds - cueSeconds) * 1000);
  return pickSwitchingBgaFrame(swBga, elapsedMs) || key;
}

/**
 * The image behind a loaded BGA texture, for `frame.bga`: the decoded bitmap or the `<video>` element itself, or a
 * cropped copy for a `#BGAxx` sub-region (made on first use, so `undefined` for a frame or two).
 */
function resolveSkinBgaImage(ctx: BgaRendererContext, texture: Texture | undefined): BeMusicImage | undefined {
  if (!texture) return undefined;
  const source = texture.source;
  const resource = source.resource as BeMusicImage | undefined;
  if (!resource) return undefined;
  const { frame } = texture;
  if (frame.x === 0 && frame.y === 0 && frame.width === source.width && frame.height === source.height) {
    return resource;
  }
  const crop = ctx.skinBgaCrops.get(texture);
  if (crop !== undefined) return crop ?? undefined;
  ctx.skinBgaCrops.set(texture, null);
  createImageBitmap(resource, frame.x, frame.y, frame.width, frame.height).then(
    (bitmap) => {
      if (ctx.play.disposed || !ctx.skinBgaCrops.has(texture)) bitmap.close();
      else ctx.skinBgaCrops.set(texture, bitmap);
    },
    () => {
      // Leave the `null` marker: the crop isn't retried, the sub-region just doesn't show.
    },
  );
  return undefined;
}

/**
 * Drives playback of a video BGA on a single track (`base` or `layer`). When the cue's key matches a known video: -
 * first time it fires, `play()` from the cue's start offset - re-firing the same cue is a no-op (video keeps playing)
 * - switching keys pauses the previous video, then plays the new
 *
 * Static (non-video) cues just clear the active-video record so the next video transition starts fresh. The seek
 * offset uses `seconds - cue.seconds` directly because BMS BGA semantics are "start playing this video from t=0 the
 * moment the cue fires".
 */
function syncBgaVideo(
  ctx: BgaRendererContext,
  track: 'base' | 'layer',
  cue: BgaCue | undefined,
  seconds: number,
): void {
  // Hold off on every video state mutation until the chart-start gate has fired and `audioContextStartTime` is
  // anchored to the audio clock. Without this guard `renderBga` (which runs every tick from the moment `start()`
  // reveals the scene) picks up the t=0 BGA cue while we're still in the LR2 LOADING phase and `play()`s the video —
  // the user sees the BGA running behind the LOADING / DONE chrome. By short-circuiting we also avoid populating
  // `bgaActiveVideos[track]`, so when PLAY START fires the next sync call still sees `previous = undefined` and
  // re-enters the "first cue" branch with the correct seek offset.
  if (ctx.play.audioContextStartTime === 0) {
    return;
  }
  const previous = ctx.play.bgaActiveVideos[track];
  const key = cue?.bmpKey;
  const handle = key ? ctx.play.bgaVideos.get(key) : undefined;
  if (!handle) {
    // Cue points at a still image (or nothing). If we were playing a video, pause it.
    if (previous) {
      const prevHandle = ctx.play.bgaVideos.get(previous.key);
      if (prevHandle && !prevHandle.video.paused) {
        prevHandle.video.pause();
      }
      ctx.play.bgaActiveVideos[track] = undefined;
    }
    return;
  }
  if (previous?.key === key) {
    // Same cue still active — nothing to do; the video plays forward on its own and the Pixi VideoSource pulls fresh
    // frames each tick.
    return;
  }
  if (previous) {
    const prevHandle = ctx.play.bgaVideos.get(previous.key);
    if (prevHandle && !prevHandle.video.paused) {
      prevHandle.video.pause();
    }
  }
  const cueSeconds = cue?.seconds ?? 0;
  ctx.play.bgaActiveVideos[track] = { key: key!, cueSeconds };
  const offset = Math.max(0, seconds - cueSeconds);
  // The video runs at the play tempo, so its time stays the chart time since its cue.
  handle.video.playbackRate = ctx.play.tempo;
  try {
    handle.video.currentTime = Math.min(offset, Math.max(0, handle.video.duration - 0.05) || offset);
  } catch {
    // Some browsers throw on currentTime assignment before the video has its initial buffer. Best-effort — play()
    // below will retry once the buffer arrives.
  }
  void handle.video.play().catch(() => {
    // Autoplay policy / codec rejections — silently swallow so the still-image fallback keeps working.
  });
}
