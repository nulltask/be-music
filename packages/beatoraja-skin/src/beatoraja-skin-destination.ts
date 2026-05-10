// Strict-typed normalization for beatoraja `destination[]` entries.
//
// Each entry binds an image (via `id`, matching `image[]`) to a list of `dst[]` keyframes. The renderer
// interpolates between consecutive keyframes by `time` to drive position / size / color / alpha animations. Most
// fields default to "no change" so an entry with `dst:[{time:0, x:0, y:0, w:100, h:100}]` is enough to render a
// static rectangle.

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';
import { isBeatorajaLuaFunctionValue, type BeatorajaLuaFunctionValue } from './beatoraja-skin-lua.ts';

export type BeatorajaBooleanPropertyRef = number | BeatorajaLuaFunctionValue;

export interface BeatorajaDestinationKeyframe {
  /** Milliseconds since `timer` started counting. Frame 0 (`time = 0`) anchors the animation. */
  time: number;
  /** Top-left position in skin-pixel units. */
  x: number;
  y: number;
  /** Display rectangle size. */
  w: number;
  h: number;
  /** Color tint (0..255 each). 255 / 255 / 255 means "untinted". */
  r: number;
  g: number;
  b: number;
  /** Alpha 0..255 (NOT 0..1). 255 means fully opaque. */
  a: number;
  /** Rotation in degrees. 360 = full revolution. */
  angle: number;
  /**
   * Easing curve applied to the interpolation from THIS keyframe to the next. Beatoraja inherits
   * LR2's `acc` semantics (`0` = linear, `1` = accelerate / slow-start, `2` = decelerate /
   * fast-start, `3` = step / discontinuous). Defaults to `0`. The renderer reads this field on the
   * "from" keyframe of each interpolation segment.
   */
  acc: number;
}

