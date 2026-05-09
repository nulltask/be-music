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

import { Container, Sprite, Texture } from 'pixi.js';
import { destinationToSpriteProps, type BeatorajaRenderContext } from './beatoraja-render.ts';
import {
  normalizeBeatorajaDestinations,
  type BeatorajaDestinationGroup,
  type BeatorajaSkin,
} from '@be-music/beatoraja-skin';
import { pickActiveBgaKey, type BgaCue } from './pixi-gameplay-bga.ts';

export interface BeatorajaBgaLayerOptions {
  skin: BeatorajaSkin;
  /**
   * Decoded BGA textures keyed by `#BMPxx` slot label (`'00'`..`'ZZ'`). Same map the LR2 path's BGA
   * loader produces; the demo can build it once and share it across the gameplay views.
   */
  textures: ReadonlyMap<string, Texture>;
  /**
   * Chart-time BGA cue lists. Built via `buildBgaTimeline(chart, resolver)` in `pixi-gameplay-bga.ts`.
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
}

export class BeatorajaBgaLayer {
  readonly container = new Container();
  private readonly sprite: Sprite;
  private readonly group: BeatorajaDestinationGroup | undefined;
  private readonly textures: ReadonlyMap<string, Texture>;
  private readonly videoElements: ReadonlyMap<string, HTMLVideoElement>;
  private readonly cues: { base: ReadonlyArray<BgaCue>; layer: ReadonlyArray<BgaCue>; poor: ReadonlyArray<BgaCue> };
  /**
   * Skin canvas height in skin-pixel units. Read from `skin.h` at construction so we can flip
   * the BGA's Y-UP dst rect into Pixi Y-DOWN — same convention the play skin view uses.
   */
  private readonly canvasHeight: number;
  private currentKey: string | undefined;
  private disposed = false;

  constructor(options: BeatorajaBgaLayerOptions) {
    this.textures = options.textures;
    this.videoElements = options.videoElements ?? new Map();
    this.cues = options.cues;
    this.group = resolveBgaDestinationGroup(options.skin, options.skinConfigOps);
    const rawH = (options.skin as { h?: unknown }).h;
    this.canvasHeight = typeof rawH === 'number' && Number.isFinite(rawH) && rawH > 0 ? rawH : 720;

    // Mounted with no texture — `update()` swaps in the active BGA texture per frame. Kept invisible
    // until the destination group resolves with `visible = true` so a chart with no BGA stays clean.
    this.sprite = new Sprite();
    this.sprite.visible = false;
    this.container.addChild(this.sprite);
  }

  /**
   * Re-place + repaint the BGA for the current frame. Call once per Pixi tick from the gameplay view
   * after `view.update(context)` has run, so the BGA layer reads the same activeOps / nowMs the skin
   * view used.
   */
  update(seconds: number, context: BeatorajaRenderContext, poorBgaActive: boolean): void {
    if (this.disposed) return;
    if (this.group === undefined) {
      this.sprite.visible = false;
      return;
    }
    const props = destinationToSpriteProps(this.group, context, this.canvasHeight);
    this.sprite.visible = props.visible;
    if (!props.visible) return;
    this.sprite.x = props.x;
    this.sprite.y = props.y;
    this.sprite.width = props.width;
    this.sprite.height = props.height;
    this.sprite.alpha = props.alpha;
    this.sprite.tint = props.tint;
    this.sprite.angle = props.angle;
    this.sprite.blendMode = props.blendMode;

    const effectiveKey = this.pickEffectiveKey(seconds, poorBgaActive);
    if (effectiveKey !== this.currentKey) {
      // Pause + reset the video on the OLD key (when one was a video) before swapping.
      // Without this, multiple video BGAs queued back-to-back would keep playing in the
      // background, contending for compositor frame callbacks.
      if (this.currentKey !== undefined) {
        const prevVideo = this.videoElements.get(this.currentKey);
        if (prevVideo !== undefined) {
          prevVideo.pause();
          prevVideo.currentTime = 0;
        }
      }
      this.currentKey = effectiveKey;
      const texture = effectiveKey !== undefined ? this.textures.get(effectiveKey) : undefined;
      // Falling through to `Texture.EMPTY` rather than hiding the sprite preserves the skin-side BGA
      // chrome (the rectangle authored in the destination group) — the skin's frame keeps painting,
      // and the BGA-area sub-rect goes black until the next cue arrives. Matches LR2 behaviour.
      this.sprite.texture = texture ?? Texture.EMPTY;
      // Start the new key's video from the beginning. Browsers gate `.play()` behind the
      // user-gesture autoplay policy — when the gameplay scene mounts as a result of a
      // click / keypress (the typical entry path), the gesture transfers and play() resolves
      // synchronously. Otherwise the promise rejects silently and the video stays at frame
      // 0 until the next cue brings it into focus.
      if (effectiveKey !== undefined) {
        const nextVideo = this.videoElements.get(effectiveKey);
        if (nextVideo !== undefined) {
          nextVideo.currentTime = 0;
          // Use the promise form so we can swallow the autoplay-rejection cleanly.
          const playPromise = nextVideo.play();
          if (playPromise !== undefined && typeof playPromise.catch === 'function') {
            playPromise.catch(() => undefined);
          }
        }
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.container.destroyed) {
      this.container.destroy({ children: true });
    }
  }

  private pickEffectiveKey(seconds: number, poorActive: boolean): string | undefined {
    const baseKey = pickActiveBgaKey(this.cues.base, seconds);
    const layerKey = pickActiveBgaKey(this.cues.layer, seconds);
    const poorKey = poorActive ? pickActiveBgaKey(this.cues.poor, seconds) : undefined;
    return poorKey ?? layerKey ?? baseKey;
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
