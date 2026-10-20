/**
 * The beatoraja select view's song list (`BeatorajaSelectView`): the rows the skin's `songlist` lays out (or a fallback
 * grid), each a bar image, a title, the chart's level digits and its feature labels, plus an invisible hit sprite,
 * drawn into the view's list layer inside the skin's container. Every frame it maps the visible slots onto the entries
 * around the animated cursor and lays them out.
 *
 * The rows read the view's state and call back into it through {@link BeatorajaSelectRowsContext}; the select view
 * passes it.
 */

import {
  BEATORAJA_SONGLIST_BAR_COUNT,
  composeBeatorajaValueCells,
  composeBeatorajaValueShift,
  normalizeBeatorajaImages,
  normalizeBeatorajaValues,
  type BeatorajaImageElement,
  type BeatorajaImageId,
  type BeatorajaSongListLayout,
  type BeatorajaValueElement,
} from '@be-music/skin-beatoraja';
import { joinBeatorajaText } from '@be-music/skin-beatoraja/scene';
import { resolveLR2ChartFeatures } from '@be-music/skin-lr2/state';
import { type Container, type FederatedPointerEvent, Sprite, Text, Texture } from 'pixi.js';
import type { LibraryEntry } from '@be-music/player-scene-model';
import type { BeatorajaFontCache } from '../../../skin/beatoraja/fonts.ts';
import { createCroppedBeatorajaTexture } from '../../../skin/beatoraja/render.ts';
import type { BeatorajaSceneKit } from '../../../skin/beatoraja/scene-kit.ts';
import type { BeatorajaPlaySkinView } from '../skin-view.ts';

/**
 * Fallback visible-row count when the skin doesn't author a `songlist` block. Odd so the
 * cursor sits on the centre. Real skins override this with the count of `songlist.liston`
 * entries (default beatoraja theme has 21, ModernChic 17, GdbG 11, …).
 */
const FALLBACK_VISIBLE_ROW_COUNT = 13;

/** What the song list reads and calls on the select view: its fields and methods of these names. */
export interface BeatorajaSelectRowsContext {
  /** The skin's view: the rows are laid out on its canvas. */
  readonly view: Pick<BeatorajaPlaySkinView, 'width' | 'height'>;
  /** The skin and its textures. */
  readonly options: Pick<BeatorajaSceneKit, 'skin' | 'textures'>;
  /** The layer the rows are drawn into, inside the skin's container at its `songlist` anchor. */
  readonly listLayer: Container;
  readonly entries: ReadonlyArray<LibraryEntry>;
  /** The animated cursor the rows follow. */
  readonly scrollPosition: number;
  handleRowPointerTap(rowOffset: number, event: FederatedPointerEvent): void;
}

/** The song list. See the module comment. */
export class BeatorajaSelectRows {
  private readonly ctx: BeatorajaSelectRowsContext;

  /**
   * Per-row bar background sprites — cropped from `skin.image[liston[i].id]`. Many beatoraja
   * skins author the focused row with a different id (e.g. `list_on` while other rows use
   * `list`), so the per-row texture choice doubles as the cursor highlight. `undefined`
   * entries fill the array when the skin omits an `id` for that row OR the matching
   * `image[]` entry is missing — labels still paint, just without a per-row backdrop.
   *
   * Mounted FIRST in the listLayer's z-order so labels / icons / level / feature labels
   * paint on top.
   */
  private readonly rowBarSprites: (Sprite | undefined)[] = [];
  /**
   * Per-row pre-resolved imageset frame textures. When the row's authored id resolved
   * through an `imageset[]`, this slot holds an array of textures (one per
   * `imageset.images[i]`) keyed by frame index. The renderer swaps `rowBarSprites[i].texture`
   * to the matching frame based on the focused entry's bar TYPE per upstream
   * `BarRenderer.java:269`'s `si.draw(sprite, time, ba.value, ...)`:
   *
   *   - `SongBar` with chart  → frame 0 (`bar-song`)
   *   - `SongBar` no chart    → frame 4 (`bar-nosong`)
   *   - `FolderBar`           → frame 1 (`bar-folder`)
   *   - `TableBar`/`HashBar`  → frame 2 (`bar-table`)
   *   - `GradeBar`            → frame 3 (`bar-grade`)
   *   - `CommandBar`/etc      → frame 5 (`bar-command`)
   *   - `SearchWordBar`       → frame 6 (`bar-search`)
   *
   * Our app currently surfaces only `'chart'` and `'folder'` entries (no command / search /
   * grade bars on the web port), so the active branches are 0, 1, and 4 only — the rest of
   * the array is kept ready for when those types land.
   *
   * `undefined` slot means the row's id wasn't an imageset (= legacy single-texture path);
   * the per-frame paint leaves `rowBarSprites[i].texture` as the build-time default.
   */
  private readonly rowBarFrameTextures: (ReadonlyArray<Texture | undefined> | undefined)[] = [];
  /**
   * Per-row label texts. `undefined` slot when the upstream-fixed 60-slot grid (audit A-9
   * — `BEATORAJA_SONGLIST_BAR_COUNT`) extends past the skin's authored `liston[]` count;
   * those slots stay non-allocated since upstream's `barimageon[i]` is null there too.
   */
  readonly rowLabels: (Text | undefined)[] = [];
  /**
   * Per-row chart-level digit overlay (Pixi `Text` fallback). Used ONLY when the skin's
   * `songlist.level[].id` doesn't resolve to a `value[]` declaration — e.g. legacy skins
   * that authored level as an `image[]` entry rather than a digit composer. Most modern
   * skins (default beatoraja, GdbG, ModernChic) author it as `value[id="playlevel_bar"]`
   * referencing `number.png`, so they take the sprite-digit path below and this field
   * stays empty.
   */
  private readonly rowLevelLabels: (Text | undefined)[] = [];
  /**
   * Per-row chart-level digit sprites — one per `digit` slot, cropped from the strip
   * texture referenced by the value declaration's `src` (typically `number.png` in
   * beatoraja's default skin). Mirrors upstream `MusicSelector`'s rendering: the chart's
   * `#PLAYLEVEL` value is composed via {@link composeBeatorajaValueCells} and each digit
   * lands in a per-cell sprite sized to a fraction of the level sub-rect.
   *
   * `undefined` slot when the row's level path falls back to text rendering (above).
   */
  private readonly rowLevelDigitSprites: (Sprite[] | undefined)[] = [];
  /**
   * Resolved `value[]` declaration referenced by `songlist.level[].id`. Single skin-wide
   * value so we cache it once per skin instead of looking up every row build. `undefined`
   * when the skin omits a `value[]` for the level id (then every row falls back to the
   * Text path above).
   */
  private levelValueElement: BeatorajaValueElement | undefined;
  /** Source-strip texture for {@link levelValueElement} — used to crop per-digit cells. */
  private levelStripTexture: Texture | undefined;
  /**
   * Per-row chart-feature label sprites — one Sprite per `(visible row × songlist.label[]
   * entry)` combination. Each label is gated on a chart feature predicate (LN /
   * random sequence / landmine / etc.); the renderer iterates the entries each frame and
   * shows / hides the matching sprite per row. Mounted lazily via {@link buildRowVisuals}
   * after the songlist parse settles.
   *
   * Layout: `rowFeatureLabels[rowIndex][labelIndex] = Sprite` so a single Sprite never
   * needs to flip between different label ids at runtime — sizing / texture is fixed at
   * mount time, only visibility / position toggles.
   */
  private readonly rowFeatureLabels: Sprite[][] = [];
  /**
   * Per-row click hit area. `undefined` for unauthored slots beyond `liston.length`
   * (audit A-9) — no rect to size against and nothing visible to click.
   */
  readonly rowHitAreas: (Sprite | undefined)[] = [];
  /**
   * Skin-authored `songlist` layout (rect-per-row + focused row index). Parsed from
   * `skin.songlist` at construction. `undefined` when the skin omits the block — the layout
   * code falls back to a screen-space hard-coded grid so unsupported themes still get
   * something usable.
   */
  songList: BeatorajaSongListLayout | undefined;
  /**
   * Whether the parsed songlist authors a different bar-image id for the focused row
   * versus the rest (e.g. `list_on` on the cursor's row, `list` elsewhere). When true the
   * texture swap visualises the cursor on its own and we suppress the warm-yellow label
   * tint so we don't double up on the highlight cue.
   *
   * Recomputed in {@link applySongListGeometry} whenever the songlist is parsed (i.e.
   * construction + `replaceSkin`). Stays `false` for skins authoring all rows with the
   * same id (or no id at all) — those rely on the warm-yellow label fallback.
   */
  private hasFocusedBarVariant = false;
  /** Cached visible row count — `songList?.rows.length` or the fallback constant. */
  private visibleRowCount = FALLBACK_VISIBLE_ROW_COUNT;
  /** Cached focused row index within `0..visibleRowCount-1`. */
  centreRowIndex = Math.floor(FALLBACK_VISIBLE_ROW_COUNT / 2);