export interface BeatorajaDestinationGroup {
  /** Image id this destination targets. Match against {@link BeatorajaImageElement.id}. */
  id: BeatorajaImageId;
  /**
   * Timer reference whose elapsed time drives the keyframe interpolation. `0` = scene start. The renderer reads
   * the runtime timer table and computes `elapsed = now - timerStart[timer]` before sampling keyframes.
   */
  timer: number;
  /** Runtime Lua timer function. When present, it supplies the timer start directly and takes precedence over `timer`. */
  timerFunction?: BeatorajaLuaFunctionValue;
  /**
   * Loop offset in milliseconds. `-1` hides the element after the last keyframe; `0` (the
   * default — matches beatoraja's `JsonSkin.Destination.loop` Java int default) loops back to
   * keyframe 0 once the last keyframe's time elapses; positive values loop to that time-stamp.
   *
   * Beatoraja's default of `0` matters for static (length-1) destinations: with `loop = 0`
   * the wrap period collapses to `endtime - 0 = 0` and the picker holds the head frame
   * indefinitely. With `loop = -1` the same length-1 dst would hide for every `t > 0` (one-
   * frame wink). Authors who want "wink and hide" must opt in by writing `loop: -1`
   * explicitly — matching beatoraja's behavior, where the most common static-anchor pattern
   * (a single keyframe with no `loop` field) just paints continuously.
   */
  loop: number;
  /**
   * Singular form of {@link offsets} — a single user-adjustable offset id (one of `SkinProperty.OFFSET_*`,
   * e.g. `3` = `OFFSET_LIFT`, `4` = `OFFSET_LANECOVER`). Beatoraja's `JSONSkinLoader.setDestination` simply
   * appends this onto the `offsets[]` array before calling `SkinObject.setOffsetID(int[])`, so the singular
   * and plural forms are equivalent — authors use whichever shape is more convenient. The renderer treats
   * `offset` and `offsets[]` symmetrically when summing position shifts.
   *
   * **Z-order:** beatoraja draws destinations in the order they appear in the JSON's `destination[]`
   * array. There is NO sort by `offset` — earlier drafts of this player misread `offset` as a z-layer
   * and produced incorrect layering for skins that use the singular form on lane-chrome elements.
   * Declaration order is the only z-source; see {@link declarationOrder}.
   *
   * `0` (the default) means "no offset reference" and is omitted from the offset sum at render time.
   */
  offset: number;
  /**
   * Op-codes that gate visibility (group level, AND-merged with each parent `if`). Negative codes mean negation.
   */
  op: ReadonlyArray<number>;
  /** Optional `draw` BooleanProperty. Beatoraja evaluates this instead of `op` when authored. */
  draw?: BeatorajaBooleanPropertyRef;
  /**
   * Blend mode. 0 = normal alpha, 1 = additive, 2 = multiply, etc. Beatoraja uses LR2-compatible numbering.
   */
  blend: number;
  /**
   * Filter flag. `1` enables bilinear filtering on scaling. Defaults to `0` (nearest neighbour).
   */
  filter: number;
  /**
   * Rotation pivot anchor — a 0-8 grid mapping to the 9 corner / midpoint points of the destination rect:
   *
   *   0 ↖ top-left      1 ↑ top-center      2 ↗ top-right
   *   3 ← middle-left   4 × middle (def.)   5 → middle-right
   *   6 ↙ bottom-left   7 ↓ bottom-center   8 ↘ bottom-right
   *
   * Without this, sprites with non-zero `angle` rotate around the wrong point. Defaults to `0`
   * (matches `JSONSkinLoader.setDestination`'s `dst.center` field — Java zero-default).
   */
  center: number;
  /**
   * User-adjustable offset ids the renderer additively applies before painting. Each id maps to a
   * `(x, y, w, h, r, a)` 6-tuple in the skin's offset table (`SkinProperty.OFFSET_*`); enabled
   * skins let the user shift judge / lanecover / notes positions via in-game sliders. The
   * cumulative effect is `dst.x += sum(offset[id].x)` etc.
   *
   * Empty when the author didn't author offsets on this destination. Defaults to `[]`.
   */
  offsets: ReadonlyArray<number>;
  /** `if` codes from any wrapping conditional group, AND-merged with `op`. */
  ifCodes: ReadonlyArray<number>;
  /**
   * Ordered keyframe list. Always at least one entry — entries with no `dst[]` are dropped at normalization time.
   */
  dst: ReadonlyArray<BeatorajaDestinationKeyframe>;
  /**
   * Element-level easing curve. Mirrors beatoraja's `SkinObject.acc` class field (audit 1.5).
   * Java's `setDestination` runs `if (this.acc == 0) this.acc = anim.acc;` per keyframe — the
   * first non-zero value across the whole keyframe list wins, and once set the field is sticky
   * (subsequent keyframes never overwrite). The renderer's `getRate()` reads this single value
   * for every segment, so the entire animation runs on ONE easing curve, not a per-segment
   * curve.
   *
   * The previous TS implementation applied easing per-segment using the FROM keyframe's `acc`.
   * That diverged from beatoraja in two cases: (1) the first segment lost the curve when
   * authors omit acc on keyframe 0 and add it on keyframe 1 (common in fade-in choreography);
   * (2) different non-zero acc values across keyframes produced a hybrid curve in our impl
   * but resolved to the first non-zero value in beatoraja. Both forms appear in ModernChic
   * and GdbG community skins, so the per-element lock is the correct interpretation.
   *
   * The keyframe-level `acc` (`BeatorajaDestinationKeyframe.acc`) is preserved for round-trip
   * and debugging — the renderer doesn't consult it any more.
   */
  acc: number;
  /**
   * Stretch mode — mirrors beatoraja's `StretchType` enum (0..10). Controls how the source
   * sprite's natural dimensions are mapped onto the destination rect. Default `0` (= STRETCH,
   * free-stretch ignoring aspect ratio); non-zero values preserve aspect ratio in various ways
   * (fit-inside, fit-outside, fit-width, fit-height, no-resize, etc.). The renderer consults
   * this when assigning sprite geometry — see `applyBeatorajaStretchRect` in
   * `@be-music/player-web/beatoraja-render`.
   *
   * Beatoraja's `JSONSkinLoader.setDestination` reads `stretch` from each `dst[]` keyframe and
   * calls `obj.setStretch(StretchType.values()[anim.stretch])` only when `>= 0`. Since each
   * call overwrites the field, the LAST authored keyframe wins. Our parser likewise picks the
   * last non-default value so multi-keyframe authoring stays consistent.
   */
  stretch: number;
  /**
   * Custom mouse-hover rectangle (audit C-12). Beatoraja's `JsonSkinObjectLoader.java:723-725`
   * parses `dst.mouseRect` as a `{x, y, w, h}` Rect object (NOT an integer index — the
   * previous TS impl read it as `numberField(f, 'mouseRect', -1)` which silently dropped the
   * authored coords).
   *
   * Upstream `SkinObject.java:513-517` uses this rect as a HOVER VISIBILITY GATE in
   * `prepare()`:
   *
   *     if (mouseRect != null && !mouseRect.contains(mouseX - region.x, mouseY - region.y)) {
   *         draw = false;
   *         return;
   *     }
   *
   * The rect's `(x, y, w, h)` are in libGDX-Y-UP coords RELATIVE to the destination's
   * `region.x / region.y` (= bottom-left of the rendered rect). When the cursor is inside
   * the relative rect, the destination paints normally; when outside, it hides. Used for
   * tooltip-style chrome (e.g. the result-screen "next stage" hover button) that appears
   * only when the player's cursor is over a specific area.
   *
   * `undefined` means "no gate, always paint" — same as upstream's `mouseRect == null`.
   */
  mouseRect: { x: number; y: number; w: number; h: number } | undefined;
  /**
   * Mirrors beatoraja's `SkinObject.relative` flag. Controls how `offsets[]` reshape the rect:
   *
   *   - `false` (default) — offset is **center-anchored**. The rect grows around its center:
   *     `x += offset.x - offset.w / 2; y += offset.y - offset.h / 2; w += offset.w; h += offset.h`.
   *     Authors expect this for lanecover / hidden-cover / sprite expansions where the visual
   *     should "breathe" around the same focal point as the original rect.
   *   - `true` — offset is **anchor-relative**. The rect grows from its top-left corner:
   *     `x += offset.x; y += offset.y; w += offset.w; h += offset.h`.
   *     Set by `JsonPlaySkinObjectLoader` only on per-digit numbers inside the judgement-detail
   *     value object — those digits are positioned by their own offset and shouldn't re-center
   *     when the parent's offset.w/h grows.
   *
   * Authored as `relative: true` on the JSON record. Most destinations omit it (= `false`).
   */
  relative: boolean;
  /**
   * Author-given declaration order. Two destinations targeting the same image but emitted at different points in
   * the source file render in source order; this field preserves that.
   */
  declarationOrder: number;
}

