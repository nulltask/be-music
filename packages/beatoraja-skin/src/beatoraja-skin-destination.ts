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
   * Loop offset in milliseconds. `-1` (or undefined → -1) hides the element after the last keyframe; `0` loops
   * back to keyframe 0 once the last keyframe's time elapses; any other positive value loops to that time-stamp.
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
   * Author-given declaration order. Two destinations targeting the same image but emitted at different points in
   * the source file render in source order; this field preserves that.
   */
  declarationOrder: number;
}

/**
 * Convert a permissive `destination[]` array into a normalized list. Entries without a usable `id` or `dst[]` are
 * dropped; all other fields take the documented defaults when missing.
 */
export function normalizeBeatorajaDestinations(input: unknown): BeatorajaDestinationGroup[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaDestinationGroup[] = [];
  for (let i = 0; i < flattened.length; i += 1) {
    const normalized = normalizeOne(flattened[i], i);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement, declarationOrder: number): BeatorajaDestinationGroup | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  const rawDst = f.dst;
  if (!Array.isArray(rawDst) || rawDst.length === 0) return undefined;

  const keyframes = normalizeKeyframes(rawDst);
  if (keyframes.length === 0) return undefined;
  const timerFunction = isBeatorajaLuaFunctionValue(f.timer) ? f.timer : undefined;
  const draw = booleanPropertyField(f.draw);

  return {
    id,
    timer: numberField(f, 'timer', 0),
    ...(timerFunction !== undefined ? { timerFunction } : {}),
    loop: numberField(f, 'loop', -1),
    offset: numberField(f, 'offset', 0),
    op: normalizeOpArray(f.op),
    ...(draw !== undefined ? { draw } : {}),
    blend: numberField(f, 'blend', 0),
    filter: numberField(f, 'filter', 0),
    center: clampCenter(numberField(f, 'center', 0)),
    offsets: normalizeOpArray(f.offsets),
    ifCodes: entry.ifCodes,
    dst: keyframes,
    // Stretch is per-element in beatoraja (the loader's `setStretch` call overwrites the field
    // each keyframe; last-write wins). The JSON / Lua entry sometimes places it on the outer
    // record, sometimes on individual keyframes; we read whichever the author chose, walking the
    // keyframes for the LAST non-default value.
    stretch: pickStretchMode(f, rawDst),
    declarationOrder,
  };
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
  /** Alpha multiplier (255 = unchanged, 0 = fully transparent). */
  a: number;
}

/** Default offset = no displacement, alpha unchanged. Same shape `MainStateAccessor.offset` returns. */
export const ZERO_BEATORAJA_OFFSET: Readonly<BeatorajaSkinOffsetValue> = Object.freeze({
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  r: 0,
  a: 255,
});

/**
 * Sum a destination's `offsets[]` ids into a single (x, y, w, h, r, a) shift. The renderer
 * applies this on top of the keyframe-sampled position. `resolve` looks up each id's current
 * value via the host (typically `state.getOffsetValue(id)` on the Java side); returning
 * `undefined` for an unknown id treats it as `ZERO_BEATORAJA_OFFSET` (no shift).
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
  // Alpha multiplies — start at 1 (unchanged) and divide each contribution by 255.
  let alphaMultiplier = 1;
  for (const id of ids) {
    const v = resolve(id);
    if (v === undefined) continue;
    x += v.x;
    y += v.y;
    w += v.w;
    h += v.h;
    r += v.r;
    alphaMultiplier *= Math.max(0, Math.min(1, v.a / 255));
  }
  return { x, y, w, h, r, a: Math.round(alphaMultiplier * 255) };
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

function normalizeKeyframes(raw: ReadonlyArray<unknown>): BeatorajaDestinationKeyframe[] {
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
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
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
 * Sample the destination state at a given elapsed time. Returns the interpolated keyframe (linear interpolation
 * between adjacent stops). When the last keyframe is past:
 *
 * - `loop < 0` → returns `undefined` (element is hidden).
 * - `loop >= 0` → wraps `elapsed` modulo `(lastKeyframe.time - loop)` after subtracting `loop`.
 *
 * Designed to be called per-frame from the renderer.
 */
export function sampleBeatorajaDestination(
  group: BeatorajaDestinationGroup,
  elapsedMs: number,
): BeatorajaDestinationKeyframe | undefined {
  const dst = group.dst;
  if (dst.length === 0) return undefined;
  // Single-keyframe destinations are static — always show, regardless of `loop`. Time advancing past `dst[0].time`
  // doesn't end the element because there's no animation to play out.
  if (dst.length === 1) return dst[0];

  const last = dst[dst.length - 1];
  let t = elapsedMs;

  if (t >= last.time) {
    if (group.loop < 0) return undefined;
    const period = last.time - group.loop;
    if (period <= 0) return last;
    t = group.loop + ((elapsedMs - group.loop) % period);
  }

  if (t <= dst[0].time) {
    return dst[0];
  }

  for (let i = 1; i < dst.length; i += 1) {
    const a = dst[i - 1];
    const b = dst[i];
    if (t <= b.time) {
      const span = b.time - a.time;
      const linearU = span === 0 ? 0 : (t - a.time) / span;
      // Apply the segment's easing — `acc` belongs to the FROM keyframe and parametrizes the
      // interpolation up to the next stop. Without this, every animation collapses to linear
      // motion, which is visually wrong on skins that author punchy decel / accel curves
      // (notably GdbG's decide / select fades, which use `acc = 1` and `acc = 2` heavily).
      const easedU = applyAccCurve(linearU, a.acc);
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
