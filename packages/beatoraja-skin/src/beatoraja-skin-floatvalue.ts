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
  /**
   * Per-digit secondary offset ids — same semantics as `BeatorajaValueElement.offsets`.
   * Mirrors upstream `SkinNumber.draw()` `+ offsets[j].x` per-slot term. Empty for the
   * common case; default skin doesn't use it.
   */
  offsets: ReadonlyArray<number>;
  /** Op-code reference for the dynamic numeric value. `0` = no ref. */
  ref: number;
  /** Optional `value` FloatProperty. Beatoraja evaluates this instead of `ref` when authored. */
  valueProperty?: BeatorajaIntegerPropertyRef;
  /**
   * Animation cycle in milliseconds — same semantics as {@link BeatorajaValueElement.cycle}.
   * Mirrors upstream `SkinNumber`'s `cycle` argument piped to `SkinSourceImageSet`. When
   * `cycle > 0` the source picks one of `divy` rows per frame via
   * `(time * divy / cycle) % divy` (`SkinSourceImageSet.java:87`); `0` keeps row 0.
   */
  cycle: number;
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
    offsets: numberArrayField(f, 'offset'),
    ref: numberField(f, 'ref', 0),
    ...(valueProperty !== undefined ? { valueProperty } : {}),
    cycle: numberField(f, 'cycle', 0),
    ifCodes: entry.ifCodes,
  };
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
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

// ─── FloatFormatter cell-glyph constants ────────────────────────────────────────────────────
// Mirror `FloatFormatter.java:21-23` cell index conventions. Used as the digit values written
// into the formatter's `digits[]` array, then read back as cell indices on the source strip.
const SIGNSYMBOL = 12; // sign cell ("+" / "-").
const DECIMALPOINT = 11; // decimal-point cell.
const REVERSEZERO = 10; // "back zero" cell (used when zeropadding=2 on fractional zeros).
const KETAMAX = 8; // max combined int+frac digit count per `FloatFormatter.java:19`.

/**
 * Compose a float number into per-slot cell descriptors for the renderer.
 *
 * Audit A-1 / A-2 / B-2 (2024-12) re-aligned this to upstream's `FloatFormatter.java` +
 * `SkinFloat.java:177-199` logic. The previous TS impl had three bugs:
 *
 *   - **Slot order reversed**: emitted leading blanks at low j with visible content at high j,
 *     while upstream emits visible content at low j with TRAILING nulls at high j (when the
 *     authored iketa exceeds the value's natural int width).
 *   - **Shift sign**: applied `- shift` to slot x, but `SkinFloat.draw()` uses `+ shift`.
 *   - **Align convention**: treated `align=0:右 / 1:左 / 2:中央` (matching SkinNumber), but
 *     `SkinFloat.java:60-62` documents `0:左 / 1:右 / 2:中央` (the OPPOSITE for 0/1).
 *
 * The three bugs together meant skins authoring `floatvalue[]` with explicit `align` rendered
 * with the WRONG flush direction, while the natural `align=0` default rendered with the
 * intended visible content but on the wrong side of the dst rect.
 *
 * ─── Algorithm (mirrors `FloatFormatter.calcuateAndGetDigits()`) ────────────────────────────
 *
 * 1. Apply `gain` to value (`SkinFloat.java:148`: `var v = value * gain;`).
 * 2. Compute `iketa, fketa, sign, length` per `FloatFormatter.java:55-71`. `length = sign +
 *    iketa + fketa + (fketa != 0 ? 1 : 0)`. The digits[] array has `length + 1` entries
 *    initialized to -1; entries 1..length map to currentImages[0..length-1] in `SkinFloat`.
 * 3. RTL walk from `nowketa = base + fketa + (fketa>0?1:0)` down to `sign`. Per iteration:
 *    write the current digit (or REVERSEZERO when zeropadding=2 and fval=0), advance fcnt and
 *    fval. When fcnt drops to 0, write DECIMALPOINT one slot to the left.
 * 4. Post-walk: if `nowketa == 1`, write SIGNSYMBOL (signed positive) or the final digit.
 * 5. Slots with `digits[i] == -1` map to `hidden: true` (= upstream's null currentImages).
 *
 * Cell index translation (per `JsonSkinObjectLoader.java:173-300`):
 *   - 0..9 → digit cells in active half.
 *   - 10 (REVERSEZERO) → cell 10 of active half.
 *   - 11 (DECIMALPOINT) → cell 11 of active half.
 *   - 12 (SIGNSYMBOL) → cell 12 of active half (only present on 26-cell-per-half strips).
 *
 * For 24-cell signed dual-strip (`divx % 24 == 0`), the "active half" is the positive half
 * (cells 0..halfDivx-1) when value ≥ 0, else the negative half (cells halfDivx..divx-1).
 *
 * `gain` is applied before formatting (`displayValue = value * gain`). Skins authoring
 * `gain = 0.01` get percentage display (raw 9876 → 98.76); `gain = 1` is the pass-through
 * default.
 */