/**
 * Convert a permissive `destination[]` array into a normalized list. Entries without a usable `id` or `dst[]` are
 * dropped; all other fields take the documented defaults when missing.
 *
 * `activeOps` carries the skin-config-level op set (selected layout options, skin-config picks). It is used to
 * resolve INNER if-gated keyframe alternatives — beatoraja's loader picks ONE alternative per keyframe at load
 * time based on the user's selected skin options. When omitted, only the catch-all (empty `if`) alternative is
 * matched (with last-alternative fallback if no catch-all exists), which matches the default-layout case for skins
 * that don't depend on configured options.
 */
export function normalizeBeatorajaDestinations(
  input: unknown,
  activeOps?: ReadonlySet<number>,
): BeatorajaDestinationGroup[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaDestinationGroup[] = [];
  const ops = activeOps ?? EMPTY_OP_SET;
  for (let i = 0; i < flattened.length; i += 1) {
    const normalized = normalizeOne(flattened[i], i, ops);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

const EMPTY_OP_SET: ReadonlySet<number> = new Set();

function normalizeOne(
  entry: NormalizedElement,
  declarationOrder: number,
  activeOps: ReadonlySet<number>,
): BeatorajaDestinationGroup | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  const rawDst = f.dst;
  if (!Array.isArray(rawDst) || rawDst.length === 0) return undefined;

  const keyframes = normalizeKeyframes(rawDst, activeOps);
  if (keyframes.length === 0) return undefined;
  const timerFunction = isBeatorajaLuaFunctionValue(f.timer) ? f.timer : undefined;
  const draw = booleanPropertyField(f.draw);

  return {
    id,
    timer: numberField(f, 'timer', 0),
    ...(timerFunction !== undefined ? { timerFunction } : {}),
    // Default to `0` matching beatoraja's Java int default — see field doc above for why this
    // matters for static (length-1) destinations.
    loop: numberField(f, 'loop', 0),
    offset: numberField(f, 'offset', 0),
    op: normalizeOpArray(f.op),
    ...(draw !== undefined ? { draw } : {}),
    blend: numberField(f, 'blend', 0),
    filter: numberField(f, 'filter', 0),
    center: clampCenter(numberField(f, 'center', 0)),
    offsets: normalizeOpArray(f.offsets),
    ifCodes: entry.ifCodes,
    dst: keyframes,
    // Element-level easing: first non-zero acc across all keyframes wins (matches beatoraja's
    // `if (this.acc == 0) this.acc = acc` per-keyframe accumulator inside SkinObject.setDestination).
    acc: pickElementAcc(keyframes),
    // Stretch is per-element in beatoraja (the loader's `setStretch` call overwrites the field
    // each keyframe; last-write wins). The JSON / Lua entry sometimes places it on the outer
    // record, sometimes on individual keyframes; we read whichever the author chose, walking the
    // keyframes for the LAST non-default value.
    stretch: pickStretchMode(f, rawDst),
    mouseRect: parseMouseRectField(f.mouseRect),
    // `relative` flips offset application from center-anchored to anchor-relative — see field
    // doc. Boolean parse: any truthy authored value (including the literal `1` skins
    // sometimes emit) flips it on.
    relative: booleanField(f, 'relative', false),
    declarationOrder,
  };
}

function booleanField(record: Readonly<Record<string, unknown>>, key: string, fallback: boolean): boolean {
  const v = record[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v !== 0;
  return fallback;
}

/**
 * Walk the keyframe list and return the first non-zero `acc` value, mirroring beatoraja's
 * `if (this.acc == 0) this.acc = acc` accumulator. Returns `0` (linear) when every keyframe
 * authored acc=0 / omitted acc.
 */
function pickElementAcc(keyframes: ReadonlyArray<BeatorajaDestinationKeyframe>): number {
  for (const k of keyframes) {
    if (k.acc !== 0) return k.acc;
  }
  return 0;
}

/**
 * Read the destination's `stretch` (StretchType) integer. Mirrors beatoraja's
 * `JSONSkinLoader.setDestination` which iterates the `dst[]` array and applies
 * `obj.setStretch(StretchType.values()[anim.stretch])` whenever `anim.stretch >= 0`. Since
 * each call overwrites the previous, the LAST keyframe with a valid stretch value wins.
 *
 * Skins occasionally put `stretch` on the outer destination record instead of per-keyframe
 * (Lua-driven skins especially); we honor either form. Default `0` = `STRETCH` = free-stretch
 * ignoring aspect ratio, matching beatoraja's enum-zero default.
 */
function pickStretchMode(outer: Readonly<Record<string, unknown>>, dst: ReadonlyArray<unknown>): number {
  const fromOuter = outer.stretch;
  let resolved = typeof fromOuter === 'number' && Number.isFinite(fromOuter) && fromOuter >= 0 ? fromOuter : 0;
  // Walk keyframes; last non-default wins.
  for (const entry of dst) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const v = (entry as Readonly<Record<string, unknown>>).stretch;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      resolved = v;
    }
  }
  return resolved;
}

