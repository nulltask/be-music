import { type BLEND_MODES, type Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Lr2DestinationRect, Lr2NumberElement } from './lr2-skin.ts';

/**
 * Shared LR2 sprite-rendering helpers used by both the gameplay view
 * (`pixi-gameplay.ts`) and the song-select view (`pixi-select.ts`).
 *
 * These helpers cover the parts of LR2's `#SRC_*` / `#DST_*` model that
 * are screen-agnostic — sprite tinting, blend-mode mapping, source
 * cropping, and NUMBER-cell layout. View-specific code (timer driving,
 * op evaluation, song-state resolution) stays in the per-view module.
 */

/**
 * Applies an LR2 `#DST_*` row's per-frame transforms (alpha, tint,
 * blend mode, rotation, rotation pivot) onto a Pixi `Sprite`.
 *
 * The `center` field is LR2's numpad-layout pivot for rotation:
 *
 * ```
 *   7 8 9   = top-left / top / top-right
 *   4 5 6   = mid-left / centre / mid-right
 *   1 2 3   = bot-left / bot / bot-right
 *   0       = centre (alias of 5)
 * ```
 *
 * Pixi's anchor is normalised (0..1), so we map each numpad position
 * onto the corresponding `(anchorX, anchorY)`. The sprite's screen
 * position is shifted by the same fraction so the painted rectangle
 * stays put — only the rotation pivot moves.
 */
export function applyDestinationToSprite(sprite: Sprite, destination: Lr2DestinationRect): void {
  sprite.alpha = destination.alpha;
  sprite.tint = (destination.r << 16) | (destination.g << 8) | destination.b;
  sprite.blendMode = mapLr2BlendMode(destination.blend);
  if (destination.angle !== 0) {
    sprite.rotation = (destination.angle * Math.PI) / 180;
    const pivot = resolveCenterAnchor(destination.center);
    if (pivot.x !== 0 || pivot.y !== 0) {
      // Move the anchor and offset the position so the sprite
      // visually stays in place — only the rotation pivot changes.
      sprite.anchor.set(pivot.x, pivot.y);
      sprite.position.set(sprite.position.x + sprite.width * pivot.x, sprite.position.y + sprite.height * pivot.y);
    }
  }
}

