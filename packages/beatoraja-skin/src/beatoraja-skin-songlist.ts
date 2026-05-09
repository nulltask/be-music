// Parser for beatoraja's `songlist` element on the music-select skin.
//
// Beatoraja's select scene authors a top-level `songlist = { liston = [...], listoff = [...] }`
// element that declares the visible song-bar grid: each entry is an `{id="bar", dst=[{x, y, w, h}]}`
// rect in skin Y-UP coordinates. The renderer iterates the live song collection and paints one
// row per `liston[]` entry, with the cursor's running index offsetting which song lands in which
// row (the row whose Pixi y is closest to canvas-vertical-centre is the "focused" position
// — that's where the highlighted song renders).
//
// Two `liston[]` flavours appear in the wild:
//
//  - Default reference theme (`select.json`) — all rows share the same x; rows fan out
//    vertically in skin-pixel steps (e.g. 36 px between rows).
//  - GdbG_Skin / ModernChic — rows vary their x-coordinate for arched / diagonal aesthetics
//    (`songlist_x = {1288, 1249, 1215, ...}` in ModernChic's `straight / arch / diagonal`
//    options).
//
// Either way, the rect array is the canonical source of "which screen-space (skin-space)
// rectangle does row N occupy". Hosts that want to render their own song-bar overlay should
// read these rects, NOT pin the layout to fixed canvas fractions.

import type { BeatorajaSkin } from './beatoraja-skin-types.ts';

/** One row's rect in skin Y-UP coordinates. */
export interface BeatorajaSongListRowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Parsed `songlist` layout. `rows` is in author order (`liston[i].dst[0]`) — typically
 * top-to-bottom in screen-space but can be arbitrary (an arch arrangement, etc.). The
 * `focusedRowIndex` picks whichever entry's Pixi y is nearest the vertical centre of the
 * skin canvas — that's the row beatoraja's renderer pins the cursor onto.
 *
 * Sub-destinations (`level` / `label` / `lamp` / etc.) are rects RELATIVE to each row's
 * rect — the renderer adds the row's `(x, y)` to the sub-destination's `(x, y)` to find
 * the per-row paint position. Beatoraja's reference theme authors level / lamp at the
 * bar's left / right edge respectively; ModernChic authors them inside per-bar
 * decorative frames.
 */
export interface BeatorajaSongListLayout {
  /** Visible rows in author order. Length matches `liston[]`. */
  rows: ReadonlyArray<BeatorajaSongListRowRect>;
  /** Index into {@link rows} of the cursor's anchor row. */
  focusedRowIndex: number;
  /**
   * Per-row chart-level sprite rect (relative to the bar rect). Beatoraja's reference theme
   * authors `songlist.level[N].dst[0] = {x, y, w, h}` for difficulties 1..14 (one entry per
   * difficulty), but our renderer treats them as identical layout positions and lets the
   * host pick which sprite to paint. Returns the FIRST entry's geometry — most skins author
   * every difficulty with the same `(x, y, w, h)` and only vary the color tint.
   *
   * `undefined` when the skin omits `songlist.level`. Hosts that want per-row level display
   * fall back to a screen-space hard-coded position in that case.
   */
  level?: BeatorajaSongListRowRect;
  /**
   * Per-row label icon rect (song / folder / random / up-folder marker). Same relative-rect
   * convention as {@link level}. Beatoraja's reference theme authors `songlist.label[]` with
   * one entry per bar kind; the host picks the matching cell based on the row's `kind`.
   */
  label?: BeatorajaSongListRowRect;
}

/**
 * Extract the `songlist.liston[]` rects from a parsed skin. Falls back to `listoff[]` when
 * `liston` is missing — `listoff` is the same per-row rect array authored for the closed /
 * faded-out variant of the list, with identical geometry. Returns `undefined` when the skin
 * doesn't author a `songlist` block at all (most LR2 skins, or beatoraja themes that paint
 * their own bar list via the `bar` imageset).
 */
export function parseBeatorajaSongList(skin: BeatorajaSkin): BeatorajaSongListLayout | undefined {
  const songlist = (skin as { songlist?: unknown }).songlist;
  if (songlist === null || typeof songlist !== 'object') return undefined;
  const obj = songlist as Readonly<Record<string, unknown>>;
  const rects = collectListRects(obj.liston) ?? collectListRects(obj.listoff);
  if (rects === undefined || rects.length === 0) return undefined;
  // Pick the row whose Pixi-space centre y is closest to the canvas vertical centre. That's
  // the "focused" anchor in beatoraja's reference renderer — the cursor's selected song
  // always lands there.
  const canvasHeight = typeof skin.h === 'number' && Number.isFinite(skin.h) && skin.h > 0 ? skin.h : 1080;
  const targetY = canvasHeight / 2;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i]!;
    const pixiCentreY = canvasHeight - r.y - r.h / 2;
    const distance = Math.abs(pixiCentreY - targetY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  // Sub-destination rects (level / label / lamp / etc.) — extracted with a single helper.
  // Each is the FIRST entry's `dst[0]` rect since most skins author identical geometry per
  // difficulty / kind index and only vary tint / cell.
  const level = collectFirstSubRect(obj.level);
  const label = collectFirstSubRect(obj.label);
  return {
    rows: rects,
    focusedRowIndex: bestIndex,
    ...(level !== undefined ? { level } : {}),
    ...(label !== undefined ? { label } : {}),
  };
}

/**
 * Pick the first entry's first dst rect from a `songlist.level[]` / `songlist.label[]` etc.
 * array — beatoraja authors one entry per difficulty / kind index but the geometry is
 * identical across them in the typical case. `undefined` when the array is missing or
 * empty / malformed.
 */
function collectFirstSubRect(input: unknown): BeatorajaSongListRowRect | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const first = input[0];
  if (first === null || typeof first !== 'object') return undefined;
  const dst = (first as Readonly<Record<string, unknown>>).dst;
  if (!Array.isArray(dst) || dst.length === 0) return undefined;
  const rect = dst[0];
  if (rect === null || typeof rect !== 'object') return undefined;
  const obj = rect as Readonly<Record<string, unknown>>;
  const x = numberField(obj, 'x', 0);
  const y = numberField(obj, 'y', 0);
  const w = numberField(obj, 'w', 0);
  const h = numberField(obj, 'h', 0);
  if (w <= 0 || h <= 0) return undefined;
  return { x, y, w, h };
}

function collectListRects(input: unknown): BeatorajaSongListRowRect[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: BeatorajaSongListRowRect[] = [];
  for (const entry of input) {
    if (entry === null || typeof entry !== 'object') continue;
    const obj = entry as Readonly<Record<string, unknown>>;
    const dst = obj.dst;
    if (!Array.isArray(dst) || dst.length === 0) continue;
    const first = dst[0];
    if (first === null || typeof first !== 'object') continue;
    const rect = first as Readonly<Record<string, unknown>>;
    const x = numberField(rect, 'x', 0);
    const y = numberField(rect, 'y', 0);
    const w = numberField(rect, 'w', 0);
    const h = numberField(rect, 'h', 0);
    if (w <= 0 || h <= 0) continue;
    out.push({ x, y, w, h });
  }
  return out.length > 0 ? out : undefined;
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