/**
 * Clamp a `center` value to its valid 0..9 range. Out-of-range falls back to `0` (= the `(0.5,
 * 0.5)` default origin in beatoraja, mid-point of the rect). Note the range is `0..9`, NOT
 * `0..8`: beatoraja's `SkinObject.CENTERX/CENTERY` arrays are 10-element (`0` = default-center
 * + a 1-indexed 9-cell grid), so the valid input range carries one more entry than LR2's `0..8`
 * convention. See `centerToAnchor` for the full mapping.
 */
function clampCenter(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const v = Math.trunc(value);
  if (v < 0 || v > 9) return 0;
  return v;
}

/**
 * User-adjustable destination offset, indexed by `OFFSET_*` ids on the skin's offset table.
 * Each field defaults to `0` / `255` (alpha) when the user hasn't moved the matching slider.
 * Beatoraja's reference theme exposes 5 base offsets (LIFT, LANECOVER, ALL, NOTES_1P,
 * JUDGE_1P, JUDGEDETAIL_1P) plus author-defined `OFFSET_*` slots.
 */
export interface BeatorajaSkinOffsetValue {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation delta in degrees. */
  r: number;
  /**
   * Alpha additive delta in `[-255, 255]`. Applied as `keyframe.a / 255 + offset.a / 255`
   * (clamped to `[0, 1]`), mirroring beatoraja's `SkinObject.prepareColor`:
   *
   *     float a = color.a + (off.a / 255.0f);
   *     a = a > 1 ? 1 : (a < 0 ? 0 : a);
   *     color.a = a;
   *
   * The previous TS impl multiplied `keyframe.a` by `offset.a / 255` with a default of `255`
   * (= no scaling), which was equivalent to upstream only when offset.a stayed at its
   * default. Skins authoring `offset.a = 64` to lighten an element by `64/255 ≈ 0.25` saw a
   * `0.25` MULTIPLIER instead of a `+0.25` ADDITION, producing nearly invisible elements
   * (`alpha = 1.0 * 0.25 = 0.25` instead of clamp(`1.0 + 0.25`) = 1.0).
   *
   * Default `0` matches Java's `float` field initialization — most destinations leave `a`
   * at the default and the offset has no alpha effect. Skins author non-zero values to
   * brighten / darken elements via the offset slider chain.
   */
  a: number;
}

/** Default offset = no displacement, no alpha shift. Same shape `MainStateAccessor.offset` returns. */
export const ZERO_BEATORAJA_OFFSET: Readonly<BeatorajaSkinOffsetValue> = Object.freeze({
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  r: 0,
  a: 0,
});

