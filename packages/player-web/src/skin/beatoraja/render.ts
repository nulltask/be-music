// Pure helpers for translating beatoraja `destination[]` samples into PixiJS `Sprite` props.
//
// Keeping the math pure (no Pixi imports here) means the test suite can exercise every keyframe interaction
// without touching a GPU. The actual `Sprite` mutation is a one-liner inside `scene/beatoraja/gameplay.ts`:
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

// Side-effect import: registers Pixi's advanced blend-mode filters (subtract, difference,
// color-burn, etc.) so `blendCodeToPixi` can hand back `'subtract'` for beatoraja's blend
// code 3 and `'difference'` for code 9 (audit 2.13). Standard modes ('add' / 'multiply' /
// 'screen' / 'erase' / 'normal') don't need this import; the registration is idempotent so
// re-importing from another module is harmless. Requires `useBackBuffer: true` at app init
// — see `scene/host.ts`.
import 'pixi.js/advanced-blend-modes';
import { Rectangle, Texture } from 'pixi.js';
import {
  applyBeatorajaOffsetAlpha,
  combineBeatorajaOffsets,
  evaluateBeatorajaLuaBoolean,
  evaluateBeatorajaLuaNumber,
  isElementVisible,
  sampleBeatorajaDestination,
  ZERO_BEATORAJA_OFFSET,
  type BeatorajaDestinationGroup,
  type BeatorajaLuaRuntimeContext,
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
export type BeatorajaPixiBlendMode = 'normal' | 'add' | 'multiply' | 'screen' | 'erase' | 'subtract' | 'difference';

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
  /** Runtime Lua context used when a skin authored Lua functions in BooleanProperty / TimerProperty fields. */
  lua?: BeatorajaLuaRuntimeContext;
  /**
   * Lookup `(offsetId) → user-adjustable offset shift`. Used by destinations whose `offsets[]`
   * lists `OFFSET_*` ids (judge offset slider, lanecover position, etc.). Returning `undefined`
   * defaults to no shift. Optional — hosts that don't expose offset adjustment can omit it.
   */
  resolveOffset?: (offsetId: number) => Readonly<BeatorajaSkinOffsetValue> | undefined;
  /**
   * Optional full gauge state for the spec-correct `pickBeatorajaGaugeNode` (audit 1.4).
   * Exposes `value / max / border / mode` together so the gauge renderer can compute the
   * correct per-cell node index. When omitted, the gauge renderer falls back to the legacy
   * percent-only path via `BeatorajaPlaySkinView`'s `resolveGaugePercent` option.
   */
  resolveGaugeState?: () => { value: number; max: number; border: number; mode: number } | undefined;
  /**
   * Optional audio hooks for `main_state.audio_play / audio_loop / audio_stop` calls fired
   * from BooleanProperty / TimerProperty / customEvent action closures at draw time.
   * ModernChic's `Root/customsound.lua` exposes functions like `m.fcSound` that watch a
   * fullcombo timer and call `audio_play` when it flips on; without these forwarded into the
   * per-frame Lua runtime context, those callbacks see a `nil` `audio_play` and either crash
   * or silently no-op. Hosts that don't want SE leave them undefined.
   */
  audioPlay?: (path: string, volume: number) => boolean | undefined;
  audioLoop?: (path: string, volume: number) => boolean | undefined;
  audioStop?: (path: string) => boolean | undefined;
  /**
   * Current mouse position in PIXI-SPACE coordinates (top-left origin, y-down). Used by the
   * `mouseRect` hover-visibility gate — destinations with an authored `mouseRect` only paint
   * when the cursor is inside the rect (relative to the destination's libGDX bottom-left).
   * Mirrors upstream `SkinObject.java:513-517`'s `mouseRect.contains(mouseX - region.x,
   * mouseY - region.y)` check, with X/Y converted from libGDX Y-UP into Pixi Y-DOWN at the
   * call site.
   *
   * `undefined` (or omitted) = no hover gate applied — destinations with `mouseRect` paint
   * unconditionally. Hosts that want the upstream-faithful hover-visibility behavior pass
   * the live cursor coords every frame.
   */
  mousePosition?: { x: number; y: number };
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
  if (group.draw !== undefined) {
    const visible =
      typeof group.draw === 'number'
        ? context.activeOps.has(group.draw)
        : evaluateBeatorajaLuaBoolean(group.draw, context.lua);
    if (!visible) return HIDDEN_PROPS;
  } else if (!isElementVisible(group.op, context.activeOps)) {
    return HIDDEN_PROPS;
  }

  const timerStart =
    group.timerFunction !== undefined
      ? timerStartFromLuaFunction(group.timerFunction, context)
      : group.timer === 0
        ? 0
        : context.getTimerStart(group.timer);
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
  // Per-step alpha math — mirrors `SkinObject.prepareColor` (`SkinObject.java:391-401, 424-430`):
  //
  //     for (off in offsets) {
  //         color.a += off.a / 255;
  //         color.a = clamp(color.a, 0, 1);
  //     }
  //
  // The clamp runs AFTER each offset, so saturating intermediate steps "burn off" the excess
  // before the next delta is applied. A plain sum-then-clamp is observably equivalent only
  // when no intermediate accumulation crosses [0, 1] — most skins author a single offset and
  // satisfy that condition, but skins chaining brightness + flicker offsets need the per-step
  // semantics to render correctly. See `applyBeatorajaOffsetAlpha` for the full derivation.
  const alpha =
    combinedOffsetIds !== undefined && context.resolveOffset !== undefined
      ? applyBeatorajaOffsetAlpha(keyframe.a / 255, combinedOffsetIds, context.resolveOffset)
      : clampUnit(keyframe.a / 255);
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
  // Center-anchored offset application — mirrors beatoraja's `SkinObject.prepareDraw`:
  //
  //     if (!relative) {
  //         region.x += off.x - off.w / 2;
  //         region.y += off.y - off.h / 2;
  //     }
  //     region.width  += off.w;
  //     region.height += off.h;
  //
  // The rect grows around its CENTER, not its top-left corner. Authors lean on this for
  // lanecover / hidden-cover slabs that "breathe" without re-anchoring as their height
  // changes — without the centering shift the cover would slide upward as the user widens
  // it. The previous implementation skipped the `- off.w / 2` / `- off.h / 2` term and
  // anchored every expansion to the top-left, which made the lanecover edge drift visibly
  // when the user dragged the slider.
  //
  // `group.relative = true` opts out — beatoraja's `JsonPlaySkinObjectLoader` sets this on
  // per-digit judgement-detail numbers so they stay anchored to their authored slot
  // position rather than re-centering when an offset.w/h is applied to the parent number's
  // box. Most destinations leave `relative` at `false` (the default), so the centering
  // applies broadly.
  //
  // libGDX bottom-left: (xRaw, yRaw) where xRaw = kx + ox + (relative ? 0 : -ow/2),
  // yRaw = ky + oy + (relative ? 0 : -oh/2).
  // With negative width, the actual left edge in libGDX-X is xRaw + rawWidth.
  // With negative height, the actual TOP edge in libGDX-Y is yRaw + rawHeight (since libGDX Y
  // grows up, "top" is the highest y; but for negative height the rect grows downward from
  // yRaw, so the bottom in Y-UP is yRaw + rawHeight which becomes the lower bound of the
  // rect). Concretely: after Y-flip, Pixi-y = canvasH - yLibgdxBottom - heightAbs.
  const centerShiftX = group.relative ? 0 : -offset.w / 2;
  const centerShiftY = group.relative ? 0 : -offset.h / 2;
  const baseX = keyframe.x + offset.x + centerShiftX;
  const baseY = keyframe.y + offset.y + centerShiftY;
  const xLeft = mirrorX ? baseX + rawWidth : baseX;
  const yLibgdxBottom = mirrorY ? baseY + rawHeight : baseY;

  // Mouse-hover visibility gate (audit C-12). Mirrors upstream `SkinObject.java:513-517`:
  //
  //     if (mouseRect != null && !mouseRect.contains(mouseX - region.x, mouseY - region.y)) {
  //         draw = false;
  //         return;
  //     }
  //
  // The rect's `(x, y, w, h)` are in libGDX-Y-UP coords RELATIVE to the destination's
  // (post-offset) `region.x / region.y` (= bottom-left of the rendered rect). Convert the
  // host's Pixi-space mouse position into libGDX coords (X same; Y = canvasH - pixiY) and
  // check the relative position against the rect.
  if (group.mouseRect !== undefined && context.mousePosition !== undefined) {
    const mouseLibgdxX = context.mousePosition.x;
    const mouseLibgdxY = canvasHeight - context.mousePosition.y;
    const relativeX = mouseLibgdxX - xLeft;
    const relativeY = mouseLibgdxY - yLibgdxBottom;
    const { x: mrX, y: mrY, w: mrW, h: mrH } = group.mouseRect;
    if (relativeX < mrX || relativeX > mrX + mrW || relativeY < mrY || relativeY > mrY + mrH) {
      return HIDDEN_PROPS;
    }
  }
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
    // Negate the authored angle to convert libGDX (Y-UP, CCW-positive) into Pixi (Y-DOWN,
    // CW-positive). The Y-flip of the rect's POSITION (`canvasHeight - yLibgdxBottom -
    // height` above) is just a translation; it doesn't change the handedness of rotations
    // applied to the sprite itself. Without this negation every authored rotation runs
    // visually backwards — most visible on ModernChic Play's `attack.lua` 14 keyframe attack
    // motion (was rotating the wrong way), 7K-skin scratch wheels, and Select-scene focus
    // rings (audit 1.8).
    angle: -(keyframe.angle + offset.r),
    blendMode: blendCodeToPixi(group.blend),
  };
}

