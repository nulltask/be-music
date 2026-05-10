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

import type { BeatorajaImageId } from './beatoraja-skin-image.ts';
import type { BeatorajaSkin } from './beatoraja-skin-types.ts';

/**
 * Number of song-bar slots beatoraja's `BarRenderer` allocates per select scene. Mirrors
 * upstream `BarRenderer.java:52` (`private final int barlength = 60;`) and
 * `SkinBar.java:22` (`barimageon = new SkinImage[BAR_COUNT]` / `BAR_COUNT = 60`). Every
 * skin shares this fixed slot count regardless of how many `liston[]` entries the JSON
 * authors — slots beyond the authored array stay null in upstream and render nothing.
 *
 * Audit A-9 — exposed so the renderer can iterate the full upstream slot count and treat
 * `liston[i]` for `i >= liston.length` as "unauthored" (skip drawing) rather than clamping
 * `visibleRowCount` to the authored length. The visible behavior is identical for typical
 * skins (`liston.length = 21`, `centerBar < 21`); the change matters only at the upstream-
 * defined edge cases where `centerBar` lands beyond the authored row count.
 */
export const BEATORAJA_SONGLIST_BAR_COUNT = 60;

/**
 * One row's rect in skin Y-UP coordinates. The optional `id` is the row's
 * `liston[i].id` / `listoff[i].id` — the `skin.image[]` entry the renderer crops as the
 * row's bar background. Only set on entries returned in {@link BeatorajaSongListLayout.rows};
 * sub-destination rects ({@link BeatorajaSongListLayout.level}, label rects) never set it.
 *
 * Many beatoraja skins author the focused row with a different `id` (e.g. `list_on` while
 * other rows use `list`), so iterating `rows` and looking up `image[id]` per row produces
 * a per-row sprite list with the cursor highlight baked into the texture choice.
 *
 * Type matches `image[].id` ({@link BeatorajaImageId}) — numeric and string forms both
 * appear in the wild. The default reference theme uses strings (`"bar"`, `"list_on"`);
 * Lua-driven skins (ModernChic's bar variants) sometimes emit numeric ids when the
 * authoring loop assigns them programmatically. Accepting both lets the renderer's
 * `image[]` lookup succeed regardless of which form the author used.
 */