export function composeBeatorajaFloatValueCells(
  element: BeatorajaFloatValueElement,
  value: number,
  /**
   * Animation frame index — selects which `divy` row the digit cells crop from. Defaults to
   * `0` (= row 0). Caller computes the index via {@link floatValueFrameAt}. Indices are
   * clamped to `[0, divy-1]`; the 24-cell signed-dual-strip mode pins frame to 0 because its
   * "rows" encode positive/negative half rather than animation frames (matches the
   * value-element composer's policy — see `composeBeatorajaValueCells` for the parallel doc).
   */
  frameIndex: number = 0,
): BeatorajaValueDigitCell[] {
  // Apply `value * gain` per `SkinFloat.java:148`.
  const gain = Number.isFinite(element.gain) ? element.gain : 1;
  const rawValue = Number.isFinite(value) ? value * gain : 0;
  const isNegative = rawValue < 0;
  const absValue = Math.abs(rawValue);

  // Mirror `FloatFormatter` constructor (`FloatFormatter.java:55-71`).
  const tempIketa = Math.max(0, Math.trunc(element.iketa));
  const tempFketa = Math.max(0, Math.trunc(element.fketa));
  const sign = element.isSignvisible ? 1 : 0;
  const zeropadding = element.zeropadding >= 2 ? 2 : element.zeropadding >= 1 ? 1 : 0;
  let iketa: number;
  let fketa: number;
  if (tempIketa >= KETAMAX || tempFketa >= KETAMAX || tempIketa + tempFketa >= KETAMAX) {
    fketa = Math.min(tempFketa, KETAMAX);
    iketa = KETAMAX - fketa;
  } else {
    iketa = tempIketa;
    fketa = tempFketa;
  }
  const length = sign + iketa + fketa + (fketa !== 0 ? 1 : 0);

  const divx = Math.max(1, element.divx);
  const isSignedDualStrip = divx % 24 === 0;
  const halfDivx = isSignedDualStrip ? divx / 2 : divx;
  const activeHalfOffset = isSignedDualStrip && isNegative ? halfDivx : 0;

  // ─── Run FloatFormatter.calcuateAndGetDigits (`FloatFormatter.java:73-128`) ──────────────
  const digits = new Array<number>(length + 1).fill(-1);
  if (length === 0) {
    // Degenerate config — no slots to fill.
    return [];
  }
  if (iketa === 0 && fketa === 0 && sign === 1) {
    // Sign-only mode (`FloatFormatter.java:78-81`).
    digits[1] = SIGNSYMBOL;
  } else {
    const isSign = sign === 1 && absValue < Math.pow(10, iketa);
    let base = sign + iketa;
    if (zeropadding === 0) {
      // `FloatFormatter.java:85-88` — base contracts to the natural int width when
      // zeropadding=0, leaving trailing slots null.
      const ival = Math.trunc(absValue);
      base = Math.min(iketa, Math.floor(Math.log10(ival !== 0 ? ival : 1)) + 1) + sign;
    }
    let fval = Math.trunc(absValue * Math.pow(10, fketa));
    let nowketa = iketa === 0 ? fketa + sign + 1 : base + fketa + (fketa !== 0 ? 1 : 0);
    let fcnt = fketa;
    while (nowketa > sign) {
      if (fcnt > -1) {
        digits[nowketa] = fval % 10;
      } else {
        digits[nowketa] = fval === 0 && zeropadding === 2 ? REVERSEZERO : fval % 10;
      }
      fcnt -= 1;
      if (fcnt === 0) {
        nowketa -= 1;
        digits[nowketa] = DECIMALPOINT;
      }
      fval = Math.floor(fval / 10);
      nowketa -= 1;
    }
    if (nowketa === 1) {
      digits[1] = isSign ? SIGNSYMBOL : fval % 10;
    }
    if (iketa === 0 && sign === 1) {
      digits[1] = SIGNSYMBOL;
    }
  }

  // ─── Map digits[1..length] to cells[0..length-1] (`SkinFloat.java:177-184`) ──────────────
  const cellW = Math.floor(element.w / divx);
  const divy = Math.max(1, element.divy);
  const cellH = Math.floor(element.h / divy);
  // Clamp the requested animation frame into `[0, divy-1]`. 24-cell dual-strip pins frame=0
  // because its rows are positive/negative-half cells, not animation frames — see the
  // {@link frameIndex} doc for the rationale.
  const frame =
    isSignedDualStrip || divy <= 1
      ? 0
      : Math.min(divy - 1, Math.max(0, Math.trunc(Number.isFinite(frameIndex) ? frameIndex : 0)));
  const yWithFrame = element.y + frame * cellH;
  const cells: BeatorajaValueDigitCell[] = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const digitValue = digits[i + 1] ?? -1;
    if (digitValue === -1) {
      cells[i] = { x: 0, y: yWithFrame, w: cellW, h: cellH, cell: -1, hidden: true };
      continue;
    }
    // Translate digit value (0..12) into a cell index in the active half. Unmapped values
    // (rare) fall through to digit clamping at halfDivx-1.
    const cellInHalf = digitValue >= 0 && digitValue < halfDivx ? digitValue : halfDivx - 1;
    const cell = cellInHalf + activeHalfOffset;
    cells[i] = {
      x: element.x + cell * cellW,
      y: yWithFrame,
      w: cellW,
      h: cellH,
      cell,
      hidden: false,
    };
  }
  return cells;
}