  constructor(ctx: BeatorajaSelectRowsContext) {
    this.ctx = ctx;
  }

  /**
   * Recompute `visibleRowCount` + `centreRowIndex` from the parsed `songlist`. When the skin
   * doesn't author one we fall back to the legacy hardcoded grid.
   *
   * Audit A-9 — when a skin authors `songlist`, iterate the upstream-fixed 60-slot grid
   * (`BEATORAJA_SONGLIST_BAR_COUNT`, mirroring `BarRenderer.barlength`) instead of clamping
   * to the authored `liston.length`. Slots beyond `rows.length` stay unauthored (no rect,
   * no allocated visuals) — the renderer paints nothing there, matching upstream's
   * `barimageon[i] = null` for those indices. Visible behavior is identical for typical
   * skins (`liston.length = 21`, `centerBar = 10`) since the entry-to-slot mapping
   * `entry = cursor + (i - centerBar)` plus the centred per-row visibility gating already
   * skipped those slots; the change matters only when the skin authors `centerBar` ≥
   * `liston.length` (where upstream legitimately renders the focused song to a null slot).
   *
   * Called on construction and `replaceSkin` — the songlist parse depends on the skin
   * payload, so it has to re-run when the skin payload changes.
   */
  applySongListGeometry(): void {
    if (this.songList !== undefined) {
      this.visibleRowCount = BEATORAJA_SONGLIST_BAR_COUNT;
      this.centreRowIndex = this.songList.focusedRowIndex;
      // Detect a per-row id variance (e.g. `list_on` for the focused row vs `list` for
      // the rest). When true, the bar-texture swap is the skin-authored cursor highlight,
      // and stacking our warm-yellow label tint on top would over-paint the cue. Reads
      // from authored rows only — unauthored slots (i ≥ rows.length) don't affect the
      // variant detection since they have no id at all.
      const focusId = this.songList.rows[this.centreRowIndex]?.id;
      const hasVariant =
        focusId !== undefined && this.songList.rows.some((r, idx) => idx !== this.centreRowIndex && r.id !== focusId);
      this.hasFocusedBarVariant = hasVariant;
    } else {
      this.visibleRowCount = FALLBACK_VISIBLE_ROW_COUNT;
      this.centreRowIndex = Math.floor(FALLBACK_VISIBLE_ROW_COUNT / 2);
      this.hasFocusedBarVariant = false;
    }
  }

  /**
   * Get the per-row rect for visible-row index `i` in skin-space (top-left origin Y-DOWN).
   * Reads directly from `songList.rows[i]` (Y-flipped from libGDX Y-UP) when available;
   * otherwise synthesises a fallback grid on the right half of the canvas.
   *
   * Audit A-9 — returns `undefined` when the skin authored a `songlist` but `i` is past
   * the authored `liston.length` (e.g. `i = 25` with `liston.length = 21`). The renderer
   * iterates the full 60-slot upstream grid; unauthored slots have no rect and skip
   * drawing. Skins that omit `songlist` entirely take the synthesised fallback grid path
   * for every `i` so the legacy behavior keeps working.
   */
  private rowRectAt(i: number): { x: number; y: number; w: number; h: number } | undefined {
    const skinH = this.ctx.view.height;
    if (this.songList !== undefined) {
      const r = this.songList.rows[i];
      if (r === undefined) return undefined;
      return { x: r.x, y: skinH - r.y - r.h, w: r.w, h: r.h };
    }
    // Fallback: right half, evenly spaced. Keeps unsupported skins (no songlist block)
    // usable. Always returns a rect — the fallback grid is uniform across the full
    // visible-row count.
    const skinW = this.ctx.view.width;
    const fallbackRowH = 56 * (skinH / 720);
    const focusedRowCentreY = skinH * 0.42;
    const cx = skinW * 0.74;
    const w = skinW * 0.4;
    const yCentre = focusedRowCentreY + (i - this.centreRowIndex) * fallbackRowH;
    return { x: cx - w / 2, y: yCentre - fallbackRowH / 2, w, h: fallbackRowH };
  }

