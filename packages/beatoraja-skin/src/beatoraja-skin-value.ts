// Strict-typed normalization for beatoraja `value[]` entries.
//
// `value[]` declares numeric readouts that share the source-cropping shape with `image[]` (`src`, `x`,
// `y`, `w`, `h`, `divx` / `divy` cell grid) but additionally carry `digit` / `padding` / `align` fields
// describing how the dynamic number is composed onto the rendered rect.
//
// Example (`play24.json`):
//
//   { id: 400, src: 5, x: 0, y: 0, w: 240, h: 24, divx: 10, digit: 4, ref: 91 }
//
// Reads as: "render a 4-digit number in source 5 (number strip with cells 0..9 across 240×24); the
// value to display is prop.lua num code 91 (`minbpm`)". The renderer:
//
//   1. Resolves `ref` → current numeric value (via the adapter's prop.lua-num map).
//   2. Stringifies to base 10 with `digit` digits (right-aligned, `padding` controls fill character).
//   3. Crops one cell per digit from the source strip and lays them side-by-side across the
//      destination rect.
//
// `divx` typically encodes the cell count: 10 = digits only, 11 = digits + minus sign at cell 10,
// 12 = digits + minus + space (the "blank" used for right-alignment with leading spaces). We honor
// whichever the author declares — clamping resolved digit indices into `[0, divx-1]` so a malformed
// `divx = 10` declaration with `padding = 0` (leading-blank) silently falls back to leading zero.

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import { isBeatorajaLuaFunctionValue, type BeatorajaLuaFunctionValue } from './beatoraja-skin-lua.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';
import type { BeatorajaSkinSourceId } from './beatoraja-skin-types.ts';

export type BeatorajaIntegerPropertyRef = number | BeatorajaLuaFunctionValue;