export interface BeatorajaSongListRowRect {
  id?: BeatorajaImageId;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Full `imageset.images[]` array when this row's authored id resolved through an
   * imageset (audit A-7 keeps `id` aliased to `images[0]` for legacy renderers, but the
   * full list is required for upstream-faithful per-bar-type rendering).
   *
   * Mirrors `JsonSelectSkinObjectLoader.java:44-77` which constructs a multi-frame
   * `SkinImage(tr[][], timer, cycle, null)` and `BarRenderer.java:269` which calls
   * `si.draw(sprite, time, ba.value, ...)` to pick the frame matching the bar's TYPE
   * (`SongBar` → 0 / `FolderBar` → 1 / `TableBar` → 2 / etc.). ModernChic authors:
   *
   *     parts.imageset = {
   *         {id = "bar", images = {"bar-song", "bar-folder", "bar-table",
   *                                "bar-grade", "bar-nosong", "bar-command", "bar-search"}}
   *     }
   *
   * so `imagesetImages = ["bar-song", "bar-folder", ...]` (in author order). Renderers that
   * support per-bar-type rendering select the matching index per row; renderers that don't
   * fall back to `id` (= `images[0]`) and paint every row with the same first frame
   * (= the user-reported "all bars share one color" behaviour).
   *
   * `undefined` when the row's id wasn't an imageset (= just a plain `image[]` reference,
   * the typical default-skin case for `bar` / `list_on`).
   */
  imagesetImages?: ReadonlyArray<BeatorajaImageId>;
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
  /**
   * Index into {@link rows} of the cursor's anchor row. Resolution priority (audit A-8):
   *
   *   1. `songlist.center` (= the authored center index) when supplied — matches upstream
   *      `JsonSelectSkinObjectLoader.java:79` `((MusicSelectSkin) skin).setCenterBar(sk.songlist.center)`
   *      which is then read by `BarRenderer.java:124` (`boolean on = (i == skin.getCenterBar())`).
   *      The author's intent for which row should look "focused" — this is what beatoraja
   *      uses verbatim, no heuristic.
   *   2. The row whose Pixi-space centre y is closest to the canvas vertical centre
   *      (legacy fallback — used when the skin omits `center`, which happens on community
   *      skins that pre-date the field's introduction).
   */
  focusedRowIndex: number;
  /**
   * Per-row chart-level sprite rect (relative to the bar rect). Returns the FIRST entry's
   * geometry — every skin we've inspected (default reference theme, ModernChic, GdbG)
   * authors `songlist.level[N].dst[0] = {x, y, w, h}` with identical rects across all
   * difficulty entries, so the singular form is sufficient for layout. The id varies per
   * difficulty (= which sprite color row to crop from); use {@link levelEntries} for
   * that branching.
   *
   * `undefined` when the skin omits `songlist.level`. Hosts that want per-row level display
   * fall back to a screen-space hard-coded position in that case.
   */
  level?: BeatorajaSongListRowRect;
  /**
   * Per-difficulty level-sprite entries. Mirrors upstream `songlist.level[]` exactly —
   * each entry pairs a level `value[].id` (e.g. `level-unknown`, `level-beginner`,
   * `level-normal`, `level-hyper`, `level-another`, `level-insane`) with its rect. The
   * renderer picks one entry per row based on the chart's `#DIFFICULTY` value:
   *
   *   - difficulty 0 → `level-unknown`  (no `#DIFFICULTY` authored, or `0`)
   *   - difficulty 1 → `level-beginner`
   *   - difficulty 2 → `level-normal`
   *   - difficulty 3 → `level-hyper`
   *   - difficulty 4 → `level-another`
   *   - difficulty 5 → `level-insane`
   *
   * Mirrors upstream `JsonSelectSkinObjectLoader.java:148-158`'s level-instantiation loop:
   *
   *     for (int i = 0; i < sk.songlist.level.length; i++) { ... new SkinNumber(...) ... }
   *
   * which hands beatoraja's `SkinBar.barlevel[i]` six independent SkinNumbers; the renderer
   * picks `barlevel[song.difficulty]` per row to crop digits from the colour-coded sprite
   * strip on `songbar.png`. Without honouring the per-difficulty selection every row uses
   * the first authored entry (= `level-unknown`'s grey row), so charts whose author gave
   * a `#DIFFICULTY` paint with the wrong colour.
   *
   * Empty array when the skin omits `songlist.level`. Order matches the author's `level[]`
   * (typically beatoraja's `unknown / beginner / normal / hyper / another / insane`); the
   * renderer keys on the entry's `id` suffix rather than positional index so a skin that
   * permutes the order still works.
   */
  levelEntries: ReadonlyArray<{ id: BeatorajaImageId; rect: BeatorajaSongListRowRect }>;
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
  labels: ReadonlyArray<{ id: BeatorajaImageId; rect: BeatorajaSongListRowRect }>;
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
  text: ReadonlyArray<{ id: BeatorajaImageId; rect: BeatorajaSongListRowRect }>;
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

  // Audit A-7 — `liston[i].id` / `listoff[i].id` reference an `imageset[]` entry per
  // upstream `JsonSelectSkinObjectLoader.java:44-77`:
  //
  //     for (int i = 0; i < sk.songlist.liston.length; i++) {
  //         for (JsonSkin.ImageSet imgs : sk.imageset) {
  //             if (sk.songlist.liston[i].id.equals(imgs.id)) {
  //                 // build TextureRegion[][] from imgs.images[*] looked up in sk.image[]
  //                 ...
  //                 onimage[i] = new SkinImage(tr, timer, cycle, null);  // ref = null
  //                 ...
  //             }
  //         }
  //     }
  //
  // Upstream's `SkinImage(images[][], ..., ref=null)` ALWAYS picks `image[0]` (the first
  // imageset frame) since `ref == null` short-circuits to value=0 in `SkinImage.prepare()`.
  // We resolve the chain at parse time: liston[i].id → imageset[id].images[0] → image[id],
  // replacing `liston[i].id` in the output rect with the resolved `image[]` id. The
  // renderer's existing direct `image[]` lookup then succeeds without further changes.
  //
  // Fallback: when `liston[i].id` doesn't match any imageset[], the original id is kept
  // unchanged. Skins authoring bars as `image[]` directly (legacy / test fixtures /
  // simplified hand-rolled skins) keep working — the renderer's direct lookup succeeds
  // on the original id. Upstream technically requires imageset[]; permitting direct
  // image[] is a strict superset of upstream behavior.
  const imagesetLookup = buildImagesetIdLookup(skin);
  const rects = collectListRects(obj.liston, imagesetLookup) ?? collectListRects(obj.listoff, imagesetLookup);
  if (rects === undefined || rects.length === 0) return undefined;