/**
 * Pick the displayed animation frame index for a `floatvalue[]` strip at a given elapsed-time
 * tick. Same formula as {@link valueFrameAt} on the integer-value side — both mirror upstream
 * `SkinSourceImageSet.getImageIndex` which is shared between `SkinNumber` and `SkinFloat`.
 *
 * Returns `0` when `cycle <= 0` (animation disabled), `divy <= 1` (single-row strip), or
 * `elapsedMs` is non-finite / negative (pre-roll guard mirroring upstream's `if (time < 0)
 * return 0;`).
 */
export function floatValueFrameAt(element: BeatorajaFloatValueElement, elapsedMs: number): number {
  if (element.cycle <= 0) return 0;
  const length = Math.max(1, Math.trunc(element.divy));
  if (length <= 1) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  const t = Math.floor(elapsedMs) % element.cycle;
  return Math.min(length - 1, Math.floor((t * length) / element.cycle));
}

/**
 * Total slot count for {@link composeBeatorajaFloatValueCells}. The renderer pre-allocates one
 * sprite per slot at build time before any value resolves, so it needs the count without
 * actually formatting a value. Mirrors `FloatFormatter.java:67`'s `length = sign + iketa +
 * fketa + (fketa != 0 ? 1 : 0)` after the iketa/fketa KETAMAX clamp.
 */
export function beatorajaFloatValueSlotCount(element: BeatorajaFloatValueElement): number {
  const tempIketa = Math.max(0, Math.trunc(element.iketa));
  const tempFketa = Math.max(0, Math.trunc(element.fketa));
  const sign = element.isSignvisible ? 1 : 0;
  let iketa: number;
  let fketa: number;
  if (tempIketa >= KETAMAX || tempFketa >= KETAMAX || tempIketa + tempFketa >= KETAMAX) {
    fketa = Math.min(tempFketa, KETAMAX);
    iketa = KETAMAX - fketa;
  } else {
    iketa = tempIketa;
    fketa = tempFketa;
  }
  return sign + iketa + fketa + (fketa !== 0 ? 1 : 0);
}

/**
 * Compute the horizontal pixel shift to apply across every digit slot to honor
 * `element.align` for floatvalue rendering. Mirrors `SkinFloat.java:186`:
 *
 *     shift = align == 0 ? 0
 *           : align == 1 ? (region.width + space) * shiftbase
 *           : (region.width + space) * 0.5f * shiftbase;
 *
 * Where `shiftbase` is the count of `null` slots (= trailing-null int positions when
 * iketa exceeds the value's natural width). Per `SkinFloat.java:60-62` the align values
 * are `0:左 (LEFT)`, `1:右 (RIGHT)`, `2:中央 (CENTER)` — the OPPOSITE of `SkinNumber`'s
 * `0:RIGHT, 1:LEFT, 2:CENTER` convention. The previous TS impl wrongly mirrored
 * SkinNumber's mapping for floatvalue.
 *
 * The renderer ADDS this value to each slot's x per `SkinFloat.java:193, 195`'s
 * `region.x + (region.width + space) * j + shift + offsets[j].x`. (SkinNumber subtracts
 * the shift; the two element types differ on this point because their slot orders are
 * mirror images of each other — SkinNumber puts visible content at HIGH j and nulls at
 * LOW j, SkinFloat the opposite.)
 *
 * Returns `0` for `align = 0` (LEFT-flush, the default — visible content sits at the
 * dst rect's LEFT edge naturally, no shift needed). Also returns 0 when the value
 * renders without trailing nulls (= `shiftbase = 0`).
 */
export function composeBeatorajaFloatValueShift(
  element: BeatorajaFloatValueElement,
  value: number,
  slotWidth: number,
): number {
  if (element.align !== 1 && element.align !== 2) return 0;
  const cells = composeBeatorajaFloatValueCells(element, value);
  let shiftbase = 0;
  for (const cell of cells) {
    if (cell.hidden) shiftbase += 1;
  }
  if (shiftbase === 0) return 0;
  const space = Number.isFinite(element.space) ? element.space : 0;
  const baseShift = shiftbase * (slotWidth + space);
  return element.align === 1 ? baseShift : baseShift * 0.5;
}