function timerStartFromLuaFunction(
  timerFunction: NonNullable<BeatorajaDestinationGroup['timerFunction']>,
  context: BeatorajaRenderContext,
): number | undefined {
  const value = evaluateBeatorajaLuaNumber(timerFunction, context.lua);
  if (value === undefined || value < 0) return undefined;
  return value / 1000;
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

/**
 * StretchType enum — mirrors `bms.player.beatoraja.skin.StretchType`. Listed for documentation;
 * authors generally cite the integer code (0..10) rather than the symbolic name.
 *
 * - `0` STRETCH — fill the dst rect, ignore aspect ratio (default).
 * - `1` FIT_INNER — preserve aspect, scale to FIT INSIDE dst rect (smaller axis wins).
 * - `2` FIT_OUTER — preserve aspect, scale to COVER dst rect entirely (larger axis wins).
 * - `3` FIT_OUTER_TRIMMED — like FIT_OUTER but the source texture is cropped to dst rect.
 * - `4` FIT_WIDTH — match dst width, height scales proportionally.
 * - `5` FIT_WIDTH_TRIMMED — match dst width, source cropped to dst height.
 * - `6` FIT_HEIGHT — match dst height, width scales proportionally.
 * - `7` FIT_HEIGHT_TRIMMED — match dst height, source cropped to dst width.
 * - `8` NO_EXPANDING — preserve aspect, scale down only when source exceeds dst (otherwise NO_RESIZE).
 * - `9` NO_RESIZE — keep source size verbatim, recenter on dst rect.
 * - `10` NO_RESIZE_TRIMMED — keep source size verbatim, source cropped to dst rect.
 *
 * The TRIMMED variants (3 / 5 / 7 / 10) require modifying the texture's source UVs — the renderer
 * crops to the dst rect rather than scaling. {@link applyBeatorajaStretchRect} returns the same
 * dst geometry as the non-trimmed variant for those modes, plus a flag instructing the caller
 * to crop the texture; renderers that don't support per-call source cropping degrade to the
 * non-trimmed approximation (= no visible change vs FIT_OUTER / FIT_WIDTH / FIT_HEIGHT /
 * NO_RESIZE respectively).
 */
export const BEATORAJA_STRETCH = {
  STRETCH: 0,
  FIT_INNER: 1,
  FIT_OUTER: 2,
  FIT_OUTER_TRIMMED: 3,
  FIT_WIDTH: 4,
  FIT_WIDTH_TRIMMED: 5,
  FIT_HEIGHT: 6,
  FIT_HEIGHT_TRIMMED: 7,
  NO_EXPANDING: 8,
  NO_RESIZE: 9,
  NO_RESIZE_TRIMMED: 10,
} as const;

export interface BeatorajaStretchedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * `true` when the stretch mode wants the texture cropped to the returned rect (TRIMMED
   * variants). The non-trimmed variants leave this `false`. Renderers that don't support
   * per-call source cropping can ignore this flag — the geometry alone is the FIT_OUTER /
   * FIT_WIDTH / FIT_HEIGHT / NO_RESIZE result for the matching trimmed mode.
   */
  trim: boolean;
}