  // Audit A-8 — prefer the authored `songlist.center` (= upstream's
  // `JsonSelectSkinObjectLoader.java:79` `setCenterBar`). Fall back to the geometric
  // "closest to canvas vertical centre" heuristic only when `center` is omitted (community
  // skins predating the field's introduction).
  const focusedRowIndex = resolveCenterIndex(obj.center, rects, skin);
  // Sub-destination rects. `level` is treated as a single rect (per-difficulty entries
  // typically share identical geometry — only the color tint varies). `label[]` is a LIST
  // of `{id, rect}` so per-feature gating (LN / random / mine) can show / hide each
  // independently at draw time. `text[]` is similar — each entry references a top-level
  // `text[]` declaration by id and provides the per-bar rect, which the renderer should use
  // as the dst (with `rect.h` as the font size).
  const levelRect = collectFirstSubRect(obj.level);
  const levelId = firstEntryId(obj.level);
  const level = levelRect !== undefined && levelId !== undefined ? { id: levelId, ...levelRect } : levelRect;
  // `levelEntries` keeps the entire `songlist.level[]` array (one entry per authored
  // difficulty). The renderer picks one per row based on the chart's `#DIFFICULTY`. Same
  // shape as the existing `labels` / `text` lists — `{id, rect}` per entry with the rect
  // relative to the bar.
  const levelEntries = collectLabelEntries(obj.level);
  const labels = collectLabelEntries(obj.label);
  // De-dupe text entries by id — beatoraja's default `select.json` authors the same id
  // (e.g. `bartext`) twice with different `filter` / color overrides. Without a filter
  // engine we'd render the same string twice on top of itself; keeping the first
  // occurrence per id is the closest single-shot approximation.
  const text = dedupeById(collectLabelEntries(obj.text));
  return {
    rows: rects,
    focusedRowIndex,
    labels,
    text,
    levelEntries,
    ...(level !== undefined ? { level } : {}),
  };
}

/**
 * Collect per-id label sub-destinations from `songlist.label[]`. Each entry is shaped
 * `{id, dst: [{x, y, w, h}]}`; we keep the id verbatim (the skin's `image[]` references
 * it) and pick the first dst rect as the per-bar position. Filters entries with missing
 * id or zero/negative dimensions so render-time sprite sizing is always safe.
 */
