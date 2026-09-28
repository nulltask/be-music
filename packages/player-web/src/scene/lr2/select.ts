import { Color, Container, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import type {
  Lr2BarBodyKind,
  Lr2BarBodySource,
  Lr2BarBodySlot,
  Lr2BarFlashElement,
  Lr2BarLevelKind,
  Lr2BarLevelSource,
  Lr2BarTitleElement,
  Lr2ButtonElement,
  Lr2DestinationRect,
  Lr2ImageElement,
  Lr2ImageRect,
  Lr2MouseCursorElement,
  Lr2NumberElement,
  Lr2OnMouseElement,
  Lr2Skin,
  Lr2SliderElement,
  Lr2SpecialGraphic,
  Lr2TextElement,
} from '@be-music/lr2-skin';
import {
  applyDestinationToSprite,
  containerSpriteSink,
  createCroppedTexture,
  evaluateElementDestination,
  evaluateKeyframes,
  makeLr2SliderSprite,
  makeLr2StaticImageSprite,
  normalizeRect,
  pickAnimatedCell,
  renderNumberElement,
} from '../../skin/lr2/render.ts';
import { computeSelectOps, resolveKeyModeOp } from '../select-ops.ts';
import {
  Lr2ChartGraphicTextureStore,
  Lr2SkinTextureStore,
  collectSelectSkinTexturePaths,
  resolveSolidSpecialGraphicTexture,
} from '../../skin/lr2/scene-textures.ts';
import { clampFontSize, isDestinationVisible, makeLr2TextSprite } from '../../skin/lr2/scene-render.ts';
import { loadSkinBitmapFonts } from '../../skin/lr2/font-loader.ts';
import type { Lr2LoadedFont } from '../../skin/lr2/bitmap-text.ts';
import type { BrowserBrowseEntry, BrowserSongEntry } from '../../collection/types.ts';
import { LR2_TEXT_FALLBACK_FONT } from './fonts.ts';
import {
  BGA_CYCLE,
  BGA_SIZE_CYCLE,
  BOOLEAN_CYCLE,
  CoreSongSelectView,
  DEFAULT_PLAY_OPTIONS,
  DIFFICULTY_FILTER_BY_DIRECT_BUTTON,
  DIFFICULTY_FILTER_CYCLE,
  GAUGE_CYCLE,
  HIDDEN_SUDDEN_CYCLE,
  HISPEED_MAX,
  HISPEED_MIN,
  HS_FIX_CYCLE,
  KEYS_FILTER_CYCLE,
  RANDOM_CYCLE,
  SORT_CYCLE,
  type CoreSongSelectViewOptions,
  type PixiPlayOptions,
  type SelectDesignSize,
} from '../core/select.ts';

// The family-neutral half of the select scene (navigation, input, audio, play options, be-music fallback) lives in
// `scene/core/select.ts`; re-export its public surface so existing `scene/lr2/select` importers keep working.
export {
  DEFAULT_PLAY_OPTIONS,
  matchesSearchQuery,
  wrappedCursorDelta,
  type PixiBgaMode,
  type PixiBgaSize,
  type PixiDifficultyFilter,
  type PixiGaugeType,
  type PixiHiddenSudden,
  type PixiHsFix,
  type PixiKeysFilter,
  type PixiPlayOptions,
  type PixiRandomMode,
  type PixiSelectSort,
  type PixiSongSelectNavigation,
  type PixiSongSelectSystemSounds,
} from '../core/select.ts';

const TEXT = new Color('#f6f2e8');

/** Constructor options for {@link PixiSongSelectView}: the shared select options plus the LR2 skin. */
export interface PixiSongSelectViewOptions extends CoreSongSelectViewOptions {
  /**
   * LR2 skin to render the select screen with. When provided, static `#IMAGE` elements decorate the frame and
   * `#SRC_BAR_BODY` / `#DST_BAR_BODY_OFF` / `_ON` slots host the song list. Without a skin the view falls back to a
   * built-in pixel-art-style layout.
   */
  skin?: Lr2Skin;
}

/**
 * One entry in the precomputed {@link PixiSongSelectView.sortedChromeEntries} array. Tagged union over the six
 * chrome-element kinds the LR2 select view paints (`#SRC_IMAGE`, `#SRC_NUMBER`, `#SRC_TEXT`, `#SRC_BUTTON`,
 * `#SRC_ONMOUSE`, `#SRC_SLIDER`). The `order` field is the CSV-declaration order used as the inter-kind sort key —
 * matching LR2's "later declaration paints on top" rule. `layerIsForeground` caches the result of `pickChromeLayer` so
 * the per-frame switch can resolve the destination container without re-reading the skin's bar layout each time.
 */
type SortedSelectChromeEntry =
  | { kind: 'image'; order: number; layerIsForeground: boolean; element: Lr2ImageElement }
  | { kind: 'number'; order: number; layerIsForeground: boolean; element: Lr2NumberElement }
  | { kind: 'text'; order: number; layerIsForeground: boolean; element: Lr2TextElement }
  | { kind: 'button'; order: number; layerIsForeground: boolean; element: Lr2ButtonElement }
  | { kind: 'onMouse'; order: number; layerIsForeground: boolean; element: Lr2OnMouseElement }
  | { kind: 'slider'; order: number; layerIsForeground: boolean; element: Lr2SliderElement };

/**
 * LR2-skinned song-select scene. Extends {@link CoreSongSelectView} with the `#SRC_*` / `#DST_*` frame, the bar list,
 * the skin's buttons / panels / sliders / mouse cursor, and the `#STARTINPUT`-driven timers. Without a select-capable
 * skin (no `#SRC_BAR_BODY` slots) every theme hook falls through and the core's be-music fallback renders instead.
 */
export class PixiSongSelectView extends CoreSongSelectView<PixiSongSelectViewOptions> {
  /**
   * Precomputed, declaration-order-sorted union of every chrome-element kind the LR2 skin defines for the select view.
   * Rebuilt only when the bound skin reference changes — the underlying skin structure (declaration order, layer
   * routing, panel masks) is static for a given skin, so building this list per render frame was pure waste in the
   * previous `work[]` + `.sort()` implementation. Per-frame visibility (ops gating, panel-open gating, DST keyframe
   * eval, pointer hit-test) still happens during the per-entry switch dispatch; only the merge/sort step is hoisted
   * out.
   */
  private sortedChromeEntries: SortedSelectChromeEntry[] = [];
  /**
   * Skin reference used to build {@link sortedChromeEntries}. Comparing identity is enough — the LR2 skin objects are
   * frozen after parse, so a structural change requires {@link setSkin} to swap in a fresh reference.
   */
  private sortedChromeSkinRef: Lr2Skin | undefined;
  /**
   * Skin asset path → decoded texture cache. Populated by `prepareSkinTextures()` after the view is mounted; rendering
   * reads straight from this map and silently skips bars whose texture is still loading (next render tick will fill
   * them in).
   */
  private readonly skinTextures = new Lr2SkinTextureStore();
  /**
   * Loaded LR2 bitmap-font payloads keyed by `#LR2FONT` declaration index. Populated asynchronously by
   * `prepareBitmapFonts`; until that finishes the renderer falls back to the system-font path inside
   * `makeLr2TextSprite`.
   */
  private bitmapFonts: Map<number, Lr2LoadedFont> = new Map();
  /**
   * Per-song chart-asset texture cache for LR2 runtime-bound graphics (`#SRC_IMAGE,gr=100/101/102` → STAGEFILE /
   * BACKBMP / BANNER). Keyed by `${song.id}:${kind}` so navigating between songs reuses already-decoded banners. Loaded
   * lazily on first reference.
   */
  private readonly chartGraphicTextures = new Lr2ChartGraphicTextureStore();

  public constructor(options: PixiSongSelectViewOptions = {}) {
    super(options);
  }

  /**
   * The LR2 skin's frame + bars are only used when the skin actually carries select-screen definitions
   * (`#SRC_BAR_BODY` / `#DST_BAR_BODY_*`). A play-only skin like `play_7.lr2skin` would otherwise paint its STAGE
   * FAILED / gauge / etc. graphics here because they're stored in the same `images` array — drop back to the built-in
   * list when that's the case.
   */
  protected override get themeDesignSize(): SelectDesignSize | undefined {
    const skin = this.options.skin;
    if (skin === undefined || skin.barLayout.slots.length === 0) return undefined;
    return { width: skin.width, height: skin.height };
  }

  protected override prepareTheme(): void {
    // Only preload skin assets if the skin has select-screen definitions — a play-only skin would otherwise pull in the
    // STAGE FAILED graphic, gauge frame, etc. that don't belong on the select view.
    if (this.options.skin && this.options.skin.barLayout.slots.length > 0) {
      void this.prepareSkinTextures(this.options.skin);
      void this.prepareBitmapFonts(this.options.skin);
    }
  }

  protected override themeListSlotHeight(): number {
    return this.estimateSlotHeight();
  }

  protected override renderTheme(designWidth: number, designHeight: number): void {
    const skin = this.options.skin;
    if (!skin) return;
    // Compute the dynamic op set ONCE per render and thread it into both renderers. Putting this here (rather than
    // inside each `isDestinationVisible` call) lets us: 1. Reflect the focused song's chart features (LN, BPM change,
    // BACKBMP presence, …) onto static frame elements that LR2 skins gate with op 70..195. 2. Avoid recomputing the
    // same `Set` per element.
    const ops = this.perf.time('computeOps', () =>
      computeSelectOps(this.focusedSong(), this.panelStates, this.playOptions, skin.customOptions, this.collection),
    );
    this.perf.time('renderSkinFrame', () => this.renderSkinFrame(skin, ops));
    this.perf.time('renderSkinBars', () => this.renderSkinBars(skin, ops));
    // Empty-state hint — shown over the skin when nothing was loaded, so the user understands they need to drop
    // content.
    if (this.collection.songs.length === 0) {
      this.renderEmptyStateHint(designWidth, designHeight);
    }
  }

  protected override handleThemePointerDown(virtualX: number, virtualY: number): void {
    const skin = this.options.skin;
    if (!skin) return;
    // Hit-test interactive skin elements first — buttons, search input — before bars, since they often overlap the
    // bar-list area on the LR2 default skin (e.g. AUTOPLAY at y=319 sits adjacent to the song-info column).
    if (this.handleSkinHitTest(skin, virtualX, virtualY)) {
      return;
    }
    // Skin layout: hit-test each available slot's BAR_BODY rect and jump the selection so the clicked slot becomes
    // the center. Any slot click both moves the cursor (if needed) AND triggers the selection action — earlier the
    // click on a non-center slot only moved the cursor and required a second click on the center slot to actually
    // pick the song. The 1-click flow is what mouse users expect; keyboard navigation still uses the 2-step "land on
    // cursor → press Enter" model.
    const center = clampSlot(skin.barLayout.center, skin.barLayout.slots.length);
    const available = skin.barLayout.available > 0 ? skin.barLayout.available : skin.barLayout.slots.length;
    const slots = skin.barLayout.slots.slice(0, available);
    const entries = this.currentEntries();
    for (const slot of slots) {
      const dst = slot.off ?? slot.on;
      if (!dst) continue;
      if (containsPoint(dst, virtualX, virtualY)) {
        const offset = slot.index - center;
        const target = wrapIndex(this.selectedIndex + offset, entries.length);
        if (target === undefined) {
          return;
        }
        if (target !== this.selectedIndex) {
          this.noteCursorChange(offset);
          this.selectedIndex = target;
          this.render();
        }
        const entry = entries[target];
        if (!entry) return;
        if (entry.kind === 'folder') {
          this.enterFolder(entry.folder);
        } else {
          this.options.onSongSelected?.(entry.song);
        }
        return;
      }
    }
  }

  protected override disposeTheme(): void {
    this.skinTextures.dispose();
    this.chartGraphicTextures.dispose();
  }

  /**
   * Swap the active LR2 skin without disposing the underlying `Application`. Re-runs the asset preload for the new skin
   * and re-renders. Pass `undefined` to fall back to the built-in UI.
   *
   * Hosts use this instead of disposing+re-creating the view, which historically tripped the PixiJS Devtools extension
   * on the second `Application.init` (`Cannot read properties of null (reading 'batch')`).
   */
  public setSkin(skin: Lr2Skin | undefined): void {
    this.options = { ...this.options, skin };
    // Drop the previous skin's textures — `prepareSkinTextures` will populate fresh ones for the new skin, and the
    // chart-graphic (BACKBMP / BANNER / STAGEFILE) cache stays valid since it's keyed by song id, not by skin.
    this.skinTextures.clear();
    this.bitmapFonts = new Map();
    // Invalidate the precomputed sorted chrome entry list — `ensureSortedChromeEntries` keys on reference identity, so
    // dropping the cached ref forces a rebuild against the new skin on the next render.
    this.sortedChromeSkinRef = undefined;
    this.sortedChromeEntries = [];
    if (skin && skin.barLayout.slots.length > 0) {
      void this.prepareSkinTextures(skin);
      void this.prepareBitmapFonts(skin);
    }
    this.render();
  }

  /**
   * Estimates the vertical pitch between adjacent bar slots — used to scale `listScrollOffset` so a 1-step cursor move
   * produces a 1-slot worth of visual slide. Picks the most-occupied y-delta between adjacent off-slot rectangles since
   * LR2 default skins tend to have one "center" slot at a different y than the uniformly-spaced off-center slots; the
   * median of pairwise deltas excludes that outlier.
   */
  private estimateSlotHeight(): number {
    const slots = this.options.skin?.barLayout.slots ?? [];
    const ys: number[] = [];
    for (const slot of slots) {
      const dst = slot.off ?? slot.on;
      if (dst) ys.push(dst.y);
    }
    ys.sort((left, right) => left - right);
    if (ys.length < 2) return 30;
    const deltas: number[] = [];
    for (let index = 1; index < ys.length; index += 1) {
      const dy = Math.abs(ys[index]! - ys[index - 1]!);
      if (dy > 0) deltas.push(dy);
    }
    if (deltas.length === 0) return 30;
    deltas.sort((left, right) => left - right);
    return deltas[Math.floor(deltas.length / 2)]!;
  }

  /**
   * Pre-loads every image referenced by the skin's `#IMAGE` table and its `#SRC_BAR_BODY` definitions. Loads happen in
   * parallel; the render pass is non-blocking and just skips bars whose texture isn't ready yet (we re-render after
   * each load resolves).
   */
  private async prepareSkinTextures(skin: Lr2Skin): Promise<void> {
    const loaded = await this.skinTextures.preload(
      skin,
      collectSelectSkinTexturePaths(skin),
      () => !this.disposed && this.options.skin === skin,
    );
    if (loaded) {
      this.render();
    }
  }

  /**
   * Loads `#LR2FONT` payloads for the supplied skin in parallel with `prepareSkinTextures`. Bails out cleanly if the
   * skin declares no fonts or if the user navigates away mid-load (`this.options.skin !== skin`). Fonts that fail to
   * decode (encrypted DXA, missing image, etc.) are simply skipped — the system-font fallback renders for those
   * indices.
   */
  private async prepareBitmapFonts(skin: Lr2Skin): Promise<void> {
    if (skin.lr2FontPaths.length === 0) return;
    const loaded = await loadSkinBitmapFonts(skin.lr2FontPaths, skin.files);
    if (this.disposed || this.options.skin !== skin) return;
    this.bitmapFonts = loaded;
    this.render();
  }

  /**
   * Hit-tests interactive skin elements at the click point and dispatches per-element actions. Returns `true` when a
   * hit was consumed so the bar-list pointerdown branch doesn't also fire.
   *
   * Currently handles:
   *
   * - `#SRC_BUTTON` (`click = 1`) — AUTOPLAY (`type = 16`) is wired to `onSongAutoPlay` for the focused song. Other
   *   button types are recognized but currently no-op (panel / filter / sort buttons land here for future wiring).
   * - `#SRC_TEXT` (`edit = 1`, `st = 30`) — fires `onSearchActivate` so the host can focus a DOM `<input>` overlay.
   *
   * Buttons / texts are only considered when their DST passes the standard visibility / panel gate; we re-use
   * `evaluateElementDst` to honor keyframe interpolation (so a click during a slide-in animation hits the rectangle
   * the user actually sees, not a static endpoint).
   */
  private handleSkinHitTest(skin: Lr2Skin, virtualX: number, virtualY: number): boolean {
    const ops = computeSelectOps(
      this.focusedSong(),
      this.panelStates,
      this.playOptions,
      skin.customOptions,
      this.collection,
    );
    for (const button of skin.buttons) {
      if (button.click !== 1) continue;
      if (!this.isPanelOpen(button.panel)) continue;
      const dst = this.evaluateElementDst(button);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      if (!containsPoint(dst, virtualX, virtualY)) continue;
      this.dispatchButtonClick(button);
      return true;
    }
    for (const text of skin.texts) {
      if (text.st !== 30) continue; // 30 = search word
      // We deliberately DON'T require `text.edit === 1` here. The LR2 default theme paints the search box with a
      // `#SRC_TEXT st=30` chrome but routes the actual edit affordance through the skin's surrounding background sprite
      // (no `edit` flag on the text itself), so the strict `edit === 1` filter previously made the search- word area
      // look interactive without actually firing `onSearchActivate`. Loosening to "any st=30 text" catches the LR2
      // default plus every theme that authors a search box more conventionally; the host's `onSearchActivate` is
      // idempotent (it just focuses the overlay input), so a stray click on a non-editable search readout is harmless.
      if (!this.isPanelOpen(text.panel)) continue;
      const dst = this.evaluateElementDst(text);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      if (!containsPoint(dst, virtualX, virtualY)) continue;
      this.options.onSearchActivate?.();
      return true;
    }
    if (
      isInsideLr2DefaultSearchBox({
        width: skin.width,
        height: skin.height,
        x: virtualX,
        y: virtualY,
      })
    ) {
      this.options.onSearchActivate?.();
      return true;
    }
    return false;
  }

  /**
   * Routes a clicked `#SRC_BUTTON` to the matching action. The button-type table comes from `docs/LR2SkinHelp.md` lines
   * 5901+; we currently honor:
   *
   * - **15** — start play (treat as Enter on the focused song)
   * - **16** — start autoplay (`onSongAutoPlay`)
   * - **17** — readtext (no host hook yet; fall through to play)
   * - **19** — replay (no replay system yet; no-op)
   *
   * Other types are no-ops for now. Filter / sort / panel buttons (types 1..12) land here too once their state machines
   * exist.
   */
  private dispatchButtonClick(button: Lr2ButtonElement): void {
    const type = button.type;
    // Panel-toggle buttons (LR2 button_type 1..9). Don't require a focused song — the LR2 default skin's "OPTION"
    // launcher is always clickable, even before any chart is selected.
    if (type >= 1 && type <= 9) {
      this.togglePanel(type);
      return;
    }
    // HS-1P / HS-2P (button_type 57 / 58). Spec: "numeric-change function only". The `plusOnly` field tells us the click direction: - `1` →
    // this button raises HS by one step - `-1` → this button lowers HS by one step - `0` → ambiguous; treat left-click
    // as +step (right-click could be wired to -step in a future pass, but we don't track button affinities yet)
    if (type === 57 || type === 58) {
      const direction = button.plusOnly === -1 ? -1 : 1;
      this.adjustHiSpeed(direction);
      return;
    }
    // BGA on/off/autoplay-only (button_type 72). Cycles through {@link BGA_CYCLE} on each click.
    if (type === 72) {
      this.cyclePlayOption('bga', BGA_CYCLE);
      return;
    }
    // BGA size NORMAL/EXTEND (button_type 73).
    if (type === 73) {
      this.cyclePlayOption('bgaSize', BGA_SIZE_CYCLE);
      return;
    }
    // SCOREGRAPH on/off (button_type 70).
    if (type === 70) {
      this.cyclePlayOption('scoreGraph', BOOLEAN_CYCLE);
      return;
    }
    // Difficulty filter cycle (button_type 10).
    if (type === 10) {
      this.cyclePlayOption('difficultyFilter', DIFFICULTY_FILTER_CYCLE);
      this.snapCursorAfterFilterChange();
      return;
    }
    // Difficulty filter direct-set (button_type 91..96).
    const directDifficulty = DIFFICULTY_FILTER_BY_DIRECT_BUTTON[type];
    if (directDifficulty !== undefined) {
      this.setPlayOption('difficultyFilter', directDifficulty);
      this.snapCursorAfterFilterChange();
      return;
    }
    // Keymode filter cycle (button_type 11). Cycling re-filters the bar list; snap the cursor to the top so the user
    // lands on a visible entry immediately.
    if (type === 11) {
      this.cyclePlayOption('keysFilter', KEYS_FILTER_CYCLE);
      this.snapCursorAfterFilterChange();
      return;
    }
    // Sort cycle (button_type 12). Reorders the bar list; snap to the top so the cursor doesn't end up pointing at an
    // entry that just slid past on the rail.
    if (type === 12) {
      this.cyclePlayOption('sort', SORT_CYCLE);
      this.snapCursorAfterFilterChange();
      return;
    }
    // HS-FIX cycle (button_type 55). Pure play-option setting — the value is applied at gameplay-mount time so the
    // running select view doesn't need to react beyond updating the panel button cell.
    if (type === 55) {
      this.cyclePlayOption('hsFix', HS_FIX_CYCLE);
      return;
    }
    // HIDDEN/SUDDEN effect cycle — split per side (button_type 50 = 1P, 51 = 2P). Each side cycles independently so a
    // player can run e.g. HIDDEN on 1P + OFF on 2P, matching the LR2 panel UI which exposes a separate cell for each
    // side.
    if (type === 50) {
      this.cyclePlayOption('hiddenSudden1P', HIDDEN_SUDDEN_CYCLE);
      return;
    }
    if (type === 51) {
      this.cyclePlayOption('hiddenSudden2P', HIDDEN_SUDDEN_CYCLE);
      return;
    }
    // LANE COVER (shutter) ON / OFF toggle (button_type 46). Per LR2's `button.txt`: type 46 is "shutter" with no declared
    // cycle values — it's a binary toggle. The height (slider type 4 / 5) is preserved across toggles via
    // `playOptions.shutter`.
    if (type === 46) {
      this.cyclePlayOption('laneCover', BOOLEAN_CYCLE);
      return;
    }
    // Autoscratch 1P / 2P toggle (button_type 44 / 45). Each side stays independent — DP charts can have one side
    // auto-scratching while the other is fully manual.
    if (type === 44) {
      this.cyclePlayOption('autoScratch1P', BOOLEAN_CYCLE);
      return;
    }
    if (type === 45) {
      this.cyclePlayOption('autoScratch2P', BOOLEAN_CYCLE);
      return;
    }
    // DP FLIP toggle (button_type 54). Pure gameplay setting — the select view just tracks the value for the gameplay
    // launch hand-off.
    if (type === 54) {
      this.cyclePlayOption('dpFlip', BOOLEAN_CYCLE);
      return;
    }
    // Note arrangement RANDOM cycle (button_type 42 = 1P, 43 = 2P).
    if (type === 42) {
      this.cyclePlayOption('random1P', RANDOM_CYCLE);
      return;
    }
    if (type === 43) {
      this.cyclePlayOption('random2P', RANDOM_CYCLE);
      return;
    }
    // Gauge type cycle (button_type 40 = 1P, 41 = 2P).
    if (type === 40) {
      this.cyclePlayOption('gauge1P', GAUGE_CYCLE);
      return;
    }
    if (type === 41) {
      this.cyclePlayOption('gauge2P', GAUGE_CYCLE);
      return;
    }
    const focused = this.focusedSong();
    if (!focused) return;
    if (type === 15) {
      this.options.onSongSelected?.(focused);
    } else if (type === 17) {
      this.toggleReadText(focused);
    } else if (type === 16) {
      // AUTOPLAY: prefer the dedicated callback when supplied, otherwise fall through to the regular start path so the
      // button isn't a dead end on hosts that haven't wired it.
      if (this.options.onSongAutoPlay) {
        this.options.onSongAutoPlay(focused);
      } else {
        this.options.onSongSelected?.(focused);
      }
    }
    // Types 17 / 19 / 13 / 14 / etc. — readtext / replay / config / skin-select. Not yet implemented; intentionally
    // silent so a click doesn't trigger the wrong action.
  }

  /**
   * Returns the per-frame interpolated DST for an element with a keyframe sequence. For static elements (single
   * keyframe or none) this is a no-op that returns `element.destination`.
   *
   * Only timer 0 (scene main) is currently driven — other timers resolve to elapsed=0, which yields the first keyframe.
   * As we drive more timers (timer 11 = song change for focus-bar pulse, etc.), this is the single integration point.
   */
  private evaluateElementDst(element: {
    destination: Lr2DestinationRect;
    keyframes: Lr2DestinationRect[];
  }): Lr2DestinationRect {
    return evaluateElementDestination(element, (timer) => this.elapsedSinceTimer(timer));
  }

  /**
   * Returns the elapsed milliseconds since `timer` started, or 0 when the timer isn't currently driven. Reads
   * `timerStartedAt` for any timer the host has fired (0 / 11 at mount; 10 / 11 / 12 / 13 on cursor moves). Timer 1 is
   * computed from `#STARTINPUT` lazily so we don't need a setTimeout.
   */
  private elapsedSinceTimer(timer: number): number {
    if (timer === 1) {
      const startInput = this.options.skin?.timing.startInput ?? 0;
      const fireAt = this.sceneStartedAt + startInput;
      return Math.max(0, performance.now() - fireAt);
    }
    const startedAt = this.timerStartedAt.get(timer);
    if (startedAt === undefined) {
      return 0;
    }
    return Math.max(0, performance.now() - startedAt);
  }

  /**
   * Returns whether `timer` is currently active (i.e. has fired and is producing meaningful elapsed-time output). Used
   * by `isDestinationVisible` so DST elements anchored to a not-yet-fired timer (e.g. an idle panel-open animation)
   * stay hidden.
   *
   * Defined as an arrow-property so callers can pass it through to the free `isDestinationVisible` helper without
   * losing `this`.
   */
  private readonly timerActive = (timer: number): boolean => {
    if (timer === 0) return true;
    if (timer === 1) {
      const startInput = this.options.skin?.timing.startInput ?? 0;
      return performance.now() - this.sceneStartedAt >= startInput;
    }
    // Song-list timers 10..13 — active once we've recorded a start (i.e. the cursor moved at least once or scene-mount
    // seeded timer 11). The keyframe interpolator clamps past the final frame, so leaving them "active" forever is
    // fine.
    if (timer >= 10 && timer <= 13) {
      return this.timerStartedAt.has(timer);
    }
    // Panel-open timers 21..29 — active iff that panel is currently open. LR2 spec: the timer is OFF once the panel closes, so the timer
    // implicitly stops when `togglePanel` clears the state, even if the seed timestamp is left in `timerStartedAt`.
    if (timer >= 21 && timer <= 29) {
      const which = timer - 20;
      return this.panelStates.has(which);
    }
    // Panel-close timers 31..39 — active once seeded by `togglePanel`. The close-anim keyframes clamp at their final
    // frame, so leaving it "active" past the animation is harmless; reopening the same panel re-deletes this entry to
    // prevent a stale seed from triggering the close anim again.
    if (timer >= 31 && timer <= 39) {
      return this.timerStartedAt.has(timer);
    }
    // Play timers (40+) etc. stay inactive on the select scene.
    return false;
  };

  /**
   * Renders the skin's static `#IMAGE` decorations (background, frame panels, banner area, etc.) plus the song-info
   * NUMBER / TEXT panels that depend on the currently-selected song. Op-gated against `ops` (built by
   * `computeSelectOps` so per-song flags affect the frame).
   */
  /**
   * Picks the right scene-graph layer for a chrome element based on its CSV-stream declaration order vs the bar
   * layout's. The routing rule mirrors LR2's "later declarations paint on top": elements declared after `#SRC_BAR_BODY`
   * go to `skinForegroundLayer` (drawn on top of the song-list bars); everything else stays on `skinLayer` behind the
   * bars.
   *
   * Falls back to `skinLayer` for skins without a bar list (no `barLayout.declarationOrder`) — every chrome element is
   * effectively "before bars" because there are no bars.
   */
  private pickChromeLayer(declarationOrder: number): Container {
    const barOrder = this.options.skin?.barLayout.declarationOrder;
    if (barOrder !== undefined && declarationOrder > barOrder) {
      return this.skinForegroundLayer;
    }
    return this.skinLayer;
  }

  /**
   * Returns the cached, declaration-order-sorted entry list for `skin`. Rebuilds on the first call after a skin swap
   * (detected by reference identity against {@link sortedChromeSkinRef}) — the LR2 skin shape is immutable per
   * `setSkin`, so reference equality is a sufficient invalidation key.
   *
   * The build merges every chrome-element kind into one array, records each entry's pre-resolved layer choice via
   * {@link pickChromeLayer}, and stable-sorts by `declarationOrder` so the final paint order on each Pixi container
   * matches the CSV's left-to-right declaration sequence.
   */
  private ensureSortedChromeEntries(skin: Lr2Skin): readonly SortedSelectChromeEntry[] {
    if (this.sortedChromeSkinRef === skin) {
      return this.sortedChromeEntries;
    }
    const barOrder = skin.barLayout.declarationOrder;
    const isForeground = (declarationOrder: number): boolean => barOrder !== undefined && declarationOrder > barOrder;
    const entries: SortedSelectChromeEntry[] = [];
    for (const element of skin.images) {
      entries.push({
        kind: 'image',
        order: element.declarationOrder,
        layerIsForeground: isForeground(element.declarationOrder),
        element,
      });
    }
    for (const element of skin.numbers) {
      entries.push({
        kind: 'number',
        order: element.declarationOrder,
        layerIsForeground: isForeground(element.declarationOrder),
        element,
      });
    }
    for (const element of skin.texts) {
      entries.push({
        kind: 'text',
        order: element.declarationOrder,
        layerIsForeground: isForeground(element.declarationOrder),
        element,
      });
    }
    for (const element of skin.buttons) {
      entries.push({
        kind: 'button',
        order: element.declarationOrder,
        layerIsForeground: isForeground(element.declarationOrder),
        element,
      });
    }
    for (const element of skin.onMouseElements) {
      entries.push({
        kind: 'onMouse',
        order: element.declarationOrder,
        layerIsForeground: isForeground(element.declarationOrder),
        element,
      });
    }
    for (const element of skin.sliders) {
      entries.push({
        kind: 'slider',
        order: element.declarationOrder,
        layerIsForeground: isForeground(element.declarationOrder),
        element,
      });
    }
    entries.sort((a, b) => a.order - b.order);
    this.sortedChromeEntries = entries;
    this.sortedChromeSkinRef = skin;
    return entries;
  }

  private renderSkinFrame(skin: Lr2Skin, ops: ReadonlySet<number>): void {
    // Resolve the song the cursor is sitting on by going through the browse stack — `selectedIndex` indexes
    // `currentEntries()`, which is per-folder (or the folder list at root). Indexing `collection.songs` (the flat
    // global list) directly would surface metadata from a totally different folder once the cursor moved inside any
    // folder past the first, because the cursor index there refers to a position WITHIN that folder, not a global
    // offset.
    const focusedSong = this.focusedSong();

    // Walk the pre-sorted chrome entry list and dispatch by kind. The order, layer choice, and the entry list itself
    // are all static for a given skin (skin shape doesn't change between frames), so we cache the merged sorted list in
    // `ensureSortedChromeEntries` and reuse it every render. The previous implementation built a fresh `work[]` of
    // `{order, layer, paint: () => …}` closures per element per frame and then `.sort()`d it — for the LR2 default skin
    // that's ~hundreds of allocations + sort comparator calls per `requestAnimationFrame` tick.
    const entries = this.ensureSortedChromeEntries(skin);
    const skinTextures = this.skinTextures.asReadonlyMap();
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!;
      const layer = entry.layerIsForeground ? this.skinForegroundLayer : this.skinLayer;
      switch (entry.kind) {
        case 'image': {
          // Visibility uses the interpolated DST so an alpha=0 keyframe still keeps the element technically visible —
          // only the per-DST op gating (and timer activity) controls hidden vs shown.
          if (!isDestinationVisible(this.evaluateElementDst(entry.element), ops, this.timerActive)) break;
          const sprite = this.makeStaticImageSprite(entry.element);
          if (sprite) layer.addChild(sprite);
          break;
        }
        case 'number': {
          // Song-info NUMBER panels: BPM, total notes, play level. We resolve a small whitelist of LR2 number ids
          // relevant to the select view — the gameplay-only ids (score, gauge, judges, …) leave their slots blank when
          // shown here, which matches LR2's behavior off-stage.
          const dst = this.evaluateElementDst(entry.element);
          if (!isDestinationVisible(dst, ops, this.timerActive)) break;
          const value = resolveSelectNumber(entry.element.source.num, focusedSong, this.playOptions);
          if (value === undefined) break;
          renderNumberElement(containerSpriteSink(layer), entry.element, value, skinTextures, dst);
          break;
        }
        case 'text': {
          // TEXT panels — title / artist / genre / level label / etc. The `panel` field hides labels scoped to closed
          // option panels.
          if (!this.isPanelOpen(entry.element.panel)) break;
          const dst = this.evaluateElementDst(entry.element);
          if (!isDestinationVisible(dst, ops, this.timerActive)) break;
          const value = resolveSelectText(entry.element.st, focusedSong, this.playOptions);
          if (value === undefined || value.length === 0) break;
          layer.addChild(
            makeLr2TextSprite(value, entry.element, dst, {
              bitmapFonts: this.bitmapFonts,
              systemFontSizes: skin.systemFontSizes,
            }),
          );
          break;
        }
        case 'button': {
          // BUTTON panels — sort / filter / panel-toggle / play / replay / option buttons etc. We render the cell that
          // matches the button's current state; click handling lands separately.
          if (!this.isPanelOpen(entry.element.panel)) break;
          if (!isDestinationVisible(this.evaluateElementDst(entry.element), ops, this.timerActive)) break;
          this.renderButtonElement(entry.element, layer);
          break;
        }
        case 'onMouse': {
          // ONMOUSE — hover overlays. Drawn on top of buttons / images when the pointer is inside the SRC's hit-test
          // rect (relative to the DST top-left).
          if (!this.isPanelOpen(entry.element.panel)) break;
          const dst = this.evaluateElementDst(entry.element);
          if (!isDestinationVisible(dst, ops, this.timerActive)) break;
          if (!this.isPointerInHitRect(dst, entry.element)) break;
          const sprite = this.makeSlicedSprite(entry.element.source, dst, 'onmouse');
          if (sprite) layer.addChild(sprite);
          break;
        }
        case 'slider': {
          // SLIDER — runtime-positioned indicator knobs.
          const dst = this.evaluateElementDst(entry.element);
          if (!isDestinationVisible(dst, ops, this.timerActive)) break;
          const value = this.resolveSelectSliderValue(entry.element.type);
          if (value === undefined) break;
          const sprite = makeLr2SliderSprite(entry.element, dst, value, skinTextures);
          if (sprite) layer.addChild(sprite);
          break;
        }
      }
    }

    // MOUSECURSOR — replaces the system cursor with the skin's sprite. Always lands on the foreground layer regardless
    // of its CSV declaration order: a custom cursor that sat behind the bar list would defeat the point of having a
    // custom cursor in the first place.
    if (this.mouseX >= 0 && this.mouseY >= 0) {
      for (const cursor of skin.mouseCursors) {
        const dst = this.evaluateElementDst(cursor);
        if (!isDestinationVisible(dst, ops, this.timerActive)) {
          continue;
        }
        const sprite = this.makeMouseCursorSprite(cursor, dst);
        if (sprite) {
          this.skinForegroundLayer.addChild(sprite);
        }
      }
    }
  }

  /**
   * Returns a 0..1 value for an `#SRC_SLIDER` element on the select screen, or `undefined` when the type isn't
   * meaningful here (e.g. play-time hi-speed / shutter sliders that LR2 still allows in select skins as decoration).
   *
   * The only slider we currently drive is `type=1` ("song-select position") — the orange / teal scroll-position bar that lives
   * to the right of the bar list. Its value is the **visual** cursor index normalized against the visible entry count,
   * where "visual" means we lag the discrete selectedIndex by the active smooth-scroll offset so the knob slides in
   * lockstep with the bars (LR2 itself doesn't define slider easing in the skin format — `#SRC_SLIDER` / `#DST_SLIDER`
   * just specify rail geometry — so the smoothing has to come from the runtime).
   *
   * Convention: `listScrollOffset` is positive when the bars are visually still at their previous slot (e.g. right
   * after a `down` press the offset is `+slotHeight` and decays toward 0). The apparent cursor index is therefore
   * `selectedIndex - listScrollOffset / slotHeight`, which equals the previous index right at the press and converges
   * to the new index as the offset decays. A 1-entry list pins to 0.
   */
  private resolveSelectSliderValue(type: number): number | undefined {
    if (type === 1) {
      const entries = this.currentEntries();
      if (entries.length <= 1) return 0;
      const slotHeight = this.estimateSlotHeight();
      const visualIndex = slotHeight > 0 ? this.selectedIndex - this.listScrollOffset / slotHeight : this.selectedIndex;
      return Math.max(0, Math.min(1, visualIndex / (entries.length - 1)));
    }
    if (type === 2 || type === 3) {
      // HiSpeed 1P / 2P — both 1P and 2P sliders read the same global HS today (we don't model side-split HS yet). The
      // value is `(hiSpeed - HISPEED_MIN) / (HISPEED_MAX - HISPEED_MIN)` so the knob spans the rail proportionally to
      // the configured range.
      const span = HISPEED_MAX - HISPEED_MIN;
      if (span <= 0) return 0;
      const ratio = (this.playOptions.hiSpeed - HISPEED_MIN) / span;
      return Math.max(0, Math.min(1, ratio));
    }
    if (type === 4 || type === 5) {
      // Shutter 1P / 2P — both render the shared shutter coverage.
      return Math.max(0, Math.min(1, this.playOptions.shutter));
    }
    return undefined;
  }

  /**
   * Tests whether the current pointer position lies inside the `#SRC_ONMOUSE` hit-test rectangle. The hit rect is
   * anchored at the DST top-left with `(x2, y2)` as the offset, per LR2 spec.
   */
  private isPointerInHitRect(dst: Lr2DestinationRect, onMouse: Lr2OnMouseElement): boolean {
    if (this.mouseX < 0 || this.mouseY < 0) {
      return false;
    }
    const rectX = dst.x + onMouse.hitOffsetX;
    const rectY = dst.y + onMouse.hitOffsetY;
    const rectW = onMouse.hitWidth > 0 ? onMouse.hitWidth : (dst.w ?? 0);
    const rectH = onMouse.hitHeight > 0 ? onMouse.hitHeight : (dst.h ?? 0);
    return this.mouseX >= rectX && this.mouseX < rectX + rectW && this.mouseY >= rectY && this.mouseY < rectY + rectH;
  }

  /**
   * Builds a sprite from a source rect + interpolated DST. Used by ONMOUSE rendering and the BAR_FLASH overlay.
   * Animation cells (`source.cycle > 0`) are picked via `pickAnimatedCell` so spinner / pulse sprites animate
   * correctly.
   */
  private makeSlicedSprite(source: Lr2ImageRect, dst: Lr2DestinationRect, label?: string): Sprite | undefined {
    const baseTexture = this.skinTextures.get(source.imagePath);
    if (!baseTexture) {
      return undefined;
    }
    const rect = normalizeRect(dst);
    if (rect.w <= 0 || rect.h <= 0) {
      return undefined;
    }
    const elapsed = this.elapsedSinceTimer(source.timer);
    const cell = pickAnimatedCell(source, elapsed, dst.loop, {
      width: baseTexture.width,
      height: baseTexture.height,
    });
    if (cell.w <= 0 || cell.h <= 0) return undefined;
    const cropped = createCroppedTexture(baseTexture, cell);
    if (!cropped) return undefined;
    const sprite = new Sprite(cropped);
    sprite.label = label ?? `sliced[${source.imagePath}]`;
    sprite.position.set(rect.x, rect.y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, dst);
    return sprite;
  }

  /**
   * Renders the skin's custom cursor at the live pointer position. The DST `(x, y)` is the offset from the actual mouse
   * (typically `(0, 0)` so the cursor's top-left tracks the pointer exactly).
   */
  private makeMouseCursorSprite(cursor: Lr2MouseCursorElement, dst: Lr2DestinationRect): Sprite | undefined {
    const baseTexture = this.skinTextures.get(cursor.source.imagePath);
    if (!baseTexture) {
      return undefined;
    }
    const rect = normalizeRect(dst);
    if (rect.w <= 0 || rect.h <= 0) {
      return undefined;
    }
    const elapsed = this.elapsedSinceTimer(cursor.source.timer);
    const cell = pickAnimatedCell(cursor.source, elapsed, dst.loop, {
      width: baseTexture.width,
      height: baseTexture.height,
    });
    if (cell.w <= 0 || cell.h <= 0) return undefined;
    const cropped = createCroppedTexture(baseTexture, cell);
    if (!cropped) return undefined;
    const sprite = new Sprite(cropped);
    sprite.label = 'mouse-cursor';
    sprite.position.set(this.mouseX + rect.x, this.mouseY + rect.y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, dst);
    return sprite;
  }

  /**
   * Renders a single `#SRC_BUTTON` element by cropping its cell sheet to the active state index. Buttons are stateful
   * in LR2 (sort direction, current filter, panel open/close, …) but we don't yet persist any of that — so the cell
   * index defaults to 0 for every button type. Switching the displayed cell is a one-line change
   * (`resolveButtonState(button.type)`) once option state is live.
   */
  private renderButtonElement(button: Lr2ButtonElement, target: Container): void {
    const baseTexture = this.skinTextures.get(button.source.imagePath);
    if (!baseTexture) {
      return;
    }
    const dst = this.evaluateElementDst(button);
    const rect = normalizeRect(dst);
    if (rect.w <= 0 || rect.h <= 0) {
      return;
    }
    // LR2 "no-graphic" button — when both `w` and `h` are 0 the skin author is declaring a clickable rect with no
    // visible body (the matching #SRC_TEXT label is what paints). The button may still carry non-zero `divx` / `divy`
    // to indicate state count (LANE COVER uses `divx=1, divy=2` for ON/OFF), so we key only on the zero source-rect
    // bounds. Without this short-circuit, our `w==0` fallback would treat the source as "use the full texture" and
    // render the entire skin atlas squashed into the small button rect.
    if (button.source.w === 0 && button.source.h === 0) {
      return;
    }
    const divx = Math.max(1, button.source.divx);
    const divy = Math.max(1, button.source.divy);
    const cellWidth = button.source.w > 0 ? button.source.w / divx : baseTexture.width / divx;
    const cellHeight = button.source.h > 0 ? button.source.h / divy : baseTexture.height / divy;
    if (cellWidth <= 0 || cellHeight <= 0) {
      return;
    }
    const stateIndex = resolveButtonStateIndex(button.type, divx * divy, this.playOptions);
    const cellX = stateIndex % divx;
    const cellY = Math.floor(stateIndex / divx);
    const cellTexture =
      createCroppedTexture(baseTexture, {
        x: button.source.x + cellWidth * cellX,
        y: button.source.y + cellHeight * cellY,
        w: cellWidth,
        h: cellHeight,
      }) ?? baseTexture;
    const sprite = new Sprite(cellTexture);
    sprite.label = `button[type=${button.type},state=${stateIndex}]`;
    sprite.position.set(rect.x, rect.y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, dst);
    target.addChild(sprite);
  }

  /**
   * Populates the skin's `#DST_BAR_BODY_OFF` / `_ON` slots with songs from the current collection, with the
   * `selectedIndex` song landing at the `BAR_CENTER` slot. Slots outside `BAR_AVAILABLE` still render (LR2 spec: they
   * decorate the scroll edges) but no song is mapped to them.
   */
  private renderSkinBars(skin: Lr2Skin, ops: ReadonlySet<number>): void {
    const layout = skin.barLayout;
    if (layout.slots.length === 0) {
      return;
    }
    const slotCount = layout.slots.length;
    const center = clampSlot(layout.center, slotCount);
    // Choose the OFF/ON state per slot — only the center slot uses ON.
    const entries = this.currentEntries();
    for (const slot of layout.slots) {
      const offset = slot.index - center;
      // Wrap so off-edge slots show entries from the opposite end. E.g. with 3 entries and a slot below the cursor's
      // "current+3" position, the slot displays `entries[0]` again — matching LR2's circular rail rendering.
      const targetIndex = wrapIndex(this.selectedIndex + offset, entries.length);
      const entry = targetIndex !== undefined ? entries[targetIndex] : undefined;
      const isCenter = slot.index === center;
      // Interpolate the slot's keyframe chain instead of pinning to the final keyframe. The skin typically anchors
      // `#DST_BAR_BODY` animations to timer 11 (song change), which we re-stamp on every cursor move via
      // `noteCursorChange`, so the bars slide into their new positions over the keyframe duration.
      const keyframes = isCenter && slot.onKeyframes.length > 0 ? slot.onKeyframes : slot.offKeyframes;
      const fallbackDst = isCenter && slot.on ? slot.on : (slot.off ?? slot.on);
      if (!fallbackDst) continue;
      const dst =
        keyframes.length > 1 ? evaluateKeyframes(keyframes, this.elapsedSinceTimer(fallbackDst.timer)) : fallbackDst;
      if (!isDestinationVisible(dst, ops, this.timerActive)) {
        continue;
      }
      const body = pickBarBody(layout.bodies, entry);
      if (body) {
        const texture = this.skinTextures.get(body.source.imagePath);
        if (texture) {
          const label = `bar-body[slot=${slot.index},kind=${body.kind}${isCenter ? ',center' : ''}]`;
          const sprite = this.makeBarBodySprite(texture, body.source, dst, label);
          if (sprite) {
            this.listLayer.addChild(sprite);
          }
        }
      }
      if (entry) {
        // BAR_TITLE DST x/y are RELATIVE to the bar's top-left (`bar.txt`: DST coordinates are specified relative to the bar's xy origin).
        this.drawBarTitleText(entry, dst, layout.title, skin);
      }
      // BAR_LEVEL: per-bar level number for SONG entries only. Folder entries don't carry a level so they leave the
      // slot blank.
      if (entry?.kind === 'song' && layout.levels.length > 0 && layout.levelDestination) {
        this.drawBarLevel(entry.song, dst, layout.levels, layout.levelDestination);
      }
      // BAR_FLASH: focused-bar overlay. DST is relative to the bar (like BAR_TITLE), so we add the bar's xy onto the
      // flash DST before drawing.
      if (isCenter && layout.flash) {
        this.drawBarFlash(layout.flash, dst);
      }
      // BAR_LAMP / BAR_RANK: skipped for now because we don't yet persist clear-history per song. Once a score record
      // exists, pick `layout.lamps[scoreLamp]` / `layout.ranks[scoreRank]` and render via the same offset-by-bar
      // formula as BAR_TITLE.
    }
  }

  /**
   * Renders the `#SRC_BAR_FLASH` overlay on the focused bar. The DST coordinates in the flash element are **relative**
   * to the focused bar's `BAR_BODY_ON` rect, mirroring how BAR_TITLE / BAR_LEVEL place themselves. We compose the
   * absolute DST and then delegate to `makeSlicedSprite` so any animation cycle / cell cycling is honored.
   */
  private drawBarFlash(flash: Lr2BarFlashElement, bar: Lr2DestinationRect): void {
    const flashDst = this.evaluateElementDst(flash);
    const absoluteDst: Lr2DestinationRect = {
      ...flashDst,
      x: bar.x + flashDst.x,
      y: bar.y + flashDst.y,
    };
    const sprite = this.makeSlicedSprite(flash.source, absoluteDst, 'bar-flash');
    if (sprite) {
      this.listLayer.addChild(sprite);
    }
  }

  /**
   * Renders the per-bar level number sprite for `song`. Picks the `#SRC_BAR_LEVEL` entry whose kind matches the chart's
   * `#DIFFICULTY` field (1=BEGINNER..5=INSANE), falling back to the "undefined" kind when no specific entry is
   * available. The DST offset is added on top of the bar's own xy because LR2 scopes BAR_LEVEL coordinates to the bar's
   * top-left.
   */
  private drawBarLevel(
    song: BrowserSongEntry,
    bar: Lr2DestinationRect,
    levels: ReadonlyArray<Lr2BarLevelSource>,
    levelDst: Lr2DestinationRect,
  ): void {
    const playLevel =
      typeof song.playLevel === 'number' ? song.playLevel : Number.parseInt(String(song.playLevel ?? ''), 10);
    if (!Number.isFinite(playLevel)) {
      return;
    }
    const kind = mapDifficultyToBarLevelKind(song.chart.metadata.difficulty);
    const level =
      levels.find((entry) => entry.kind === kind) ?? levels.find((entry) => entry.kind === 'undefined') ?? levels[0];
    if (!level) {
      return;
    }
    // Translate the relative DST into absolute coordinates on the bar.
    const absoluteDst: Lr2DestinationRect = {
      ...levelDst,
      x: bar.x + levelDst.x,
      y: bar.y + levelDst.y,
    };
    const fakeNumberElement: Lr2NumberElement = {
      source: level.source,
      destination: absoluteDst,
      keyframes: [absoluteDst],
      // Synthetic element built per-frame for digit rendering; never enters the pre/post-bar layer routing, so a `-1`
      // sentinel is fine here. The renderer pumps it directly through `renderNumberElement` rather than the chrome
      // dispatcher.
      declarationOrder: -1,
    };
    // Suppress leading zeros — `keta` on BAR_LEVEL means "max number of digits" (slot reservation for centering math),
    // NOT "force pad to that width". Without this flag a level of 7 would render as "07" inside a 2-digit field,
    // pushing the visible "7" half a field-width to the right and leaving a stray "0" at the left edge of the bar —
    // visibly offset from where the LR2 default skin places it. Centering math still uses the full field width so
    // single-digit numbers sit at the field's middle.
    renderNumberElement(
      containerSpriteSink(this.listLayer),
      fakeNumberElement,
      playLevel,
      this.skinTextures.asReadonlyMap(),
      absoluteDst,
      { suppressLeadingZeros: true },
    );
  }

  private makeStaticImageSprite(image: Lr2ImageElement) {
    return makeLr2StaticImageSprite(image, this.evaluateElementDst(image), {
      textures: this.skinTextures.asReadonlyMap(),
      elapsedSinceTimer: (timer) => this.elapsedSinceTimer(timer),
      resolveSpecialGraphicTexture: (path) => this.resolveSpecialGraphicTexture(path),
    });
  }

  /**
   * Returns the live texture bound to one of LR2's runtime-resolved graphic slots (BACKBMP / BANNER / STAGEFILE / black
   * / white). Triggers an async load on first miss, returning `undefined` until the asset is decoded; the next
   * `render()` tick will pick up the cached texture.
   */
  private resolveSpecialGraphicTexture(path: Lr2SpecialGraphic): Texture | undefined {
    const solidTexture = resolveSolidSpecialGraphicTexture(path);
    if (solidTexture) {
      return solidTexture;
    }
    const song = this.focusedSong();
    if (!song) {
      return undefined;
    }
    return this.chartGraphicTextures.resolve(this.collection, song, path, () => this.render());
  }

  private makeBarBodySprite(
    texture: Texture,
    source: Lr2ImageRect,
    destination: Lr2DestinationRect,
    label?: string,
  ): Sprite | undefined {
    const rect = normalizeRect(destination);
    if (rect.w <= 0 || rect.h <= 0) {
      return undefined;
    }
    // BAR_BODY may animate (glow rotation, focus pulse) via the source's `cycle` ms over its `divx * divy` cells. We
    // resolve the active cell here so the bar sprite changes frame over time when the skin defines an animation.
    const elapsed = this.elapsedSinceTimer(source.timer);
    const cell = pickAnimatedCell(source, elapsed, destination.loop);
    const cropped = createCroppedTexture(texture, cell) ?? texture;
    const sprite = new Sprite(cropped);
    sprite.label = label ?? 'bar-body';
    sprite.position.set(rect.x, rect.y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, destination);
    return sprite;
  }

  /**
   * Draws the song title at the `BAR_TITLE` destination (xy relative to the bar's top-left).
   *
   * When the skin defines `#SRC_BAR_TITLE` and the matching `#LR2FONT` payload has decoded, we route through
   * `makeLr2TextSprite` so the title renders with the skin's authored bitmap font (the LR2 default's 14 px pixel-art
   * face for the bar list, glyph-tinted per `#DST_BAR_TITLE`'s RGBA). Otherwise we fall back to a system-font `Text` —
   * either while fonts are still loading, or for skins that omit `#SRC_BAR_TITLE` entirely.
   *
   * No artist sub-line: LR2's bar list shows just the title (or folder name). Per-song artist / genre live in the
   * dedicated info panel populated by the skin's `#SRC_TEXT` slots — not the bar list itself.
   */
  private drawBarTitleText(
    entry: BrowserBrowseEntry,
    bar: Lr2DestinationRect,
    titleElement: Lr2BarTitleElement | undefined,
    skin: Lr2Skin,
  ): void {
    const titleRect = titleElement?.destination ?? { x: 12, y: 8, w: bar.w - 24, h: 20 };
    const x = bar.x + titleRect.x;
    const y = bar.y + titleRect.y;
    const w = Math.max(1, titleRect.w);
    const h = Math.max(1, titleRect.h);
    const primaryText = entry.kind === 'song' ? entry.song.title : entry.folder.label;
    if (titleElement) {
      // Build a synthetic `Lr2TextElement` carrying just the fields `makeLr2TextSprite` reads — font index, alignment
      // (BAR_TITLE has no LR2-spec alignment field, so left-anchor is the conventional rendering), and the absolute
      // `destination` on the bar's coordinate frame. Going through `makeLr2TextSprite` means the bitmap-font path
      // automatically engages once `#LR2FONT` payloads finish decoding, mirroring how the chrome-text path works.
      const synthetic: Lr2TextElement = {
        font: titleElement.font,
        // 0 = freeform string. The bar list never queries `st` for text resolution since we pass the value directly,
        // and `makeLr2BitmapTextSprite` only uses it for a debug label — any non-clashing value is fine.
        st: 0,
        alignment: 'left',
        edit: 0,
        panel: 0,
        destination: { ...titleElement.destination, x, y, w, h },
        keyframes: [],
        declarationOrder: 0,
      };
      const sprite = makeLr2TextSprite(primaryText, synthetic, synthetic.destination, {
        bitmapFonts: this.bitmapFonts,
        systemFontSizes: skin.systemFontSizes,
      });
      sprite.label = `bar-title[${entry.kind}=${primaryText}]`;
      this.listLayer.addChild(sprite);
      return;
    }
    // No `#SRC_BAR_TITLE` — fall back to a basic font-backed `Text`. LR2 default skins use pixel-art fonts (typically
    // 12 px tall) for BAR_TITLE; Pixi `Text` is taller pixel-for-pixel, so cap the font size
    // at 14 px and leave 2 px breathing room below `h`.
    const titleFontSize = clampFontSize(h - 2, 8, 14);
    // No `wordWrap` — LR2 spec auto-shrinks long titles horizontally rather than wrapping (`docs/LR2SkinHelp.md` line
    // 1343). The squeeze below mirrors that.
    const titleText = new Text({
      text: primaryText,
      style: new TextStyle({
        fill: TEXT,
        fontSize: titleFontSize,
        // A regular weight reads cleaner at small sizes than the heavy title face.
        fontWeight: '500',
        fontFamily: LR2_TEXT_FALLBACK_FONT,
        // Outlined text — LR2 reference skins bake a 1–2 px black outline into their bar-title bitmaps so titles
        // read cleanly against the colored BAR_BODY artwork. Match that by stroking the fallback.
        stroke: { color: 0x000000, width: 2, alignment: 0.5, join: 'round' },
      }),
    });
    titleText.label = `bar-title[${entry.kind}=${primaryText}]`;
    titleText.position.set(x, y);
    if (w > 0 && titleText.width > w) {
      titleText.scale.x = w / titleText.width;
    }
    this.listLayer.addChild(titleText);
  }
}