/**
 * Sum a destination's `offsets[]` ids into a single (x, y, w, h, r, a) shift. The renderer
 * applies this on top of the keyframe-sampled position. `resolve` looks up each id's current
 * value via the host (typically `state.getOffsetValue(id)` on the Java side); returning
 * `undefined` for an unknown id treats it as `ZERO_BEATORAJA_OFFSET` (no shift).
 *
 * The `x / y / w / h / r` axes are pure addition with no per-step clamp — accumulation
 * order doesn't matter. **The returned `a` is a RAW SUM and is NOT upstream-faithful for
 * rendering; use {@link applyBeatorajaOffsetAlpha} for the alpha output.** Upstream's
 * `SkinObject.prepareColor()` (`SkinObject.java:391-401, 424-430`) clamps after EACH offset
 * application, which differs from a single final clamp whenever any intermediate step
 * saturates. The `.a` field is kept on the return type for back-compat but should not be
 * fed into Pixi alpha directly.
 */
export function combineBeatorajaOffsets(
  ids: ReadonlyArray<number>,
  resolve: (offsetId: number) => Readonly<BeatorajaSkinOffsetValue> | undefined,
): Readonly<BeatorajaSkinOffsetValue> {
  if (ids.length === 0) return ZERO_BEATORAJA_OFFSET;
  let x = 0;
  let y = 0;
  let w = 0;
  let h = 0;
  let r = 0;
  let aSum = 0; // raw sum — see `applyBeatorajaOffsetAlpha` for the upstream-faithful clamp.
  for (const id of ids) {
    const v = resolve(id);
    if (v === undefined) continue;
    x += v.x;
    y += v.y;
    w += v.w;
    h += v.h;
    r += v.r;
    aSum += v.a;
  }
  return { x, y, w, h, r, a: aSum };
}

/**
 * Apply each offset's `a` delta to a base alpha in sequence, clamping after every step.
 * Returns the final alpha in `[0, 1]`.
 *
 * Mirrors upstream `SkinObject.prepareColor()` (`SkinObject.java:391-401, 424-430`):
 *
 *     for (SkinOffset off : this.off) {
 *         float a = color.a + (off.a / 255.0f);
 *         a = a > 1 ? 1 : (a < 0 ? 0 : a);
 *         color.a = a;
 *     }
 *
 * Per-step clamping differs from a single final clamp whenever any intermediate accumulation
 * saturates. Concrete example: base 0.5 + offsets `[+200, -100, +50]`:
 *
 *   - Per-step (upstream): 0.5 + 0.78 = 1.28 → clamp 1.0; -0.39 → 0.61; +0.20 → 0.81. **Final: 0.81**
 *   - Sum-then-clamp:      0.5 + (0.78 - 0.39 + 0.20) = 1.09 → clamp 1.0. **Final: 1.0** (wrong)
 *
 * Most skins author 0–1 offsets per destination so the two paths agree. Skins that chain
 * multiple alpha-modifying offsets (e.g. brightness + flicker overlays) only render correctly
 * with per-step semantics.
 *
 * @param baseAlpha The destination keyframe's color.a in `[0, 1]` (= `keyframe.a / 255`).
 * @param ids Resolved offset ids in authored order. Order matters once any step saturates.
 * @param resolve Host lookup (returns `undefined` for ids the host doesn't know).
 */
export function applyBeatorajaOffsetAlpha(
  baseAlpha: number,
  ids: ReadonlyArray<number>,
  resolve: (offsetId: number) => Readonly<BeatorajaSkinOffsetValue> | undefined,
): number {
  let a = baseAlpha;
  if (a > 1) a = 1;
  else if (a < 0) a = 0;
  for (const id of ids) {
    const v = resolve(id);
    if (v === undefined) continue;
    a += v.a / 255;
    if (a > 1) a = 1;
    else if (a < 0) a = 0;
  }
  return a;
}

/**
 * Convert beatoraja's `center` (0..9) into a Pixi `Sprite.anchor` point in `[0, 1]²`. The
 * mapping comes straight from `SkinObject.java`'s `CENTERX` / `CENTERY` tables in libGDX Y-UP
 * coordinates (origin at the rect's bottom-left, y grows upward), then we Y-flip into Pixi
 * Y-DOWN (`pixiAnchorY = 1 - libgdxOriginY`) so the sprite's anchor lands at the correct visual
 * point on screen.
 *
 * Index `0` is the default — beatoraja initialises uninitialized `center` values to the rect's
 * mid-point, NOT the top-left. Indices `1..9` form a 1-indexed 3×3 grid in Y-UP layout — bottom
 * row first, top row last. The numeric arrangement intentionally diverges from LR2's `0..8`
 * grid (where 0 is top-left), and skin authors are expected to use beatoraja's numbering when
 * targeting beatoraja themes.
 *
 * Visual layout in Pixi (Y-DOWN, `(0,0)` at top-left of the destination rect):
 *
 *     7 (0, 0)   8 (.5, 0)   9 (1, 0)         ← top row in libGDX Y-UP, top row in Pixi Y-DOWN
 *     4 (0, .5)  5 (.5, .5)  6 (1, .5)        ← (5 == 0 == default mid-point)
 *     1 (0, 1)   2 (.5, 1)   3 (1, 1)         ← bottom row in libGDX Y-UP, bottom row in Pixi
 */
