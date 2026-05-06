// Pure helpers for translating beatoraja `destination[]` samples into PixiJS `Sprite` props.
//
// Keeping the math pure (no Pixi imports here) means the test suite can exercise every keyframe interaction
// without touching a GPU. The actual `Sprite` mutation is a one-liner inside `pixi-gameplay-beatoraja.ts`:
//
//     sprite.x = props.x;
//     sprite.y = props.y;
//     sprite.width = props.width;
//     sprite.height = props.height;
//     sprite.alpha = props.alpha;
//     sprite.tint = props.tint;
//     sprite.angle = props.angle;
//     sprite.visible = props.visible;
//     sprite.blendMode = props.blendMode;

import { Rectangle, Texture } from 'pixi.js';
import { isElementVisible, sampleBeatorajaDestination, type BeatorajaDestinationGroup } from '@be-music/beatoraja-skin';

export interface BeatorajaSpriteProps {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1 (PixiJS uses 0..1 for `Sprite.alpha`, beatoraja uses 0..255 — this scaling is applied here). */
  alpha: number;
  /** Packed RGB tint as `0xRRGGBB` for `Sprite.tint`. */
  tint: number;
  /** Rotation in degrees — assign directly to `Sprite.angle`. */
  angle: number;
  /** PixiJS `BlendMode` string, derived from beatoraja's numeric blend code. */
  blendMode: BeatorajaPixiBlendMode;
}

/**
 * PixiJS v8 blend mode strings the renderer assigns to `Sprite.blendMode`. Mapping covers the modes beatoraja's
 * reference theme actually uses; the rest fall back to `'normal'`.
 */
export type BeatorajaPixiBlendMode = 'normal' | 'add' | 'multiply' | 'screen' | 'erase';

const HIDDEN_PROPS: BeatorajaSpriteProps = {
  visible: false,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  alpha: 0,
  tint: 0xffffff,
  angle: 0,
  blendMode: 'normal',
};

export interface BeatorajaRenderContext {
  /** Set of currently-active op-codes (option picks + runtime timer / judge / lamp ops). */
  activeOps: ReadonlySet<number>;
  /** Lookup `(timerId) → start-time-ms-since-scene-start`. Returns `undefined` when the timer hasn't fired yet. */
  getTimerStart: (timerId: number) => number | undefined;
  /** Current scene-relative time in milliseconds. */
  nowMs: number;
}

/**
 * Compute the sprite props for a destination group at the current frame. Returns the hidden state when:
 *
 * - the group's `op` codes don't pass against `activeOps`, or
 * - the parent `if` codes don't pass, or
 * - the group's timer hasn't started (and `timer > 0`), or
 * - the destination's keyframe sample returned `undefined` (animation past the end with `loop = -1`).
 */
export function destinationToSpriteProps(
  group: BeatorajaDestinationGroup,
  context: BeatorajaRenderContext,
): BeatorajaSpriteProps {
  if (!isElementVisible(group.ifCodes, context.activeOps)) return HIDDEN_PROPS;
  if (!isElementVisible(group.op, context.activeOps)) return HIDDEN_PROPS;

  const timerStart = group.timer === 0 ? 0 : context.getTimerStart(group.timer);
  if (timerStart === undefined) return HIDDEN_PROPS;

  const elapsed = context.nowMs - timerStart;
  if (elapsed < 0) return HIDDEN_PROPS;

  const keyframe = sampleBeatorajaDestination(group, elapsed);
  if (keyframe === undefined) return HIDDEN_PROPS;

  const alpha = clampUnit(keyframe.a / 255);
  if (alpha <= 0) return HIDDEN_PROPS;

  return {
    visible: true,
    x: keyframe.x,
    y: keyframe.y,
    width: keyframe.w,
    height: keyframe.h,
    alpha,
    tint: packRgbTint(keyframe.r, keyframe.g, keyframe.b),
    angle: keyframe.angle,
    blendMode: blendCodeToPixi(group.blend),
  };
}

function clampUnit(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function packRgbTint(r: number, g: number, b: number): number {
  const cr = clamp255(r);
  const cg = clamp255(g);
  const cb = clamp255(b);
  return (cr << 16) | (cg << 8) | cb;
}

function clamp255(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}

/**
 * Per-base-texture cache of cropped sub-textures. Mirrors the LR2 renderer's `createCroppedTexture` cache so a
 * gameplay frame doesn't allocate a fresh `Texture` + `Rectangle` per sprite each tick. The cache is `WeakMap`-keyed
 * on the base texture so an entry vanishes once the owning view drops the texture.
 */
const cropCache = new WeakMap<Texture, Map<string, Texture>>();

/**
 * Build a `Texture` view that crops `texture` to `rect`. Reuses the same `TextureSource` (no GPU re-upload). Returns
 * `undefined` for empty / missing rectangles. Cached — repeated calls with the same `(texture, x, y, w, h)` return
 * the same `Texture` instance.
 */
export function createCroppedBeatorajaTexture(
  texture: Texture | undefined,
  rect: { x: number; y: number; w: number; h: number },
): Texture | undefined {
  if (
    !texture ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.w) ||
    !Number.isFinite(rect.h) ||
    rect.w <= 0 ||
    rect.h <= 0
  ) {
    // PixiJS v8 + WebGPU crashes inside `BindGroupSystem._createBindGroup` (`Cannot read properties of null
    // (reading 'textureSource1')`) when a sub-texture is created with a zero-extent or NaN frame — the source
    // never finishes its GPU upload and the bind group lookup deref's a null. Guard against every degenerate rect
    // here so the renderer can simply skip the sprite when the source cell is empty.
    return undefined;
  }
  let bySource = cropCache.get(texture);
  if (!bySource) {
    bySource = new Map();
    cropCache.set(texture, bySource);
  }
  // Encode raw numeric values rather than rounding so cells with fractional widths (`w / divx` not an integer) get
  // their own cache slot.
  const key = `${rect.x}|${rect.y}|${rect.w}|${rect.h}`;
  let cached = bySource.get(key);
  if (!cached) {
    cached = new Texture({ source: texture.source, frame: new Rectangle(rect.x, rect.y, rect.w, rect.h) });
    bySource.set(key, cached);
  }
  return cached;
}

/**
 * Translate beatoraja's numeric blend code (LR2-compatible) into PixiJS v8's `BlendMode` string. Codes the
 * reference theme uses are `0` (normal) and `2` (additive — for keybeam glows, judge flashes, etc.); the rest
 * are surfaced for completeness and silently fall back to `'normal'` if the renderer doesn't honor them.
 */
export function blendCodeToPixi(code: number): BeatorajaPixiBlendMode {
  switch (code) {
    case 0:
    case 1:
      return 'normal';
    case 2:
      return 'add';
    case 3:
      return 'screen';
    case 4:
      return 'multiply';
    case 9:
      return 'erase';
    default:
      return 'normal';
  }
}