export interface BeatorajaValueElement {
  /** Element id; `destination[]` references this. */
  id: BeatorajaImageId;
  /** `source[].id` reference. Numeric and symbolic string ids are both valid. */
  src: BeatorajaSkinSourceId;
  /** Source rect — full strip including every digit cell. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Cell grid. `divx` = digits in the strip (typically 10, sometimes 11 for minus sign or 12 for blank). */
  divx: number;
  divy: number;
  /** Number of digits to display. `0` is invalid; treated as 1. */
  digit: number;
  /**
   * Padding mode for digit-only strips (`divx <= 10`). Values mirror beatoraja's
   * {@code value.padding} after its loader's d-based dispatch:
   *
   * - `0` — Pad with the cell at index `divx-1` (typically a blank glyph for `divx>=11`),
   *   or HIDE the slot when the strip is digits-only (`divx==10`). This matches beatoraja's
   *   "no pad / null leading slots" behavior on 10-cell strips.
   * - `1` — Pad with cell `0` ("0"). Used by score / combo / count readouts that want
   *   leading zeros (e.g. `00008722`).
   *
   * Note: the JSON loader path inside beatoraja CONSULTS `padding` only when `divx <= 10`.
   * For `divx > 10` (= 11-cell strips), beatoraja hardcodes pad=2 (blank); the renderer
   * here mirrors that by always painting cell `divx-1` for the leading slots regardless
   * of `padding` when `divx >= 11`. For `divx == 24` (signed dual-strip, two 12-cell
   * halves), beatoraja consults {@link zeropadding} instead — see that field's doc.
   */
  padding: number;
  /**
   * Pad mode for the 24-cell signed dual-strip layout (`divx % 24 == 0`). Same value space
   * as Java's {@code SkinNumber.zeropadding}: `1` = pad with cell 0 ("0"), `2` = pad with
   * cell 10 (blank), other values = no pad / null slots. Default `0`.
   *
   * Currently parsed but only meaningful when 24-cell strip support lands (audit 2.7); for
   * now the composer doesn't enter the dual-strip branch, so the field is preserved
   * verbatim from the JSON for forward-compat with that future change.
   */
  zeropadding: number;
  /**
   * Inter-digit pixel gap. Mirrors {@code SkinNumber.space} — added to each slot's width
   * when computing horizontal positions, so digit `j` sits at
   * `region.x + (region.width + space) * j - shift`. Most skins author `0`; some banner
   * fonts use small positive values to match the source font's natural spacing.
   */
  space: number;
  /** Source-strip cell-selection ref; resolves through the prop.lua num table. */
  ref: number;
  /** Optional `value` IntegerProperty. Beatoraja evaluates this instead of `ref` when authored. */
  valueProperty?: BeatorajaIntegerPropertyRef;
  /**
   * Horizontal alignment of the digit row within `dst.w * digit` (the strip's full visual width).
   * Mirrors beatoraja's {@code SkinNumber.align}:
   *
   * - `0` — RIGHT (no shift; leading blank / zero / hidden slots stay on the LEFT, the actual
   *   significant digits land on the right side of the strip). This is what most authors use for
   *   score / combo / ms readouts.
   * - `1` — LEFT. The whole digit row is shifted leftward by `shiftbase * (slotWidth + space)`,
   *   where `shiftbase` is the number of leading non-significant slots (`digit - usedDigits -
   *   signCount`). Visually: leading blanks slide off the left edge of the rect, the actual
   *   digits flush against the rect's left edge.
   * - `2` — CENTER. Same shift formula but halved, so the digits sit centered in the rect.
   *
   * The earlier comment incorrectly described `0 = right, 1 = center, 2 = left` (mirrored from
   * an LR2 convention); beatoraja's renderer uses the layout above. The renderer applies the
   * shift via `composeBeatorajaValueShift` rather than the composer, since the leading-slot
   * count depends on the runtime value, not the static cell layout.
   */
  align: number;
  /**
   * Per-digit secondary offset ids — one offset id per slot. Mirrors upstream's
   * `SkinNumber.draw()` `+ offsets[j].x / offsets[j].y` term: each digit slot j adds
   * `(offset.x, offset.y)` from its authored offset id (resolved via the host's
   * `resolveOffset`). Authored as `value[].offset = [10, 20, 30, ...]` (parallel array
   * with one id per slot up to {@link digit}); slots without a corresponding entry get
   * no per-digit offset.
   *
   * Empty (= `[]`) when the author didn't author per-digit offsets, which is the common
   * case. Default skin / GdbG / ModernChic don't currently use this — the field is
   * preserved for community skins that author per-digit chrome positioning.
   */
  offsets: ReadonlyArray<number>;
  /**
   * Animation cycle in milliseconds — mirrors upstream `SkinNumber`'s `cycle` field which is
   * passed straight to `SkinSourceImageSet(image, timer, cycle)` (`SkinNumber.java:73`). When
   * `cycle > 0` the source image set walks `divy` rows over the cycle period:
   *
   *   `frame = (time * divy / cycle) % divy`  (`SkinSourceImageSet.java:87`)
   *
   * `0` (default) keeps the strip on row 0 — matches upstream's `cycle == 0` early-return
   * branch (`SkinSourceImageSet.java:73-75`).
   *
   * Used by ModernChic's `judgen-*` combo digits (cycle=80/120, divy=2/3) so the digits cycle
   * through the strip's vertically-stacked color frames in sync with the matching judge-text
   * animation. Without honoring this, every digit always painted from row 0 — visually a
   * single-color readout where upstream cycles through 2-3 colors.
   */
  cycle: number;
  /** Op-codes that gate visibility (from `if`/`values` flattening). */
  ifCodes: ReadonlyArray<number>;
}

/**
 * Normalize a permissive `value[]` array into typed entries. Drops entries without a usable id (those
 * couldn't be referenced from `destination[]` anyway).
 */