  /**
   * Pick an authored row rect for sample queries (label sizing, avg row step) that need
   * SOME valid rect even when `centreRowIndex` lands on an unauthored slot (the upstream
   * `centerBar ≥ liston.length` edge case). Returns the rect at index `0` of the authored
   * rows, Y-flipped to skin-space — that's guaranteed to exist whenever `songList` is
   * defined (parser drops empty `liston[]` arrays as "no songlist").
   *
   * Returns `undefined` only when no songlist was authored — call sites then take the
   * synthesised-fallback grid path via {@link rowRectAt} on `centreRowIndex` (always
   * defined under fallback).
   */
  private firstAuthoredRowRect(): { x: number; y: number; w: number; h: number } | undefined {
    const rows = this.songList?.rows;
    if (rows === undefined || rows.length === 0) return undefined;
    const r = rows[0]!;
    const skinH = this.ctx.view.height;
    return { x: r.x, y: skinH - r.y - r.h, w: r.w, h: r.h };
  }

  /**
   * Sample row rect for label-size / avg-step heuristics. Prefers `centreRowIndex`
   * (matches the previous behavior for skins where centerBar < liston.length, which is
   * every real skin in the wild) but falls back to the first authored row when centerBar
   * lands on an unauthored slot — needed since {@link rowRectAt} now returns `undefined`
   * for those.
   */
  private sampleRowRect(): { x: number; y: number; w: number; h: number } {
    const atCentre = this.rowRectAt(this.centreRowIndex);
    if (atCentre !== undefined) return atCentre;
    const firstAuthored = this.firstAuthoredRowRect();
    if (firstAuthored !== undefined) return firstAuthored;
    // No songlist authored at all — fallback grid always returns a rect at index 0.
    return this.rowRectAt(0)!;
  }

  destroyRowVisuals(): void {
    for (const t of this.rowLabels) t?.destroy();
    for (const t of this.rowLevelLabels) t?.destroy();
    for (const sprites of this.rowLevelDigitSprites) {
      if (sprites === undefined) continue;
      for (const s of sprites) s.destroy({ children: false, texture: false, textureSource: false });
    }
    for (const row of this.rowFeatureLabels) {
      for (const sprite of row) sprite.destroy({ children: false, texture: false, textureSource: false });
    }
    for (const s of this.rowHitAreas) s?.destroy();
    for (const s of this.rowBarSprites) s?.destroy({ children: false, texture: false, textureSource: false });
    this.rowLabels.length = 0;
    this.rowLevelLabels.length = 0;
    this.rowLevelDigitSprites.length = 0;
    this.rowFeatureLabels.length = 0;
    this.rowHitAreas.length = 0;
    this.rowBarSprites.length = 0;
    // Pre-resolved imageset frame textures don't own any GPU lifetime (the underlying
    // base texture is owned by the texture cache); just drop the references so the
    // rebuild loop populates a fresh array indexed alongside `rowBarSprites`.
    this.rowBarFrameTextures.length = 0;
  }

  buildRowVisuals(fonts: BeatorajaFontCache | undefined): void {
    const skinFamily = fonts?.values()[0]?.family;
    const fontFamily = skinFamily !== undefined ? `'${skinFamily}', sans-serif` : 'sans-serif';
    // Tear down old visuals when rebuilding (e.g. on `replaceSkin` against a skin whose
    // songlist length differs from the previous one). Pixi children stay attached to
    // listLayer; clearing the arrays lets the new loop allocate the right count.
    this.destroyRowVisuals();
    // Resolve the songlist's `level[].id` against the skin's `value[]` declarations
    // FIRST. When it matches (e.g. default beatoraja's `playlevel_bar` value points at
    // `number.png`), each row's level slot composes per-digit sprites cropped from the
    // strip — same path beatoraja's `MusicSelector` uses. When it doesn't (legacy skin
    // authoring level as `image[]` instead, or no `value[]` for that id), every row
    // falls back to system-font Pixi `Text`.
    this.levelValueElement = this.resolveLevelValueElement();
    this.levelStripTexture =
      this.levelValueElement !== undefined ? this.ctx.options.textures.get(this.levelValueElement.src) : undefined;
    // Title font size. Two cases:
    //
    //  - Skin authored `songlist.text[]` (default beatoraja, GdbG, ModernChic) — use
    //    `text[0].rect.h` as the title size, which matches upstream `SkinTextFont.draw`'s
    //    `font.setScale(region.height / parameter.size)` behavior (the rendered glyph
    //    height IS the dst rect's height; the text element's authored `size` only controls
    //    the bitmap load resolution). For the default skin's 36 px bar with `dst:{h:24}`
    //    this gives 24 px.
    //
    //  - Skin omitted the block — fall back to a row-height proportional size so
    //    unsupported skins still get readable text. `0.45` mirrors what the bundled
    //    fixtures of older skins were authoring before we adopted the spec-faithful path.
    const sampleRect = this.sampleRowRect();
    const songListText = this.songList?.text ?? [];
    const proportionalLabelSize = Math.max(12, Math.floor(sampleRect.h * 0.45));
    const labelSize =
      songListText[0] !== undefined ? Math.max(8, Math.floor(songListText[0].rect.h)) : proportionalLabelSize;
    for (let i = 0; i < this.visibleRowCount; i += 1) {
      // Audit A-9 — when iterating the upstream-fixed 60-slot grid, slots beyond the
      // skin's authored `liston[]` array stay un-allocated. Push `undefined` placeholders
      // so the array indices keep aligning with slot indices (every consumer indexes by
      // `i ∈ [0, visibleRowCount)` so the alignment matters), and the render loops below
      // skip these slots via the `=== undefined` checks. Mirrors upstream's
      // `barimageon[i] = null` / `barimageoff[i] = null` for indices past `liston.length`.
      if (this.songList !== undefined && this.songList.rows[i] === undefined) {
        this.rowBarSprites.push(undefined);
        this.rowBarFrameTextures.push(undefined);
        this.rowHitAreas.push(undefined);
        this.rowLabels.push(undefined);
        if (this.songList.level !== undefined) {
          this.rowLevelDigitSprites.push(undefined);
          this.rowLevelLabels.push(undefined);
        }
        this.rowFeatureLabels.push([]);
        continue;
      }
      // Per-row bar background. Mounted FIRST so it sits behind hit area / icon / labels.
      // Skins that author the focused row with a different `liston[i].id` (e.g. `list_on`
      // for the cursor row, `list` for the rest) get their cursor highlight via the
      // texture choice — no extra branching here. Skins that omit an id, or whose matching
      // `image[]` entry is missing from the texture cache, get an `undefined` slot and the
      // labels paint without a backdrop.
      const rowMeta = this.songList?.rows[i];
      const barId = rowMeta?.id;
      const bar = barId !== undefined ? this.buildFeatureLabelSprite(barId) : undefined;
      if (bar !== undefined) this.ctx.listLayer.addChild(bar);
      this.rowBarSprites.push(bar);
      // Pre-resolve every imageset sub-image's texture so the per-frame paint can swap to
      // the matching one based on the entry's bar TYPE (song / folder / etc.). Mirrors
      // upstream `BarRenderer.java:269`'s `si.draw(sprite, time, ba.value, ...)` where
      // `ba.value` indexes into the multi-frame `SkinImage`. Empty when the row's authored
      // id is just a plain `image[]` (= no imageset chain) — the legacy single-texture
      // path stays the only path in that case.
      this.rowBarFrameTextures.push(this.resolveBarFrameTextures(rowMeta?.imagesetImages));

      // Hit area sprite — invisible but interactive. Sized to the row's text band on layout.
      const hit = new Sprite({ texture: Texture.WHITE });
      hit.alpha = 0;
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      hit.on('pointertap', (event: FederatedPointerEvent) => this.ctx.handleRowPointerTap(i, event));
      this.ctx.listLayer.addChild(hit);
      this.rowHitAreas.push(hit);

      // Bar text — beatoraja's `bartext` named element, dynamically resolved by the
      // music selector to the song's title / folder name. Default skin authors a single
      // entry; multi-entry skins are not yet supported (only the first text entry's
      // dst rect drives the layout for now).
      const label = new Text({
        text: '',
        style: { fontFamily, fontSize: labelSize, fill: 0xffffff, fontWeight: '600' },
      });
      label.anchor.set(0, 0.5);
      this.ctx.listLayer.addChild(label);
      this.rowLabels.push(label);

      // Per-row chart-level overlay — only allocated when the songlist authored
      // `level[]`. Two paths:
      //
      //  - **Sprite-digit** (preferred, matches beatoraja's reference). When the level's
      //    `id` resolves to a `value[]` declaration (e.g. default skin's `playlevel_bar`
      //    → `number.png`), allocate one sprite per `digit` slot. Per-frame composes the
      //    chart's `#PLAYLEVEL` via `composeBeatorajaValueCells` and crops the matching
      //    cell from the strip texture.
      //  - **Text fallback**. When no matching `value[]` exists (legacy skin authoring as
      //    `image[]` or omitting the value declaration), render a system-font Pixi `Text`
      //    digit so the player still sees the number — just without the skin's bitmap font.
      if (this.songList?.level !== undefined) {
        const levelDef = this.songList.level;
        if (this.levelValueElement !== undefined && this.levelStripTexture !== undefined) {
          const valueElement = this.levelValueElement;
          const digitCount = Math.max(1, Math.trunc(valueElement.digit));
          const sprites: Sprite[] = [];
          for (let d = 0; d < digitCount; d += 1) {
            const sprite = new Sprite();
            sprite.visible = false;
            this.ctx.listLayer.addChild(sprite);
            sprites.push(sprite);
          }
          this.rowLevelDigitSprites.push(sprites);
          this.rowLevelLabels.push(undefined);
        } else {
          const level = new Text({
            text: '',
            style: {
              fontFamily,
              // Floor at 12 so unusually short level rects stay legible.
              fontSize: Math.max(12, Math.floor(levelDef.h)),
              fill: 0xffffff,
              fontWeight: '700',
              stroke: { color: 0x000000, width: 2 },
            },
          });
          level.anchor.set(0.5, 0.5);
          this.ctx.listLayer.addChild(level);
          this.rowLevelLabels.push(level);
          this.rowLevelDigitSprites.push(undefined);
        }
      }

      // Per-row chart-feature label sprites (LN / random / mine / favorite / etc.). One
      // Sprite per `(row × songlist.label[] entry)` — texture is fixed at mount time from
      // the skin's `image[id]` lookup, only visibility / position toggles per frame as
      // the cursor moves and the focused song's feature predicate changes.
      const featureLabels = this.songList?.labels ?? [];
      const rowSprites: Sprite[] = [];
      for (const labelEntry of featureLabels) {
        const sprite = this.buildFeatureLabelSprite(labelEntry.id);
        if (sprite === undefined) continue;
        sprite.visible = false;
        this.ctx.listLayer.addChild(sprite);
        rowSprites.push(sprite);
      }
      this.rowFeatureLabels.push(rowSprites);
    }
  }

