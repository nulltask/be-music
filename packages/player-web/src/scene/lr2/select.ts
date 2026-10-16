import { Color, Container, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import type {
  Lr2BarBodySlot,
  Lr2BarFlashElement,
  Lr2BarLampSource,
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
import { PLAY_OPTION_CHOICES } from '@be-music/scene-model';
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
import { LR2_TEXT, LR2_TIMER } from '@be-music/lr2-skin/ids';
import {
  pickLr2BarBody,
  resolveLr2BarLamp,
  resolveLr2BarLevel,
  resolveLr2CourseMakerAction,
  resolveLr2SelectButton,
  resolveLr2SelectState,
  resolveLr2SelectTimers,
  type Lr2Clock,
  type Lr2SelectState,
} from '@be-music/lr2-skin/state';
import { COURSE_NAME_PROMPT } from '../../collection/course-maker.ts';
import {
  Lr2ChartGraphicTextureStore,
  Lr2SkinTextureStore,
  collectSelectSkinTexturePaths,
  resolveSolidSpecialGraphicTexture,
} from '../../skin/lr2/scene-textures.ts';
import { clampFontSize, isDestinationVisible, makeLr2TextSprite } from '../../skin/lr2/scene-render.ts';
import { loadSkinBitmapFonts } from '../../skin/lr2/font-loader.ts';
import type { Lr2LoadedFont } from '../../skin/lr2/bitmap-text.ts';
import { resolveChartBpmRange } from '../../chart/bpm-range.ts';
import type { BrowserBrowseEntry, BrowserSongCollection, BrowserSongEntry } from '../../collection/types.ts';
import { resolveSongSource } from '../../collection/collection.ts';
import { dirname } from '@be-music/utils/core';
import { LR2_TEXT_FALLBACK_FONT } from './fonts.ts';
import { CoreSongSelectView, type CoreSongSelectViewOptions, type SelectDesignSize } from '../core/select.ts';
import type { SceneIdentity } from '../../host/family-kit.ts';

// The family-neutral half of the select scene (navigation, input, audio, play options, be-music fallback) lives in
// `scene/core/select.ts`; re-export its public surface so existing `scene/lr2/select` importers keep working.
export {
  DEFAULT_PLAY_OPTIONS,
  matchesSearchQuery,
  wrappedCursorDelta,
  type PixiBgaMode,
  type PixiBgaSize,
  type PixiDifficultyFilter,
  type PixiHiddenSudden,
  type PixiHsFix,
  type PixiKeysFilter,
  type PixiPlayOptions,
  type PixiRandomMode,
  type PixiSelectSort,
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

const IDENTITY: SceneIdentity = { kind: 'select', family: 'lr2' };

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

  public override get identity(): SceneIdentity {
    return IDENTITY;
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
    this.syncCourseMakerTimers();
    const state = this.perf.time('computeOps', () => this.computeState(skin));
    this.perf.time('renderSkinFrame', () => this.renderSkinFrame(skin, state));
    this.perf.time('renderSkinBars', () => this.renderSkinBars(skin, state.ops));
    // Empty-state hint — shown over the skin when nothing was loaded, so the user understands they need to drop
    // content.
    if (this.collection.songs.length === 0) {
      this.renderEmptyStateHint(designWidth, designHeight);
    }
  }

  /**
   * The LR2 state of the select screen for the bar under the cursor (`resolveLr2SelectState`): its ops, numbers, texts,
   * button cells and sliders. A course bar lights the course-bar op (3), the playable op (5) when every stage is in the
   * collection, its best lamp (100-105), its stages' difficulties (700-745) and the course ops (290 and its kind's op).
   */
  private computeState(skin: Lr2Skin): Lr2SelectState {
    const entries = this.currentEntries();
    const focused = entries[this.selectedIndex];
    const song = focused?.kind === 'song' ? focused.song : undefined;
    const maker = this.options.courseMaker;
    return resolveLr2SelectState({
      ...(focused !== undefined ? { focused } : {}),
      options: this.playOptions,
      record:
        focused?.kind === 'song'
          ? { lamp: this.options.resolveSongRecord?.(focused.song)?.lamp }
          : focused?.kind === 'course'
            ? { lamp: this.options.resolveCourseRecord?.(focused.course)?.lamp }
            : {},
      openPanels: this.panelStates,
      customOps: skin.customOptions.map((option) => option.defaultOp),
      readme: song !== undefined && hasReadtextForSong(this.collection, song),
      ...(song !== undefined ? { bpmRange: resolveChartBpmRange(song.chart) } : {}),
      // The search word is the typed query, left to the host's field while the player types in it.
      searchText: this.searchEditing ? '' : this.searchText,
      listPosition: this.resolveListPosition(entries.length),
      ...(maker !== undefined
        ? {
            courseMaker: {
              ...(maker.draft !== undefined ? { draft: maker.draft } : {}),
              defaultConnection: maker.defaultConnection,
              namePrompt: COURSE_NAME_PROMPT,
            },
          }
        : {}),
      clock: lr2ClockNow(),
      // The scene samples no frame rate of its own; 60 rather than a blank panel.
      fps: 60,
    });
  }

  /**
   * The search box of an LR2 skin: the visible `#SRC_TEXT st=30`, where its text is drawn. Its DST often hugs the text
   * and collapses when empty, so a narrow one is widened (to the LR2 default theme's box on that theme). The default
   * theme's box stands in when no such text is visible.
   */
  protected override designSearchFieldRect(): { x: number; y: number; width: number; height: number } | undefined {
    const skin = this.options.skin;
    if (skin === undefined || this.themeDesignSize === undefined) return undefined;
    const ops = this.computeState(skin).ops;
    const isDefaultTheme = skin.width === 1280 && skin.height === 720;
    for (const text of skin.texts) {
      if (text.st !== LR2_TEXT.SEARCH_WORD || !this.isPanelOpen(text.panel)) continue;
      const dst = this.evaluateElementDst(text);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const rect = normalizeRect(dst);
      const width = rect.w >= 40 ? rect.w : isDefaultTheme ? Math.max(40, 920 - rect.x) : 320;
      return { x: rect.x, y: rect.y, width, height: Math.max(rect.h, 16) };
    }
    return isDefaultTheme ? { x: 0, y: 540, width: 920, height: 42 } : undefined;
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
        // The cursor moves the slots between, so the list slides by them, and the bar starts.
        if (target !== this.selectedIndex) this.moveCursor(offset);
        this.activateFocused();
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
    const ops = this.computeState(skin).ops;
    for (const button of skin.buttons) {
      if (button.click !== 1) continue;
      if (!this.isPanelOpen(button.panel)) continue;
      const dst = this.evaluateElementDst(button);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      if (!containsPoint(dst, virtualX, virtualY)) continue;
      // LR2's value buttons step up on their right half and down on their left half (`ButtonByInput`).
      const rect = normalizeRect(dst);
      this.dispatchButtonClick(button, virtualX >= rect.x + rect.w / 2 ? 1 : -1);
      return true;
    }
    if (this.options.courseMaker !== undefined && this.hitsCourseName(skin, ops, virtualX, virtualY)) {
      this.options.onCourseNameActivate?.();
      return true;
    }
    for (const text of skin.texts) {
      if (text.st !== LR2_TEXT.SEARCH_WORD) continue;
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
   * Runs a clicked `#SRC_BUTTON`: a course-maker button against the host's course maker, any other through its LR2
   * action (`resolveLr2SelectButton`): toggle a panel, step the hi-speed (`plusOnly` picks the direction), cycle or set
   * a play option (a filter or the sort reshapes the list), or play the focused bar (PLAY /
   * AUTOPLAY on a course bar start the course, as the built-in scene's PLAY / AUTO do) or show its text file. The key
   * config, skin select and replay buttons are not implemented: a click does nothing rather than the wrong thing.
   */
  private dispatchButtonClick(button: Lr2ButtonElement, direction: 1 | -1 = 1): void {
    if (this.dispatchCourseMakerButton(button.type, direction)) return;
    const action = resolveLr2SelectButton(button.type);
    if (action === undefined) return;
    switch (action.kind) {
      case 'panel':
        // Clickable without a focused song: the LR2 default skin's OPTION launcher works before any chart is selected.
        this.togglePanel(action.panel);
        return;
      case 'hi-speed':
        // Both sides step the one hi-speed.
        this.adjustHiSpeed(button.plusOnly === -1 ? -1 : 1);
        return;
      case 'cycle-option':
        this.cyclePlayOption(action.option, PLAY_OPTION_CHOICES[action.option]!);
        return;
      case 'set-difficulty-filter':
        this.setPlayOption('difficultyFilter', action.value);
        return;
      case 'play':
      case 'autoplay':
      case 'read-text':
        this.launchFromButton(action.kind);
        return;
      default:
        return;
    }
  }

  /** PLAY / AUTOPLAY / READ TEXT on the focused bar. */
  private launchFromButton(kind: 'play' | 'autoplay' | 'read-text'): void {
    if (kind !== 'read-text' && this.focusedCourse() !== undefined) {
      this.launchFocusedSong(kind === 'autoplay');
      return;
    }
    const focused = this.focusedSong();
    if (!focused) return;
    if (kind === 'play') {
      this.options.onSongSelected?.(focused);
    } else if (kind === 'read-text') {
      this.toggleReadText(focused);
    } else if (this.options.onSongAutoPlay) {
      this.options.onSongAutoPlay(focused);
    } else {
      // AUTOPLAY falls back to the regular start so the button isn't a dead end on hosts that haven't wired it.
      this.options.onSongSelected?.(focused);
    }
  }

  /**
   * Runs an LR2 course-maker button (see `resolveLr2CourseMakerAction`) against the host's {@link CourseMaker}: finish /
   * cancel the course being made, delete the selected course of the player's own, or step a NONSTOP connection.
   * Returns whether `type` is such a button.
   */
  private dispatchCourseMakerButton(type: number, direction: 1 | -1): boolean {
    const maker = this.options.courseMaker;
    const action = resolveLr2CourseMakerAction(type);
    if (maker === undefined || action === undefined) return false;
    const course = this.focusedCourse();
    const own = course?.editable === true && maker.owns(course.definition) ? course.definition : undefined;
    if (action.kind === 'finish') maker.finish();
    else if (action.kind === 'cancel') maker.cancel();
    else if (action.kind === 'default-connection') maker.stepDefaultConnection(direction);
    // LR2 asks before it deletes (`isDeletingCourse`); the host confirms and calls `CourseMaker.deleteCourse`.
    else if (own !== undefined && action.kind === 'delete') this.options.onCourseDeleteRequest?.(own);
    else if (own !== undefined && action.kind === 'connection') maker.stepConnection(own, action.slot, direction);
    this.render();
    return true;
  }

  /** Whether a click lands on the course name (text 170) while it can be edited: making a course, or on one's own. */
  private hitsCourseName(skin: Lr2Skin, ops: ReadonlySet<number>, x: number, y: number): boolean {
    if (this.options.courseMaker?.draft === undefined && this.focusedCourse()?.editable !== true) return false;
    return skin.texts.some((text) => {
      if (text.st !== LR2_TEXT.COURSE_TITLE || !this.isPanelOpen(text.panel)) return false;
      const dst = this.evaluateElementDst(text);
      return isDestinationVisible(dst, ops, this.timerActive) && containsPoint(dst, x, y);
    });
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
    if (timer === LR2_TIMER.START_INPUT) {
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
    if (timer === LR2_TIMER.SCENE_START) return true;
    if (timer === LR2_TIMER.START_INPUT) {
      const startInput = this.options.skin?.timing.startInput ?? 0;
      return performance.now() - this.sceneStartedAt >= startInput;
    }
    // Song-list timers 10..13 — active once we've recorded a start (i.e. the cursor moved at least once or scene-mount
    // seeded timer 11). The keyframe interpolator clamps past the final frame, so leaving them "active" forever is
    // fine.
    if (timer >= LR2_TIMER.SONG_BAR_MOVE && timer <= LR2_TIMER.SONG_BAR_DOWN) {
      return this.timerStartedAt.has(timer);
    }
    // Panel-open timers 21..29 — active iff that panel is currently open. LR2 spec: the timer is OFF once the panel closes, so the timer
    // implicitly stops when `togglePanel` clears the state, even if the seed timestamp is left in `timerStartedAt`.
    if (timer >= LR2_TIMER.PANEL1_OPEN && timer <= LR2_TIMER.PANEL9_OPEN) {
      const which = timer - LR2_TIMER.PANEL1_OPEN + 1;
      return this.panelStates.has(which);
    }
    // Panel-close timers 31..39 — active once seeded by `togglePanel`. The close-anim keyframes clamp at their final
    // frame, so leaving it "active" past the animation is harmless; reopening the same panel re-deletes this entry to
    // prevent a stale seed from triggering the close anim again.
    if (timer >= LR2_TIMER.PANEL1_CLOSE && timer <= LR2_TIMER.PANEL9_CLOSE) {
      return this.timerStartedAt.has(timer);
    }
    // Course-maker timers: 17 runs while a course is being made, 18 from when it was saved or cancelled.
    if (timer === LR2_TIMER.COURSE_MAKING_START || timer === LR2_TIMER.COURSE_MAKING_END) {
      return this.timerStartedAt.has(timer);
    }
    // Play timers (40+) etc. stay inactive on the select scene.
    return false;
  };

  /** Whether a course was being made at the last render, to start timer 17 / 18 as making starts and ends. */
  private makingCourse = false;

  /** Starts LR2's timer 17 when making a course begins (OpenLR2 L12151) and timer 18 when it ends (L11067, L11090). */
  private syncCourseMakerTimers(): void {
    const making = this.options.courseMaker?.draft !== undefined;
    if (making === this.makingCourse) return;
    this.makingCourse = making;
    this.applyLr2Timers(resolveLr2SelectTimers({ kind: 'course-making', making, at: performance.now() }));
  }

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

  /**
   * Renders the skin's static `#IMAGE` decorations (background, frame panels, banner area, etc.) plus the song-info
   * NUMBER / TEXT panels that depend on the currently-selected bar, from the select screen's LR2 state.
   */
  private renderSkinFrame(skin: Lr2Skin, state: Lr2SelectState): void {
    const ops = state.ops;
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
          // Song-info NUMBER panels: BPM, total notes, play level. The gameplay-only numbers (score, gauge, judges, …)
          // leave their slots blank here, as LR2 does off-stage.
          const dst = this.evaluateElementDst(entry.element);
          if (!isDestinationVisible(dst, ops, this.timerActive)) break;
          const value = state.number(entry.element.source.num);
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
          const value = state.text(entry.element.st);
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
          this.renderButtonElement(entry.element, layer, state);
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
          const value = state.slider(entry.element.type);
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
   * The cursor's place in the list for the list-position slider (`#SRC_SLIDER` type 1): the **visual** cursor index over
   * the list, lagging the discrete `selectedIndex` by the smooth-scroll offset so the knob slides in lockstep with the
   * bars (LR2 defines no slider easing — `#SRC_SLIDER` / `#DST_SLIDER` only give the rail — so the smoothing comes from
   * the runtime).
   *
   * Convention: `listScrollOffset` is positive while the bars are still at their previous slot (right after a `down`
   * press the offset is `+slotHeight` and decays toward 0), so the apparent index is `selectedIndex - listScrollOffset /
   * slotHeight`. A list of one bar or none pins to 0.
   */
  private resolveListPosition(entryCount: number): number {
    if (entryCount <= 1) return 0;
    const slotHeight = this.estimateSlotHeight();
    const visualIndex = slotHeight > 0 ? this.selectedIndex - this.listScrollOffset / slotHeight : this.selectedIndex;
    return Math.max(0, Math.min(1, visualIndex / (entryCount - 1)));
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
   * Renders a single `#SRC_BUTTON` element by cropping its cell sheet to the cell of the value it shows
   * (`Lr2SelectState.button`; 0 for a button without one), clamped to its cells.
   */
  private renderButtonElement(button: Lr2ButtonElement, target: Container, state: Lr2SelectState): void {
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
    const stateIndex = Math.max(0, Math.min(state.button(button.type) ?? 0, divx * divy - 1));
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
      const body = pickLr2BarBody(layout.bodies, entry);
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
      // BAR_LAMP: a song or course bar's best lamp from the player's records, placed relative to the bar like
      // BAR_TITLE. BAR_RANK is not drawn yet.
      if (entry !== undefined && layout.lamps.length > 0 && layout.lampDestination !== undefined) {
        this.drawBarLamp(entry, dst, layout.lamps, layout.lampDestination);
      }
    }
  }

  /**
   * Draws the `#SRC_BAR_LAMP` of a song or course bar for its best lamp (LR2 draws NO PLAY too, as its own lamp). A skin
   * without that lamp's art draws nothing; folder bars have no lamp here.
   */
  private drawBarLamp(
    entry: BrowserBrowseEntry,
    bar: Lr2DestinationRect,
    lamps: ReadonlyArray<Lr2BarLampSource>,
    lampDst: Lr2DestinationRect,
  ): void {
    if (entry.kind === 'folder') return;
    const record =
      entry.kind === 'song'
        ? this.options.resolveSongRecord?.(entry.song)
        : this.options.resolveCourseRecord?.(entry.course);
    const kind = resolveLr2BarLamp(record?.lamp);
    const lamp = lamps.find((source) => source.kind === kind);
    if (lamp === undefined) return;
    const absoluteDst: Lr2DestinationRect = { ...lampDst, x: bar.x + lampDst.x, y: bar.y + lampDst.y };
    const sprite = this.makeSlicedSprite(lamp.source, absoluteDst, `bar-lamp[${kind}]`);
    if (sprite) this.listLayer.addChild(sprite);
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
    const barLevel = resolveLr2BarLevel(song);
    if (barLevel === undefined) {
      return;
    }
    const playLevel = barLevel.level;
    const level =
      levels.find((entry) => entry.kind === barLevel.kind) ??
      levels.find((entry) => entry.kind === 'undefined') ??
      levels[0];
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
    const primaryText =
      entry.kind === 'song'
        ? entry.song.title
        : entry.kind === 'course'
          ? entry.course.definition.name
          : entry.folder.label;
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

/** The time now on the local clock, for the clock numbers (21-26). */
function lr2ClockNow(): Lr2Clock {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
  };
}

/** Whether the folder of `song`'s chart holds a text (`.txt`) file: LR2's readme (ops 174 / 175). */
function hasReadtextForSong(collection: BrowserSongCollection, song: BrowserSongEntry): boolean {
  const source = resolveSongSource(collection, song);
  if (!source) return false;
  const dir = dirname(song.chartPath).toLowerCase();
  for (const path of source.files.keys()) {
    if (!path.toLowerCase().endsWith('.txt')) continue;
    if (dirname(path).toLowerCase() === dir) return true;
  }
  return false;
}

// Re-export the slot type so consumers (tests, future helpers) can reach it without dipping into the parser module
// directly.
export type { Lr2BarBodySlot };
