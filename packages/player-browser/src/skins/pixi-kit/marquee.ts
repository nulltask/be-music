import { type Container, type DestroyOptions, Graphics, GraphicsContext, type Text } from 'pixi.js';

/**
 * Long-text fitting for built-in skin text: a string wider than its `maxWidth` is squeezed horizontally, but never
 * below {@link MIN_TEXT_SQUEEZE}. Past that it stays at the minimum squeeze, is clipped to a box exactly `maxWidth`
 * wide, and scrolls through the box like a marquee (see {@link resolveMarqueeOffset}).
 */

/** The narrowest horizontal scale a fitted text is squeezed to before it scrolls instead. */
export const MIN_TEXT_SQUEEZE = 0.85;

export interface MarqueeTiming {
  /** Time the text rests at its start, so the beginning reads. */
  startHoldMs: number;
  /** Scroll speed, in design pixels per second. */
  speedPxPerSecond: number;
  /** Time the text rests at its end before returning to the start. */
  endHoldMs: number;
  /** Fade out at the end of the end hold and back in at the start of the next cycle (inside the holds). */
  fadeMs: number;
}

export const DEFAULT_MARQUEE_TIMING: MarqueeTiming = {
  startHoldMs: 1500,
  speedPxPerSecond: 32,
  endHoldMs: 1000,
  fadeMs: 220,
};

/**
 * Horizontal scale that fits a text `width` wide into `maxWidth`: 1 when it fits, the squeeze when it fits squeezed
 * no further than `minSqueeze`, otherwise `minSqueeze` (the text then overflows and scrolls).
 */
export function resolveTextSqueeze(width: number, maxWidth: number, minSqueeze: number = MIN_TEXT_SQUEEZE): number {
  if (!(width > maxWidth) || !(width > 0)) return 1;
  return Math.max(minSqueeze, Math.max(0, maxWidth) / width);
}

/** Length of one marquee cycle (start hold, scroll, end hold) for a text overflowing its box by `overflowPx`. */
export function marqueeCycleMs(overflowPx: number, timing: MarqueeTiming = DEFAULT_MARQUEE_TIMING): number {
  if (!(overflowPx > 0)) return 0;
  return timing.startHoldMs + (overflowPx / timing.speedPxPerSecond) * 1000 + timing.endHoldMs;
}

/**
 * How far (design px, 0..`overflowPx`) a marquee text has scrolled left `elapsedMs` after it first appeared: it rests
 * at 0 for the start hold, scrolls at a constant speed to `overflowPx`, rests there for the end hold, then starts over.
 */
export function resolveMarqueeOffset(
  elapsedMs: number,
  overflowPx: number,
  timing: MarqueeTiming = DEFAULT_MARQUEE_TIMING,
): number {
  if (!(overflowPx > 0) || !(elapsedMs > 0)) return 0;
  const t = elapsedMs % marqueeCycleMs(overflowPx, timing);
  if (t <= timing.startHoldMs) return 0;
  return Math.min(overflowPx, ((t - timing.startHoldMs) * timing.speedPxPerSecond) / 1000);
}

/**
 * Opacity (0..1) of a marquee text `elapsedMs` after it first appeared: it fades out at the end of each end hold and
 * back in as the next cycle starts at the beginning, so the return to the start reads as a cut rather than a jump.
 * The first appearance is not faded in.
 */
export function resolveMarqueeAlpha(
  elapsedMs: number,
  overflowPx: number,
  timing: MarqueeTiming = DEFAULT_MARQUEE_TIMING,
): number {
  if (!(overflowPx > 0) || !(elapsedMs > 0) || !(timing.fadeMs > 0)) return 1;
  const cycle = marqueeCycleMs(overflowPx, timing);
  const t = elapsedMs % cycle;
  const fadeOut = Math.min(timing.fadeMs, timing.endHoldMs);
  if (t > cycle - fadeOut) return Math.max(0, (cycle - t) / fadeOut);
  const fadeIn = Math.min(timing.fadeMs, timing.startHoldMs);
  if (elapsedMs >= cycle && t < fadeIn) return t / fadeIn;
  return 1;
}

/** One rect (0,0)–(1,1) every clip box shares; each box only positions and scales it. */
let unitRect: GraphicsContext | undefined;

/** A marquee's clip box: a shared unit rect that never destroys the shared context it draws. */
class MarqueeClip extends Graphics {
  public constructor() {
    unitRect ??= new GraphicsContext().rect(0, 0, 1, 1).fill(0xffffff);
    super(unitRect);
    this.label = 'marquee-clip';
  }

  public override destroy(options?: DestroyOptions): void {
    // Layers are torn down with `context: true`; the shared rect must survive that.
    super.destroy(typeof options === 'object' ? { ...options, context: false } : options === true ? {} : options);
  }
}

/** When a scrolling string first appeared, keyed by the string and its box, so rebuilt nodes keep scrolling on. */
interface MarqueeClock {
  startMs: number;
  seenMs: number;
}

const CLOCKS = new Map<string, MarqueeClock>();
/** A clock not rendered for this long restarts: the text left the screen, and should read from its start again. */
const CLOCK_IDLE_MS = 400;
const CLOCK_PRUNE_SIZE = 64;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function clockFor(key: string, nowMs: number): MarqueeClock {
  let clock = CLOCKS.get(key);
  if (!clock) {
    if (CLOCKS.size >= CLOCK_PRUNE_SIZE) {
      for (const [stale, entry] of CLOCKS) if (nowMs - entry.seenMs > CLOCK_IDLE_MS) CLOCKS.delete(stale);
    }
    clock = { startMs: nowMs, seenMs: nowMs };
    CLOCKS.set(key, clock);
  } else if (nowMs - clock.seenMs > CLOCK_IDLE_MS) {
    clock.startMs = nowMs;
  }
  clock.seenMs = nowMs;
  return clock;
}