function clampSlot(value: number, slotCount: number): number {
  if (slotCount <= 0) return 0;
  return Math.min(slotCount - 1, Math.max(0, Math.trunc(value)));
}

/**
 * Maps any integer (including negatives or values past the end) into `[0, count)` by modular arithmetic. Returns
 * `undefined` when the list is empty so the caller can decide what to draw (or skip).
 *
 * Used by both the cursor → slot mapping and click hit-tests so the bar list behaves like a circular rail — scrolling
 * past the end wraps to the start, and slots above / below the cursor that would normally land in negative-index
 * territory show entries from the opposite end of the list instead of being blank.
 */
function wrapIndex(target: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  return ((target % count) + count) % count;
}

export interface Lr2DefaultSearchBoxHitTestInput {
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * Heuristic hit-test for the LR2 default theme's search box.
 *
 * The vanilla LR2 select skin draws the SEARCH chrome as a background `#SRC_IMAGE` plus an `#SRC_TEXT st=30` whose DST
 * rectangle hugs the value text rather than the whole box. Once the text is empty, the DST collapses to roughly zero
 * horizontal room, so the spec-driven text walk misses clicks on the chrome.
 *
 * To avoid hijacking custom layouts, the fallback is gated to the canonical 1280×720 LR2-default design size.
 */
export function isInsideLr2DefaultSearchBox(input: Lr2DefaultSearchBoxHitTestInput): boolean {
  if (input.width !== 1280 || input.height !== 720) return false;
  return input.x >= 0 && input.x <= 920 && input.y >= 540 && input.y <= 582;
}

function containsPoint(rect: Lr2DestinationRect, x: number, y: number): boolean {
  const r = normalizeRect(rect);
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/**
 * Picks the bar-body sprite definition for a slot. Maps the entry kind (`'song'` / `'folder'`) onto the matching
 * `#SRC_BAR_BODY` art, falling back to a `'song'` body when the skin doesn't define a folder variant, and finally the
 * first available body. Slots with no entry (i.e. out-of-range when the cursor is near the start / end of the list)
 * still get a body sprite so the empty slats keep rendering — that matches LR2's behavior where the rail draws even
 * past the end of the song list.
 */
function pickBarBody(
  bodies: ReadonlyArray<Lr2BarBodySource>,
  entry: BrowserBrowseEntry | undefined,
): Lr2BarBodySource | undefined {
  if (bodies.length === 0) {
    return undefined;
  }
  const kind: Lr2BarBodyKind = entry?.kind === 'folder' ? 'folder' : 'song';
  return bodies.find((body) => body.kind === kind) ?? bodies.find((body) => body.kind === 'song') ?? bodies[0];
}

/**
 * Resolves an LR2 `#SRC_TEXT` source-type (`st`) onto a string from the currently-focused song. Mirrors
 * `scene/lr2/gameplay.ts`'s resolver but for the static select-screen subset. Returns `undefined` for st codes outside the
 * song-info range so the caller can skip painting. Codes 10..15 / 17..18 (single-digit) and 20..28 (double-digit) are
 * treated the same — LR2 uses the second range for "subtitle / sub-artist / etc." rendering on a separate layer, but
 * practically the value resolves identically.
 */
function resolveSelectText(
  st: number,
  song: BrowserSongEntry | undefined,
  playOptions: PixiPlayOptions = DEFAULT_PLAY_OPTIONS,
): string | undefined {
  // Slots that don't depend on a focused song.
  switch (st) {
    case 1:
      // Target / rival name. LR2 displays "NO TARGET" when no rival has been selected; we ship without rival/IR support
      // so this is the permanent value.
      return 'NO TARGET';
    case 2:
      // Player name. Placeholder until a profile system exists.
      return 'PLAYER';
    case 30:
      // Search box content / jukebox name. We don't model search yet, so return an empty string to keep the panel
      // rendering.
      return '';
    case 50: // skin name
      return 'LR2 SELECT';
    case 51: // skin author
      return '';
    // Option-panel labels (60..85). LR2 default skin renders the current option-state name as readable text inside each
    // panel-1 box (mirrors what HI-SPEED's NUMBER readout does for HiSpeed). We return the matching `playOptions` enum
    // string so `makeLr2TextSprite` paints it with the system font; without these, the underlying #SRC_TEXT slot stayed
    // empty and the only thing visible was an unrelated background image.
    case 60: {
      // Playstyle / keymode label — derived from the focused chart's lane usage. Matches the "5KEYS" / "7KEYS" /
      // "10KEYS" / "14KEYS" / "9KEYS" wording the LR2 default skin paints for the panel-1 PLAYSTYLE box.
      if (!song) return 'SINGLE';
      switch (resolveKeyModeOp(song)) {
        case 161:
          return '5KEYS';
        case 160:
          return '7KEYS';
        case 163:
          return '10KEYS';
        case 162:
          return '14KEYS';
        case 164:
          return '9KEYS';
        default:
          return 'SINGLE';
      }
    }
    case 61: // sort
      return playOptions.sort;
    case 62: // difficulty filter
      return playOptions.difficultyFilter;
    case 63: // random 1P
      return playOptions.random1P;
    case 64: // random 2P
      return playOptions.random2P;
    case 65: // gauge 1P
      return playOptions.gauge1P;
    case 66: // gauge 2P
      return playOptions.gauge2P;
    case 67: // assist 1P (autoscratch)
      return playOptions.autoScratch1P ? 'AUTOSCRATCH' : 'OFF';
    case 68: // assist 2P
      return playOptions.autoScratch2P ? 'AUTOSCRATCH' : 'OFF';
    case 69: // battle
      return 'OFF';
    case 70: // flip
      return playOptions.dpFlip ? 'ON' : 'OFF';
    case 71: // scoregraph
      return playOptions.scoreGraph ? 'ON' : 'OFF';
    case 72: // ghost
      return 'OFF';
    case 73: // LANE COVER (shutter)
      // LR2's SYSTEM OPTION row labels this slot "LANE COVER" and shows the binary ON / OFF state — the height
      // percentage belongs to the slider next to the value, not the value text itself. (We previously rendered a
      // percentage here, which made the row look like a numeric option instead of a toggle.)
      return playOptions.laneCover ? 'ON' : 'OFF';
    case 74: // scroll type
      return 'OFF';
    case 75: // bga size
      return playOptions.bgaSize;
    case 76: // bga
      return playOptions.bga === 'AUTOPLAY_ONLY' ? 'AUTOPLAY' : playOptions.bga;
    case 77: // color depth
      return '32 BIT';
    case 78: // vsync
      return 'ON';
    case 79: // screen mode
      return 'FULL';
    case 80: // judge auto-adjust
      return 'OFF';
    case 81: // replay save mode
      return 'OFF';
    case 82: // trial line 1
    case 83: // trial line 2
      return '';
    case 84: // effect 1P (HIDDEN / SUDDEN)
      return playOptions.hiddenSudden1P;
    case 85: // effect 2P
      return playOptions.hiddenSudden2P;
  }

  if (!song) {
    return undefined;
  }
  const subartists = song.chart.bmson.info?.subartists?.join(' / ');
  switch (st) {
    case 10:
    case 20:
      return song.title;
    case 11:
    case 21:
      return song.subtitle ?? '';
    case 12:
    case 22:
      return [song.title, song.subtitle].filter((value): value is string => Boolean(value)).join(' ');
    case 13:
    case 23:
      return song.genre ?? '';
    case 14:
    case 24:
      return song.artist ?? '';
    case 15:
    case 25:
      return subartists ?? '';
    case 16:
    case 26:
      return song.fileLabel;
    case 17:
    case 27:
      return song.playLevel?.toString() ?? '';
    case 18:
    case 28:
      return resolveDifficultyName(song.chart.metadata.difficulty);
    case 29:
      // Insane level — same source as playLevel for now, since we don't ship a separate insane-table
      // integration.
      return song.chart.metadata.difficulty === 5 ? (song.playLevel?.toString() ?? '') : '';
    default:
      return undefined;
  }
}

/**
 * Resolves an LR2 `#SRC_NUMBER` source-num onto a numeric value pulled from the focused song's metadata or static skin
 * state. Numbers map to the canonical slots in `docs/LR2SkinHelp.md` `# num list`:
 *
 * - **10..15** — play option values (HS, JUDGE TIMING, SUD+). Mostly placeholder until preferences persist.
 * - **20..26** — fps / date / time. Only `20=fps` actively varies.
 * - **30..41** — lifetime player stats (TOTAL PLAY/CLEAR/FAIL/judges, running combo, trial level). All `0` until
 *   persistence ships.
 * - **45..49** — same-folder difficulty levels (beginner..insane). We don't model the folder concept yet.
 * - **70..91** — best-score panel for the focused chart. Most are `undefined` until score history persists; chart-side
 *   stats (totalnotes, BPM max/min) are computed from the chart on the fly.
 * - **92..94** — IR (online-only) — always `undefined`.
 * - **160** — initial BPM (matches the gameplay `bpm` field).
 *
 * Returning `undefined` makes the renderer skip the slot, leaving it blank — which matches LR2's behavior when no
 * value is bound.
 */
function resolveSelectNumber(
  num: number,
  song: BrowserSongEntry | undefined,
  playOptions: PixiPlayOptions = DEFAULT_PLAY_OPTIONS,
): number | undefined {
  // Slots that don't depend on a focused song.
  switch (num) {
    case 20:
      // FPS — `scene/lr2/select` doesn't sample its own frame rate yet, so surface 60 as a placeholder rather than leaving
      // the panel blank.
      return 60;
    case 21:
      return new Date().getFullYear();
    case 22:
      return new Date().getMonth() + 1;
    case 23:
      return new Date().getDate();
    case 24:
      return new Date().getHours();
    case 25:
      return new Date().getMinutes();
    case 26:
      return new Date().getSeconds();
    // Lifetime player stats (30..41). 0 placeholders until we add a persistence layer for play history.
    case 30: // TOTAL PLAY COUNT
    case 31: // TOTAL CLEAR COUNT
    case 32: // TOTAL FAIL COUNT
    case 33: // TOTAL PERFECT
    case 34: // TOTAL GREAT
    case 35: // TOTAL GOOD
    case 36: // TOTAL BAD
    case 37: // TOTAL POOR
    case 38: // RUNNING COMBO (now)
    case 39: // RUNNING COMBO (max)
    case 40: // TRIAL LEVEL
    case 41: // TRIAL LEVEL-1
      return 0;
    // Play-option slots (10..15). HS values come from the live `playOptions.hiSpeed` so the LR2 default skin's HS
    // readout tracks the in-scene panel buttons. Other slots are placeholders until the corresponding option lands in
    // {@link PixiPlayOptions} (judge / target rate / SUD+).
    case 10: // HS-1P (×100, e.g. 230 = 2.30×)
    case 11: // HS-2P (we drive both from the same global HS today)
      return Math.round(playOptions.hiSpeed * 100);
    case 12: // JUDGE TIMING
    case 13: // DEFAULT TARGET RATE
    case 14: // SUD+ 1P
    case 15: // SUD+ 2P
      return 0;
  }

  if (!song) {
    return undefined;
  }
  const playLevel =
    typeof song.playLevel === 'number' ? song.playLevel : Number.parseInt(String(song.playLevel ?? ''), 10);
  const playLevelOrUndef = Number.isFinite(playLevel) ? playLevel : undefined;
  const totalNotes = song.totalNotes;
  switch (num) {
    // Best-score panel (70..89). 0 placeholders for slots that need score history; chart-derived ones (72/74) compute
    // live.
    case 70: // best score
    case 71: // best exscore
      return 0;
    case 72: // exscore theoretical max (= totalnotes * 2)
      return totalNotes * 2;
    case 73: // best rate
      return 0;
    case 74: // totalnotes (the canonical LR2 slot)
      return totalNotes;
    case 75: // best maxcombo
    case 76: // best min b+p
    case 77: // playcount
    case 78: // clearcount
    case 79: // failcount
    case 80: // best perfect
    case 81: // best great
    case 82: // best good
    case 83: // best bad
    case 84: // best poor
    case 85: // best perfect %
    case 86: // best great %
    case 87: // best good %
    case 88: // best bad %
    case 89: // best poor %
      return 0;
    // BPM range (90/91). Computed by scanning channel-03 / channel-08 events; charts without BPM changes get the
    // initial BPM for both.
    case 90:
      return resolveBpmRange(song).max;
    case 91:
      return resolveBpmRange(song).min;
    // IR slots (92..94) — undefined until online support arrives.
    case 92:
    case 93:
    case 94:
      return undefined;
    // Same-folder difficulty levels (45..49). We don't model folders yet, so surface the focused chart's level under
    // whichever slot matches its difficulty and leave the others blank.
    case 45:
    case 46:
    case 47:
    case 48:
    case 49: {
      const expectedDifficulty = num - 44; // 45 → diff=1 (beginner), 49 → diff=5 (insane)
      return song.chart.metadata.difficulty === expectedDifficulty ? playLevelOrUndef : undefined;
    }
    case 160:
      // Initial BPM. The LR2 spec marks this as "live BPM"; on the select screen the chart isn't playing, so the
      // initial BPM is the right read.
      return song.bpm;
    default:
      return undefined;
  }
}

/**
 * Computes the focused chart's BPM range. Scans BPM-change events (channel 03 = inline hex BPM, channel 08 = lookup via
 * `resources.bpm`) plus the initial BPM. Cheap because it only runs when a num=90 / num=91 slot is rendered (i.e. once
 * per cursor move).
 */
function resolveBpmRange(song: BrowserSongEntry): { min: number; max: number } {
  // `BrowserSongEntry.bpm` is optional; fall back to the chart's metadata BPM (which is non-optional in the json type)
  // before scanning events so the range never starts as `undefined`.
  const initial = song.bpm ?? song.chart.metadata.bpm;
  let min = initial;
  let max = initial;
  for (const event of song.chart.events) {
    if (event.channel === '03') {
      // Inline hex (base-16) BPM. Two-digit value, 0..255.
      const value = Number.parseInt(event.value, 16);
      if (Number.isFinite(value) && value > 0) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    } else if (event.channel === '08') {
      // Lookup via `#BPMxx` table.
      const bpm = song.chart.resources.bpm[event.value];
      if (typeof bpm === 'number' && bpm > 0) {
        if (bpm < min) min = bpm;
        if (bpm > max) max = bpm;
      }
    }
  }
  return { min: Math.round(min), max: Math.round(max) };
}

/**
 * Maps the BMS `#DIFFICULTY` code to the LR2 label string. Mirrors the gameplay-side helper of the same name so the
 * select view shows the same vocabulary.
 */
function resolveDifficultyName(difficulty: number | undefined): string {
  switch (difficulty) {
    case 1:
      return 'BEGINNER';
    case 2:
      return 'NORMAL';
    case 3:
      return 'HYPER';
    case 4:
      return 'ANOTHER';
    case 5:
      return 'INSANE';
    default:
      return '';
  }
}

/**
 * Returns the cell index a `#SRC_BUTTON` should display for the current option state. Mapped per LR2 `# button_type list`
 * (`docs/LR2SkinHelp.md` lines 5887+). Types not yet tracked by {@link PixiPlayOptions} fall back to cell 0 ("OFF" /
 * "ALL" / "GROOVE" / etc.). The `cellCount = divx * divy` cap prevents an out-of-range index from sampling outside the
 * source rect.
 */
function resolveButtonStateIndex(type: number, cellCount: number, playOptions: PixiPlayOptions): number {
  let stateIndex = 0;
  if (type === 72) {
    // BGA: cell 0 = OFF, cell 1 = ON, cell 2 = AUTOPLAY ONLY.
    stateIndex = BGA_CYCLE.indexOf(playOptions.bga);
  } else if (type === 73) {
    // BGA size: cell 0 = NORMAL, cell 1 = EXTEND.
    stateIndex = BGA_SIZE_CYCLE.indexOf(playOptions.bgaSize);
  } else if (type === 70) {
    // Score graph: cell 0 = OFF, cell 1 = ON.
    stateIndex = playOptions.scoreGraph ? 1 : 0;
  } else if (type === 10) {
    // Difficulty filter cycle button — cell index follows the {@link DIFFICULTY_FILTER_CYCLE} order.
    stateIndex = DIFFICULTY_FILTER_CYCLE.indexOf(playOptions.difficultyFilter);
  } else if (type === 11) {
    // Keymode filter cycle button — cell index follows the {@link KEYS_FILTER_CYCLE} order (off / 5K / 7K / 10K / 14K /
    // 9K).
    stateIndex = KEYS_FILTER_CYCLE.indexOf(playOptions.keysFilter);
  } else if (type === 12) {
    // Sort cycle button — cell index follows the {@link SORT_CYCLE} order (off / level / title / clear).
    stateIndex = SORT_CYCLE.indexOf(playOptions.sort);
  } else if (type === 55) {
    // HS-FIX cycle button — cell index follows the {@link HS_FIX_CYCLE} order (off / maxbpm / minbpm / average /
    // constant).
    stateIndex = HS_FIX_CYCLE.indexOf(playOptions.hsFix);
  } else if (type === 50) {
    // HIDDEN/SUDDEN 1P — cell index follows the {@link HIDDEN_SUDDEN_CYCLE} order (off/hidden/sudden/hid+sud).
    stateIndex = HIDDEN_SUDDEN_CYCLE.indexOf(playOptions.hiddenSudden1P);
  } else if (type === 51) {
    // HIDDEN/SUDDEN 2P — independent cycle from the 1P button.
    stateIndex = HIDDEN_SUDDEN_CYCLE.indexOf(playOptions.hiddenSudden2P);
  } else if (type === 46) {
    // LANE COVER (shutter): cell 0 = OFF, cell 1 = ON.
    stateIndex = playOptions.laneCover ? 1 : 0;
  } else if (type === 44) {
    // Autoscratch 1P: cell 0 = OFF, cell 1 = ON.
    stateIndex = playOptions.autoScratch1P ? 1 : 0;
  } else if (type === 45) {
    // Autoscratch 2P: cell 0 = OFF, cell 1 = ON.
    stateIndex = playOptions.autoScratch2P ? 1 : 0;
  } else if (type === 54) {
    // DP FLIP: cell 0 = OFF, cell 1 = ON.
    stateIndex = playOptions.dpFlip ? 1 : 0;
  } else if (type === 42) {
    // RANDOM 1P: cells follow {@link RANDOM_CYCLE} order.
    stateIndex = RANDOM_CYCLE.indexOf(playOptions.random1P);
  } else if (type === 43) {
    // RANDOM 2P.
    stateIndex = RANDOM_CYCLE.indexOf(playOptions.random2P);
  } else if (type === 40) {
    // Gauge 1P: cells follow {@link GAUGE_CYCLE} order.
    stateIndex = GAUGE_CYCLE.indexOf(playOptions.gauge1P);
  } else if (type === 41) {
    // Gauge 2P.
    stateIndex = GAUGE_CYCLE.indexOf(playOptions.gauge2P);
  } else if (type >= 91 && type <= 96) {
    // Difficulty filter direct-set buttons — cell 0 / 1 = inactive / active depending on whether this button's specific
    // difficulty matches the live filter. Skins typically use these as separate "lit when selected" plates.
    const target = DIFFICULTY_FILTER_BY_DIRECT_BUTTON[type];
    stateIndex = target !== undefined && playOptions.difficultyFilter === target ? 1 : 0;
  }
  return Math.max(0, Math.min(cellCount - 1, stateIndex));
}

/**
 * Maps the BMS `#DIFFICULTY` field (1=BEGINNER..5=INSANE, 0/missing = undefined) to the LR2 `#SRC_BAR_LEVEL` kind enum.
 * The "irRanking" kind isn't a chart attribute — it shows up only in IR mode, which we don't simulate yet, so we never
 * select it from this mapping.
 */
function mapDifficultyToBarLevelKind(difficulty: number | undefined): Lr2BarLevelKind {
  switch (difficulty) {
    case 1:
      return 'beginner';
    case 2:
      return 'normal';
    case 3:
      return 'hyper';
    case 4:
      return 'another';
    case 5:
      return 'insane';
    default:
      return 'undefined';
  }
}

// Re-export the slot type so consumers (tests, future helpers) can reach it without dipping into the parser module
// directly.
export type { Lr2BarBodySlot };