const BEATORAJA_CENTER_X: ReadonlyArray<number> = [0.5, 0, 0.5, 1, 0, 0.5, 1, 0, 0.5, 1];
/** libGDX Y-UP origin Y values. We subtract from 1 to land in Pixi Y-DOWN anchor space. */
const BEATORAJA_CENTER_Y_UP: ReadonlyArray<number> = [0.5, 0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1];

export function centerToAnchor(center: number): { x: number; y: number } {
  const c = clampCenter(center);
  return {
    x: BEATORAJA_CENTER_X[c]!,
    y: 1 - BEATORAJA_CENTER_Y_UP[c]!,
  };
}

/**
 * Resolve a single inner if-gated keyframe slot. The input is an array of `{if: number[], value:
 * {...rect}}` alternatives; the output is the chosen alternative's `value` record (or `undefined`
 * if none match). Selection rules mirror beatoraja's `JSONSkinLoader.setDestination` logic:
 *
 * 1. Walk alternatives in declared order.
 * 2. The first alternative whose every `if` code is in `activeOps` (or whose `if` is empty /
 *    missing — the catch-all) wins.
 * 3. If nothing matches, fall back to the LAST alternative — beatoraja itself short-circuits
 *    on the first match so trailing alternatives are typically the catch-all default
 *    (`{if:[]}`); when authors omit that, returning the last entry preserves something visible
 *    rather than dropping the keyframe entirely.
 *
 * Negative `if` codes mean "must NOT be active", same convention as element-level `ifCodes`.
 */
