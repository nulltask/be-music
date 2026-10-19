// BGA (background animation) rendering layer for a beatoraja play skin.
//
// The skin's `bga` block holds an `id` referencing one of the destination[] groups; that group's
// keyframes describe where on the skin canvas the BGA should be drawn (gated by `if[]` so multi-layout
// skins like the play24 reference can place the BGA differently for the Half / Hybrid / Separate Lane
// layouts).
//
// The BGA cue lists (`base` / `layer` / `poor`) come from the chart's BGA timeline — same `BgaCue[]`
// shape the LR2 gameplay path consumes. The host loads those once when the chart is prepared and hands
// them to the layer alongside the decoded BMP textures keyed by `#BMPxx` slot.
//
// Layering rules:
//   - `base` (chart channel `04`) is the always-active BGA.
//   - `layer` (channels `07` / `0A`) draws on top of base — alpha-blended.
//   - `poor` (channel `06`) overrides everything while a POOR window is active.
//
// For the MVP we collapse the three layers into a single sprite that paints whichever cue takes
// precedence (poor > layer > base). Real beatoraja stacks all three on separate sprites, but a single
// overlay reads correctly for ~95% of charts and dodges the per-cue sprite overhead until profiling
// shows it matters.
//
// A stitched NONSTOP chart draws one such sprite per stage at the opacity of its crossfade
// (`resolveBgaStacks`, the stacks the built-in and LR2 scenes draw too), so the BGA cross-fades over
// 3 s at a stage seam as LR2 does.

import { Container, Sprite, Texture } from 'pixi.js';
import { destinationToSpriteProps, type BeatorajaRenderContext } from '../../../skin/beatoraja/render.ts';
import {
  normalizeBeatorajaDestinations,
  type BeatorajaDestinationGroup,
  type BeatorajaSkin,
} from '@be-music/beatoraja-skin';
import {
  resolveBgaImageRect,
  resolveBgaStacks,
  type BgaCue,
  type NonstopBgaStage,
  type NonstopStageBgaTimeline,
} from '../../../chart/bga-timeline.ts';

export interface BeatorajaBgaLayerOptions {
  skin: BeatorajaSkin;
  /**
   * Decoded BGA textures keyed by `#BMPxx` slot label (`'00'`..`'ZZ'`). Same map the LR2 path's BGA
   * loader produces; the demo can build it once and share it across the gameplay views.
   */
  textures: ReadonlyMap<string, Texture>;
  /**
   * Chart-time BGA cue lists. Built via `buildBgaTimeline(chart, resolver)` in `chart/bga-timeline.ts`.
   * Pass an empty `{ base: [], layer: [], poor: [] }` if the chart has no BGA — the layer hides itself.
   */
  cues: { base: ReadonlyArray<BgaCue>; layer: ReadonlyArray<BgaCue>; poor: ReadonlyArray<BgaCue> };
  /**
   * Optional video-element map for keys whose BMPxx resolves to a video file. The layer
   * pauses / plays / seeks these elements when their texture becomes the active cue.
   * Sparse (only video keys present); empty / undefined = no video BGAs in the chart.
   */
  videoElements?: ReadonlyMap<string, HTMLVideoElement>;
  /**
   * Skin-config-level op set (selected layout / option ops). Used to resolve INNER if-gated
   * keyframe alternatives — beatoraja's BGA destinations stash variant rects per layout option
   * (compact vs. full BGA, etc.) and the loader picks one at skin-load time. Without this set
   * the resolver falls back to the catch-all (empty `if`) alternative — fine for the default
   * layout but mismatches the rect when the user has a non-default skin option active.
   */
  skinConfigOps?: ReadonlySet<number>;
  /**
   * A stitched NONSTOP chart's stages and each stage's own cues (`splitNonstopBgaTimeline`): the layer draws each
   * stage's BGA at the opacity of its crossfade instead of `cues`.
   */
  nonstop?: { stages: readonly NonstopBgaStage[]; timelines: readonly NonstopStageBgaTimeline[] } | undefined;
}

/** One stack's sprites: the black canvas behind a small image, and the image. */
interface BgaSpritePair {
  readonly canvas: Sprite;
  readonly sprite: Sprite;
}

type BgaDestinationProps = ReturnType<typeof destinationToSpriteProps>;