  /**
   * Crop the skin's `image[id]` source rect into a fresh `Sprite`. Returns `undefined`
   * when the skin doesn't author the matching image entry, the source texture isn't in
   * the cache (deferred / failed decode), or the cropped texture comes back empty. The
   * sprite is sized later per the row's label sub-rect.
   */
  /**
   * Look up the `value[]` declaration the songlist's `level[].id` points at. Beatoraja's
   * reference skin authors level as `value[id="playlevel_bar"]` referencing `number.png`
   * — the digit composer template the renderer uses to crop per-cell glyphs from the
   * strip. Returns `undefined` when the songlist either omits a level block, has no
   * id captured on the level rect, or the id doesn't resolve to a value entry (legacy
   * skins author the level frame as an `image[]` instead).
   *
   * Cached lazily into a per-skin Map; rebuilt on every `replaceSkin` since the lookup
   * map binds to the new skin's `value[]` declarations.
   */
  private resolveLevelValueElement(): BeatorajaValueElement | undefined {
    const levelId = this.songList?.level?.id;
    if (typeof levelId !== 'string' && typeof levelId !== 'number') return undefined;
    if (this.valueElementsById === undefined) {
      this.valueElementsById = new Map();
      for (const v of normalizeBeatorajaValues((this.ctx.options.skin as { value?: unknown }).value)) {
        this.valueElementsById.set(v.id, v);
      }
    }
    return this.valueElementsById.get(levelId);
  }
  valueElementsById: Map<string | number, BeatorajaValueElement> | undefined;

  /**
   * Per-difficulty level value-element map. Built from the parsed
   * {@link BeatorajaSongListLayout.levelEntries}: each entry's id (e.g. `level-beginner`)
   * looks up the matching `value[]` declaration on the skin (`src = songbar.png`,
   * `(x, y)` cropping a difficulty-specific colour row from the level sprite strip).
   * Per-row rendering picks the entry by `chart.metadata.difficulty`:
   *
   *   - 0 (no `#DIFFICULTY` authored) → `level-unknown`
   *   - 1..5 → `level-beginner / normal / hyper / another / insane`
   *
   * Mirrors upstream `JSONSelectSkinObjectLoader.java:148-158` which builds an array of
   * SkinNumbers (`barlevel[i]`) and `BarRenderer.java` reads `barlevel[song.difficulty]`
   * per row. Without this, every row painted from the SAME value declaration (= the first
   * entry, typically the grey "unknown" row), so charts with an explicit `#DIFFICULTY`
   * showed in the wrong colour.
   */
  private resolveLevelValueByDifficulty(): ReadonlyMap<number, BeatorajaValueElement> {
    if (this.cachedLevelValueByDifficulty !== undefined) return this.cachedLevelValueByDifficulty;
    const map = new Map<number, BeatorajaValueElement>();
    const entries = this.songList?.levelEntries ?? [];
    if (this.valueElementsById === undefined) {
      this.valueElementsById = new Map();
      for (const v of normalizeBeatorajaValues((this.ctx.options.skin as { value?: unknown }).value)) {
        this.valueElementsById.set(v.id, v);
      }
    }
    for (const entry of entries) {
      const difficulty = parseLevelDifficultyIndex(entry.id);
      if (difficulty === undefined) continue;
      const value = this.valueElementsById.get(entry.id);
      if (value === undefined) continue;
      // First occurrence wins — matches upstream's loop break-on-match semantics.
      if (!map.has(difficulty)) map.set(difficulty, value);
    }
    this.cachedLevelValueByDifficulty = map;
    return map;
  }
  private cachedLevelValueByDifficulty: ReadonlyMap<number, BeatorajaValueElement> | undefined;

