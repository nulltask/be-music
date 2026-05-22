import { type BLEND_MODES, type Container, Sprite, Texture } from 'pixi.js';
import type {
  Lr2BarGraphElement,
  Lr2DestinationRect,
  Lr2ImageElement,
  Lr2NumberElement,
  Lr2SliderElement,
  Lr2SpecialGraphic,
} from '@be-music/lr2-skin';
import { isLr2SpecialGraphic } from '@be-music/lr2-skin';
import { createCachedCroppedTexture, type PixiCropRect } from '../pixi-texture.ts';

/**
 * Shared LR2 sprite-rendering helpers used by both the gameplay view (`scene/lr2/gameplay.ts`) and the song-select view
 * (`scene/lr2/select.ts`).
 *
 * These helpers cover the parts of LR2's `#SRC_*` / `#DST_*` model that are screen-agnostic — sprite tinting,
 * blend-mode mapping, source cropping, and NUMBER-cell layout. View-specific code (timer driving, op evaluation,
 * song-state resolution) stays in the per-view module.
 */

/**
 * Minimal interface for "where do I put this Sprite?". Pool-based callers (scene/lr2/gameplay's `ChildPool`) satisfy this
 * structurally with their `acquireSprite()` method; non-pooled scene renders wrap a layer `Container` via
 * {@link containerSpriteSink} so the same helpers work for both.
 */
export interface SpriteSink {
  acquireSprite(): Sprite;
}

/**
 * Wraps a Pixi `Container` as a `SpriteSink` that allocates a fresh `Sprite` and parents it to the layer on every
 * acquire. Used by the non-pooled scene renders (select / result / decide); pooled callers should pass a `ChildPool`
 * directly instead so its recycle semantics kick in. Holding the wrapper inside a per-render local keeps every
 * acquire cost down to the closure call plus the `new Sprite()` / `addChild()` Pixi handles.
 */
export function containerSpriteSink(layer: Container): SpriteSink {
  return {
    acquireSprite() {
      const sprite = new Sprite();
      layer.addChild(sprite);
      return sprite;
    },
  };
}

/**
 * Applies an LR2 `#DST_*` row's per-frame transforms (alpha, tint, blend mode, rotation, rotation pivot) onto a Pixi
 * `Sprite`.
 *
 * The `center` field is LR2's numpad-layout pivot for rotation:
 *
 * ```
 *   7 8 9   = top-left / top / top-right
 *   4 5 6   = mid-left / center / mid-right
 *   1 2 3   = bot-left / bot / bot-right
 *   0       = center (alias of 5)
 * ```
 *
 * Pixi's anchor is normalized (0..1), so we map each numpad position onto the corresponding `(anchorX, anchorY)`. The
 * sprite's screen position is shifted by the same fraction so the painted rectangle stays put — only the rotation pivot
 * moves.
 */