export class BeatorajaBgaLayer {
  readonly container: Container = new Container();
  /**
   * One sprite pair per stack drawn (one, or a NONSTOP chart's stages at a seam), earlier stacks behind. Each pair is a
   * black fill behind an image smaller than the BGA canvas, which beatoraja leaves black around it, and the image. The
   * first pair is mounted at construction.
   */
  private readonly pairs: BgaSpritePair[] = [];
  private readonly group: BeatorajaDestinationGroup | undefined;
  private readonly textures: ReadonlyMap<string, Texture>;
  private readonly videoElements: ReadonlyMap<string, HTMLVideoElement>;
  private readonly cues: { base: ReadonlyArray<BgaCue>; layer: ReadonlyArray<BgaCue>; poor: ReadonlyArray<BgaCue> };
  private readonly nonstop: BeatorajaBgaLayerOptions['nonstop'];
  /**
   * Skin canvas height in skin-pixel units. Read from `skin.h` at construction so we can flip
   * the BGA's Y-UP dst rect into Pixi Y-DOWN — same convention the play skin view uses.
   */
  private readonly canvasHeight: number;
  /** The keys the stacks show now, whose videos play. */
  private currentKeys = new Set<string>();
  private disposed = false;

  constructor(options: BeatorajaBgaLayerOptions) {
    this.textures = options.textures;
    this.videoElements = options.videoElements ?? new Map();
    this.cues = options.cues;
    this.nonstop = options.nonstop;
    this.group = resolveBgaDestinationGroup(options.skin, options.skinConfigOps);
    const rawH = (options.skin as { h?: unknown }).h;
    this.canvasHeight = typeof rawH === 'number' && Number.isFinite(rawH) && rawH > 0 ? rawH : 720;
    // Mounted with no texture — `update()` swaps in the active BGA texture per frame. Kept invisible
    // until the destination group resolves with `visible = true` so a chart with no BGA stays clean.
    this.pairAt(0);
  }

  /**
   * Re-place + repaint the BGA for the current frame. Call once per Pixi tick from the gameplay view
   * after `view.update(context)` has run, so the BGA layer reads the same activeOps / nowMs the skin
   * view used.
   */
  update(seconds: number, context: BeatorajaRenderContext, poorBgaActive: boolean): void {
    if (this.disposed) return;
    for (const pair of this.pairs) {
      pair.canvas.visible = false;
      pair.sprite.visible = false;
    }
    if (this.group === undefined) return;
    const props = destinationToSpriteProps(this.group, context, this.canvasHeight);
    // One stack, or a NONSTOP chart's stages at their crossfade opacity, earlier stages behind.
    const stacks = resolveBgaStacks({
      timeline: this.cues,
      nonstop: this.nonstop,
      seconds,
      inPoorWindow: poorBgaActive,
    });
    const keys = new Set<string>();
    stacks.forEach((stack, index) => {
      const key = stack.poorKey ?? stack.layerCue?.bmpKey ?? stack.baseCue?.bmpKey;
      if (key === undefined) return;
      keys.add(key);
      this.drawStack(this.pairAt(index), key, props, stack.alpha);
    });
    this.syncVideos(keys);
  }