function collectLabelEntries(input: unknown): ReadonlyArray<{ id: BeatorajaImageId; rect: BeatorajaSongListRowRect }> {
  if (!Array.isArray(input)) return [];
  const out: { id: BeatorajaImageId; rect: BeatorajaSongListRowRect }[] = [];
  for (const entry of input) {
    if (entry === null || typeof entry !== 'object') continue;
    const obj = entry as Readonly<Record<string, unknown>>;
    const idRaw = obj.id;
    const id: BeatorajaImageId | undefined =
      typeof idRaw === 'string' && idRaw.length > 0
        ? idRaw
        : typeof idRaw === 'number' && Number.isFinite(idRaw)
          ? idRaw
          : undefined;
    if (id === undefined) continue;
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
function firstEntryId(input: unknown): BeatorajaImageId | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const first = input[0];
  if (first === null || typeof first !== 'object') return undefined;
  const idValue = (first as Readonly<Record<string, unknown>>).id;
  if (typeof idValue === 'string' && idValue.length > 0) return idValue;
  if (typeof idValue === 'number' && Number.isFinite(idValue)) return idValue;
  return undefined;
}

function collectListRects(
  input: unknown,
  imagesetLookup: ReadonlyMap<BeatorajaImageId, ReadonlyArray<BeatorajaImageId>>,
): BeatorajaSongListRowRect[] | undefined {
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
    // Capture `entry.id` so callers can look up the row's bar texture. Many skins author
    // the focused row with a different id (e.g. `list_on` vs `list`), so retaining the id
    // per-row gives the renderer the cursor highlight via texture choice at no extra cost.
    // `undefined` when the entry omits an id (bare dst-only rows in skins that don't author
    // a bar texture).
    //
    // Accept both string and numeric ids — `image[].id` and `imageset[].id` are both
    // `string | number`; Lua-driven skins occasionally emit numeric forms.
    const idValue = obj.id;
    const rawId =
      typeof idValue === 'string' && idValue.length > 0
        ? idValue
        : typeof idValue === 'number' && Number.isFinite(idValue)
          ? idValue
          : undefined;
    // Audit A-7: resolve through `imageset[].images[0]` when the row id matches an
    // imageset entry. Mirrors `JsonSelectSkinObjectLoader.java:44-77` which uses the
    // imageset chain — for legacy single-texture renderers we alias `id` to `images[0]`,
    // but the full `images[]` array is preserved on `imagesetImages` so renderers that
    // support per-bar-type frame selection (matching upstream `BarRenderer.java:269`'s
    // `si.draw(sprite, time, ba.value, ...)` where `ba.value` is the bar TYPE index) can
    // pick the right sub-image at draw time.
    const imagesetImages = rawId !== undefined ? imagesetLookup.get(rawId) : undefined;
    const id = imagesetImages !== undefined ? imagesetImages[0]! : rawId;
    if (id !== undefined && imagesetImages !== undefined) {
      out.push({ id, x, y, w, h, imagesetImages });
    } else if (id !== undefined) {
      out.push({ id, x, y, w, h });
    } else {
      out.push({ x, y, w, h });
    }
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Build a lookup from `imageset[].id` to its full `images[]` array. The renderer reads
 * `images[0]` for the legacy single-texture path (audit A-7) and the full array for
 * upstream-faithful per-bar-type frame selection
 * (`BarRenderer.java:269`'s `si.draw(sprite, time, ba.value, ...)`).
 *
 * Returns an empty map when the skin omits `imageset` (most LR2-derived skins) — callers
 * walk the lookup and gracefully fall back to the original id.
 */
function buildImagesetIdLookup(skin: BeatorajaSkin): ReadonlyMap<BeatorajaImageId, ReadonlyArray<BeatorajaImageId>> {
  const out = new Map<BeatorajaImageId, ReadonlyArray<BeatorajaImageId>>();
  const imagesetField = (skin as { imageset?: unknown }).imageset;
  if (!Array.isArray(imagesetField)) return out;
  for (const entry of imagesetField) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const obj = entry as Readonly<Record<string, unknown>>;
    const idRaw = obj.id;
    const id: BeatorajaImageId | undefined =
      typeof idRaw === 'string' && idRaw.length > 0
        ? idRaw
        : typeof idRaw === 'number' && Number.isFinite(idRaw)
          ? idRaw
          : undefined;
    if (id === undefined) continue;
    const images = obj.images;
    if (!Array.isArray(images) || images.length === 0) continue;
    const collected: BeatorajaImageId[] = [];
    for (const raw of images) {
      if (typeof raw === 'string' && raw.length > 0) collected.push(raw);
      else if (typeof raw === 'number' && Number.isFinite(raw)) collected.push(raw);
    }
    if (collected.length === 0) continue;
    out.set(id, collected);
  }
  return out;
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Resolve the focused row index. Audit A-8: when `songlist.center` is authored, use it
 * verbatim — it's the index `BarRenderer.java:124` checks via `i == skin.getCenterBar()`.
 * When omitted (older community skins), fall back to the "closest to canvas vertical
 * centre" heuristic so layout still resolves to something sensible.
 *
 * Audit A-9 — accept the full upstream `[0, BEATORAJA_SONGLIST_BAR_COUNT)` range, NOT
 * just `[0, rects.length)`. Upstream `BarRenderer.java:124` (`boolean on = (i == skin.
 * getCenterBar())`) loops `i` from 0..59, so a skin authoring `centerBar = 25` with
 * `liston.length = 21` legitimately points the cursor at slot 25 (which renders nothing
 * because `barimageon[25] = null`). Clamping to `rects.length` would mis-resolve those
 * skins to a different anchor row and silently desync the entry-to-slot mapping vs.
 * upstream. The renderer skips drawing unauthored slots so the focused row simply
 * doesn't paint a bar — matching upstream's null-slot behavior.
 */
function resolveCenterIndex(
  centerField: unknown,
  rects: ReadonlyArray<BeatorajaSongListRowRect>,
  skin: BeatorajaSkin,
): number {
  if (typeof centerField === 'number' && Number.isFinite(centerField)) {
    const idx = Math.trunc(centerField);
    if (idx >= 0 && idx < BEATORAJA_SONGLIST_BAR_COUNT) return idx;
  }
  // Geometric fallback — pick the row whose Pixi-space centre y is closest to the canvas
  // vertical centre. Mirrors the previous heuristic (used for skins without `center`).
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
  return bestIndex;
}

function dedupeById<T extends { id: BeatorajaImageId }>(entries: ReadonlyArray<T>): ReadonlyArray<T> {
  const seen = new Set<BeatorajaImageId>();
  const out: T[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}