function resolveKeyframeAlternative(
  alternatives: ReadonlyArray<unknown>,
  activeOps: ReadonlySet<number>,
): Readonly<Record<string, unknown>> | undefined {
  let lastValid: Readonly<Record<string, unknown>> | undefined;
  for (const alt of alternatives) {
    if (alt === null || typeof alt !== 'object' || Array.isArray(alt)) continue;
    const obj = alt as Readonly<Record<string, unknown>>;
    // Allow either nested `{if, value}` form (beatoraja's authored shape) OR a flat `{if, time,
    // x, y, ...}` shape (common in Lua-emitted skins where the alt is the keyframe directly).
    const value =
      typeof obj.value === 'object' && obj.value !== null
        ? (obj.value as Readonly<Record<string, unknown>>)
        : obj;
    lastValid = value;
    const ifCodes = obj.if;
    if (!Array.isArray(ifCodes) || ifCodes.length === 0) {
      return value;
    }
    let allMatch = true;
    for (const code of ifCodes) {
      if (typeof code !== 'number' || !Number.isFinite(code)) continue;
      if (code === 0) continue;
      if (code > 0) {
        if (!activeOps.has(code)) {
          allMatch = false;
          break;
        }
      } else if (activeOps.has(-code)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return value;
  }
  return lastValid;
}

function normalizeKeyframes(
  raw: ReadonlyArray<unknown>,
  activeOps: ReadonlySet<number>,
): BeatorajaDestinationKeyframe[] {
  const out: BeatorajaDestinationKeyframe[] = [];
  // Beatoraja keyframes carry forward the previous frame's value when a field is omitted. e.g.
  //   {"time":0,"x":121,"y":140,"w":18,"h":580},{"time":100,"x":112,"w":36}
  // means "at t=100 the rect is at x=112, y stays 140, w=36, h stays 580". Track a rolling state so the renderer
  // gets a fully-populated keyframe for every entry.
  const state: BeatorajaDestinationKeyframe = {
    time: 0,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    r: 255,
    g: 255,
    b: 255,
    a: 255,
    angle: 0,
    acc: 0,
  };
  for (const rawItem of raw) {
    // Inner if-gated array: a single keyframe slot whose rect varies by skin-config layout
    // option. Beatoraja's loader walks alternatives in order and picks the first whose `if`
    // codes all match the SELECTED skin options (resolved at skin load time, not runtime).
    // Used by play24's BGA group, custom-events tables, and lane-position presets — without
    // this expansion the renderer reads the array as a degenerate object and emits an
    // all-zero keyframe (BGA invisible, lane offsets null, etc.).
    const item = Array.isArray(rawItem) ? resolveKeyframeAlternative(rawItem, activeOps) : rawItem;
    if (item === null || item === undefined || typeof item !== 'object') continue;
    const obj = item as Readonly<Record<string, unknown>>;
    state.time = numberField(obj, 'time', state.time);
    state.x = numberField(obj, 'x', state.x);
    state.y = numberField(obj, 'y', state.y);
    state.w = numberField(obj, 'w', state.w);
    state.h = numberField(obj, 'h', state.h);
    state.r = numberField(obj, 'r', state.r);
    state.g = numberField(obj, 'g', state.g);
    state.b = numberField(obj, 'b', state.b);
    state.a = numberField(obj, 'a', state.a);
    state.angle = numberField(obj, 'angle', state.angle);
    // `acc` carries forward like every other field — `JSONSkinLoader.setDestination` does
    // `a.acc = (a.acc == MIN_VALUE ? prev.acc : a.acc)`. Resetting to 0 each frame would break
    // the common authoring pattern of declaring `acc=2` on the FROM frame of a long fade-in
    // and leaving subsequent intermediate keyframes with no `acc` (which would re-linearize
    // the back half of the fade in our implementation prior to this fix).
    state.acc = numberField(obj, 'acc', state.acc);
    // Push a fresh copy so future state mutations don't reach already-emitted keyframes.
    out.push({ ...state });
  }
  return out;
}

function normalizeOpArray(value: unknown): ReadonlyArray<number> {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const v of value) {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function booleanPropertyField(value: unknown): BeatorajaBooleanPropertyRef | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isBeatorajaLuaFunctionValue(value)) return value;
  return undefined;
}

/**
 * Parse `dst.mouseRect` per `JsonSkinObjectLoader.java:723-725`. The JSON shape is the same
 * `{x, y, w, h}` Rect object used by `JsonSkin.Rect` (`JsonSkin.java:444-449`). Defaults to
 * `0` for any missing component — matches Java's `int` field initialization.
 */
function parseMouseRectField(value: unknown): { x: number; y: number; w: number; h: number } | undefined {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const obj = value as Readonly<Record<string, unknown>>;
  // At least one of (w, h) must be positive — a `0×0` rect would never contain the mouse and
  // is indistinguishable from "unset" for visibility gating. Treat as no rect.
  const w = numberField(obj, 'w', 0);
  const h = numberField(obj, 'h', 0);
  if (w <= 0 || h <= 0) return undefined;
  return {
    x: numberField(obj, 'x', 0),
    y: numberField(obj, 'y', 0),
    w,
    h,
  };
}

/**
 * Sample the destination state at a given elapsed time. Returns the interpolated keyframe (linear interpolation
 * between adjacent stops). When the last keyframe is past:
 *
 * - `loop < 0` → returns `undefined` (element is hidden).
 * - `loop >= 0` → wraps `elapsed` modulo `(lastKeyframe.time - loop)` after subtracting `loop`.
 *
 * Designed to be called per-frame from the renderer.
 *
 * ─── Upstream parity (audit 2024-12) ──────────────────────────────────────────────────────
 *   Mirrors `SkinObject.java:300-326` (`prepareRegion`):
 *
 *     if (dstloop == -1) {
 *         if (time > endtime) time = -1;     // hides via the starttime check below
 *     } else if (lasttime > 0 && time > dstloop) {
 *         if (lasttime == dstloop) time = dstloop;
 *         else time = (time - dstloop) % (lasttime - dstloop) + dstloop;
 *     }
 *     if (starttime > time) { draw = false; return; }
 *
 *   Two micro-optimizations vs the literal upstream port:
 *
 *   1. **Wrap trigger short-circuit.** Upstream wraps when `time > dstloop`. We wrap only
 *      when `t > last.time`. The two are observably equivalent because the wrap formula is
 *      a no-op for `time ∈ [dstloop, lasttime]`:
 *
 *          (time - dstloop) % (lasttime - dstloop) + dstloop = time, when time ≤ lasttime.
 *
 *   2. **`period ≤ 0` defensive return.** Upstream divides by zero (or negative) when
 *      authors mis-author `loop ≥ lasttime` — undefined behavior in Java. We treat this as
 *      "hold the last frame static" so the renderer doesn't propagate NaN into sprite
 *      coordinates. Matches upstream's `lasttime == dstloop` branch (which freezes time at
 *      `dstloop`) for the equality case; differs only for the rarely-authored `loop > lasttime`.
 */
export function sampleBeatorajaDestination(
  group: BeatorajaDestinationGroup,
  elapsedMs: number,
): BeatorajaDestinationKeyframe | undefined {
  const dst = group.dst;
  if (dst.length === 0) return undefined;

  const first = dst[0]!;
  const last = dst[dst.length - 1]!;
  let t = elapsedMs;

  // Pre-starttime gate (audit 1.7). Beatoraja's `prepareRegion()` runs
  // `if (starttime > time) { draw = false; return; }` — elements authored with `dst[0].time
  // > 0` (a delayed reveal) hide until the timer reaches that mark. The previous impl pinned
  // `dst[0]` for any `t <= dst[0].time` instead, which made delayed elements paint their
  // head frame from the moment the timer fired.
  if (t < first.time) return undefined;

  if (t > last.time) {
    if (group.loop < 0) return undefined;
    const period = last.time - group.loop;
    // Degenerate case: single-keyframe dst with `loop >= 0`. The wraparound period collapses
    // to 0 (or negative, when authors mis-author loop > last.time) — beatoraja itself is
    // undefined here (division by zero in `(time - dstloop) % (lasttime - dstloop)`). Treat
    // as "hold the last frame static" rather than producing NaN.
    if (period <= 0) return last;
    t = group.loop + ((elapsedMs - group.loop) % period);
    // After wrap, t is in `[loop, last.time]`. If the wrap landed BEFORE the first keyframe's
    // time (when authors loop with `loop < first.time`), beatoraja's same `starttime > time`
    // gate kicks in and hides the element until the next wrap brings t back into range.
    if (t < first.time) return undefined;
  }

  // Single-keyframe path: at this point we're guaranteed `first.time <= t <= last.time`,
  // and since the array has length 1, both bounds are `first.time`. Audit 1.6: previously we
  // short-circuited to `dst[0]` regardless of `loop`, which made elements stick on screen
  // forever even when the author wrote `loop = -1` to mean "wink at t == dst[0].time then
  // disappear" — visibly breaking default play's `judgef-*` / `judgen-*` / keybeam dsts and
  // ModernChic Decide's corner-flash group. With the time-window gating above (and `t >
  // last.time → hide` on `loop = -1`), length-1 elements naturally hide when the timer ticks
  // past their authored time.
  if (dst.length === 1) return first;

  // Multi-keyframe path: locate the surrounding pair and lerp.
  if (t <= first.time) return first;
  for (let i = 1; i < dst.length; i += 1) {
    const a = dst[i - 1]!;
    const b = dst[i]!;
    if (t <= b.time) {
      const span = b.time - a.time;
      const linearU = span === 0 ? 0 : (t - a.time) / span;
      // Apply the ELEMENT's easing — beatoraja's `SkinObject.acc` is a class field locked to
      // the first non-zero authored value across the keyframe list, NOT a per-segment curve
      // (audit 1.5). Every segment of the entire animation uses the same curve; switching
      // between curves mid-animation is impossible at the spec level. See `pickElementAcc`
      // for the resolution rule.
      const easedU = applyAccCurve(linearU, group.acc);
      return interpolate(a, b, easedU);
    }
  }
  return last;
}

/**
 * Beatoraja / LR2 `acc` easing curves applied to a linear time parameter `u ∈ [0, 1]`.
 *
 * - `acc = 0` (linear): `u' = u`
 * - `acc = 1` (accelerate / slow-start): `u' = u²` — output starts slow and speeds up
 * - `acc = 2` (decelerate / fast-start): `u' = u·(2 - u)` — output starts fast and slows down
 * - `acc = 3` (step / discontinuous): `u' = 0` until `u >= 1` (the segment holds its FROM frame)
 *
 * Codes other than 0–3 fall back to linear. Both endpoints (`u = 0` and `u = 1`) always return
 * exactly the FROM / TO values regardless of curve, mirroring beatoraja's behavior.
 */
function applyAccCurve(u: number, acc: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  switch (acc) {
    case 1:
      return u * u;
    case 2:
      return u * (2 - u);
    case 3:
      return 0;
    default:
      return u;
  }
}

function interpolate(
  a: BeatorajaDestinationKeyframe,
  b: BeatorajaDestinationKeyframe,
  u: number,
): BeatorajaDestinationKeyframe {
  return {
    time: a.time + (b.time - a.time) * u,
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    w: a.w + (b.w - a.w) * u,
    h: a.h + (b.h - a.h) * u,
    r: a.r + (b.r - a.r) * u,
    g: a.g + (b.g - a.g) * u,
    b: a.b + (b.b - a.b) * u,
    a: a.a + (b.a - a.a) * u,
    angle: a.angle + (b.angle - a.angle) * u,
    // The interpolated keyframe uses the FROM frame's curve label — same convention beatoraja
    // uses internally. Only matters if a downstream consumer inspects the curve flag.
    acc: a.acc,
  };
}
