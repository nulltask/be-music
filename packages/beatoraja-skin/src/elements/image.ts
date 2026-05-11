// Strict-typed normalization for beatoraja `image[]` entries.
//
// `BeatorajaSkin.image` arrives as a permissive `Record<string, unknown>[]` from the JSON / Lua loaders. The fields
// follow beatoraja's upstream schema (`bms.player.beatoraja.skin.json.JSONSkin.Image`), but their presence is
// inconsistent across hand-written skins — `divx` / `divy` default to 1, `timer` / `cycle` default to 0, and missing
// `ref` / `len` mean "no dynamic frame selection". `normalizeBeatorajaImages` turns the loose objects into a flat
// list of `BeatorajaImageElement` with every field present and validated.

import { flattenBeatorajaElements, type NormalizedElement } from './base.ts';
import { boolField, numberField, positiveIntField, sourceIdField } from './fields.ts';
import { isBeatorajaLuaFunctionValue, type BeatorajaLuaFunctionValue } from '../lua.ts';
import type { BeatorajaSkinSourceId } from '../types.ts';

/**
 * `id` of an `image[]` entry. Skins use both numeric ids (`100`, `400`) for op-code-driven references and string ids
 * (`"keybeam1"`, `"close1"`) for symbolic names. We preserve whichever form the author used so downstream code can
 * match on the raw key.
 */
export type BeatorajaImageId = number | string;

export interface BeatorajaImageElement {
  /** Unique identifier within the skin. Other elements (`destination[]`, `value[]`, `imageset[]`) reference it. */
  id: BeatorajaImageId;
  /** `source[].id` reference. Numeric and symbolic string ids are both valid. */
  src: BeatorajaSkinSourceId;
  /** Source-rectangle origin within the texture, in source-pixel units. */
  x: number;
  y: number;
  /**
   * Source-rectangle size. `divx` / `divy` cells are calculated from this rect — a 200x220 image with `divy=11`
   * exposes 11 frames of 200x20 each.
   */
  w: number;
  h: number;
  /**
   * Cell grid for animated / multi-frame textures. `1` (the default) means the rect itself is the only frame.
   * Total frame count is `divx * divy`.
   */
  divx: number;
  divy: number;
  /**
   * Timer reference whose elapsed time selects the current frame for animations. `0` means "scene start" (which
   * effectively disables the animation when paired with `cycle = 0`).
   */
  timer: number;
  /** Runtime Lua timer function. When present, it supplies the timer start directly and takes precedence over `timer`. */
  timerFunction?: BeatorajaLuaFunctionValue;
  /**
   * Full animation period in milliseconds. `0` disables the cycle (the rect stays on frame 0 unless `ref`/`len`
   * pick a frame instead).
   */
  cycle: number;
  /**
   * Op-code reference for "static" frame selection (e.g. clear-lamp icons that pick one frame based on the runtime
   * lamp state). `0` means "no ref" — frame is driven by `timer`/`cycle` instead.
   */
  ref: number;
  /**
   * Number of valid frames for the `ref` lookup. When `ref` is set and the op-code value is between `0..len`, the
   * matching cell is shown. `0` means "use all `divx * divy` cells" (the upstream behavior when `len` is omitted).
   */
  len: number;
  /**
   * Click-event code (audit 2.5). Mirrors beatoraja's `Event act` field on `JsonSkin.Image`.
   * When non-zero, the renderer makes the sprite interactive and forwards this code to the
   * host's `onButtonAction` callback on tap. Beatoraja's reference theme uses
   *
   *   - `15` PLAY, `16` AUTO_PLAY, `19/316/317/318` REPLAY slots, `315` PRACTICE, `210` IR_OPEN,
   *   - `17` READ_TEXT, `89` FAVORITE_SONG, `90` FAVORITE_CHART, `74` JUDGE_TIMING,
   *   - `308` LN_MODE_CYCLE, `11` KEYS_FILTER, `12` SORT.
   *
   * Default `0` = "no action" (decorative sprite). The host scene resolves the code into its
   * real action — see `scene/beatoraja/select.ts handleButtonAction` for the mapping.
   */
  act: number;
  /**
   * Click mode tag (`int click = 0` in beatoraja's `JsonSkin.Image`). Distinguishes the
   * action variant the host should interpret on the click — typical values are `0` (regular
   * tap) and `1` (long-press / hold). Forwarded verbatim alongside {@link act} to the host.
   */
  click: number;
  /**
   * Disappearance Y line in skin-pixel units (libGDX Y-UP — bigger = higher on screen). When set
   * (and the destination's lift offset is wired), the renderer hides the portion of the sprite
   * BELOW this line so the image looks like it's being clipped from the bottom up. Used by
   * `hiddenCover` entries: the reference theme writes `disapearLine = 140` so the cover starts
   * out drawn from y=140 upward, and the player's lift slider shifts that boundary further up.
   * `-1` (the default) means "no clip" — the renderer uses the full source rect.
   */
  disapearLine: number;
  /**
   * When `true`, the renderer adds the resolved `OFFSET_LIFT.y` shift to {@link disapearLine}
   * before clipping, so dragging the lift slider visually lifts the hidden-cover bottom edge.
   * False (the default) leaves the disappearance line static.
   */
  isDisapearLineLinkLift: boolean;
  /**
   * Op-codes that gate visibility (from `if`/`values` flattening). Empty array means always visible.
   * Negative codes mean "must NOT be active". See {@link NormalizedElement.ifCodes} on `elements/base.ts`.
   */
  ifCodes: ReadonlyArray<number>;
}