export function normalizeBeatorajaValues(input: unknown): BeatorajaValueElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaValueElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaValueElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  const digit = positiveIntField(f, 'digit', 1);
  const valueProperty = integerPropertyField(f.value);
  return {
    id,
    src: sourceIdField(f, 'src', -1),
    x: numberField(f, 'x', 0),
    y: numberField(f, 'y', 0),
    w: numberField(f, 'w', 0),
    h: numberField(f, 'h', 0),
    divx: positiveIntField(f, 'divx', 1),
    divy: positiveIntField(f, 'divy', 1),
    digit,
    padding: numberField(f, 'padding', 0),
    zeropadding: numberField(f, 'zeropadding', 0),
    space: numberField(f, 'space', 0),
    ref: numberField(f, 'ref', 0),
    ...(valueProperty !== undefined ? { valueProperty } : {}),
    align: numberField(f, 'align', 0),
    offsets: numberArrayField(f, 'offset'),
    cycle: numberField(f, 'cycle', 0),
    ifCodes: entry.ifCodes,
  };
}

function numberArrayField(record: Readonly<Record<string, unknown>>, key: string): ReadonlyArray<number> {
  const v = record[key];
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    if (typeof x === 'number' && Number.isFinite(x)) out.push(x);
  }
  return out;
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function integerPropertyField(value: unknown): BeatorajaIntegerPropertyRef | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isBeatorajaLuaFunctionValue(value)) return value;
  return undefined;
}

function sourceIdField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  fallback: BeatorajaSkinSourceId,
): BeatorajaSkinSourceId {
  const v = record[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.length > 0) return v;
  return fallback;
}

function positiveIntField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const truncated = Math.trunc(v);
  return truncated >= 1 ? truncated : fallback;
}

export interface BeatorajaValueDigitCell {
  /** Source-rect coordinates for this digit's cell. Ignored when {@link hidden} is `true`. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Cell index inside the strip (`0..divx-1`). `-1` when the slot has no glyph to display (only
   * possible when {@link hidden} is `true`).
   */
  cell: number;
  /**
   * `true` for leading slots that should NOT paint anything — e.g. `value = 0` rendered into a 4-digit
   * `padding = 0` slot of a `divx = 10` strip (digits-only, no blank cell). The renderer hides the
   * matching sprite so the slot is visually empty rather than filled with a stray "9" cell.
   */
  hidden: boolean;
}

/**
 * Compose a numeric value into per-digit cells. Returns `keta` entries laid out left-to-right
 * (slot index 0 = leftmost, slot index keta-1 = rightmost = least-significant digit).
 *
 * Mirrors `SkinNumber.prepare()` (`SkinNumber.java:161-184`) — a right-to-left walk consuming
 * one digit per step, with branching on `(mimage != null, zeropadding)`. Audit A-3 (2024-12)
 * re-aligned the 24-cell branch to use `value.zeropadding` (NOT `value.padding`) and emit the
 * sign cell at the leftmost slot when `zeropadding > 0`, matching upstream's
 * `if (mimage != null && zeropadding > 0)` branch.
 *
 * ─── Pad-mode dispatch (per `JsonSkinObjectLoader.java:103-167`) ────────────────────────────
 *   - **24-cell** (`divx % 24 == 0`): SkinNumber's `zeropadding` param ← `value.zeropadding`.
 *   - **11-cell** (`divx == 11` after %10!=0 fallback): forced to `2` (blank pad).
 *   - **10-cell** (`divx == 10`): SkinNumber's `zeropadding` param ← `value.padding`.
 *
 * ─── Per-slot logic (per `SkinNumber.java:161-184`) ──────────────────────────────────────────
 * Walk j from `keta-1` to `0`, decrementing `value` by `value /= 10` each step:
 *
 *   1. **24-cell with zp > 0** (`mimage != null && zeropadding > 0`):
 *      - `j == 0`: cell 11 (sign cell of active half — 11 for positive, 23 for negative).
 *      - `value > 0 || j == keta-1`: digit cell `value % 10` in active half.
 *      - else: pad cell — `10` (blank, `zp == 2`) or `0` (zero, `zp == 1`) in active half.
 *
 *   2. **24-cell with zp == 0** OR **single-strip**:
 *      - `value > 0 || j == keta-1`: digit cell `value % 10` in active half.
 *      - else if `zp == 2`: pad cell `10` (blank).
 *      - else if `zp == 1`: pad cell `0` (zero).
 *      - else (`zp == 0`):
 *        - 24-cell only: place sign cell `11` to the LEFT of leftmost non-null slot (chained
 *          from `currentImages[j+1] != image[11] && != null` upstream).
 *        - single-strip: hidden (= upstream's `null` slot).
 *
 * Negative values: `value = Math.abs(value)` BEFORE the loop (`SkinNumber.java:160`), and the
 * active "half" picks `mimage` instead of `image` for 24-cell mode. Single-strip with
 * `mimage == null` renders negatives identically to their absolute value (no sign).
 */