  /**
   * Pick the level value element for a song's difficulty. Falls back to the global
   * `levelValueElement` (= first entry) when the chart's `#DIFFICULTY` doesn't have a
   * matching `level-*` entry — covers community charts that author non-standard
   * difficulty values plus skins that only ship a subset (e.g. unknown + normal).
   */
  private levelValueElementForDifficulty(difficulty: number | undefined): BeatorajaValueElement | undefined {
    const byDiff = this.resolveLevelValueByDifficulty();
    if (byDiff.size > 0) {
      const safe = Number.isFinite(difficulty) && (difficulty as number) >= 0 ? Math.trunc(difficulty as number) : 0;
      const matched = byDiff.get(safe);
      if (matched !== undefined) return matched;
      // Difficulty outside the map (e.g. `#DIFFICULTY 9` from a non-standard chart, or no
      // matching authored row) — try `level-unknown` (= 0) then fall back to the first
      // authored entry so the digits still render with SOME sprite row.
      const unknown = byDiff.get(0);
      if (unknown !== undefined) return unknown;
      const first = byDiff.values().next().value;
      if (first !== undefined) return first;
    }
    return this.levelValueElement;
  }

  private buildFeatureLabelSprite(imageId: string | number): Sprite | undefined {
    if (this.featureLabelImages === undefined) {
      this.featureLabelImages = new Map();
      for (const image of normalizeBeatorajaImages(this.ctx.options.skin.image)) {
        this.featureLabelImages.set(image.id, image);
      }
    }
    const image = this.featureLabelImages.get(imageId);
    if (image === undefined) return undefined;
    const baseTexture = this.ctx.options.textures.get(image.src);
    if (baseTexture === undefined) return undefined;
    const cropped = createCroppedBeatorajaTexture(baseTexture, {
      x: image.x,
      y: image.y,
      w: image.w,
      h: image.h,
    });
    if (cropped === undefined) return undefined;
    return new Sprite({ texture: cropped, alpha: 1 });
  }

  /**
   * Pre-resolve every imageset sub-image's cropped texture so the per-frame paint can
   * swap to the matching frame in O(1). Returns `undefined` when the row's authored id
   * wasn't an imageset (= legacy single-image path — no swap needed). Slots within the
   * array are `undefined` when an authored sub-image id failed to resolve in `image[]` /
   * texture cache; the caller falls back to the legacy single-texture render in that case.
   */
  private resolveBarFrameTextures(
    images: ReadonlyArray<BeatorajaImageId> | undefined,
  ): ReadonlyArray<Texture | undefined> | undefined {
    if (images === undefined || images.length === 0) return undefined;
    if (this.featureLabelImages === undefined) {
      this.featureLabelImages = new Map();
      for (const image of normalizeBeatorajaImages(this.ctx.options.skin.image)) {
        this.featureLabelImages.set(image.id, image);
      }
    }
    const out: (Texture | undefined)[] = [];
    for (const id of images) {
      const image = this.featureLabelImages.get(id);
      if (image === undefined) {
        out.push(undefined);
        continue;
      }
      const baseTexture = this.ctx.options.textures.get(image.src);
      if (baseTexture === undefined) {
        out.push(undefined);
        continue;
      }
      const cropped = createCroppedBeatorajaTexture(baseTexture, {
        x: image.x,
        y: image.y,
        w: image.w,
        h: image.h,
      });
      out.push(cropped);
    }
    return out;
  }
  /** Lazy `image[].id → BeatorajaImageElement` map for feature-label texture lookups. */
  featureLabelImages: Map<string | number, BeatorajaImageElement> | undefined;

  /** Forgets what was read off the skin, before the rows are built for another one. */
  forgetSkin(): void {
    this.featureLabelImages = undefined;
    this.valueElementsById = undefined;
    this.cachedLevelValueByDifficulty = undefined;
  }