/**
 * Convert a permissive `image[]` array (typically `BeatorajaSkin['image']`) into normalized rectangles. Any entry
 * that lacks `id` is dropped silently — those would be unreferenceable from `destination[]` so keeping them only
 * serves to surface confusing index drift in downstream code.
 */
export function normalizeBeatorajaImages(input: unknown): BeatorajaImageElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaImageElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaImageElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  const timerFunction = isBeatorajaLuaFunctionValue(f.timer) ? f.timer : undefined;
  return {
    id,
    src: sourceIdField(f, 'src', -1),
    x: numberField(f, 'x', 0),
    y: numberField(f, 'y', 0),
    w: numberField(f, 'w', 0),
    h: numberField(f, 'h', 0),
    divx: positiveIntField(f, 'divx', 1),
    divy: positiveIntField(f, 'divy', 1),
    timer: numberField(f, 'timer', 0),
    ...(timerFunction !== undefined ? { timerFunction } : {}),
    cycle: numberField(f, 'cycle', 0),
    ref: numberField(f, 'ref', 0),
    len: numberField(f, 'len', 0),
    act: numberField(f, 'act', 0),
    click: numberField(f, 'click', 0),
    disapearLine: numberField(f, 'disapearLine', -1),
    isDisapearLineLinkLift: boolField(f, 'isDisapearLineLinkLift', false),
    ifCodes: entry.ifCodes,
  };
}

/**
 * Pick the source rect for a given frame index. `frameIndex` is clamped to `[0, divx*divy - 1]`. The cell width /
 * height are derived by integer-dividing `w` / `h` by the cell grid; for a 200x220 image with `divy=11` that yields
 * cells of 200x20 each.
 */
export function imageFrameRect(
  image: BeatorajaImageElement,
  frameIndex: number,
): { x: number; y: number; w: number; h: number } {
  const totalFrames = image.divx * image.divy;
  const safeIndex = totalFrames > 0 ? Math.max(0, Math.min(frameIndex, totalFrames - 1)) : 0;
  const cellW = image.divx > 0 ? Math.floor(image.w / image.divx) : image.w;
  const cellH = image.divy > 0 ? Math.floor(image.h / image.divy) : image.h;
  const col = image.divx > 0 ? safeIndex % image.divx : 0;
  const row = image.divx > 0 ? Math.floor(safeIndex / image.divx) : 0;
  return {
    x: image.x + col * cellW,
    y: image.y + row * cellH,
    w: cellW,
    h: cellH,
  };
}

/**
 * Pick the displayed frame for an animated image at a given elapsed-time tick. Returns `0` when the cycle isn't set
 * (frame stays on cell 0). Designed to be called per-frame from the renderer alongside the runtime `timer` lookup.
 */
export function imageFrameAt(image: BeatorajaImageElement, elapsedMs: number): number {
  if (image.cycle <= 0) return 0;
  const totalFrames = image.divx * image.divy;
  if (totalFrames <= 1) return 0;
  const t = ((elapsedMs % image.cycle) + image.cycle) % image.cycle;
  const frame = Math.floor((t / image.cycle) * totalFrames);
  return Math.min(frame, totalFrames - 1);
}

/**
 * Pick the displayed frame for a `ref`-driven static lookup. `opValue` is whatever the op-code resolved to at
 * runtime (e.g. clear-lamp index). When `len` is set, values are clamped to `[0, len-1]`; otherwise they fall back
 * to `[0, totalFrames-1]`.
 */
export function imageRefFrame(image: BeatorajaImageElement, opValue: number): number {
  const totalFrames = image.divx * image.divy;
  const upper = image.len > 0 ? Math.min(image.len, totalFrames) : totalFrames;
  if (upper <= 0) return 0;
  if (opValue < 0) return 0;
  return Math.min(opValue, upper - 1);
}
