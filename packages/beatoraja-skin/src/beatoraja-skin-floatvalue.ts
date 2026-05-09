// Strict-typed normalization for beatoraja `floatvalue[]` declarations (audit 3.5).
//
// `floatvalue` is the decimal-number cousin of `value[]` — same digit-strip cell layout, but
// the rendered number includes a decimal point. The result screen authors these for BPM
// (`123.4`), accuracy percentages (`98.76 %`), average timing deltas (`+5.23 ms`), etc. The
// integer / fractional digit counts are configured separately via `iketa` / `fketa`, and
// `gain` lets authors apply a runtime multiplier (e.g. `gain = 0.01` to convert a 100x op to
// the displayed percentage).
//
// Composer below mirrors beatoraja's `SkinNumber` draw path for floats: integer half (right-
// aligned to its digit count) + dot cell + fractional half (left-aligned, zero-padded). The
// dot cell index is derived from the strip's `divx`: a 12-cell strip uses cell 11, a 24-cell
// signed dual-strip uses cell 11 (positive) or cell 23 (negative), digits-only strips hide
// the dot slot.

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';
import type { BeatorajaSkinSourceId } from './beatoraja-skin-types.ts';
import type { BeatorajaIntegerPropertyRef, BeatorajaValueDigitCell } from './beatoraja-skin-value.ts';

export interface BeatorajaFloatValueElement {
  /** Element id; `destination[]` references this. Same id space as `image[]` / `value[]`. */
  id: BeatorajaImageId;
  /** `source[].id` reference. Numeric and symbolic string ids are both valid. */
  src: BeatorajaSkinSourceId;
  /** Source-strip rect. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Cell grid. Same convention as `value[]` — `divx >= 11` carries a sign cell, etc. */
  divx: number;
  divy: number;
  /** Integer-portion digit count (whole number to the LEFT of the decimal point). */
  iketa: number;
  /** Fractional-portion digit count (digits to the RIGHT of the decimal point). */
  fketa: number;
  /**
   * Runtime value multiplier. Beatoraja stores it as float; common values: `1.0` (default —
   * no scaling), `0.01` (display a 100x op as a percentage), `0.001` (millisecond → second).
   */
  gain: number;
  /**
   * `true` to always render the leading `+` / `-` sign. `false` (default) hides the `+` for
   * non-negative values. Negative values always render the sign regardless.
   */
  isSignvisible: boolean;
  /** Inter-digit gap, same as `value[].space`. */
  space: number;
  /** Padding mode for the integer half (10-cell strip path). Same semantics as `value.padding`. */
  padding: number;
  /** Padding mode for the 24-cell signed dual-strip path. Same semantics as `value.zeropadding`. */
  zeropadding: number;
  /** Alignment hint, same numeric semantics as `value.align` (0=right, 1=left, 2=center). */
  align: number;
  /** Op-code reference for the dynamic numeric value. `0` = no ref. */
  ref: number;
  /** Optional `value` FloatProperty. Beatoraja evaluates this instead of `ref` when authored. */
  valueProperty?: BeatorajaIntegerPropertyRef;
  /** `if` codes that gate visibility (from `if`/`values` flattening). */
  ifCodes: ReadonlyArray<number>;
}

/**
 * Normalize a permissive `floatvalue[]` array into typed entries. Same shape as
 * `normalizeBeatorajaValues` but emits `BeatorajaFloatValueElement` records — the float-value
 * renderer can pick them up without de-duplicating against the integer-only path.
 */
export function normalizeBeatorajaFloatValues(input: unknown): BeatorajaFloatValueElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaFloatValueElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaFloatValueElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  const valueProperty = integerPropertyField(f.value);
  return {
    id,
    src: sourceIdField(f.src, -1),
    x: numberField(f, 'x', 0),
    y: numberField(f, 'y', 0),
    w: numberField(f, 'w', 0),
    h: numberField(f, 'h', 0),
    divx: positiveIntField(f, 'divx', 1),
    divy: positiveIntField(f, 'divy', 1),
    iketa: numberField(f, 'iketa', 0),
    fketa: numberField(f, 'fketa', 0),
    gain: numberField(f, 'gain', 1),
    isSignvisible: f.isSignvisible === true,
    space: numberField(f, 'space', 0),
    padding: numberField(f, 'padding', 0),
    zeropadding: numberField(f, 'zeropadding', 0),
    align: numberField(f, 'align', 0),
    ref: numberField(f, 'ref', 0),
    ...(valueProperty !== undefined ? { valueProperty } : {}),
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

function sourceIdField(value: unknown, fallback: BeatorajaSkinSourceId): BeatorajaSkinSourceId {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) return value;
  return fallback;
}