export function composeBeatorajaValueCells(
  element: BeatorajaValueElement,
  value: number,
  /**
   * Animation frame index — selects which `divy` row the digit cells crop from. Defaults to
   * `0` (= row 0, matching the previous behaviour where strips animated on every cycle were
   * silently rendered from frame 0 only). Caller computes the index via {@link valueFrameAt}
   * (or supplies `0` for unanimated strips). Indices are clamped to `[0, divy-1]` — values
   * outside the range collapse to the nearest valid frame, mirroring upstream's
   * `SkinSourceImageSet.getImageIndex` clamp.
   *
   * The 24-cell signed-dual-strip mode (divx % 24 == 0) ignores this argument: in upstream
   * the dual-strip slicing produces `divx*divy/24` frames each containing a 12+12 cell row,
   * which is a different shape than the simple `[divy][divx]` layout this composer assumes
   * for animation. We keep the dual-strip composer single-frame for now (matches the few
   * skins that author divx=24 with divy=1 + cycle=0).
   */
  frameIndex: number = 0,
): BeatorajaValueDigitCell[] {
  const keta = Math.max(1, Math.trunc(element.digit));
  const divx = Math.max(1, element.divx);
  const isSignedDualStrip = divx % 24 === 0;
  // halfDivx: the per-half cell count (12 for 24-cell, divx for single-strip).
  const halfDivx = isSignedDualStrip ? divx / 2 : divx;

  // Pad-mode dispatch (mirrors `JsonSkinObjectLoader.java:103-167`).
  let zeropaddingMode: number;
  if (isSignedDualStrip) {
    zeropaddingMode = Math.trunc(element.zeropadding);
  } else if (halfDivx === 11) {
    zeropaddingMode = 2; // upstream forces zp=2 for 11-cell (`d > 10 ? 2 : value.padding`).
  } else {
    zeropaddingMode = Math.trunc(element.padding);
  }

  // Sign-cell index inside a half. Upstream uses `image[11]` regardless of the half's actual
  // size; for our typical 12-cell half that lands on cell 11 (the conventional sign glyph).
  // For 11-cell or 10-cell single-strip this index doesn't get used (single-strip with
  // `mimage == null` never emits a sign cell).
  const signCellInHalf = 11;

  const safeValue = Number.isFinite(value) ? Math.trunc(value) : 0;
  const isNegative = safeValue < 0;
  // Active half offset for cell-index translation (24-cell only; single-strip ignores).
  const activeHalfOffset = isSignedDualStrip && isNegative ? halfDivx : 0;
  let absValue = Math.abs(safeValue);

  type Slot = { cell: number; hidden: boolean };
  const slots: Slot[] = new Array(keta);

  // RTL walk — mirrors SkinNumber.java:161 `for (int j = currentImages.length - 1; j >= 0; j--)`.
  for (let j = keta - 1; j >= 0; j -= 1) {
    if (isSignedDualStrip && zeropaddingMode > 0) {
      // ─ 24-cell-with-zp branch (`SkinNumber.java:162-169`) ─
      if (j === 0) {
        // Leftmost slot is ALWAYS the sign cell when zp > 0 in dual-strip mode.
        slots[j] = { cell: signCellInHalf + activeHalfOffset, hidden: false };
      } else if (absValue > 0 || j === keta - 1) {
        const digit = absValue % 10;
        slots[j] = { cell: digit + activeHalfOffset, hidden: false };
        absValue = Math.floor(absValue / 10);
      } else {
        const padCell = zeropaddingMode === 2 ? 10 : 0;
        slots[j] = { cell: padCell + activeHalfOffset, hidden: false };
      }
    } else {
      // ─ Catch-all branch (`SkinNumber.java:170-176`) ─
      if (absValue > 0 || j === keta - 1) {
        const digit = absValue % 10;
        // Clamp digit to the active half's range — guards against `divx < 10` edge cases.
        const cellIdx = digit < halfDivx ? digit : halfDivx - 1;
        slots[j] = { cell: cellIdx + activeHalfOffset, hidden: false };
        absValue = Math.floor(absValue / 10);
      } else if (zeropaddingMode === 2) {
        // Blank pad — cell 10 in active half for 24-cell, cell `divx-2` for single-strip 12+,
        // cell `divx-1` for single-strip 11. We use cell index 10 uniformly because:
        //   - 24-cell: cell 10 = blank in each half. ✓
        //   - 11-cell: zp gets forced to 2; cell 10 = sign cell of 11-cell strip (upstream
        //     uses cell 10 here too, so SAME index — happens to double as sign+blank).
        //   - 10-cell: zp wasn't 2 unless author authored padding=2; rare. Cell index 9
        //     would be "9" digit; clamp to halfDivx-1 = 9. Imperfect for 10-cell zp=2 but
        //     matches upstream which would also produce a "9"-glyph leading slot.
        const cellIdx = halfDivx >= 11 ? 10 : halfDivx - 1;
        slots[j] = { cell: cellIdx + activeHalfOffset, hidden: false };
      } else if (zeropaddingMode === 1) {
        // Zero pad — cell 0 in active half.
        slots[j] = { cell: 0 + activeHalfOffset, hidden: false };
      } else if (isSignedDualStrip) {
        // 24-cell with zp == 0: place sign cell to the LEFT of the leftmost non-null slot,
        // hide everything else. Mirrors upstream's `mimage != null && currentImages[j+1] !=
        // image[11] && currentImages[j+1] != null ? image[11] : null` chain — the loop walks
        // RTL, so `slots[j+1]` is the slot we just filled.
        const next = slots[j + 1];
        const signCellAbsolute = signCellInHalf + activeHalfOffset;
        if (next !== undefined && !next.hidden && next.cell !== signCellAbsolute) {
          slots[j] = { cell: signCellAbsolute, hidden: false };
        } else {
          slots[j] = { cell: 0, hidden: true };
        }
      } else {
        // Single-strip with zp == 0: leading slots are HIDDEN (upstream's `null` branch).
        slots[j] = { cell: 0, hidden: true };
      }
    }
  }

  const cellW = Math.floor(element.w / divx);
  const divy = Math.max(1, element.divy);
  const cellH = Math.floor(element.h / divy);
  // Clamp the requested animation frame into `[0, divy-1]`. Mirrors upstream's
  // `SkinSourceImageSet.getImageIndex` which `% length`-folds the frame index. We additionally
  // skip frame indexing for 24-cell signed dual-strip mode — see the {@link frameIndex} doc.
  const frame =
    isSignedDualStrip || divy <= 1
      ? 0
      : Math.min(divy - 1, Math.max(0, Math.trunc(Number.isFinite(frameIndex) ? frameIndex : 0)));
  const yWithFrame = element.y + frame * cellH;
  return slots.map((slot) => ({
    x: element.x + slot.cell * cellW,
    y: yWithFrame,
    w: cellW,
    h: cellH,
    cell: slot.hidden ? -1 : slot.cell,
    hidden: slot.hidden,
  }));
}