/** Per-node marquee state: kept on the node across pooled reuse, so a 60 fps HUD redraw allocates nothing. */
class MarqueeState {
  public readonly clip = new MarqueeClip();
  public boxLeft = 0;
  public overflow = 0;
  public scroll = true;
  public key = '';
  public clock: MarqueeClock | undefined;
  /** The alpha the owner gave the node, and the faded alpha last written over it. */
  private baseAlpha = 1;
  private writtenAlpha = Number.NaN;
  private readonly target: Container;

  public constructor(target: Container) {
    this.target = target;
    target.once('destroyed', () => {
      if (!this.clip.destroyed) this.clip.destroy();
      STATES.delete(target);
    });
  }

  /** Places the target for the current time (also its `onRender`, so a screen built once still scrolls). */
  public readonly update = (): void => {
    const target = this.target;
    const clock = this.clock;
    if (!clock || target.destroyed) return;
    const nowMs = now();
    clock.seenMs = nowMs;
    const elapsed = this.scroll ? nowMs - clock.startMs : 0;
    target.x = this.boxLeft - resolveMarqueeOffset(elapsed, this.overflow);
    // Owners set `alpha` after building (fades, intros); treat any alpha we did not write as the new base.
    if (target.alpha !== this.writtenAlpha) this.baseAlpha = target.alpha;
    target.alpha = this.baseAlpha * resolveMarqueeAlpha(elapsed, this.overflow);
    this.writtenAlpha = target.alpha;
  };

  public resetAlpha(): void {
    this.writtenAlpha = Number.NaN;
  }
}

const STATES = new WeakMap<Container, MarqueeState>();

/** The clip box of a marquee, in the coordinates of the target's parent. */
export interface MarqueeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Clips `target` (a child of `parent` whose content starts at its own x = 0) to `box` with a rect mask added to
 * `parent`, and scrolls it left by up to `overflow` px from its `onRender`, so it animates even on screens that are not
 * rebuilt every frame. Targets showing the same `key` share one clock: a screen rebuilt every frame (new nodes each
 * time) keeps scrolling smoothly. Calling it again on the same target (pooled HUD text) reuses its mask and callback.
 */
export function startMarquee(
  target: Container,
  parent: Container,
  box: MarqueeBox,
  overflow: number,
  key: string,
  scroll = true,
): void {
  let marquee = STATES.get(target);
  if (!marquee) {
    marquee = new MarqueeState(target);
    STATES.set(target, marquee);
  }
  marquee.boxLeft = box.left;
  marquee.overflow = overflow;
  marquee.scroll = scroll;
  if (key !== marquee.key || !marquee.clock) {
    marquee.key = key;
    marquee.clock = clockFor(key, now());
  }
  const clip = marquee.clip;
  clip.position.set(box.left, box.top);
  clip.scale.set(box.width, box.height);
  clip.visible = true;
  if (clip.parent !== parent) parent.addChild(clip);
  target.mask = clip;
  if (target.onRender !== marquee.update) {
    marquee.resetAlpha();
    target.onRender = marquee.update;
  }
  marquee.update();
}

/** Drops `target`'s marquee (clip and scrolling), e.g. when a pooled node is reused for text that fits. */
export function stopMarquee(target: Container): void {
  const state = STATES.get(target);
  if (!state) return;
  if (target.onRender === state.update) target.onRender = null;
  if (target.mask === state.clip) target.mask = null;
  // Once no longer a mask the rect would render as a white box.
  state.clip.visible = false;
  state.key = '';
  state.clock = undefined;
}

export interface FitTextOptions {
  /** Box width; the text's anchor point sits `anchorX` of the way across it. */
  maxWidth: number;
  anchorX: number;
  anchorY: number;
  /** Uniform scale applied on top of the fit (HUD "punch"); the box grows with it. */
  scale?: number;
  /** `false` clips an overflowing text at its start without scrolling (e.g. an unfocused list row). */
  scroll?: boolean;
}

/**
 * Fits `node` (positioned at its anchor point, unscaled, already or about to be a child of `parent`) into
 * `options.maxWidth`: squeezed down to {@link MIN_TEXT_SQUEEZE}, then clipped and scrolled (see {@link startMarquee}).
 */
export function fitTextToWidth(node: Text, parent: Container, options: FitTextOptions): void {
  const scale = options.scale ?? 1;
  const width = node.width;
  const squeeze = resolveTextSqueeze(width, options.maxWidth);
  const overflow = (width * squeeze - options.maxWidth) * scale;
  // A rotated text cannot be clipped by an axis-aligned box; it keeps the plain squeeze.
  if (!(overflow > 0.5) || node.rotation !== 0) {
    stopMarquee(node);
    node.scale.set((overflow > 0.5 ? options.maxWidth / width : squeeze) * scale, scale);
    return;
  }
  node.scale.set(squeeze * scale, scale);
  const boxWidth = options.maxWidth * scale;
  const left = node.x - options.anchorX * boxWidth;
  node.anchor.x = 0;
  node.x = left;
  // Clip vertically with room to spare (descenders, strokes, shadows); only the horizontal edges matter.
  const height = node.height;
  const middle = node.y + (0.5 - options.anchorY) * height - node.pivot.y * node.scale.y;
  startMarquee(
    node,
    parent,
    { left, top: middle - height * 1.5, width: boxWidth, height: height * 3 },
    overflow,
    `${Math.round(options.maxWidth)}|${node.text}`,
    options.scroll,
  );
}