  /**
   * Repaint the row backdrops + labels for the current cursor / scroll state. Called on every
   * tick (cheap — just text mutations + Graphics rect rebuild).
   */
  refreshRowVisuals(): void {
    const total = this.ctx.entries.length;
    // The "centre" of the visible window in entry-coordinates. As `scrollPosition` tweens
    // toward `currentIndex`, every row's index slides by the same amount. Indices that fall
    // outside `[0, total)` are wrapped — the list is circular, so the row above the first
    // entry shows the LAST entry and vice versa.
    const centreEntry = this.ctx.scrollPosition;
    for (let i = 0; i < this.visibleRowCount; i += 1) {
      const rawEntryIndex = Math.round(centreEntry) + (i - this.centreRowIndex);
      const wrappedIndex = total > 0 ? ((rawEntryIndex % total) + total) % total : -1;
      const entry = total > 0 ? this.ctx.entries[wrappedIndex] : undefined;
      const label = this.rowLabels[i];
      const hit = this.rowHitAreas[i];
      const bar = this.rowBarSprites[i];
      // Audit A-9 — slot is unauthored in this skin's `liston[]` (i ≥ rows.length).
      // No visuals were allocated; nothing to do this frame.
      if (label === undefined || hit === undefined) continue;
      if (entry === undefined) {
        label.visible = false;
        hit.visible = false;
        // Hide the row bar background when no song / folder is mapped to this slot
        // (small libraries that don't fill the whole visible window). Otherwise an empty
        // row would still show its bar texture.
        if (bar !== undefined) bar.visible = false;
        continue;
      }
      const isSelected = i === this.centreRowIndex;
      label.visible = true;
      hit.visible = true;
      if (bar !== undefined) {
        bar.visible = true;
        // Per-bar-type imageset frame swap. Mirrors upstream `BarRenderer.java:269`'s
        // `si.draw(sprite, time, ba.value, ...)` where `ba.value` is the bar TYPE index
        // resolved at `BarRenderer.java:150-166`. Our app currently surfaces only `'chart'`
        // and `'folder'` browse entries, mapping to frames 0 (`bar-song`) and 1
        // (`bar-folder`). Future bar-type additions (table / grade / command / search)
        // would extend the switch below; today they fall through to the default frame.
        const frames = this.rowBarFrameTextures[i];
        if (frames !== undefined) {
          // `BarRenderer.java:150-166`: a GradeBar is frame 3, or 4 (`bar-nosong`) when a stage is missing.
          const frameIndex =
            entry.kind === 'folder' ? 1 : entry.kind === 'course' ? (entry.course.playable ? 3 : 4) : 0;
          const frame = frames[frameIndex] ?? frames[0];
          if (frame !== undefined) bar.texture = frame;
        }
      }
      const levelLabel = this.rowLevelLabels[i];
      const levelDigits = this.rowLevelDigitSprites[i];
      if (entry.kind === 'folder') {
        // Beatoraja's `BarRenderer.render` (`BarRenderer.java:298`) sets the bar's text from
        // `Bar.getTitle()`. For folder rows the implementation is `FolderBar.getTitle()` →
        // `folder.getTitle()` (`FolderBar.java:35-36`), which is the folder's own name
        // without any subtitle merge.
        label.text = entry.folder.label;
        if (levelLabel !== undefined) levelLabel.visible = false;
        if (levelDigits !== undefined) {
          for (const sprite of levelDigits) sprite.visible = false;
        }
      } else if (entry.kind === 'course') {
        // `GradeBar.getTitle()` is the course name.
        label.text = entry.course.definition.name;
        if (levelLabel !== undefined) levelLabel.visible = false;
        if (levelDigits !== undefined) {
          for (const sprite of levelDigits) sprite.visible = false;
        }
      } else {
        const chartEntry = entry.chart;
        // `SongBar.getTitle()` (`SongBar.java:61-63`) returns `song.getFullTitle()`, which is
        // `subtitle.length() > 0 ? title + " " + subtitle : title` (`SongData.java:285-290`).
        // Authors who use `#SUBTITLE` to disambiguate difficulty (`Foo` + `[INSANE]`) rely on
        // this concatenation — pre-fix the bar showed only the title, so charts that share
        // a base title looked identical in the song list.
        label.text = joinBeatorajaText(chartEntry.title, chartEntry.subtitle);
        const lvl = resolvePlayLevel(chartEntry.playLevel);
        const showLevel = lvl !== undefined && lvl > 0;
        // Per-difficulty value element pick. Upstream's `BarRenderer` reads
        // `barlevel[song.difficulty]` per row so each chart paints its `#PLAYLEVEL` from the
        // colour-coded sprite row matching its difficulty (`level-beginner`,
        // `level-normal`, …). Falls back to `this.levelValueElement` (the first authored
        // entry) when the chart's difficulty doesn't have a matching authored entry — keeps
        // skins with a partial level set or non-standard `#DIFFICULTY` values still
        // rendering some sprite digits.
        const perDifficultyLevelValue = this.levelValueElementForDifficulty(chartEntry.chart.metadata.difficulty);
        if (
          levelDigits !== undefined &&
          perDifficultyLevelValue !== undefined &&
          this.levelStripTexture !== undefined
        ) {
          // Sprite-digit path. Compose the chart's `#PLAYLEVEL` into per-cell rects via
          // upstream's value composer, then crop each cell from the strip texture and
          // assign it to the matching slot sprite. Hidden cells leave the slot invisible
          // (= leading-blank padding) so a 4-digit slot rendering "12" only paints two
          // sprites on the right.
          if (showLevel) {
            const cells = composeBeatorajaValueCells(perDifficultyLevelValue, lvl);
            for (let d = 0; d < levelDigits.length; d += 1) {
              const sprite = levelDigits[d]!;
              const cell = cells[d];
              if (cell === undefined || cell.hidden) {
                sprite.visible = false;
                continue;
              }
              const cropped = createCroppedBeatorajaTexture(this.levelStripTexture, {
                x: cell.x,
                y: cell.y,
                w: cell.w,
                h: cell.h,
              });
              if (cropped === undefined) {
                sprite.visible = false;
                continue;
              }
              sprite.texture = cropped;
              sprite.visible = true;
            }
          } else {
            for (const sprite of levelDigits) sprite.visible = false;
          }
        } else if (levelLabel !== undefined) {
          // Text fallback path.
          if (showLevel) {
            levelLabel.text = String(Math.trunc(lvl));
            levelLabel.tint = levelTintForDifficulty(lvl);
            levelLabel.visible = true;
          } else {
            levelLabel.visible = false;
          }
        }
      }
      label.alpha = isSelected ? 1 : 0.75;
    }
    this.layoutRows();
  }