export function applyDestinationToSprite(sprite: Sprite, destination: Lr2DestinationRect): void {
  sprite.alpha = destination.alpha;
  sprite.tint = (destination.r << 16) | (destination.g << 8) | destination.b;
  sprite.blendMode = mapLr2BlendMode(destination.blend);
  if (destination.angle !== 0) {
    sprite.rotation = (destination.angle * Math.PI) / 180;
    const pivot = resolveCenterAnchor(destination.center);
    if (pivot.x !== 0 || pivot.y !== 0) {
      // Move the anchor and offset the position so the sprite visually stays in place — only the rotation pivot
      // changes.
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
 * Maps the LR2 `blend` field (0..11) onto PixiJS v8 blend mode names. Pixi has no native subtractive blend, so blend=3
 * falls back to normal.
 */
function mapLr2BlendMode(blend: number): BLEND_MODES {
  switch (blend) {
    case 2:
      return 'add';
    case 4:
    case 11:
      return 'multiply';
    case 3:
      // LR2 "subtract" blend — PixiJS v8 has no native subtractive blend.
      return 'normal';
    default:
      return 'normal';
  }
}

/**
 * Returns a `Texture` view that crops `texture` to `rect`. Reuses the same `BaseTexture` (no GPU re-upload). Returns
 * `undefined` for empty or absent rectangles. Cached: repeated calls with the same `(texture, x, y, w, h)` return the
 * same `Texture` instance.
 */
export function createCroppedTexture(texture: Texture | undefined, rect: PixiCropRect): Texture | undefined {
  return createCachedCroppedTexture(texture, rect, { requireFiniteFrame: true });
}

/**
 * LR2 sprite destinations may carry negative `w`/`h` values to indicate the rectangle "grows" in the opposite direction
 * (e.g. h=-321 at y=321 means a 321-tall rect whose bottom edge sits at y=321). PixiJS expects positive extents
 * anchored at the top-left, so we convert here.
 */
export function normalizeRect(rect: { x: number; y: number; w: number; h: number }): {
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

export interface Lr2DestinationElement {
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
}

type NormalizedLr2Rect = ReturnType<typeof normalizeRect>;
type Lr2TextureSourceElement = { source: { imagePath: string } };

interface Lr2ValueSpriteMetrics {
  texture: Texture;
  rect: NormalizedLr2Rect;
  ratio: number;
}

export function evaluateElementDestination(
  element: Lr2DestinationElement,
  elapsedSinceTimer: (timer: number) => number,
): Lr2DestinationRect {
  if (element.keyframes.length > 1) {
    return evaluateKeyframes(element.keyframes, elapsedSinceTimer(element.destination.timer));
  }
  return element.destination;
}

export interface Lr2StaticImageSpriteOptions {
  textures: ReadonlyMap<string, Texture>;
  elapsedSinceTimer: (timer: number) => number;
  resolveSpecialGraphicTexture?: (path: Lr2SpecialGraphic) => Texture | undefined;
}

export function makeLr2StaticImageSprite(
  image: Lr2ImageElement,
  dst: Lr2DestinationRect,
  options: Lr2StaticImageSpriteOptions,
): Sprite | undefined {
  const path = image.source.imagePath;
  let texture = options.textures.get(path);
  if (!texture && isLr2SpecialGraphic(path)) {
    texture = options.resolveSpecialGraphicTexture?.(path);
  }
  if (!texture) {
    return undefined;
  }
  const rect = normalizeRect(dst);
  if (rect.w <= 0 || rect.h <= 0) {
    return undefined;
  }
  let cropped: Texture;
  if (isLr2SpecialGraphic(path)) {
    cropped = texture;
  } else {
    const cell = pickAnimatedCell(image.source, options.elapsedSinceTimer(image.source.timer), dst.loop, {
      width: texture.width,
      height: texture.height,
    });
    if (cell.w <= 0 || cell.h <= 0) return undefined;
    const cellTexture = createCroppedTexture(texture, cell);
    if (!cellTexture) return undefined;
    cropped = cellTexture;
  }
  const sprite = new Sprite(cropped);
  sprite.label = `image[${path}]`;
  sprite.position.set(rect.x, rect.y);
  sprite.width = rect.w;
  sprite.height = rect.h;
  applyDestinationToSprite(sprite, dst);
  return sprite;
}

export function makeLr2BargraphSprite(
  element: Lr2BarGraphElement,
  dst: Lr2DestinationRect,
  value: number,
  textures: ReadonlyMap<string, Texture>,
): Sprite | undefined {
  return renderValueSprite(element, dst, value, textures, ({ texture, rect, ratio }) => {
    const horizontal = element.muki === 'horizontal';
    const cropW = horizontal ? element.source.w * ratio : element.source.w;
    const cropH = horizontal ? element.source.h : element.source.h * ratio;
    const cropY = horizontal ? element.source.y : element.source.y + (element.source.h - cropH);
    const cropped = createCroppedTexture(texture, {
      x: element.source.x,
      y: cropY,
      w: cropW,
      h: cropH,
    });
    if (!cropped) return undefined;
    return createLr2DestinationSprite(cropped, `bargraph[type=${element.type}]`, dst, (sprite) => {
      sprite.position.set(rect.x, horizontal ? rect.y : rect.y + rect.h * (1 - ratio));
      sprite.width = horizontal ? rect.w * ratio : rect.w;
      sprite.height = horizontal ? rect.h : rect.h * ratio;
    });
  });
}

export function makeLr2SliderSprite(
  element: Lr2SliderElement,
  dst: Lr2DestinationRect,
  value: number,
  textures: ReadonlyMap<string, Texture>,
): Sprite | undefined {
  return renderValueSprite(element, dst, value, textures, ({ texture, rect, ratio }) => {
    const cropped = createCroppedTexture(texture, {
      x: element.source.x,
      y: element.source.y,
      w: element.source.w / Math.max(1, element.source.divx),
      h: element.source.h / Math.max(1, element.source.divy),
    });
    if (!cropped) return undefined;
    let x = rect.x;
    let y = rect.y;
    switch (element.muki) {
      case 'down':
        y = rect.y + element.range * ratio;
        break;
      case 'up':
        y = rect.y - element.range * ratio;
        break;
      case 'right':
        x = rect.x + element.range * ratio;
        break;
      case 'left':
        x = rect.x - element.range * ratio;
        break;
    }
    return createLr2DestinationSprite(cropped, `slider[type=${element.type}]`, dst, (sprite) => {
      sprite.position.set(x, y);
      sprite.width = rect.w;
      sprite.height = rect.h;
    });
  });
}

function renderValueSprite(
  element: Lr2TextureSourceElement,
  dst: Lr2DestinationRect,
  value: number,
  textures: ReadonlyMap<string, Texture>,
  render: (metrics: Lr2ValueSpriteMetrics) => Sprite | undefined,
): Sprite | undefined {
  const metrics = resolveValueSpriteMetrics(element, dst, value, textures);
  return metrics ? render(metrics) : undefined;
}

function resolveValueSpriteMetrics(
  element: Lr2TextureSourceElement,
  dst: Lr2DestinationRect,
  value: number,
  textures: ReadonlyMap<string, Texture>,
): Lr2ValueSpriteMetrics | undefined {
  const texture = textures.get(element.source.imagePath);
  if (!texture) return undefined;
  const rect = normalizeRect(dst);
  if (rect.w <= 0 || rect.h <= 0) return undefined;
  return {
    texture,
    rect,
    ratio: Math.max(0, Math.min(1, value)),
  };
}

function createLr2DestinationSprite(
  texture: Texture,
  label: string,
  dst: Lr2DestinationRect,
  layout: (sprite: Sprite) => void,
): Sprite {
  const sprite = new Sprite(texture);
  sprite.label = label;
  layout(sprite);
  applyDestinationToSprite(sprite, dst);
  return sprite;
}

/**
 * Interpolates an LR2 destination keyframe sequence at the given elapsed time (since the controlling timer started).
 *
 * - **Single keyframe**: returned verbatim.
 * - **Before the first keyframe's `time`**: the first keyframe is held.
 * - **After the last keyframe's `time`**: - `loop < 0` (typically `-1`): play once and clamp at the last keyframe
 *   forever (used for one-shot effects like bomb sprites). - `loop >= finalTime`: behaves like a clamp (would wrap back
 *   to a point that isn't earlier than the last keyframe). - Otherwise: wrap to `loop + ((elapsed - loop) % (finalTime
 *   - loop))`. LR2's `loop` is the **time the animation jumps back to**, not a cycle length.
 * - **Between two keyframes A (time=tA) and B (time=tB)**: position, size, color, alpha and angle are linearly
 *   interpolated by `(t - tA) / (tB - tA)`. Discrete attributes (blend, filter, center, timer, ops, op4) come from the
 *   **target** keyframe so visibility / blending changes cleanly at boundaries.
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
    // Past the final keyframe — decide between hide vs. hold vs. real loop.
    //
    // Per `docs/LR2SkinHelp.md` line 629: with loop=-1 only, the part becomes
    // invisible after the animation finishes". So we synthesize a hidden version of the last keyframe (alpha=0) —
    // preserves position / size for anything that still queries them, but makes the element disappear visually. The LR2
    // default skin's "DONE" plate uses exactly this idiom: 2 alpha=1 keyframes spanning 500 ms with loop=-1, so it
    // flashes briefly then vanishes.
    if (last.loop < 0) {
      return { ...last, alpha: 0 };
    }
    if (last.loop >= finalTime) {
      // `loop >= finalTime` is degenerate (would-be loop point is at or past the final keyframe), treat as hold-at-last
      // for forward compat with skins that use it as "stop here".
      return last;
    }
    const period = finalTime - last.loop;
    if (period <= 0) {
      return last;
    }
    t = last.loop + ((elapsedMs - last.loop) % period);
  }
  if (t < first.time) {
    // PRE-FIRST-KEYFRAME — hide. Per `docs/LR2SkinHelp.md`, a `#DST_*` whose first keyframe sits at `t=N>0` schedules
    // the element to APPEAR at t=N, not to display the first keyframe verbatim during 0..N. The previous version
    // returned `first` here, which painted e.g. the LR2 default play skin's blue scan-line beam (image[109], first kf
    // at t=1000) at full size for the entire LOAD phase — visible immediately on scene mount instead of sweeping in
    // alongside the song-title reveal at t=1000ms. Mirrors the `loop=-1 → alpha=0 after final` rule above for the
    // post-animation phase: same hide-when-out-of-band idiom, just the bookend before the first keyframe instead of
    // after the last.
    return { ...first, alpha: 0 };
  }
  if (t === first.time) {
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
    // `acc` lives on the *target* keyframe per LR2 spec: it controls how this segment eases into the next.
    return interpolateKeyframe(lower, upper, applyAccEasing(u, upper.acc));
  }
  return last;
}

/**
 * Applies the `acc` easing curve to a normalized progress value `u` (0..1). Per `docs/LR2SkinHelp.md` line 509+:
 *
 * - **0** — linear (constant velocity).
 * - **1** — accelerate (ease-in, `u²`).
 * - **2** — decelerate (ease-out, `1 - (1 - u)²`).
 * - **3** — discontinuous (snap to start until the end). LR2's "discontinuous" basically means "no interpolation, hold
 *   then jump"; we approximate with a step function at u >= 1.
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
 * Picks the current source-rect cell for an animated `#SRC_*` element. LR2 sources may divide their rect into a
 * `divx`×`divy` grid that cycles over `cycle` ms. When `cycle` is 0 (or there is only one cell) we just return cell
 * (0,0). Frames advance row-major (left-to-right, top-to-bottom), matching LR2's playback order.
 *
 * The optional `loop` parameter is reserved for callers that need to pin the cell at its final frame (used by one-shot
 * effects whose SRC happens to have `cycle > 0`); pass `-1` to opt in. The default behavior cycles cells continuously
 * per LR2 spec — SRC cycling and DST keyframe looping are independent in LR2, so passing `dst.loop` here would conflate
 * the two and break elements like the LR2 default skin's "DONE" plate (which is gated on op 81 + timer 40, has
 * `dst.loop=-1` for "no DST keyframe loop", but whose SRC frames are an animated blink that must keep cycling).
 */
export function pickAnimatedCell(
  source: { x: number; y: number; w: number; h: number; divx: number; divy: number; cycle: number },
  elapsedMs: number,
  loop: number = 0,
  textureSize?: { width: number; height: number },
): { x: number; y: number; w: number; h: number } {
  // "No-graphic" idiom — `w=0,h=0,divx=0,divy=0` is how LR2 skin authors declare a placeholder element that should
  // paint nothing (typically a clickable button whose only visible content is its #SRC_TEXT label, or an empty op-gated
  // slot). Returning a zero-size rect makes the caller's `createCroppedTexture` short-circuit to `undefined`, which
  // they treat as "skip render".
  if (source.w === 0 && source.h === 0 && source.divx === 0 && source.divy === 0) {
    return { x: source.x, y: source.y, w: 0, h: 0 };
  }
  const divx = Math.max(1, source.divx);
  const divy = Math.max(1, source.divy);
  const totalFrames = divx * divy;
  // LR2 SRC rects with `w=0` / `h=0` are spec shorthand for "use the texture's native dimensions". Substitute when the
  // caller supplied `textureSize`, otherwise leave the zero through (the crop helper will return `undefined` and the
  // caller falls back to the full texture — preferable to silently re-sampling arbitrary-size cells).
  const sourceW = source.w > 0 ? source.w : (textureSize?.width ?? 0);
  const sourceH = source.h > 0 ? source.h : (textureSize?.height ?? 0);
  const cellW = sourceW / divx;
  const cellH = sourceH / divy;
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
   * When true, leading zeros in the displayed value are blanked instead of rendered. Used for the gauge percentage
   * where keta=3 would otherwise paint "020" / "100" with visible leading zeros.
   */
  suppressLeadingZeros?: boolean;
}

/**
 * Renders an LR2 `#SRC_NUMBER` + `#DST_NUMBER` element. Slices the source texture into `divx × divy` cells and lays out
 * one cell per digit (plus an optional sign cell), respecting `align` and `padding (keta)`.
 *
 * LR2 spec on `divx*divy` cell layouts:
 *
 * - **×10** — cells `0..9` are digits.
 * - **×11** — cells `0..9` plus cell `10` as a blank (used to "blank out" a leading-zero slot rather than draw `0`).
 * - **×24** — cells `0..9` digits, `10` blank, `11` `+`, `12..21` digits styled for negative numbers, `22` blank, `23`
 *   `-`. Negative values are rendered using the second-half digit cells plus the trailing `-` sign cell.
 */
export function renderNumberElement(
  sink: SpriteSink,
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
  // ×24 sheets carry per-sign digit cells and a `-` glyph at index 23. We treat any sheet whose total is a multiple of
  // 24 as signed; this matches LR2's convention where the only common signed layout is exactly 24 cells (1×24, 2×12,
  // 4×6, 6×4, 8×3, 12×2, 24×1).
  const isSignedSheet = totalCells % 24 === 0;
  const negative = isSignedSheet && value < 0;
  const absValue = Math.abs(Math.trunc(value));
  const digitText = absValue.toString();
  // The sign cell is appended to the field on negative values, eating one slot from the configured `padding (keta)` so
  // the visual width stays the same as the positive variant.
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
        // Blank slot: `10` for ×11 / ×24 sheets, `22` if the negative half also wants its own blank cell.
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
    const sprite = sink.acquireSprite();
    sprite.texture = cellTexture;
    sprite.label = `number[num=${element.source.num},cell=${cellIndex}]`;
    sprite.position.set(startX + dstWidth * index, dst.y);
    sprite.width = dstWidth;
    sprite.height = dst.h || cellHeight;
    applyDestinationToSprite(sprite, dst);
  }
}