/**
 * Pick the displayed animation frame index for a `value[]` strip at a given elapsed-time tick.
 * Mirrors upstream's `SkinSourceImageSet.getImageIndex` (`SkinSourceImageSet.java:73-87`):
 *
 *   if (cycle == 0) return 0;
 *   return (int) ((time * length / cycle) % length);
 *
 * Where `length` is the number of frames — for our composer that's `divy` (single-strip layout
 * sliced as `[divy][divx]`). Returns `0` for unanimated strips (`cycle <= 0`) or single-row
 * strips (`divy <= 1`), matching upstream's early-return.
 *
 * Negative `elapsedMs` is folded into the cycle window so the strip stays on a valid frame
 * during pre-roll / pre-timer-start states (instead of returning `-N` which would crop above
 * the strip's top edge). This mirrors upstream's `if (time < 0) return 0;` guard.
 */
export function valueFrameAt(element: BeatorajaValueElement, elapsedMs: number): number {
  if (element.cycle <= 0) return 0;
  const length = Math.max(1, Math.trunc(element.divy));
  if (length <= 1) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  // Floor-mod over the cycle window. Upstream uses Java's integer `%`; we mirror it via
  // `Math.floor` so negative elapsed (pre-timer) maps to frame 0 above.
  const t = Math.floor(elapsedMs) % element.cycle;
  return Math.min(length - 1, Math.floor((t * length) / element.cycle));
}

