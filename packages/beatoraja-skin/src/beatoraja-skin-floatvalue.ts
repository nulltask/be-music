// Strict-typed normalization for beatoraja `floatvalue[]` declarations (audit 3.5).
//
// `floatvalue` is the decimal-number cousin of `value[]` — same digit-strip cell layout, but
// the rendered number includes a decimal point. The result screen authors these for BPM
// (`123.4`), accuracy percentages (`98.76 %`), average timing deltas (`+5.23 ms`), etc. The
// integer / fractional digit counts are configured separately via `iketa` / `fketa`, and
// `gain` lets authors apply a runtime multiplier (e.g. `gain = 0.01` to convert a 100x op to
// the displayed percentage).
//
// Parser only — the renderer is a follow-up. Beatoraja's draw path composes the integer half,
// a decimal-point glyph, and the fractional half side-by-side; that's a non-trivial extension
// of the `value[]` digit cell composer. By preserving the field shapes now, a future renderer
// patch can ingest them without re-walking the JSON.

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';
import type { BeatorajaSkinSourceId } from './beatoraja-skin-types.ts';
import type { BeatorajaIntegerPropertyRef } from './beatoraja-skin-value.ts';

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
