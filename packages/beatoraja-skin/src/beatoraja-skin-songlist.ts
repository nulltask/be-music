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

/**
 * One row's rect in skin Y-UP coordinates. The optional `id` is the row's
 * `liston[i].id` / `listoff[i].id` — the `skin.image[]` entry the renderer crops as the
 * row's bar background. Only set on entries returned in {@link BeatorajaSongListLayout.rows};
 * sub-destination rects ({@link BeatorajaSongListLayout.level}, label rects) never set it.
 *
 * Many beatoraja skins author the focused row with a different `id` (e.g. `list_on` while
 * other rows use `list`), so iterating `rows` and looking up `image[id]` per row produces
 * a per-row sprite list with the cursor highlight baked into the texture choice.
 */
export interface BeatorajaSongListRowRect {
  id?: string;
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
   * Per-row chart-feature label sprites. Each entry is `{id, rect}` — the `id` references
   * a `skin.image[]` entry (e.g. `"label-ln"` / `"label-random"` / `"label-mine"` in the
   * default theme), the `rect` is positioned RELATIVE to the bar rect. Each label is
   * shown only when the focused chart has the matching feature: LN / random sequence /
   * landmine notes.
   *
   * Beatoraja's reference theme authors three labels (LN / random / mine); ModernChic /
   * GdbG add or substitute their own (e.g. `label-fav` for favorites). The renderer
   * iterates the array and shows each entry whose feature predicate matches the focused
   * row's chart, so adding more label kinds in the future just means extending the
   * id-to-feature mapping.
   */
  labels: ReadonlyArray<{ id: string; rect: BeatorajaSongListRowRect }>;
  /**
   * Per-row text destinations. Each entry references a top-level `skin.text[id == entry.id]`
   * declaration (e.g. `"bartext"` in the default theme) and provides the per-bar rect that
   * positions + sizes the text. The renderer paints one text node per `(visible row × text
   * entry)` combination — content comes from the underlying text declaration's `ref`
   * (matched against `BEATORAJA_TEXT.*` opcodes via the host's `resolveTextContent`).
   *
   * Rect is RELATIVE to the bar rect. The renderer should use `rect.h` as the font size
   * to match upstream `SkinTextFont.draw`'s `font.setScale(region.height / parameter.size)`
   * — the rendered glyph height is the dst rect's height, not the text element's authored
   * `size` (which only controls the font bitmap's load resolution).
   *
   * Default beatoraja's `select.json` authors a single `bartext` entry (one line per bar).
   * Skins that want both title + artist split into two entries; the renderer iterates them
   * verbatim. `[]` when the skin omits the block — caller falls back to a synthesised
   * label / sub-label pair sized proportionally to the bar height.
   */
  text: ReadonlyArray<{ id: string; rect: BeatorajaSongListRowRect }>;
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
  // Sub-destination rects. `level` is treated as a single rect (per-difficulty entries
  // typically share identical geometry — only the color tint varies). `label[]` is a LIST
  // of `{id, rect}` so per-feature gating (LN / random / mine) can show / hide each
  // independently at draw time. `text[]` is similar — each entry references a top-level
  // `text[]` declaration by id and provides the per-bar rect, which the renderer should use
  // as the dst (with `rect.h` as the font size).
  const levelRect = collectFirstSubRect(obj.level);
  const levelId = firstEntryId(obj.level);
  const level = levelRect !== undefined && levelId !== undefined ? { id: levelId, ...levelRect } : levelRect;
  const labels = collectLabelEntries(obj.label);
  // De-dupe text entries by id — beatoraja's default `select.json` authors the same id
  // (e.g. `bartext`) twice with different `filter` / color overrides. Without a filter
  // engine we'd render the same string twice on top of itself; keeping the first
  // occurrence per id is the closest single-shot approximation.
  const text = dedupeById(collectLabelEntries(obj.text));
  return {
    rows: rects,
    focusedRowIndex: bestIndex,
    labels,
    text,
    ...(level !== undefined ? { level } : {}),
  };
}

/**
 * Collect per-id label sub-destinations from `songlist.label[]`. Each entry is shaped
 * `{id, dst: [{x, y, w, h}]}`; we keep the id verbatim (the skin's `image[]` references
 * it) and pick the first dst rect as the per-bar position. Filters entries with missing
 * id or zero/negative dimensions so render-time sprite sizing is always safe.
 */
function collectLabelEntries(input: unknown): ReadonlyArray<{ id: string; rect: BeatorajaSongListRowRect }> {
  if (!Array.isArray(input)) return [];
  const out: { id: string; rect: BeatorajaSongListRowRect }[] = [];
  for (const entry of input) {
    if (entry === null || typeof entry !== 'object') continue;
    const obj = entry as Readonly<Record<string, unknown>>;
    const id = obj.id;
    if (typeof id !== 'string' || id.length === 0) continue;
    const rect = collectFirstSubRect([entry]);
    if (rect === undefined) continue;
    out.push({ id, rect });
  }
  return out;
}

/**
 * Pick the first entry's first dst rect from a `songlist.level[]` / `songlist.label[]` etc.
 * array — beatoraja authors one entry per difficulty / kind index but the geometry is
 * identical across them in the typical case. `undefined` when the array is missing or
 * empty / malformed. The wrapper entry's `id` (e.g. `playlevel_bar` for `level[]`) is
 * NOT captured here; callers that need it should pull `input[0].id` separately. (Inner
 * rect-only call sites like `collectLabelEntries` rely on the rect being id-free so the
 * outer `{id, rect}` shape doesn't double-encode the id.)
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

/**
 * Pull a wrapper entry's `id` field (the `skin.image[]` reference for sub-destinations
 * like `level[].id == "playlevel_bar"`). Picks the FIRST entry of the array; returns
 * `undefined` when missing / malformed.
 */
function firstEntryId(input: unknown): string | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const first = input[0];
  if (first === null || typeof first !== 'object') return undefined;
  const idValue = (first as Readonly<Record<string, unknown>>).id;
  return typeof idValue === 'string' && idValue.length > 0 ? idValue : undefined;
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
    // Capture `entry.id` so callers can look up `skin.image[id]` for the row's bar
    // background sprite. Many skins author the focused row with a different id
    // (e.g. `list_on` vs `list`), so retaining the id per-row gives the renderer the
    // cursor highlight at no extra cost. `undefined` when the entry omits an id (bare
    // dst-only entries in skins that don't author a bar texture).
    const idValue = obj.id;
    const id = typeof idValue === 'string' && idValue.length > 0 ? idValue : undefined;
    out.push(id !== undefined ? { id, x, y, w, h } : { x, y, w, h });
  }
  return out.length > 0 ? out : undefined;
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function dedupeById<T extends { id: string }>(entries: ReadonlyArray<T>): ReadonlyArray<T> {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}
