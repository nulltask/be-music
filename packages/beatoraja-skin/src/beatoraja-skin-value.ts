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
  const hasBlankCell = divx >= 11;
  const blankCell = hasBlankCell ? divx - 1 : -1;
  const zeroCell = 0;

  // Stringify the absolute value with leading-zero padding wide enough to fit the digit count.
  const safeValue = Number.isFinite(value) ? Math.trunc(value) : 0;
  const isNegative = safeValue < 0;
  const abs = Math.abs(safeValue);
  const raw = abs.toString(10);

  type Slot = { cell: number; hidden: boolean };
  const reversed: Slot[] = [];
  for (let i = 0; i < digits; i += 1) {
    if (i < raw.length) {
      // Digit position from the right edge — always painted.
      const ch = raw[raw.length - 1 - i]!;
      const idx = ch.charCodeAt(0) - 48;
      reversed.push({ cell: idx >= 0 && idx < divx ? idx : Math.min(divx - 1, idx), hidden: false });
    } else if (isNegative && i === raw.length) {
      // Minus sign slot. When the strip carries no blank / sign cells, hide the slot entirely.
      reversed.push({ cell: hasBlankCell ? blankCell : 0, hidden: !hasBlankCell });
    } else if (element.padding === 1) {
      // Leading-zero pad — paint cell 0.
      reversed.push({ cell: zeroCell, hidden: false });
    } else if (hasBlankCell) {
      // Leading-blank pad — paint the strip's authored blank cell.
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