  /**
   * Position + size the row visuals using the skin's authored `songlist.liston` rects (or
   * the synthesised fallback grid). Coordinates are skin-space — the listLayer is mounted
   * inside `view.container` so the parent transform handles scaling / letterboxing.
   *
   * The fractional `scrollPosition` residual feeds into a per-row Y nudge so an in-flight
   * tween shows a sub-row glide instead of jumping a whole row at the snap. The offset
   * is applied along the AVERAGE row-height direction, which works for straight column
   * layouts and degrades gracefully for arched / diagonal layouts (the rows still glide,
   * just along a non-vertical axis).
   */
  layoutRows(): void {
    if (this.visibleRowCount === 0) return;

    // Average row height (skin-space) to scale the fractional scroll. For straight layouts
    // this is the per-row vertical step; for arched layouts it's a reasonable approximation
    // of the typical step magnitude. Audit A-9 — `centreRowIndex` may now point at an
    // unauthored slot (`centerBar ≥ liston.length` edge case), so use `sampleRowRect()`
    // (falls back to the first authored row) for `atCentre`. `aboveCentre` falls back to
    // the same sample when the slot above is also unauthored — degenerate layouts (single
    // authored row) collapse `avgRowStep` to `atCentre.h`, matching the pre-A-9 fallback.
    const atCentre = this.sampleRowRect();
    const aboveCentre = this.rowRectAt(Math.max(0, this.centreRowIndex - 1)) ?? atCentre;
    const avgRowStep = Math.abs(aboveCentre.y - atCentre.y) || atCentre.h;
    const fractional = this.ctx.scrollPosition - Math.round(this.ctx.scrollPosition);
    const fractionalNudge = -fractional * avgRowStep;

    const total = this.ctx.entries.length;
    const centreEntry = this.ctx.scrollPosition;
    for (let i = 0; i < this.visibleRowCount; i += 1) {
      const hit = this.rowHitAreas[i];
      const label = this.rowLabels[i];
      // Audit A-9 — skip unauthored 60-slot grid positions (visuals weren't allocated).
      if (hit === undefined || label === undefined) continue;
      if (!label.visible) continue;
      const rect = this.rowRectAt(i);
      // Defensive: rowRectAt returns undefined for unauthored slots, but the label/hit
      // checks above already gate that path. Keep the guard so type inference stays happy.
      if (rect === undefined) continue;
      const rowCentreY = rect.y + rect.h / 2 + fractionalNudge;
      // Resolve the entry for THIS row — needed for per-row feature-label predicates. The
      // wrap math mirrors `refreshRowVisuals`'s; both functions iterate the same visible
      // window so they need to agree on which entry maps to which slot.
      const rawEntryIndex = Math.round(centreEntry) + (i - this.centreRowIndex);
      const wrappedIndex = total > 0 ? ((rawEntryIndex % total) + total) % total : -1;
      const entry = total > 0 ? this.ctx.entries[wrappedIndex] : undefined;

      const isSelected = i === this.centreRowIndex;

      // Per-row bar background — positioned + sized to the row's full rect (skin-space).
      // The skin's authored `liston[i].dst[0]` rect IS the bar rect, so we just stamp the
      // cropped texture into the same coordinates the labels / hit area use. Honours the
      // fractional scroll nudge so an in-flight tween glides the bar with everything else.
      const bar = this.rowBarSprites[i];
      if (bar !== undefined) {
        bar.x = rect.x;
        bar.y = rect.y + fractionalNudge;
        bar.width = rect.w;
        bar.height = rect.h;
      }

      hit.x = rect.x;
      hit.y = rect.y + fractionalNudge;
      hit.width = rect.w;
      hit.height = rect.h;
      hit.hitArea = null;

      // Title label x — pushed past whichever sub-rect extends further right within the
      // bar. Two flavours for the level slot:
      //
      //  - Sprite-digit (`value[].digit` cells, default skin) — `dst.w` is PER-DIGIT slot
      //    width, so the digit row's actual right edge is
      //    `level.x + (slotWidth + space) * digit_count`. Using just `level.x + level.w`
      //    here was the squashed-text bug's twin: the title text would overlap the
      //    second / third digit of multi-digit levels (e.g. "10ight Parade" instead of
      //    "10  Light Parade").
      //  - Text fallback — single Text node sized to roughly `level.w`, so `level.x +
      //    level.w` is the right edge.
      //
      // Negative-x `label[]` entries (e.g. default's `label-ln` at x=-20) sit OUTSIDE the
      // bar and don't push the title.
      const levelRectForOffset = this.songList?.level;
      let levelRightEdge = 0;
      if (levelRectForOffset !== undefined) {
        if (this.levelValueElement !== undefined) {
          const ve = this.levelValueElement;
          const slotW = levelRectForOffset.w;
          const space = Number.isFinite(ve.space) ? ve.space : 0;
          const digits = Math.max(1, Math.trunc(ve.digit));
          // `align=0` (right) extends right from `dst.x`; `align=1/2` shift the row LEFT,
          // so the right edge is at most `dst.x + slotStep * digits` regardless. Using the
          // upper bound keeps the title clearance conservative across alignments.
          levelRightEdge = levelRectForOffset.x + slotW * digits + space * Math.max(0, digits - 1);
        } else {
          levelRightEdge = levelRectForOffset.x + levelRectForOffset.w;
        }
      }
      let positiveLabelRight = 0;
      for (const labelEntry of this.songList?.labels ?? []) {
        const right = labelEntry.rect.x + labelEntry.rect.w;
        if (right > positiveLabelRight) positiveLabelRight = right;
      }
      const subRectRightEdge = Math.max(levelRightEdge, positiveLabelRight);
      const leftPad = Math.max(8, Math.floor(rect.h * 0.2));
      // Title label position. Two flavours:
      //
      //  - Skin authored `songlist.text[]` — `text[0].rect.{x, y}` is the per-bar relative
      //    position of the bartext sprite. ModernChic / GdbG-style skins place the title
      //    inside a decorative frame that doesn't follow the level / label sub-rects, so we
      //    HAVE to honor the authored rect or the title lands in the wrong place (often
      //    completely outside the bar).
      //  - Skin omitted `text[]` — fall back to "right of level / labels + leftPad" so a
      //    skin that didn't author a bartext rect still gets a readable title.
      const songListTextRect = this.songList?.text[0]?.rect;
      const labelTextOffsetX =
        songListTextRect !== undefined
          ? rect.x + songListTextRect.x
          : subRectRightEdge > 0
            ? rect.x + subRectRightEdge + leftPad
            : rect.x + leftPad;
      // Y: skin-authored relative-y is in libGDX Y-UP (origin at bar's bottom-left). Convert
      // to Pixi Y-DOWN (origin at bar's top-left) so the title's y-anchor (`0.5` baseline)
      // lands where the author intended. For default skin's bartext at `{y:6, h:24}` inside
      // a 36-tall bar, this puts the baseline at `36 - 6 - 24/2 = 18` from the top — exactly
      // the bar's vertical centre, matching beatoraja's reference layout.
      const labelTextOffsetY =
        songListTextRect !== undefined
          ? rect.y + (rect.h - songListTextRect.y - songListTextRect.h / 2) + fractionalNudge
          : rowCentreY;
      label.x = labelTextOffsetX;
      label.y = labelTextOffsetY;
      // Only paint the warm-yellow cursor tint when the skin doesn't already cue the
      // focused row via a per-row bar-image swap (e.g. `list_on` vs `list`). Doubling up
      // would over-paint the skin-authored highlight; leaving white-on-white otherwise
      // keeps the title legible.
      label.tint = isSelected && !this.hasFocusedBarVariant ? 0xffe066 : 0xffffff;

      // Per-row level overlay — only when the songlist authored a `level` sub-rect AND we
      // pre-allocated either a digit-sprite stack or a Text fallback for this row.
      // Sub-rect is RELATIVE to the bar rect; we place each renderer at the corresponding
      // position inside the level's dst region.
      const levelLabel = this.rowLevelLabels[i];
      const levelDigits = this.rowLevelDigitSprites[i];
      const levelRect = this.songList?.level;
      if (levelRect !== undefined) {
        // Beatoraja authors `level.dst` rects in skin Y-UP coords (origin at bar's
        // bottom-left). Our `rect` is already Pixi Y-DOWN with `rect.y` at the row's
        // top. Skin Y-UP offset within the bar maps to Pixi:
        //   pixiY = rect.y + (rect.h - level.y - level.h)
        const subPixiY = rect.y + (rect.h - levelRect.y - levelRect.h) + fractionalNudge;
        if (levelDigits !== undefined && this.levelValueElement !== undefined) {
          // Digit sprites: per beatoraja's `value[]` convention, `dst.w` is the PER-DIGIT
          // slot width (NOT the total strip width). The digit row extends rightward from
          // `dst.x` for `slotWidth × digit` pixels (plus `space` gaps). Dividing
          // `levelRect.w` by `digit count` would halve each slot — that's the squashed-
          // text bug the standard skin-view value renderer documents at line 1922.
          //
          // `align` shifts the row left for `align=1` (left) / `align=2` (centre); align=0
          // (right) leaves the row anchored at `dst.x`.
          const valueElement = this.levelValueElement;
          const slotWidth = levelRect.w;
          const space = Number.isFinite(valueElement.space) ? valueElement.space : 0;
          const slotStep = slotWidth + space;
          // The row's width depends on the rendered value, so we look up the chart's
          // playLevel here too and pass it to the shift composer. Folder rows skip this
          // (no song.playLevel) — the shift collapses to 0 when value is 0 anyway.
          const songForRow = entry?.kind === 'chart' ? entry.chart : undefined;
          const lvlForShift = songForRow !== undefined ? (resolvePlayLevel(songForRow.playLevel) ?? 0) : 0;
          const alignShift = composeBeatorajaValueShift(valueElement, lvlForShift, slotWidth);
          for (let d = 0; d < levelDigits.length; d += 1) {
            const sprite = levelDigits[d]!;
            sprite.anchor.set(0, 0);
            sprite.x = rect.x + levelRect.x + d * slotStep - alignShift;
            sprite.y = subPixiY;
            sprite.width = slotWidth;
            sprite.height = levelRect.h;
            sprite.alpha = isSelected ? 1 : 0.85;
          }
        } else if (levelLabel !== undefined) {
          levelLabel.x = rect.x + levelRect.x + levelRect.w / 2;
          levelLabel.y = subPixiY + levelRect.h / 2;
          levelLabel.alpha = isSelected ? 1 : 0.85;
        }
      }

      // Per-row feature label sprites — show / hide / position based on the focused
      // entry's chart features. Each label's visibility predicate is gated on the chart
      // feature its image-id implies (LN / random sequence / landmine).
      const featureSprites = this.rowFeatureLabels[i] ?? [];
      const labelEntries = this.songList?.labels ?? [];
      for (let labelIdx = 0; labelIdx < featureSprites.length; labelIdx += 1) {
        const sprite = featureSprites[labelIdx]!;
        const labelEntry = labelEntries[labelIdx];
        if (labelEntry === undefined) {
          sprite.visible = false;
          continue;
        }
        const visible = entry !== undefined && this.chartHasLabelFeature(entry, labelEntry.id);
        sprite.visible = visible;
        if (!visible) continue;
        const labelRect = labelEntry.rect;
        const subPixiY = rect.y + (rect.h - labelRect.y - labelRect.h) + fractionalNudge;
        sprite.x = rect.x + labelRect.x;
        sprite.y = subPixiY;
        sprite.width = labelRect.w;
        sprite.height = labelRect.h;
        sprite.alpha = isSelected ? 1 : 0.85;
      }
    }
  }