function integerPropertyField(value: unknown): BeatorajaIntegerPropertyRef | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // BeatorajaLuaFunctionValue path matches `value[].valueProperty` — we share the same type.
  if (value !== null && typeof value === 'object' && (value as { kind?: unknown }).kind === 'beatoraja-lua-function') {
    return value as BeatorajaIntegerPropertyRef;
  }
  return undefined;
}

/**
 * Compose a float number into per-slot cell descriptors for the renderer. Slot order:
 *
 *     [int_iketa-1] [int_iketa-2] ... [int_0] [dot] [frac_0] [frac_1] ... [frac_fketa-1]
 *
 * The integer half is right-aligned to its `iketa` digit count (leading-blank or leading-zero
 * pad based on `padding`). The fractional half is left-aligned to `fketa` and zero-padded on
 * the right. The dot cell sits between them — index resolved per the strip's `divx`:
 *
 *   - 24-cell signed dual-strip (`divx % 24 == 0`): cell `divx/2 - 1` for positive (typically
 *     11), cell `divx - 1` for negative (typically 23). Mirrors beatoraja's per-half atlas.
 *   - Single strip with `divx >= 12`: cell `divx - 1` (the last cell, conventionally the dot).
 *   - Smaller strip (`divx < 12`): no dot glyph available; the slot hides.
 *
 * `gain` is applied to `value` before formatting (`displayValue = value * gain`). Skins
 * authoring `gain = 0.01` get percentage display (raw 9876 → 98.76); `gain = 1` is the
 * pass-through default.
 *
 * Slot count = `iketa + (fketa > 0 ? 1 : 0) + fketa`. Slots with `hidden: true` mean "skip the
 * sprite this slot" — the renderer mounts a single sprite per slot and toggles visibility.
 *
 * Negative numbers: the integer half emits a sign cell when the strip carries one. Single-strip
 * conventions match the integer-`composeBeatorajaValueCells` path. Dual-strip uses the negative
 * half (cells 12..23) for every digit cell including the dot.
 */