/**
 * Compute the horizontal pixel shift to apply across every digit slot to honor `element.align`.
 * Mirrors `SkinNumber.prepare()` (`SkinNumber.java:185-186`):
 *
 *     length = (region.width + space) * (currentImages.length - shiftbase);
 *     shift = align == 0 ? 0
 *           : align == 1 ? (region.width + space) * shiftbase
 *           : (region.width + space) * 0.5f * shiftbase;
 *
 * Where `shiftbase` is the count of `null` slots (= leading non-significant slots that the
 * renderer SKIPS, leaving them blank in screen coords). Audit A-3 (2024-12) re-derives
 * shiftbase from {@link composeBeatorajaValueCells}'s `hidden` flag instead of the previous
 * "digit length minus significant digits" estimate, so the dispatch matches upstream's
 * 4-branch logic in `SkinNumber.java:161-184` (especially the 24-cell with zeropadding=0
 * case where the sign cell occupies a slot the previous estimate counted as null).
 *
 * `slotWidth` is the rendered width of one digit cell (typically `dst.w` since beatoraja
 * authors set `dst.w` to the per-digit slot width). The element's `space` (inter-digit gap)
 * is added to slotWidth to match upstream's `(region.width + space) * shiftbase` formula.
 * The renderer subtracts the returned shift from each slot's `x` coordinate, so positive
 * values shift the whole row LEFT (= `align == 1`, LEFT-flush) or HALF-LEFT (= `align == 2`,
 * CENTER).
 */
export function composeBeatorajaValueShift(element: BeatorajaValueElement, value: number, slotWidth: number): number {
  if (element.align !== 1 && element.align !== 2) return 0;
  const cells = composeBeatorajaValueCells(element, value);
  let shiftbase = 0;
  for (const cell of cells) {
    if (cell.hidden) shiftbase += 1;
  }
  if (shiftbase === 0) return 0;
  const space = Number.isFinite(element.space) ? element.space : 0;
  const baseShift = shiftbase * (slotWidth + space);
  return element.align === 1 ? baseShift : baseShift * 0.5;
}
