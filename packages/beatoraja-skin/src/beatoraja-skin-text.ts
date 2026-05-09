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
  /**
   * Optional pre-rendered string. Beatoraja's Lua skins use this to bake in a literal label
   * (e.g. `"Avg 5.23 ms"` computed at scene mount via `main_state.number(374)` and stored as a
   * static string for the renderer). When set, takes precedence over `ref` / `valueProperty`.
   */
  constantText?: string;
  /** Rendering alignment. Defaults to `'left'`. */
  align: BeatorajaTextAlign;
  /**
   * Beatoraja's `overflow` flag controls how text wider than its destination box is handled. The
   * surveyed skins (GdbG_Skin, ModernChic) only ever author `overflow = 1` (= shrink-to-fit, the
   * mode that scales the rendered text down by `dst.w / measured.w` so it stays inside the box);
   * other values (`0` = no handling, `2` = clip in the upstream Java) are uncommon in practice but
   * preserved verbatim here so the renderer can branch on them. Defaults to `0`.
   */
  overflow: number;
  /**
   * Outline / drop-shadow styling (audit 2.10). Beatoraja's JsonSkin.Text serializes colors as
   * 8-char `RRGGBBAA` hex strings (e.g. `"165423ff"` = beginner green). When the outline / shadow
   * is "off" the alpha byte is `00` so the renderer can gate on `alpha > 0` instead of needing a
   * separate enabled flag.
   */
  outlineColor: BeatorajaTextRgba;
  outlineWidth: number;
  shadowColor: BeatorajaTextRgba;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowSmoothness: number;
  /**
   * Word-wrap toggle (`boolean wrapping = false` upstream). When true the renderer wraps the
   * rendered text inside the destination box rather than letting it overflow / shrink.
   */
  wrapping: boolean;
  /** `if` codes that gate visibility (from `if`/`values` flattening). */
  ifCodes: ReadonlyArray<number>;
}

/** Parsed `RRGGBBAA` hex color split into Pixi-friendly components. */
export interface BeatorajaTextRgba {
  /** 24-bit RGB packed `0xRRGGBB`. */
  rgb: number;
  /** Alpha 0..1 (so it can be passed straight into Pixi `style.dropShadow.alpha`). */
  alpha: number;
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
  const constantText = typeof f.constantText === 'string' ? f.constantText : undefined;
  return {
    id,
    fontId: fontIdField(f, 'font', 0),
    size: numberField(f, 'size', 24),
    ref: numberField(f, 'ref', 0),
    ...(valueProperty !== undefined ? { valueProperty } : {}),
    ...(constantText !== undefined ? { constantText } : {}),
    align: alignField(f.align),
    overflow: numberField(f, 'overflow', 0),
    // Outline / shadow styling (audit 2.10). The default `RRGGBBAA = "ffffff00"` is white with
    // 0% alpha — same sentinel beatoraja uses for "feature disabled". The renderer should gate
    // its stroke / dropShadow application on `alpha > 0`.
    outlineColor: parseBeatorajaTextRgba(f.outlineColor, 0xffffff, 0),
    outlineWidth: numberField(f, 'outlineWidth', 0),
    shadowColor: parseBeatorajaTextRgba(f.shadowColor, 0xffffff, 0),
    shadowOffsetX: numberField(f, 'shadowOffsetX', 0),
    shadowOffsetY: numberField(f, 'shadowOffsetY', 0),
    shadowSmoothness: numberField(f, 'shadowSmoothness', 0),
    wrapping: f.wrapping === true || f.wrapping === 1,
    ifCodes: entry.ifCodes,
  };
}

/**
 * Parse beatoraja's `RRGGBBAA` 8-char hex string into `{rgb, alpha}`. Tolerates 6-char
 * `RRGGBB` (alpha defaults to 1.0) and falls back to the supplied default when the value is
 * missing / malformed. Used by both the runtime parser (for `text[]` outline / shadow) and
 * future bpmgraph / gaugegraph color fields.
 */
export function parseBeatorajaTextRgba(value: unknown, fallbackRgb: number, fallbackAlpha: number): BeatorajaTextRgba {
  if (typeof value !== 'string') return { rgb: fallbackRgb, alpha: fallbackAlpha };
  const trimmed = value.startsWith('#') ? value.slice(1) : value;
  if (trimmed.length === 8) {
    // RRGGBBAA. Parse as base-16; if any byte is invalid, the integer fall back to NaN and
    // we drop to the default. The alpha byte gets normalized to 0..1.
    const num = Number.parseInt(trimmed, 16);
    if (!Number.isFinite(num)) return { rgb: fallbackRgb, alpha: fallbackAlpha };
    const rgb = (num >>> 8) & 0xffffff;
    const alpha = (num & 0xff) / 255;
    return { rgb, alpha };
  }
  if (trimmed.length === 6) {
    const num = Number.parseInt(trimmed, 16);
    if (!Number.isFinite(num)) return { rgb: fallbackRgb, alpha: fallbackAlpha };
    return { rgb: num & 0xffffff, alpha: 1 };
  }
  return { rgb: fallbackRgb, alpha: fallbackAlpha };
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
