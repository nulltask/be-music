/**
 * The drawing of the built-in and LR2 select scenes (`CoreSongSelectView`): the design canvas letterboxed into the
 * window, the layers a theme (the LR2 select) draws its frame into, the be-music skin that draws the frame without a
 * theme (the built-in Phantom skin unless the host picks one), and the README overlay on top.
 *
 * The view reads the scene's state and calls back into it through {@link BuiltInSelectViewContext}; the select scene
 * passes it.
 */

import { cyclePlayOptionValue, PLAY_OPTION_CHOICES } from '@be-music/scene-model';
import { resolveBeMusicSelectLayout, resolveStageOrientation, type BeMusicSelectLayout } from '@be-music/skin-sdk';
import { type Application, Color, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { resolveSongSource } from '../../collection/collection.ts';
import type {
  BrowserBrowseEntry,
  BrowserCourseEntry,
  BrowserFolderNode,
  BrowserSongEntry,
} from '../../collection/types.ts';
import { CORE_TEXT_FONT } from '../../scene/core/fonts.ts';
import type { CoreSongSelectViewOptions, PixiPlayOptions, SelectDesignSize } from '../../scene/core/select.ts';
import {
  resolveDesignTextResolution,
  resolveScaledViewport,
  setDesignPixelRatio,
  setDesignTextResolution,
} from '../../scene/core/viewport.ts';
import type { PixiSceneHost } from '../../scene/host.ts';
import { disposeChildren } from '../../scene/pixi-utils.ts';
import { BeMusicSelectBinding, resolveBeMusicSkinStage } from '../../skin/be-music/binding.ts';
import { resolveSelectListWindow } from '../../skin/be-music/registry.ts';
import { SongImageCache } from '../../skin/be-music/song-images.ts';
import type { BeMusicSelectActions, BeMusicSkin } from '../../skin/be-music/types.ts';
import { phantomSkin } from '../../skins/phantom/index.ts';
import { SelectReadTextOverlay, type SelectReadTextContext } from './select-readtext.ts';

const BG = new Color('#050912');
const TEXT = new Color('#f6f2e8');
const MUTED = new Color('#a9a39a');
/**
 * Design canvas the no-skin select scene renders into. 640×480 matches the LR2 default `select.lr2skin` (no
 * `#RESOLUTION` declared, so the loader's seed at width=640 / height=480 wins).
 *
 * Aligning the fallback design with LR2's native canvas means dropping an LR2 theme mid-session doesn't change the
 * on-screen aspect ratio (4:3 either way) — without this the no-skin path letterboxed at 16:9 and the LR2-skin path
 * pillarboxed at 4:3, causing the song list to visibly shrink when a theme loaded.
 *
 * The LR2 decide / result scenes carry the same constant for the same reason.
 */
const FALLBACK_DESIGN_WIDTH = 640;
const FALLBACK_DESIGN_HEIGHT = 480;

/** What the view reads and calls on the select scene: its fields and methods of these names. */
export interface BuiltInSelectViewContext extends SelectReadTextContext {
  /** The host's `Application`; reading it before the scene's first entry throws. */
  readonly app: Application;
  readonly host: PixiSceneHost | undefined;
  /** The canvas's parent, for the screen size before the renderer has one. */
  readonly mountedContainer: HTMLElement | undefined;
  readonly options: Readonly<
    Pick<
      CoreSongSelectViewOptions,
      'beMusicSkin' | 'beMusicEffects' | 'resolveSongRecord' | 'resolveCourseRecord' | 'onSearchActivate'
    >
  >;
  readonly themeDesignSize: SelectDesignSize | undefined;
  /** When the scene was last entered (`performance.now()`), for the skin's entrance. */
  readonly sceneStartedAt: number;
  readonly selectedIndex: number;
  readonly browseStack: readonly BrowserFolderNode[];
  readonly searchQuery: string;
  readonly searchEditing: boolean;
  readonly launchAt: number | undefined;
  readonly playOptions: PixiPlayOptions;
  renderTheme(designWidth: number, designHeight: number): void;
  currentEntries(): readonly BrowserBrowseEntry[];
  focusedSong(): BrowserSongEntry | undefined;
  focusedCourse(): BrowserCourseEntry | undefined;
  launchFocusedSong(autoPlay: boolean): void;
  toggleReadText(song: BrowserSongEntry): void;
  setSkinPlayOption<K extends keyof PixiPlayOptions>(key: K, value: PixiPlayOptions[K]): void;
}

/** The select scene's drawing. See the module comment. */
export class BuiltInSelectView {
  private readonly ctx: BuiltInSelectViewContext;

  /**
   * Top-level Container the host attaches to its `app.stage` while the select scene is active. Holds
   * `viewportBackground` + `designRoot` so the host can attach / detach the scene as one operation.
   */
  public readonly root: Container = new Container();
  private readonly designRoot = new Container();
  /**
   * Clip mask for the design rectangle (`skin.width × skin.height` or the no-skin fallback canvas). Sits as a child of
   * `designRoot` so the same `position` / `scale` transform applies to it. Pixi clips against the mask's world-space
   * bounds, so any skin element that animates from off-canvas (LR2 default's `#DST_BAR_BODY_OFF` slide-ins, etc.)
   * gets cut at the design edge instead of bleeding into the pillarbox / letterbox of a screen with a different aspect
   * ratio.
   */
  private readonly designClipMask = new Graphics();
  /**
   * Last dimensions baked into the design / viewport / mask graphics. Compared against the per-frame values so we only
   * rebuild the geometry when the canvas actually resizes (skin swap, browser resize). Pixi v8's `Graphics.clear()` +
   * `.rect()` + `.fill()` chain rebuilds the underlying GraphicsContext on every call — fine for occasional resize
   * events, but redrawing the same three rectangles every `requestAnimationFrame` tick was on the hot path of the
   * select scene's 60 fps loop.
   */
  cachedScreenWidth = -1;
  cachedScreenHeight = -1;
  private cachedDesignWidth = -1;
  private cachedDesignHeight = -1;
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  /** Theme chrome drawn behind the song list (LR2 static images, empty-state hint, …). Cleared every render. */
  readonly skinLayer: Container = new Container();
  /**
   * Theme chrome drawn on top of the song list. The LR2 scene routes elements its CSV declared AFTER the bar list
   * (`#SRC_BAR_BODY`) here — the canonical use case is the song-list scroll-position slider that lives to the right of
   * the bars. Cleared every render.
   */
  readonly skinForegroundLayer: Container = new Container();
  /** The README overlay the LR2 READTEXT button and a be-music skin open over the song list. */
  readonly readText: SelectReadTextOverlay;
  /** Song-bar slots — one sprite per visible bar plus its overlay text. */
  readonly listLayer: Container = new Container();
  /**
   * Persistent mount points for the be-music select renderer's back / front layers (skinless path only). The renderer
   * owns what's inside; the scene only toggles visibility and keeps them around `listLayer`.
   */
  readonly beMusicBackHolder: Container = new Container();
  private readonly beMusicFrontHolder = new Container();
  beMusicRenderer: BeMusicSelectBinding | undefined;
  /** Song images handed to the be-music skin (`frame.songImage`); created with the renderer. */
  songImages: SongImageCache | undefined;
  /** Set when the last skinless render reported an unfinished transition, so the next tick renders again. */
  beMusicNeedsFrame = false;
  /** `performance.now()` of the last cursor move — drives the skin's focus transitions. */
  cursorChangedAt = 0;
  private readonly title = new Text({
    text: 'Drop a BMS folder or ZIP',
    style: new TextStyle({
      fill: TEXT,
      fontSize: 28,
      fontWeight: '700',
      fontFamily: CORE_TEXT_FONT,
    }),
  });
  private readonly hint = new Text({
    text: 'Select: Arrow keys / Enter',
    style: new TextStyle({ fill: MUTED, fontSize: 14, fontFamily: CORE_TEXT_FONT }),
  });
  /**
   * Pixel offset applied to `listLayer` during a skinned bar-list scroll transition. Right after a cursor move, the
   * entry-to-slot mapping shifts instantly; we counter that by pushing `listLayer.y` so the bars appear to stay where they
   * were, then decay the offset back to 0 over a few frames to produce a smooth slide.
   *
   * Convention: positive offset = "bars look like they're still at the previous song's positions". For a `down` press
   * (selectedIndex +1) the entries move up one slot, so we add `+slotHeight` and decay to 0 — visually this looks like
   * the bars sliding up. The built-in default select screen does not use this because its background chrome also lives in
   * `listLayer`; applying the offset there makes the whole screen move instead of just changing the highlighted row.
   */
  listScrollOffset = 0;
  /**
   * `performance.now()` of the previous render frame, used to compute `dt` for the scroll-offset decay so the slide
   * speed is wall-clock consistent across refresh rates.
   */
  lastScrollUpdate = 0;
  /** The viewport of the last render, to place the search box on the page. */
  lastViewport: { x: number; y: number; scale: number } | undefined;
  /** The player's stored values for the be-music skin's settings (`beMusicSkinSettings`, then the setter). */
  beMusicSkinSettings: Readonly<Record<string, unknown>> | undefined;

  public constructor(ctx: BuiltInSelectViewContext) {
    this.ctx = ctx;
    this.readText = new SelectReadTextOverlay(ctx);
  }

  /** Builds the scene graph under {@link root}, on the scene's first entry. */
  build(): void {
    // Label every top-level node so PixiJS Devtools renders the scene graph as `select > {viewport-bg, root > {bg,
    // skin, list, title, hint}}` instead of an unlabelled tower of `Container`s.
    this.root.label = 'select/scene';
    this.designRoot.label = 'select/root';
    this.viewportBackground.label = 'select/viewport-bg';
    this.background.label = 'select/background';
    this.skinLayer.label = 'select/skin';
    this.listLayer.label = 'select/list';
    this.skinForegroundLayer.label = 'select/skin-fg';
    this.title.label = 'select/title';
    this.hint.label = 'select/hint';
    this.root.addChild(this.viewportBackground, this.designRoot);
    // Stack order (back → front): background → skinLayer (chrome behind bars) → listLayer (the song bars) →
    // skinForegroundLayer (chrome that the CSV declared AFTER bars, e.g. scroll slider) → title / hint (Drop hints,
    // fallback chrome). LR2 panels (op 1..9) live inside skinLayer / skinForegroundLayer — they're regular `#SRC_*`
    // elements gated by their `panel` field, so no separate overlay layer is needed.
    this.designClipMask.label = 'select/design-clip';
    this.beMusicBackHolder.label = 'select/be-music-back';
    this.beMusicFrontHolder.label = 'select/be-music-front';
    this.beMusicBackHolder.visible = false;
    this.beMusicFrontHolder.visible = false;
    this.designRoot.addChild(
      this.background,
      this.skinLayer,
      this.beMusicBackHolder,
      this.listLayer,
      this.beMusicFrontHolder,
      this.skinForegroundLayer,
      this.title,
      this.hint,
      this.readText.readTextLayer,
      this.designClipMask,
    );
    this.designRoot.mask = this.designClipMask;
  }

  render(): void {
    const screenWidth = this.ctx.app.screen.width || this.ctx.mountedContainer?.clientWidth || FALLBACK_DESIGN_WIDTH;
    const screenHeight =
      this.ctx.app.screen.height || this.ctx.mountedContainer?.clientHeight || FALLBACK_DESIGN_HEIGHT;
    const themeSize = this.ctx.themeDesignSize;
    const useTheme = themeSize !== undefined;
    const { width: designWidth, height: designHeight } = themeSize ?? this.beMusicDesignSize;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
    setDesignTextResolution(resolveDesignTextResolution(viewport.scale, this.ctx.app.renderer.resolution));
    setDesignPixelRatio(viewport.scale * this.ctx.app.renderer.resolution);
    // Only rebuild the static rect graphics when the dimensions they depend on actually change. The previous
    // unconditional `.clear().rect().fill()` chain ran on every rAF tick and was a measurable contributor to the select
    // scene's frame budget under LR2 default skin (~hundreds of skin elements already redraw per frame).
    if (this.cachedScreenWidth !== screenWidth || this.cachedScreenHeight !== screenHeight) {
      this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
      this.cachedScreenWidth = screenWidth;
      this.cachedScreenHeight = screenHeight;
    }
    this.designRoot.position.set(viewport.x, viewport.y);
    this.designRoot.scale.set(viewport.scale);
    this.lastViewport = viewport;
    this.ctx.host?.setStageOrientation(
      useTheme ? 'landscape' : resolveStageOrientation({ width: designWidth, height: designHeight }),
    );
    if (this.cachedDesignWidth !== designWidth || this.cachedDesignHeight !== designHeight) {
      this.designClipMask.clear().rect(0, 0, designWidth, designHeight).fill(0xffffff);
      this.background.clear().rect(0, 0, designWidth, designHeight).fill(BG);
      this.cachedDesignWidth = designWidth;
      this.cachedDesignHeight = designHeight;
    }

    // `disposeChildren` (vs bare `removeChildren`) frees the GraphicsContext / glyph-atlas state Pixi v8 keeps
    // registered for every detached node. The select scene rebuilds its skin and song-list sprites every frame, so
    // without this we'd leak renderer-side resources for as long as the player browses the song list. See
    // `pixi-utils.ts` for the full story (the same leak caused the post-chart browser hang on the gameplay scene).
    disposeChildren(this.skinLayer);
    disposeChildren(this.listLayer);
    disposeChildren(this.skinForegroundLayer);

    // Decay the smooth-scroll offset toward 0. Exponential decay with a ~80 ms time constant gives a snappy slide
    // that's substantially complete in a quarter second; rapid cursor presses compose naturally because each new step
    // adds onto the residual offset.
    const now = performance.now();
    if (this.lastScrollUpdate === 0) {
      this.lastScrollUpdate = now;
    }
    const dt = now - this.lastScrollUpdate;
    this.lastScrollUpdate = now;
    if (useTheme && this.listScrollOffset !== 0) {
      const decay = Math.exp(-dt / 80);
      this.listScrollOffset *= decay;
      if (Math.abs(this.listScrollOffset) < 0.5) {
        this.listScrollOffset = 0;
      }
    }
    this.listLayer.y = useTheme ? this.listScrollOffset : 0;

    if (useTheme) {
      this.title.visible = false;
      this.hint.visible = false;
      this.beMusicBackHolder.visible = false;
      this.beMusicFrontHolder.visible = false;
      this.ctx.renderTheme(designWidth, designHeight);
      this.readText.renderReadTextOverlay(designWidth, designHeight);
      return;
    }

    // Default-family chrome paints only live library / focused-chart data, so the legacy `this.title` / `this.hint`
    // overlays are hidden; the host-level drop overlay remains responsible for the empty-library callout.
    const entries = this.ctx.currentEntries();
    this.title.visible = false;
    this.hint.visible = false;
    const renderer = this.ensureBeMusicRenderer();
    const selectWindow = resolveSelectListWindow(
      this.beMusicSelectLayout,
      designHeight,
      this.ctx.selectedIndex,
      entries.length,
    );
    const currentFolder = this.ctx.browseStack[this.ctx.browseStack.length - 1];
    this.beMusicBackHolder.visible = true;
    this.beMusicFrontHolder.visible = true;
    renderer.render({
      designWidth,
      designHeight,
      nowMs: performance.now(),
      sceneStartedAt: this.ctx.sceneStartedAt,
      cursorChangedAt: this.cursorChangedAt,
      entries,
      selectedIndex: this.ctx.selectedIndex,
      firstVisibleIndex: selectWindow.firstVisibleIndex,
      visibleRows: selectWindow.visibleRows,
      focusedSong: this.ctx.focusedSong(),
      focusedCourse: this.ctx.focusedCourse(),
      folderLabel: currentFolder?.label,
      searchQuery: this.ctx.searchQuery,
      searchEditing: this.ctx.searchEditing,
      totalCharts: this.ctx.collection.songs.length,
      actions: this.beMusicActions,
      effects: this.ctx.options.beMusicEffects ?? 'full',
      launchAt: this.ctx.launchAt,
      playOptions: this.ctx.playOptions,
      playOptionChoices: PLAY_OPTION_CHOICES,
    });
    // The binding draws the skin every frame in `tick`; nothing needs a re-render here.
    this.beMusicNeedsFrame = this.ctx.launchAt !== undefined;
    this.readText.renderReadTextOverlay(designWidth, designHeight);
  }

  /** Active be-music skin for the skinless path — the built-in Phantom skin unless the host picked one. */
  private get beMusicSkin(): BeMusicSkin {
    return this.ctx.options.beMusicSkin ?? phantomSkin;
  }

  private ensureBeMusicRenderer(): BeMusicSelectBinding {
    if (!this.beMusicRenderer) {
      const songImages = new SongImageCache({
        resolveSource: (song) => resolveSongSource(this.ctx.collection, song),
        onLoaded: () => this.beMusicRenderer?.invalidate(),
      });
      this.songImages = songImages;
      this.beMusicRenderer = new BeMusicSelectBinding(this.beMusicSkin, {
        resolveSongRecord: this.ctx.options.resolveSongRecord,
        resolveCourseRecord: this.ctx.options.resolveCourseRecord,
        songImage: songImages.lookup,
        settings: this.beMusicSkinSettings,
        renderer: this.ctx.host?.app.renderer,
      });
      this.beMusicBackHolder.addChild(this.beMusicRenderer.backLayer);
      this.beMusicFrontHolder.addChild(this.beMusicRenderer.frontLayer);
    }
    return this.beMusicRenderer;
  }

  /** PLAY / AUTO PLAY / search / play-option / readme callbacks handed to the skin's hit areas. */
  private readonly beMusicActions: BeMusicSelectActions = {
    play: (): void => this.ctx.launchFocusedSong(false),
    autoPlay: (): void => this.ctx.launchFocusedSong(true),
    activateSearch: (): void => this.ctx.options.onSearchActivate?.(),
    setPlayOption: (key, value): void => this.ctx.setSkinPlayOption(key, value),
    cyclePlayOption: (key, step = 1): void => {
      const next = cyclePlayOptionValue(key, this.ctx.playOptions[key], step);
      if (next !== undefined) this.ctx.setSkinPlayOption(key, next);
    },
    toggleReadme: (): void => {
      const song = this.ctx.focusedSong();
      if (song) this.ctx.toggleReadText(song);
    },
  };

  /** Design canvas for the current frame: the active theme's, or the be-music skin's stage. */
  resolveDesignSize(): SelectDesignSize {
    return this.ctx.themeDesignSize ?? this.beMusicDesignSize;
  }

  /**
   * The be-music skin's stage for the current screen: its portrait stage while the screen is upright and the skin has
   * one, its landscape stage otherwise.
   */
  get beMusicDesignSize(): SelectDesignSize {
    const screen = this.ctx.host?.app.screen;
    const stage = resolveBeMusicSkinStage(
      this.beMusicSkin,
      screen && screen.width > 0 && screen.height > 0 ? screen : undefined,
    );
    return { width: stage.width, height: stage.height };
  }

  /** Where the skin's song list sits on the current stage. */
  get beMusicSelectLayout(): BeMusicSelectLayout {
    return resolveBeMusicSelectLayout(this.beMusicSkin.select, this.beMusicDesignSize);
  }
}