function resolveCenterAnchor(center: number): { x: number; y: number } {
  switch (center) {
    case 1:
      return { x: 0, y: 1 };
    case 2:
      return { x: 0.5, y: 1 };
    case 3:
      return { x: 1, y: 1 };
    case 4:
      return { x: 0, y: 0.5 };
    case 5:
    case 0:
      return { x: 0.5, y: 0.5 };
    case 6:
      return { x: 1, y: 0.5 };
    case 7:
      return { x: 0, y: 0 };
    case 8:
      return { x: 0.5, y: 0 };
    case 9:
      return { x: 1, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Maps the LR2 `blend` field (0..11) onto PixiJS v8 blend mode names.
 * Pixi has no native subtractive blend, so blend=3 falls back to normal.
 */
export function mapLr2BlendMode(blend: number): BLEND_MODES {
  switch (blend) {
    case 2:
      return 'add';
    case 4:
    case 11:
      return 'multiply';
    case 3:
      // LR2 "減算" — PixiJS v8 has no native subtractive blend.
      return 'normal';
    default:
      return 'normal';
  }
}

/**
 * Per-base-texture cache of cropped sub-textures.
 *
 * LR2 skins reference the same atlas crops every frame (frame chrome,
 * lane decorations, fixed UI panels, animated cells with a small
 * cycle). Allocating a fresh `Texture` + `Rectangle` per call from
 * `createCroppedTexture` was producing a steady stream of GC-eligible
 * objects each tick — measurable as occasional sub-60 fps stutters
 * during gameplay.
 *
 * The cache is keyed on the base `Texture` (WeakMap → entry vanishes
 * once the base is dropped from its owning view) and an `(x, y, w, h)`
 * string sub-key. The cropped values reference `texture.source`, which
 * is the same source the base texture already pins, so caching adds no
 * extra GPU lifetime.
 */
const cropCache = new WeakMap<Texture, Map<string, Texture>>();

/**
 * Returns a `Texture` view that crops `texture` to `rect`. Reuses the
 * same `BaseTexture` (no GPU re-upload). Returns `undefined` for empty
 * or absent rectangles. Cached: repeated calls with the same
 * `(texture, x, y, w, h)` return the same `Texture` instance.
 */
export function createCroppedTexture(
  texture: Texture | undefined,
  rect: { x: number; y: number; w: number; h: number },
): Texture | undefined {
  if (!texture || rect.w <= 0 || rect.h <= 0) {
    return undefined;
  }
  let bySource = cropCache.get(texture);
  if (!bySource) {
    bySource = new Map();
    cropCache.set(texture, bySource);
  }
  // Animation cells can have fractional widths when the source w/h
  // doesn't divide evenly by divx/divy, so encode the full numeric
  // value rather than rounding.
  const key = `${rect.x}|${rect.y}|${rect.w}|${rect.h}`;
  let cached = bySource.get(key);
  if (!cached) {
    cached = new Texture({ source: texture.source, frame: new Rectangle(rect.x, rect.y, rect.w, rect.h) });
    bySource.set(key, cached);
  }
  return cached;
}

/**
 * LR2 sprite destinations may carry negative `w`/`h` values to indicate
 * the rectangle "grows" in the opposite direction (e.g. h=-321 at
 * y=321 means a 321-tall rect whose bottom edge sits at y=321). PixiJS
 * expects positive extents anchored at the top-left, so we convert here.
 */
export function normaliseRect(rect: { x: number; y: number; w: number; h: number }): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let { x, y, w, h } = rect;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  return { x, y, w, h };
}

/**
 * Interpolates an LR2 destination keyframe sequence at the given
 * elapsed time (since the controlling timer started).
 *
 * - **Single keyframe**: returned verbatim.
 * - **Before the first keyframe's `time`**: the first keyframe is
 *   held.
 * - **After the last keyframe's `time`**:
 *   - `loop < 0` (typically `-1`): play once and clamp at the last
 *     keyframe forever (used for one-shot effects like bomb sprites).
 *   - `loop >= finalTime`: behaves like a clamp (would wrap back to a
 *     point that isn't earlier than the last keyframe).
 *   - Otherwise: wrap to `loop + ((elapsed - loop) % (finalTime -
 *     loop))`. LR2's `loop` is the **time the animation jumps back
 *     to**, not a cycle length.
 * - **Between two keyframes A (time=tA) and B (time=tB)**: position,
 *   size, colour, alpha and angle are linearly interpolated by
 *   `(t - tA) / (tB - tA)`. Discrete attributes (blend, filter,
 *   center, timer, ops, op4) come from the **target** keyframe so
 *   visibility / blending changes cleanly at boundaries.
 */
export function evaluateKeyframes(keyframes: ReadonlyArray<Lr2DestinationRect>, elapsedMs: number): Lr2DestinationRect {
  if (keyframes.length === 1 || elapsedMs < 0) {
    return keyframes[0]!;
  }
  const first = keyframes[0]!;
  const last = keyframes[keyframes.length - 1]!;
  const finalTime = last.time;
  let t = elapsedMs;
  if (elapsedMs > finalTime) {
    // Past the final keyframe — decide between hold vs. real loop.
    if (last.loop < 0 || last.loop >= finalTime) {
      return last;
    }
    const period = finalTime - last.loop;
    if (period <= 0) {
      return last;
    }
    t = last.loop + ((elapsedMs - last.loop) % period);
  }
  if (t <= first.time) {
    return first;
  }
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const lower = keyframes[index]!;
    const upper = keyframes[index + 1]!;
    if (t < lower.time || t > upper.time) {
      continue;
    }
    const span = upper.time - lower.time;
    const u = span <= 0 ? 0 : (t - lower.time) / span;
    // `acc` lives on the *target* keyframe per LR2 spec: it controls
    // how this segment eases into the next.
    return interpolateKeyframe(lower, upper, applyAccEasing(u, upper.acc));
  }
  return last;
}

/**
 * Applies the `acc` easing curve to a normalised progress value `u`
 * (0..1). Per `docs/LR2SkinHelp.md` line 509+:
 *
 * - **0** — linear (constant velocity).
 * - **1** — accelerate (ease-in, `u²`).
 * - **2** — decelerate (ease-out, `1 - (1 - u)²`).
 * - **3** — discontinuous (snap to start until the end). LR2's
 *   "discontinuous" basically means "no interpolation, hold then
 *   jump"; we approximate with a step function at u >= 1.
 */
function applyAccEasing(u: number, acc: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  switch (acc) {
    case 1:
      return u * u;
    case 2:
      return 1 - (1 - u) * (1 - u);
    case 3:
      return 0;
    case 0:
    default:
      return u;
  }
}

function interpolateKeyframe(a: Lr2DestinationRect, b: Lr2DestinationRect, t: number): Lr2DestinationRect {
  return {
    time: a.time + (b.time - a.time) * t,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
    acc: b.acc,
    alpha: a.alpha + (b.alpha - a.alpha) * t,
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
    blend: b.blend,
    filter: b.filter,
    angle: a.angle + (b.angle - a.angle) * t,
    center: b.center,
    loop: b.loop,
    timer: b.timer,
    ops: b.ops,
    op4: b.op4,
  };
}

/**
 * Picks the current source-rect cell for an animated `#SRC_*`
 * element. LR2 sources may divide their rect into a `divx`×`divy`
 * grid that cycles over `cycle` ms. When `cycle` is 0 (or there is
 * only one cell) we just return cell (0,0). Frames advance row-major
 * (left-to-right, top-to-bottom), matching LR2's playback order.
 *
 * When `loop === -1` (LR2's "play once and stop" marker on the
 * destination), the elapsed time is clamped to the cycle length so
 * the animation stops on its final frame instead of wrapping back to
 * frame 0. This is what makes a bomb explosion play exactly once even
 * when its SRC has a non-zero cycle.
 */
export function pickAnimatedCell(
  source: { x: number; y: number; w: number; h: number; divx: number; divy: number; cycle: number },
  elapsedMs: number,
  loop: number = 0,
): { x: number; y: number; w: number; h: number } {
  const divx = Math.max(1, source.divx);
  const divy = Math.max(1, source.divy);
  const totalFrames = divx * divy;
  const cellW = source.w / divx;
  const cellH = source.h / divy;
  if (totalFrames <= 1 || source.cycle <= 0) {
    return { x: source.x, y: source.y, w: cellW, h: cellH };
  }
  const frameMs = source.cycle / totalFrames;
  const safeElapsed = Math.max(0, elapsedMs);
  const noLoop = loop === -1;
  const reduced = noLoop ? Math.min(safeElapsed, source.cycle - frameMs) : safeElapsed % source.cycle;
  const frame = Math.min(totalFrames - 1, Math.floor(reduced / Math.max(1, frameMs)));
  const cellX = frame % divx;
  const cellY = Math.floor(frame / divx);
  return {
    x: source.x + cellX * cellW,
    y: source.y + cellY * cellH,
    w: cellW,
    h: cellH,
  };
}

export interface RenderNumberOptions {
  /**
   * When true, leading zeros in the displayed value are blanked instead
   * of rendered. Used for the gauge percentage where keta=3 would
   * otherwise paint "020" / "100" with visible leading zeros.
   */
  suppressLeadingZeros?: boolean;
}

/**
 * Renders an LR2 `#SRC_NUMBER` + `#DST_NUMBER` element. Slices the
 * source texture into `divx × divy` cells and lays out one cell per
 * digit (plus an optional sign cell), respecting `align` and
 * `padding (keta)`.
 *
 * LR2 spec on `divx*divy` cell layouts:
 *
 * - **×10** — cells `0..9` are digits.
 * - **×11** — cells `0..9` plus cell `10` as a blank (used to "blank
 *   out" a leading-zero slot rather than draw `0`).
 * - **×24** — cells `0..9` digits, `10` blank, `11` `+`, `12..21`
 *   digits styled for negative numbers, `22` blank, `23` `-`.
 *   Negative values are rendered using the second-half digit cells
 *   plus the trailing `-` sign cell.
 */
export function renderNumberElement(
  layer: Container,
  element: Lr2NumberElement,
  value: number,
  textures: ReadonlyMap<string, Texture>,
  dst: Lr2DestinationRect,
  options: RenderNumberOptions = {},
): void {
  const baseTexture = textures.get(element.source.imagePath);
  if (!baseTexture) {
    return;
  }
  const divx = Math.max(1, element.source.divx);
  const divy = Math.max(1, element.source.divy);
  const cellWidth = element.source.w / divx;
  const cellHeight = element.source.h / divy;
  if (cellWidth <= 0 || cellHeight <= 0) {
    return;
  }
  if (dst.w === 0 || dst.h === 0) {
    return;
  }
  const totalCells = divx * divy;
  // ×11 / ×22 / ×24 sheets include a blank cell. Anything ÷11=0 has it.
  const hasBlankCell = totalCells % 11 === 0 || totalCells % 24 === 0;
  // ×24 sheets carry per-sign digit cells and a `-` glyph at index 23.
  // We treat any sheet whose total is a multiple of 24 as signed; this
  // matches LR2's convention where the only common signed layout is
  // exactly 24 cells (1×24, 2×12, 4×6, 6×4, 8×3, 12×2, 24×1).
  const isSignedSheet = totalCells % 24 === 0;
  const negative = isSignedSheet && value < 0;
  const absValue = Math.abs(Math.trunc(value));
  const digitText = absValue.toString();
  // The sign cell is appended to the field on negative values, eating
  // one slot from the configured `padding (keta)` so the visual width
  // stays the same as the positive variant.
  const fieldKeta = element.source.padding > 0 ? element.source.padding : digitText.length + (negative ? 1 : 0);
  const digitsKeta = negative ? Math.max(1, fieldKeta - 1) : fieldKeta;
  const displayDigitsKeta = options.suppressLeadingZeros ? digitText.length : digitsKeta;
  const fillChar = hasBlankCell ? ' ' : '0';
  const digits = (
    digitText.length >= displayDigitsKeta
      ? digitText.slice(-displayDigitsKeta)
      : fillChar.repeat(displayDigitsKeta - digitText.length) + digitText
  ).split('');
  // Negative values render as `<digits><sign>` per LR2 spec.
  const totalSlots = digits.length + (negative ? 1 : 0);
  const dstWidth = dst.w || cellWidth;
  const fieldWidth = dstWidth * fieldKeta;
  let startX = dst.x;
  if (element.source.alignment === 'center') {
    startX = dst.x + (fieldWidth - dstWidth * totalSlots) / 2;
  } else if (element.source.alignment === 'right') {
    startX = dst.x + fieldWidth - dstWidth * totalSlots;
  }
  for (let index = 0; index < totalSlots; index += 1) {
    let cellIndex: number;
    if (negative && index === totalSlots - 1) {
      // Sign cell at the tail.
      cellIndex = 23;
    } else {
      const character = digits[index]!;
      if (character === ' ') {
        if (!hasBlankCell) continue;
        // Blank slot: `10` for ×11 / ×24 sheets, `22` if the negative
        // half also wants its own blank cell.
        cellIndex = negative ? 22 : 10;
      } else {
        const digit = Number.parseInt(character, 10);
        if (!Number.isFinite(digit)) continue;
        cellIndex = negative ? 12 + digit : digit;
      }
    }
    if (cellIndex < 0 || cellIndex >= totalCells) {
      continue;
    }
    const cellX = cellIndex % divx;
    const cellY = Math.floor(cellIndex / divx);
    const cellTexture = createCroppedTexture(baseTexture, {
      x: element.source.x + cellWidth * cellX,
      y: element.source.y + cellHeight * cellY,
      w: cellWidth,
      h: cellHeight,
    });
    if (!cellTexture) {
      continue;
    }
    const sprite = new Sprite(cellTexture);
    sprite.label = `number[num=${element.source.num},cell=${cellIndex}]`;
    sprite.position.set(startX + dstWidth * index, dst.y);
    sprite.width = dstWidth;
    sprite.height = dst.h || cellHeight;
    applyDestinationToSprite(sprite, dst);
    layer.addChild(sprite);
  }
}
