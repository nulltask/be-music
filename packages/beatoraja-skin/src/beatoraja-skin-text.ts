// Strict-typed normalization for beatoraja `text[]` and `font[]` declarations.
//
// Beatoraja text elements differ from `image[]` / `value[]` in that they have no source rect — instead they pair a
// font id with a size and an op-code reference (`ref`). The renderer pulls the actual string from the runtime
// (song title, current judge label, etc.) using `ref`, lays it out in the font, and paints the result inside the
// destination's bounding box.
//
// At parser level we only normalize the declaration shape. Font loading and text-content resolution are renderer
// concerns that live in `@be-music/player-web`.

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import { isBeatorajaLuaFunctionValue, type BeatorajaLuaFunctionValue } from './beatoraja-skin-lua.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';
import type { BeatorajaSkinFontId } from './beatoraja-skin-types.ts';

export type BeatorajaStringPropertyRef = number | BeatorajaLuaFunctionValue;

/** Optional alignment hint. Most authors leave it unset (`'left'` is the beatoraja default). */
export type BeatorajaTextAlign = 'left' | 'center' | 'right';

export interface BeatorajaTextElement {
  /**
   * Same id space as `image[]` / `value[]` — destinations reference text elements with `dst[].id` matching this.
   */
  id: BeatorajaImageId;
  /** Font slot id (`font[].id`). Numeric and symbolic string ids are both valid. */
  fontId: BeatorajaSkinFontId;
  /** Font size in skin-pixel units. */
  size: number;
  /**
   * Op-code reference for the dynamic string contents (song title, artist, current combo's word form, etc.).
   * `0` means "no ref" — a static label the author baked in.
   */
  ref: number;
  /** Optional `value` StringProperty. Beatoraja evaluates this instead of `ref` when authored. */
  valueProperty?: BeatorajaStringPropertyRef;
  /** Rendering alignment. Defaults to `'left'`. */
  align: BeatorajaTextAlign;
  /** `if` codes that gate visibility (from `if`/`values` flattening). */
  ifCodes: ReadonlyArray<number>;
}

export interface BeatorajaFontElement {
  id: BeatorajaSkinFontId;
  /** Path relative to the skin file. */
  path: string;
}

export function normalizeBeatorajaTexts(input: unknown): BeatorajaTextElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaTextElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaTextElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  const valueProperty = stringPropertyField(f.value);
  return {
    id,
    fontId: fontIdField(f, 'font', 0),
    size: numberField(f, 'size', 24),
    ref: numberField(f, 'ref', 0),
    ...(valueProperty !== undefined ? { valueProperty } : {}),
    align: alignField(f.align),
    ifCodes: entry.ifCodes,
  };
}

function alignField(value: unknown): BeatorajaTextAlign {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'center' || lower === 'right' || lower === 'left') return lower;
  }
  if (typeof value === 'number') {
    // Beatoraja accepts numeric align codes in some skins: 0 = left, 1 = center, 2 = right.
    if (value === 1) return 'center';
    if (value === 2) return 'right';
  }
  return 'left';
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function stringPropertyField(value: unknown): BeatorajaStringPropertyRef | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isBeatorajaLuaFunctionValue(value)) return value;
  return undefined;
}

function fontIdField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  fallback: BeatorajaSkinFontId,
): BeatorajaSkinFontId {
  const v = record[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.length > 0) return v;
  return fallback;
}

/**
 * Normalize the top-level `font[]` array. Returns `[]` when the skin doesn't declare any fonts. Paths are
 * preserved verbatim — the renderer is responsible for resolving them through the dropped file map.
 */
export function normalizeBeatorajaFonts(input: unknown): BeatorajaFontElement[] {
  if (!Array.isArray(input)) return [];
  const out: BeatorajaFontElement[] = [];
  for (const entry of input) {
    if (entry === null || typeof entry !== 'object') continue;
    const obj = entry as Readonly<Record<string, unknown>>;
    const id = obj.id;
    const path = obj.path;
    if (typeof id !== 'number' && typeof id !== 'string') continue;
    if (typeof id === 'number' && !Number.isFinite(id)) continue;
    if (typeof id === 'string' && id.length === 0) continue;
    if (typeof path !== 'string' || path.length === 0) continue;
    out.push({ id, path });
  }
  return out;
}
