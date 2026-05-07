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
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';

export interface BeatorajaValueElement {
  /** Element id; `destination[]` references this. */
  id: BeatorajaImageId;
  /** Index into `source[]`. -1 when the author left it unset. */
  src: number;
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
   * Padding mode. `0` = pad with the cell at index `divx-1` (typically a blank); `1` = pad with the cell
   * at index 0 (= "0"). Beatoraja's reference theme uses `0` for BPM / time displays (where leading zeros
   * are awkward) and `1` for score / combo (where leading zeros pad to the digit count).
   */
  padding: number;
  /** Source-strip cell-selection ref; resolves through the prop.lua num table. */
  ref: number;
  /** Alignment hint. 0 = right-aligned (default), 1 = center, 2 = left. Most authors use 0. */
  align: number;
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
  return {
    id,
    src: numberField(f, 'src', -1),
    x: numberField(f, 'x', 0),
    y: numberField(f, 'y', 0),
    w: numberField(f, 'w', 0),
    h: numberField(f, 'h', 0),
    divx: positiveIntField(f, 'divx', 1),
    divy: positiveIntField(f, 'divy', 1),
    digit,
    padding: numberField(f, 'padding', 0),
    ref: numberField(f, 'ref', 0),
    align: numberField(f, 'align', 0),
    ifCodes: entry.ifCodes,
  };
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function positiveIntField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const truncated = Math.trunc(v);
  return truncated >= 1 ? truncated : fallback;
}

export interface BeatorajaValueDigitCell {
  /** Source-rect coordinates for this digit's cell. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Cell index inside the strip (`0..divx-1`). Useful for renderers that want to skip emitting an
   * invisible "blank" cell when `padding = 0` and the value doesn't fill the digit count.
   */
  cell: number;
}

/**
 * Compose a numeric value into per-digit cells. Returns `digit` entries laid out left-to-right; the
 * caller positions each cell across the destination rect (typically by dividing rect width by digit).
 *
 * Rules (mirrors beatoraja's reference behavior):
 *   - Negative numbers borrow cell `divx-1` (= minus sign by convention) for the leading character; the
 *     rest of the cells render the absolute-value digits.
 *   - When `padding = 0`, leading cells are the "blank" cell at index `divx-1` (typical for BPM / time).
 *     When `padding = 1`, leading cells are "0" (cell index 0, typical for score / combo).
 *   - Digit cells beyond what the source strip provides clamp to the last valid cell — degrades
 *     gracefully when the author declared `digit = 8` against a `divx = 10` strip and the number is
 *     larger than 99 999 999 (rare).
 */
export function composeBeatorajaValueCells(
  element: BeatorajaValueElement,
  value: number,
): BeatorajaValueDigitCell[] {
  const digits = Math.max(1, Math.trunc(element.digit));
  const cells: BeatorajaValueDigitCell[] = Array.from({ length: digits });
  const divx = Math.max(1, element.divx);
  const blankCell = Math.min(divx - 1, divx - 1); // `divx - 1` is the conventional blank / sign cell.
  const zeroCell = 0;

  // Stringify the absolute value with leading-zero padding wide enough to fit the digit count.
  const safeValue = Number.isFinite(value) ? Math.trunc(value) : 0;
  const isNegative = safeValue < 0;
  const abs = Math.abs(safeValue);
  const raw = abs.toString(10);

  // Compose the per-cell sequence right-to-left, then reverse for left-to-right layout.
  const reversed: number[] = [];
  for (let i = 0; i < digits; i += 1) {
    if (i < raw.length) {
      // Digit position from the right edge.
      const ch = raw[raw.length - 1 - i]!;
      const idx = ch.charCodeAt(0) - 48;
      reversed.push(idx >= 0 && idx < divx ? idx : Math.min(divx - 1, idx));
    } else if (isNegative && i === raw.length) {
      // Place minus sign in the cell just before the highest-order digit. We honor `divx >= 11`
      // (cell 10 = "-"); for `divx == 10` the strip has no minus cell, so we fall through to the
      // padding rule.
      reversed.push(divx >= 11 ? 10 : element.padding === 1 ? zeroCell : blankCell);
    } else {
      reversed.push(element.padding === 1 ? zeroCell : blankCell);
    }
  }

  // Reverse into left-to-right.
  const sequence = reversed.reverse();

  const cellW = Math.floor(element.w / divx);
  const cellH = Math.floor(element.h / Math.max(1, element.divy));

  for (let i = 0; i < digits; i += 1) {
    const idx = sequence[i] ?? 0;
    cells[i] = {
      x: element.x + idx * cellW,
      y: element.y, // single-row strips; multi-row (divy > 1) is rare for digits and uses the first row.
      w: cellW,
      h: cellH,
      cell: idx,
    };
  }
  return cells;
}
