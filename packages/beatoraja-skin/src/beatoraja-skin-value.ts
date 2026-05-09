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
 * Compose a numeric value into per-digit cells. Returns `digit` entries laid out left-to-right; the
 * caller positions each cell across the destination rect (typically by dividing rect width by digit).
 *
 * Rules (mirrors beatoraja's reference behavior, verified against `play24.json`):
 *
 * - **Padding 1 (leading zeros)**: leading slots use cell `0` (the "0" digit). Common for score /
 *   combo / max-combo readouts ("00008722").
 * - **Padding 0 (default)**: leading slots use either:
 *   - cell `divx-1` if the strip carries an explicit blank glyph (`divx >= 11` — beatoraja's number
 *     atlas typically reserves cell 10 for a blank, cell 11 for "+", cell 12 for "-"), OR
 *   - **hidden** (`hidden: true`) when the strip is digits-only (`divx == 10`). The renderer omits
 *     the slot entirely instead of falling through to cell 9 ("9"), which would paint stray digits
 *     for every zero / short-of-`digit`-wide value (e.g. `value = 0`, `digit = 4` rendered "9990"
 *     against a digits-only strip).
 * - **Negative numbers**: cell `divx-1` (or `divx-2` for `divx == 12` where cell 11 is "+") is used
 *   for the minus-sign slot. For digits-only strips, the sign is hidden along with leading blanks.
 * - **Overflow**: a value wider than the digit count silently truncates to the lowest digits — beatoraja
 *   itself behaves the same way, and the alternative ("show all 9s") is more confusing for the player.
 */
export function composeBeatorajaValueCells(element: BeatorajaValueElement, value: number): BeatorajaValueDigitCell[] {
  const digits = Math.max(1, Math.trunc(element.digit));
  const cells: BeatorajaValueDigitCell[] = Array.from({ length: digits });
  const divx = Math.max(1, element.divx);

  // 24-cell signed dual-strip detection (audit 2.7). Beatoraja's
  // `JsonPlaySkinObjectLoader.java:103-115` checks `images.length % 24 == 0` and splits the
  // strip into a 12-cell positive half (cells 0..11) + 12-cell negative half (cells 12..23).
  // Cells 0..9 are the digits, 10 is the blank glyph, 11 is the sign — the negative half is
  // the same layout offset by 12 (negative-coloured glyphs baked in, no separate sign cell
  // needed at draw time). Compose against the active half, picking the offset based on the
  // numeric sign.
  const isSignedDualStrip = divx % 24 === 0;
  const halfDivx = isSignedDualStrip ? divx / 2 : divx;
  const hasBlankCell = halfDivx >= 11;
  // For the 24-cell dual-strip path each half is `halfDivx = 12` cells: 0..9 digits, 10
  // blank, 11 reserved (sign in beatoraja's atlas — unused since the sign is baked into
  // negative-coloured digits). Blank lives at `halfDivx - 2 = 10`. The legacy single-strip
  // path keeps the historic `divx - 1` cell for backward compat (a known imprecision when
  // divx == 12 — the single-strip blank index lands on the sign cell, but every fix-tested
  // skin authors against this), so only override the blank index for the dual-strip case.
  const blankCellInHalf = !hasBlankCell ? -1 : isSignedDualStrip ? halfDivx - 2 : halfDivx - 1;
  const zeroCellInHalf = 0;

  // Stringify the absolute value with leading-zero padding wide enough to fit the digit count.
  const safeValue = Number.isFinite(value) ? Math.trunc(value) : 0;
  const isNegative = safeValue < 0;
  const abs = Math.abs(safeValue);
  const raw = abs.toString(10);

  // For dual-strip, every cell within the active half gets shifted to the matching half. The
  // blank cell stays inside the half (so a blank slot in negative mode picks cell 22, not 10).
  const halfOffset = isSignedDualStrip && isNegative ? halfDivx : 0;
  const blankCell = blankCellInHalf >= 0 ? blankCellInHalf + halfOffset : -1;
  const zeroCell = zeroCellInHalf + halfOffset;

  type Slot = { cell: number; hidden: boolean };
  const reversed: Slot[] = [];
  for (let i = 0; i < digits; i += 1) {
    if (i < raw.length) {
      // Digit position from the right edge — always painted. Offset into the active half so
      // negative dual-strip values pick the negative-coloured digit cells.
      const ch = raw[raw.length - 1 - i]!;
      const idx = ch.charCodeAt(0) - 48;
      const cellInHalf = idx >= 0 && idx < halfDivx ? idx : Math.min(halfDivx - 1, idx);
      reversed.push({ cell: cellInHalf + halfOffset, hidden: false });
    } else if (isNegative && i === raw.length && !isSignedDualStrip) {
      // Minus sign slot for SINGLE-strip (`divx == 11/12`) layouts. The dual-strip path bakes
      // the sign into the digits themselves, so this branch only fires for the legacy single
      // strip. When the strip carries no sign / blank cell at all, hide the slot.
      reversed.push({ cell: hasBlankCell ? blankCell : 0, hidden: !hasBlankCell });
    } else if (element.padding === 1) {
      // Leading-zero pad — paint cell 0 (within the active half for dual-strip).
      reversed.push({ cell: zeroCell, hidden: false });
    } else if (hasBlankCell) {
      // Leading-blank pad — paint the strip's authored blank cell (within the active half).
      reversed.push({ cell: blankCell, hidden: false });
    } else {
      // Digits-only strip + leading-blank pad → hide the slot. Renderer skips the matching sprite.
      reversed.push({ cell: 0, hidden: true });
    }
  }

  const sequence = reversed.reverse();
  const cellW = Math.floor(element.w / divx);
  const cellH = Math.floor(element.h / Math.max(1, element.divy));

  for (let i = 0; i < digits; i += 1) {
    const slot = sequence[i] ?? { cell: 0, hidden: true };
    cells[i] = {
      x: element.x + slot.cell * cellW,
      y: element.y,
      w: cellW,
      h: cellH,
      cell: slot.hidden ? -1 : slot.cell,
      hidden: slot.hidden,
    };
  }
  return cells;
}

/**
 * Compute the horizontal pixel shift to apply across every digit slot to honor `element.align`.
 * Mirrors the {@code shift = align == 0 ? 0 : (align == 1 ? (w+space)*shiftbase : (w+space)*0.5*shiftbase)}
 * formula from beatoraja's `SkinNumber.prepare()`.
 *
 * `shiftbase` is the count of LEADING non-significant slots — the slots that would render as a
 * blank glyph, a leading zero, or be hidden entirely (digits-only strip + leading-blank pad).
 * For `value = 5`, `digit = 4`, `padding = 0` → `shiftbase = 3` (three leading nulls). For
 * `value = -7`, `digit = 4` → `shiftbase = 2` (two leading nulls; the sign occupies one slot).
 *
 * `slotWidth` is the rendered width of one digit cell (typically `dst.w` since beatoraja
 * authors set `dst.w` to the per-digit slot width). The element's `space` (inter-digit gap)
 * is added to slotWidth to match beatoraja's `(region.width + space) * shiftbase` formula.
 * The renderer subtracts the returned shift from each slot's `x` coordinate, so positive
 * values shift the whole row LEFT.
 */
export function composeBeatorajaValueShift(
  element: Pick<BeatorajaValueElement, 'align' | 'digit' | 'space'>,
  value: number,
  slotWidth: number,
): number {
  if (element.align !== 1 && element.align !== 2) return 0;
  const digits = Math.max(1, Math.trunc(element.digit));
  const safeValue = Number.isFinite(value) ? Math.trunc(value) : 0;
  const significant = Math.abs(safeValue).toString(10).length + (safeValue < 0 ? 1 : 0);
  const shiftbase = Math.max(0, digits - significant);
  const space = Number.isFinite(element.space) ? element.space : 0;
  const baseShift = shiftbase * (slotWidth + space);
  return element.align === 1 ? baseShift : baseShift * 0.5;
}
