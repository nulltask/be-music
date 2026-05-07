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
import {
  combineBeatorajaOffsets,
  isElementVisible,
  sampleBeatorajaDestination,
  ZERO_BEATORAJA_OFFSET,
  type BeatorajaDestinationGroup,
  type BeatorajaSkinOffsetValue,
} from '@be-music/beatoraja-skin';

export interface BeatorajaSpriteProps {
  visible: boolean;
  /**
   * Top-left x of the rendered rect in Pixi screen-space, after libGDX → Pixi Y-flip AND after
   * negative-width normalization. Beatoraja allows negative width (mirrors the texture
   * horizontally and extends the rect LEFT of the authored x); the props normalize that into a
   * positive {@link width} with the x shifted to the actual left edge. The {@link mirrorX}
   * flag preserves the mirror behavior for the consumer to apply via `scale.x`.
   */
  x: number;
  y: number;
  /** Always non-negative — mirroring is surfaced via {@link mirrorX} / {@link mirrorY}. */
  width: number;
  /** Always non-negative — mirroring is surfaced via {@link mirrorX} / {@link mirrorY}. */
  height: number;
  /**
   * `true` when the destination authored a NEGATIVE width (`w < 0`). Beatoraja mirrors the
   * texture horizontally in this case — the reference play7 skin uses it for the lane
   * background when scratch is on the right side. Renderers should multiply `scale.x` by `-1`
   * to honor the mirror; geometry-only renderers can ignore this and the texture will appear
   * at the correct position with its original orientation.
   */
  mirrorX: boolean;
  /** Companion to {@link mirrorX}. Negative-height destinations don't appear in stock skins but the flag is symmetric. */
  mirrorY: boolean;
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
  mirrorX: false,
  mirrorY: false,
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
  /**
   * Lookup `(offsetId) → user-adjustable offset shift`. Used by destinations whose `offsets[]`
   * lists `OFFSET_*` ids (judge offset slider, lanecover position, etc.). Returning `undefined`
   * defaults to no shift. Optional — hosts that don't expose offset adjustment can omit it.
   */
  resolveOffset?: (offsetId: number) => Readonly<BeatorajaSkinOffsetValue> | undefined;
}

/**
 * Merge the destination's singular `offset` and plural `offsets[]` into one id list for the
 * combiner. Beatoraja's `JSONSkinLoader.setDestination` does the same — appends the singular
 * value onto the array before passing it to `SkinObject.setOffsetID(int[])`. Returns
 * `undefined` when there's nothing to apply (no plural list AND no non-zero singular), so the
 * caller can short-circuit to {@link ZERO_BEATORAJA_OFFSET} without allocating.
 *
 * `0` (the singular default) is filtered out — it's the "no offset" sentinel, not a valid
 * `OFFSET_*` id. Values inside `offsets[]` are passed through as-is; the resolver decides how
 * to handle out-of-range entries.
 */
function collectOffsetIds(group: BeatorajaDestinationGroup): ReadonlyArray<number> | undefined {
  const hasPlural = group.offsets.length > 0;
  const hasSingular = group.offset !== 0;
  if (!hasPlural && !hasSingular) return undefined;
  if (hasPlural && !hasSingular) return group.offsets;
  if (!hasPlural && hasSingular) return [group.offset];
  // Both forms present — concat. Reference themes don't typically mix the two but the spec
  // treats them as additive, so we follow.
  return [...group.offsets, group.offset];
}

/**
 * Compute the sprite props for a destination group at the current frame. Returns the hidden state when:
 *
 * - the group's `op` codes don't pass against `activeOps`, or
 * - the parent `if` codes don't pass, or
 * - the group's timer hasn't started (and `timer > 0`), or
 * - the destination's keyframe sample returned `undefined` (animation past the end with `loop = -1`).
 *
 * `canvasHeight` is the skin's authored canvas height — needed to flip beatoraja's libGDX Y-UP
 * dst coordinates (origin at canvas bottom-left) into Pixi Y-DOWN (origin at canvas top-left).
 * Each renderer holds the canvasHeight as state (`view.height` for the play skin view, or the
 * stored `skin.h` for sibling layers like BgaLayer) and passes it through here.
 */