export function composeBeatorajaFloatValueCells(
  element: BeatorajaFloatValueElement,
  value: number,
): BeatorajaValueDigitCell[] {
  const iketa = Math.max(1, Math.trunc(element.iketa));
  const fketa = Math.max(0, Math.trunc(element.fketa));
  const divx = Math.max(1, element.divx);
  const isSignedDualStrip = divx % 24 === 0;
  const halfDivx = isSignedDualStrip ? divx / 2 : divx;

  // Apply gain before formatting. Defaults (`gain = 1`) leave the value unchanged.
  const gain = Number.isFinite(element.gain) ? element.gain : 1;
  const safeValue = Number.isFinite(value) ? value * gain : 0;
  const isNegative = safeValue < 0;
  const halfOffset = isSignedDualStrip && isNegative ? halfDivx : 0;

  // Format `|safeValue|` as a fixed-decimal string with `fketa` fractional digits, then split
  // into integer and fractional digit arrays. `iketa` may exceed the natural integer length
  // (in which case we pad on the left); `fketa` always fixes the fractional length (zero-pad
  // on the right).
  const fixed = Math.abs(safeValue).toFixed(fketa);
  const dotIdx = fixed.indexOf('.');
  const intStr = dotIdx >= 0 ? fixed.slice(0, dotIdx) : fixed;
  const fracStr = dotIdx >= 0 ? fixed.slice(dotIdx + 1) : '';

  // Build the sequence in left-to-right slot order. Integer half first (right-aligned to
  // iketa). Dot if fketa > 0. Then fractional half left-aligned.
  const slots: Array<{ cell: number; hidden: boolean }> = [];
  // Integer half — right-align: leading slots are blank/zero-padded.
  const hasBlankCell = halfDivx >= 11;
  const blankCellInHalf = !hasBlankCell ? -1 : isSignedDualStrip ? halfDivx - 2 : halfDivx - 1;
  // Sign cell: dual-strip bakes the sign into the negative-half digits (no dedicated slot).
  // Single strip uses `divx - 1` when divx >= 11 (cell 10 = sign for the legacy 11-cell layout).
  // We position the sign at the FIRST integer slot when negative + non-dual-strip.
  const intDigitCount = intStr.length;
  // For padding: how many leading slots (excluding the digits themselves and any sign).
  const leadingSlots = Math.max(0, iketa - intDigitCount - (isNegative && !isSignedDualStrip ? 1 : 0));
  for (let i = 0; i < leadingSlots; i += 1) {
    if (element.padding === 1) {
      slots.push({ cell: 0 + halfOffset, hidden: false });
    } else if (hasBlankCell) {
      slots.push({ cell: (blankCellInHalf >= 0 ? blankCellInHalf : 0) + halfOffset, hidden: false });
    } else {
      slots.push({ cell: 0, hidden: true });
    }
  }
  // Sign cell (single-strip negatives only).
  if (isNegative && !isSignedDualStrip) {
    if (hasBlankCell) {
      // For 12-cell strip, sign cell is `divx - 1 - 1 = 10` (the cell BEFORE the dot). For
      // 11-cell strip, sign is at `divx - 1 = 10`. Approximate: use the second-to-last cell
      // when divx >= 12, else the last cell. Skins typically use 12+ cells for floatvalue.
      slots.push({ cell: divx >= 12 ? divx - 2 : divx - 1, hidden: false });
    } else {
      slots.push({ cell: 0, hidden: true });
    }
  }
  // Integer digits (left-to-right within the integer half). Truncate to fit iketa.
  const intDisplayed = intStr.slice(Math.max(0, intStr.length - (iketa - leadingSlots - (isNegative && !isSignedDualStrip ? 1 : 0))));
  for (const ch of intDisplayed) {
    const idx = ch.charCodeAt(0) - 48;
    const cellInHalf = idx >= 0 && idx < halfDivx ? idx : halfDivx - 1;
    slots.push({ cell: cellInHalf + halfOffset, hidden: false });
  }
  // Dot slot — only when there's a fractional half. Cell index = last cell of the active
  // half (single-strip: `divx - 1`; dual-strip-positive: `halfDivx - 1`; dual-strip-negative:
  // `divx - 1`). Strips smaller than 12 cells have no dot glyph; hide.
  if (fketa > 0) {
    if (halfDivx >= 12) {
      slots.push({ cell: halfDivx - 1 + halfOffset, hidden: false });
    } else {
      slots.push({ cell: 0, hidden: true });
    }
  }
  // Fractional digits (left-to-right). Already zero-padded to fketa by `toFixed`.
  for (const ch of fracStr) {
    const idx = ch.charCodeAt(0) - 48;
    const cellInHalf = idx >= 0 && idx < halfDivx ? idx : halfDivx - 1;
    slots.push({ cell: cellInHalf + halfOffset, hidden: false });
  }

  // Map slot cells to source-rect crops on the strip. Each cell occupies (w/divx, h/divy).
  const cellW = Math.floor(element.w / divx);
  const cellH = Math.floor(element.h / Math.max(1, element.divy));
  return slots.map((slot) => ({
    x: element.x + slot.cell * cellW,
    y: element.y,
    w: cellW,
    h: cellH,
    cell: slot.hidden ? -1 : slot.cell,
    hidden: slot.hidden,
  }));
}

/**
 * Total slot count for {@link composeBeatorajaFloatValueCells}. The renderer pre-allocates one
 * sprite per slot at build time before any value resolves, so it needs the count without
 * actually formatting a value. Matches the slot count the composer emits regardless of value
 * magnitude (the layout is fixed by `iketa` + (`fketa > 0 ? 1 : 0`) + `fketa`).
 */
export function beatorajaFloatValueSlotCount(element: BeatorajaFloatValueElement): number {
  const iketa = Math.max(1, Math.trunc(element.iketa));
  const fketa = Math.max(0, Math.trunc(element.fketa));
  return iketa + (fketa > 0 ? 1 : 0) + fketa;
}