  /**
   * Predicate map for `songlist.label[]` entries. Each known label id corresponds to a
   * chart feature; the sprite is shown when the focused entry's chart has that feature.
   * Unknown ids return false (= hidden) so a skin authoring a custom label that we don't
   * recognise stays out of view rather than showing on every row indiscriminately.
   *
   * Folder rows return false uniformly — the labels are per-chart, not per-folder.
   */
  private chartHasLabelFeature(entry: LibraryEntry, labelId: string | number): boolean {
    if (entry.kind !== 'chart') return false;
    const features = resolveLR2ChartFeatures(entry.chart.chart);
    const id = String(labelId).toLowerCase();
    if (id.includes('ln')) return features.longNote;
    if (id.includes('random')) return features.random;
    // `mine` / `landmine` covered by direct event-channel scan since `resolveLR2ChartFeatures`
    // doesn't expose it (it's not in the LR2 dst_option op gate set the LR2 helper was
    // built against). BMS landmine channels are `D1..D9` (1P) and `E1..E9` (2P).
    if (id.includes('mine') || id.includes('landmine')) {
      return entry.chart.chart.events.some((event) => /^[de][1-9a-z]$/iu.test(event.channel));
    }
    return false;
  }
}

/**
 * `LibraryChart.playLevel` arrives as either a number (BMS `#PLAYLEVEL 12`) or a string
 * (some bmson files / BMS variants store it as text). The skin's `value[]` resolver expects
 * a number, so we coerce — strings parse via `parseInt`; non-finite results return
 * `undefined` so the digit panel shows blanks rather than NaN garbage.
 */
function resolvePlayLevel(level: number | string | undefined): number | undefined {
  if (typeof level === 'number') return Number.isFinite(level) ? level : undefined;
  if (typeof level === 'string' && level.length > 0) {
    const parsed = Number.parseInt(level, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Map a chart's `#PLAYLEVEL` to a tint colour band — beatoraja's reference theme uses
 * different per-difficulty colours on the songlist's level slot (white for beginner, blue
 * for normal, yellow for hyper, orange for another, red for insane). Without authored
 * sprites we approximate via tint on a single neutral text node. Boundaries chosen to
 * match the conventional BMS difficulty bands:
 *   1-4  white      — beginner
 *   5-8  cyan       — normal
 *   9-10 yellow     — hyper
 *   11   orange     — another
 *   12+  red        — insane
 */
function levelTintForDifficulty(level: number): number {
  if (level <= 4) return 0xffffff;
  if (level <= 8) return 0x66ddff;
  if (level <= 10) return 0xffe066;
  if (level <= 11) return 0xffaa44;
  return 0xff5555;
}

/**
 * Parse a `songlist.level[].id` string (e.g. `"level-beginner"`) into the matching
 * difficulty index used by `chart.metadata.difficulty`. Returns `undefined` when the id
 * doesn't match the upstream `level-*` convention so the caller can skip it.
 *
 * Mapping mirrors upstream `JSONSelectSkinObjectLoader.java`'s level loop where each
 * `level[i]` corresponds to one of the difficulty rows in beatoraja's level sprite strip:
 *
 *   level-unknown  → 0 (= no `#DIFFICULTY` authored)
 *   level-beginner → 1
 *   level-normal   → 2
 *   level-hyper    → 3
 *   level-another  → 4
 *   level-insane   → 5
 *
 * Numeric ids (rare, default theme) fall through unmatched — the renderer keeps the
 * legacy "first entry wins" fallback in that case.
 */
function parseLevelDifficultyIndex(id: string | number): number | undefined {
  if (typeof id !== 'string') return undefined;
  switch (id) {
    case 'level-unknown':
      return 0;
    case 'level-beginner':
      return 1;
    case 'level-normal':
      return 2;
    case 'level-hyper':
      return 3;
    case 'level-another':
      return 4;
    case 'level-insane':
      return 5;
    default:
      return undefined;
  }
}