export function destinationToSpriteProps(
  group: BeatorajaDestinationGroup,
  context: BeatorajaRenderContext,
  canvasHeight: number,
): BeatorajaSpriteProps {
  if (!isElementVisible(group.ifCodes, context.activeOps)) return HIDDEN_PROPS;
  if (!isElementVisible(group.op, context.activeOps)) return HIDDEN_PROPS;

  const timerStart = group.timer === 0 ? 0 : context.getTimerStart(group.timer);
  if (timerStart === undefined) return HIDDEN_PROPS;

  const elapsed = context.nowMs - timerStart;
  if (elapsed < 0) return HIDDEN_PROPS;

  const keyframe = sampleBeatorajaDestination(group, elapsed);
  if (keyframe === undefined) return HIDDEN_PROPS;

  // Apply the destination's user-adjustable offset shifts on top of the sampled keyframe. Two
  // sources contribute, both reading the same `OFFSET_*` table:
  //   1. `offsets[]` (plural) — explicit list authored by the skin
  //   2. `offset` (singular) — convenience alias beatoraja's `JSONSkinLoader.setDestination`
  //      simply appends onto the array before calling `setOffsetID(int[])`. So `"offset":3` is
  //      semantically identical to `"offsets":[3]`.
  // Reference theme `play24.json` uses `"offset":3` (= `OFFSET_LIFT`) on every lane-chrome
  // element so the lift slider shifts them as a group. Until this fix the singular form was
  // parsed but never applied — lifts and other singular-offset shifts silently no-op'd.
  // `0` is the no-offset sentinel and is filtered out before resolving so it doesn't trip a
  // bogus lookup against an unrelated id.
  const combinedOffsetIds = collectOffsetIds(group);
  const offset =
    combinedOffsetIds !== undefined && context.resolveOffset !== undefined
      ? combineBeatorajaOffsets(combinedOffsetIds, context.resolveOffset)
      : ZERO_BEATORAJA_OFFSET;
  const alpha = clampUnit((keyframe.a / 255) * (offset.a / 255));
  if (alpha <= 0) return HIDDEN_PROPS;

  // Y-flip from beatoraja's libGDX Y-UP coordinates (origin at canvas bottom-left, with `(x, y)`
  // pointing at the rect's bottom-left corner) into Pixi Y-DOWN (origin at canvas top-left, with
  // `(x, y)` pointing at the sprite's top-left corner). The X axis is unchanged — both engines
  // grow X to the right.
  //
  //   beatoraja rect in Y-UP: bottom-left = (kx + ox, ky + oy), size = (kw + ow, kh + oh)
  //   Pixi rect top-left:     (kx + ox, canvasHeight - (ky + oy) - (kh + oh))
  //
  // The skin parser stays in Y-UP space; this renderer is the only place the flip happens.
  //
  // Negative width / height handling: beatoraja's `SkinObject.draw` passes signed `w`/`h` into
  // libGDX's `SpriteBatch.draw`, where a negative width spans `[x + w, x]` (mirroring the
  // texture and extending LEFT of the authored x). The reference play7 skin uses this for the
  // lane background when "Scratch Side = Right":
  //
  //     geometry.lanebg_x = geometry.lanes_x + geometry.lanes_w
  //     geometry.lanebg_w = -geometry.lanes_w
  //
  // We surface this through {@link BeatorajaSpriteProps.x} / {@link width} (always non-negative,
  // so consumers can `addressMode` / size sprites without sign-aware math) plus the
  // {@link mirrorX} flag (so renderers that care about the texture orientation can flip the
  // sprite via `scale.x = -1`). Without this normalization, downstream sprite-positioning code
  // (which wants to apply `center` anchor offsets via `props.width`) had to deal with negative
  // widths — and the play7 lane background painted at the wrong x in right-scratch mode.
  const rawWidth = keyframe.w + offset.w;
  const rawHeight = keyframe.h + offset.h;
  const mirrorX = rawWidth < 0;
  const mirrorY = rawHeight < 0;
  const width = Math.abs(rawWidth);
  const height = Math.abs(rawHeight);
  // libGDX bottom-left: (xRaw, yRaw) where xRaw = kx + ox, yRaw = ky + oy.
  // With negative width, the actual left edge in libGDX-X is xRaw + rawWidth.
  // With negative height, the actual TOP edge in libGDX-Y is yRaw + rawHeight (since libGDX Y
  // grows up, "top" is the highest y; but for negative height the rect grows downward from
  // yRaw, so the bottom in Y-UP is yRaw + rawHeight which becomes the lower bound of the
  // rect). Concretely: after Y-flip, Pixi-y = canvasH - yLibgdxBottom - heightAbs.
  const xLeft = mirrorX ? keyframe.x + offset.x + rawWidth : keyframe.x + offset.x;
  const yLibgdxBottom = mirrorY ? keyframe.y + offset.y + rawHeight : keyframe.y + offset.y;
  return {
    visible: true,
    x: xLeft,
    y: canvasHeight - yLibgdxBottom - height,
    width,
    height,
    mirrorX,
    mirrorY,
    alpha,
    tint: packRgbTint(keyframe.r, keyframe.g, keyframe.b),
    angle: keyframe.angle + offset.r,
    blendMode: blendCodeToPixi(group.blend),
  };
}

/**
 * Convert a raw skin-space rect (libGDX Y-UP, origin at canvas bottom-left) into a Pixi-space
 * rect (Y-DOWN, origin at canvas top-left). Use this for layers that consume raw skin rects
 * outside the `destination[]` keyframe pipeline — note lane geometry, marker prototypes, etc.
 */
export function flipRectToPixi(
  rect: { x: number; y: number; w: number; h: number },
  canvasHeight: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: rect.x,
    y: canvasHeight - rect.y - rect.h,
    w: rect.w,
    h: rect.h,
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