  /**
   * Plays the current cues' videos again when they are paused: a paused play pauses every BGA video, and the layer only
   * starts one on a cue change.
   */
  resume(): void {
    if (this.disposed) return;
    for (const key of this.currentKeys) {
      const video = this.videoElements.get(key);
      if (video !== undefined && video.paused) playVideo(video);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Pause the active videos before tearing down the container — otherwise the
    // `requestVideoFrameCallback` poll keeps running on the compositor thread, fighting
    // for frame slots even though no Pixi sprite consumes the frames anymore. The prep
    // pipeline's `dispose()` clears `src` + revokes the URL on EVERY video; this layer
    // pause is just the "stop the in-flight cue" half so a rapid scene-swap (replaceSkin
    // mid-play) doesn't briefly drive two videos before the prep cleanup runs.
    for (const key of this.currentKeys) {
      try {
        this.videoElements.get(key)?.pause();
      } catch {
        // Already paused / disposed.
      }
    }
    if (!this.container.destroyed) {
      this.container.destroy({ children: true });
    }
  }

  /** The sprite pair of the stack at `index`, mounted on first use. */
  private pairAt(index: number): BgaSpritePair {
    while (this.pairs.length <= index) {
      const pair: BgaSpritePair = {
        canvas: new Sprite({ texture: Texture.WHITE, tint: 0x000000, visible: false }),
        sprite: new Sprite({ visible: false }),
      };
      this.pairs.push(pair);
      this.container.addChild(pair.canvas, pair.sprite);
    }
    return this.pairs[index]!;
  }

  /** Draws `key` on `pair` into the destination `props`, at `alpha` (a NONSTOP stage's crossfade) on top of its own. */
  private drawStack(pair: BgaSpritePair, key: string, props: BgaDestinationProps, alpha: number): void {
    const texture = this.textures.get(key);
    // No decoded texture (or Pixi's source-less EMPTY singleton) must not enter the renderer's
    // batch. Other beatoraja skin paths already skip EMPTY because WebGPU can crash while creating
    // the bind group for that source; BGA cues can hit the same path when a chart references a
    // missing/corrupt BMP slot mid-play.
    if (!props.visible || texture === undefined || texture === Texture.EMPTY) return;
    const { canvas, sprite } = pair;
    if (sprite.texture !== texture) {
      sprite.texture = texture;
    }
    // The destination stands for the 256x256 BMS canvas: a still image that fits it is centered horizontally and
    // top-aligned at its pixel size on a black canvas (beatoraja's `BGImageProcessor`), anything larger and videos
    // fill the rect.
    const rect = { x: props.x, y: props.y, w: props.width, h: props.height };
    const placed = this.videoElements.has(key)
      ? rect
      : resolveBgaImageRect(texture.frame.width, texture.frame.height, rect);
    if (placed.w < rect.w || placed.h < rect.h) {
      canvas.visible = true;
      canvas.x = rect.x;
      canvas.y = rect.y;
      canvas.width = rect.w;
      canvas.height = rect.h;
      canvas.alpha = props.alpha * alpha;
      canvas.angle = props.angle;
      canvas.blendMode = props.blendMode;
    }
    sprite.visible = true;
    sprite.x = placed.x;
    sprite.y = placed.y;
    sprite.width = placed.w;
    sprite.height = placed.h;
    sprite.alpha = props.alpha * alpha;
    sprite.tint = props.tint;
    sprite.angle = props.angle;
    sprite.blendMode = props.blendMode;
  }

  /**
   * Pauses and rewinds the videos of the keys no longer shown, and starts the newly shown ones from the beginning.
   * Without the pause, video BGAs queued back-to-back would keep playing in the background, contending for compositor
   * frame callbacks.
   */
  private syncVideos(keys: Set<string>): void {
    for (const key of this.currentKeys) {
      if (keys.has(key)) continue;
      const video = this.videoElements.get(key);
      if (video !== undefined) {
        video.pause();
        video.currentTime = 0;
      }
    }
    for (const key of keys) {
      if (this.currentKeys.has(key)) continue;
      const video = this.videoElements.get(key);
      if (video !== undefined) {
        video.currentTime = 0;
        playVideo(video);
      }
    }
    this.currentKeys = keys;
  }
}

/**
 * Plays `video`. Browsers gate `.play()` behind the user-gesture autoplay policy — when the gameplay scene mounts as a
 * result of a click / keypress (the typical entry path), the gesture transfers and play() resolves. Otherwise the
 * promise rejects silently and the video stays on its frame until the next cue brings it into focus.
 */
function playVideo(video: HTMLVideoElement): void {
  try {
    const playPromise = video.play();
    if (playPromise !== undefined && typeof playPromise.catch === 'function') {
      playPromise.catch(() => undefined);
    }
  } catch {
    // Autoplay policy or a codec refused it: the video stays on its frame.
  }
}

/**
 * Look up the destination group the skin's `bga.id` points at. Returns `undefined` when the skin has no
 * `bga` block (some custom themes ship a chart-area-only play layout without BGA support) or when the
 * destination[] doesn't carry a matching id.
 */
function resolveBgaDestinationGroup(
  skin: BeatorajaSkin,
  skinConfigOps: ReadonlySet<number> | undefined,
): BeatorajaDestinationGroup | undefined {
  const bgaId = skin.bga?.id;
  if (typeof bgaId !== 'number' && typeof bgaId !== 'string') return undefined;
  const groups = normalizeBeatorajaDestinations(skin.destination, skinConfigOps);
  return groups.find((group) => group.id === bgaId);
}