/**
 * Compute the post-stretch rect for a given destination rect + source-sprite natural
 * dimensions. Mirrors beatoraja's `StretchType.stretch(rectangle, image, image)` —
 * `StretchType` mutates `rectangle` in place; we return a new record. The Y-flip / mirror /
 * angle math is unaffected (this only resizes / recenters within the same Pixi space).
 *
 * Behavior per mode:
 *
 *   - **STRETCH (0)** — pass-through.
 *   - **FIT_INNER (1) / FIT_OUTER (2 / 3) / NO_EXPANDING (8)** — scale uniformly, recenter.
 *   - **FIT_WIDTH (4 / 5)** — match dst width, height = sourceH × dstW / sourceW; recenter.
 *   - **FIT_HEIGHT (6 / 7)** — match dst height, width = sourceW × dstH / sourceH; recenter.
 *   - **NO_RESIZE (9 / 10)** — keep source dimensions, recenter.
 *
 * Source dimensions ≤ 0 fall through to STRETCH (degenerate texture; no aspect to preserve).
 */
export function applyBeatorajaStretchRect(
  dst: { x: number; y: number; width: number; height: number },
  source: { width: number; height: number },
  stretch: number,
): BeatorajaStretchedRect {
  const sw = source.width;
  const sh = source.height;
  if (stretch <= BEATORAJA_STRETCH.STRETCH || sw <= 0 || sh <= 0) {
    return { ...dst, trim: false };
  }
  const cx = dst.x + dst.width * 0.5;
  const cy = dst.y + dst.height * 0.5;
  const fitWidth = (w: number): { x: number; width: number } => {
    return { x: cx - w * 0.5, width: w };
  };
  const fitHeight = (h: number): { y: number; height: number } => {
    return { y: cy - h * 0.5, height: h };
  };
  switch (stretch) {
    case BEATORAJA_STRETCH.FIT_INNER: {
      // Pick the SMALLER scale so the source fits inside the dst rect.
      const scaleX = dst.width / sw;
      const scaleY = dst.height / sh;
      if (scaleX <= scaleY) {
        const { y, height } = fitHeight(sh * scaleX);
        return { x: dst.x, y, width: dst.width, height, trim: false };
      }
      const { x, width } = fitWidth(sw * scaleY);
      return { x, y: dst.y, width, height: dst.height, trim: false };
    }
    case BEATORAJA_STRETCH.FIT_OUTER:
    case BEATORAJA_STRETCH.FIT_OUTER_TRIMMED: {
      // Pick the LARGER scale so the source covers the dst rect.
      const scaleX = dst.width / sw;
      const scaleY = dst.height / sh;
      const trim = stretch === BEATORAJA_STRETCH.FIT_OUTER_TRIMMED;
      if (scaleX >= scaleY) {
        const { y, height } = fitHeight(sh * scaleX);
        return { x: dst.x, y, width: dst.width, height, trim };
      }
      const { x, width } = fitWidth(sw * scaleY);
      return { x, y: dst.y, width, height: dst.height, trim };
    }
    case BEATORAJA_STRETCH.FIT_WIDTH:
    case BEATORAJA_STRETCH.FIT_WIDTH_TRIMMED: {
      const trim = stretch === BEATORAJA_STRETCH.FIT_WIDTH_TRIMMED;
      const { y, height } = fitHeight((sh * dst.width) / sw);
      return { x: dst.x, y, width: dst.width, height, trim };
    }
    case BEATORAJA_STRETCH.FIT_HEIGHT:
    case BEATORAJA_STRETCH.FIT_HEIGHT_TRIMMED: {
      const trim = stretch === BEATORAJA_STRETCH.FIT_HEIGHT_TRIMMED;
      const { x, width } = fitWidth((sw * dst.height) / sh);
      return { x, y: dst.y, width, height: dst.height, trim };
    }
    case BEATORAJA_STRETCH.NO_EXPANDING: {
      // Scale down only when the source exceeds the dst — otherwise leave at source dimensions.
      const scale = Math.min(1, dst.width / sw, dst.height / sh);
      const { x, width } = fitWidth(sw * scale);
      const { y, height } = fitHeight(sh * scale);
      return { x, y, width, height, trim: false };
    }
    case BEATORAJA_STRETCH.NO_RESIZE:
    case BEATORAJA_STRETCH.NO_RESIZE_TRIMMED: {
      const trim = stretch === BEATORAJA_STRETCH.NO_RESIZE_TRIMMED;
      const { x, width } = fitWidth(sw);
      const { y, height } = fitHeight(sh);
      return { x, y, width, height, trim };
    }
    default:
      // Unknown stretch code → fall through to STRETCH for defensive sanity. Keeps the renderer
      // from blowing up on a future enum addition.
      return { ...dst, trim: false };
  }
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
 * Translate beatoraja's numeric blend code (LR2-compatible) into PixiJS v8's `BlendMode` string.
 * Mapping:
 *
 *   - `0`, `1` → `'normal'` — standard alpha compositing.
 *   - `2` → `'add'` — additive (keybeam glows, judge flashes, etc.).
 *   - `3` → `'subtract'` — beatoraja's `GL_FUNC_SUBTRACT` true subtract. Requires the
 *     advanced-blend-modes import (registered at the top of this file) and
 *     `useBackBuffer: true` at app init. Used by skins that paint dim / shadow overlays —
 *     the previous mapping was `'screen'`, which is the OPPOSITE operation (brighten-only).
 *   - `4` → `'multiply'` — beatoraja's `(GL_ZERO, GL_SRC_COLOR)`. Pixi's `'multiply'` is
 *     close (`(GL_DST_COLOR, GL_ONE_MINUS_SRC_ALPHA)`); halo-on-feathered-edges is the only
 *     visible drift, and standard multiply matches the dominant use case.
 *   - `9` → `'difference'` — beatoraja's `(GL_ONE_MINUS_DST_COLOR, GL_ZERO)` (`dst' = (1-dst)
 *     * src.rgb`) doesn't have an exact Pixi equivalent. `'difference'` (`|src - dst|`) is the
 *     closest visual approximation — both produce the "invert-feeling" effect that authors
 *     reach for blend=9 to express (most prominently ModernChic Play
 *     `Play/lua/sp/detailinfo/bgaareainfo.lua:650`). The previous mapping was `'erase'`,
 *     which was a fundamentally different operation (alpha hole-punch).
 *
 * Codes outside this set silently fall back to `'normal'`.
 */
export function blendCodeToPixi(code: number): BeatorajaPixiBlendMode {
  switch (code) {
    case 0:
    case 1:
      return 'normal';
    case 2:
      return 'add';
    case 3:
      return 'subtract';
    case 4:
      return 'multiply';
    case 9:
      return 'difference';
    default:
      return 'normal';
  }
}
