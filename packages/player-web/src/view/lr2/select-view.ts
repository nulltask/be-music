/**
 * The LR2 family's select view: an LR2 select skin's `#SRC_*` / `#DST_*` frame, its bar list (`#SRC_BAR_BODY` slots
 * around `#BAR_CENTER`), buttons, panels, sliders, numbers, texts and mouse cursor, over the select session's frames.
 * The skin's ops, numbers, texts, button cells and sliders come from `resolveLr2SelectState`, its buttons' actions from
 * `resolveLr2SelectButton` / `resolveLr2CourseMakerAction`, and its timers from `resolveLr2SelectTimers`, started by
 * what the frames report (the screen's entry, cursor moves, option panels, the course being made). The LR2 ids stay in
 * this view: the session sees intents.
 */

import { resolveBeMusicSelectLayout, type BeMusicSelectLayout } from '@be-music/skin-sdk';
import { Color, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import type {
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
  type Lr2TimerUpdate,
} from '@be-music/lr2-skin/state';
import type { BrowserBrowseEntry, BrowserSongCollection, BrowserSongEntry } from '../../collection/types.ts';
import { COURSE_NAME_PROMPT } from '../../collection/course-maker.ts';
import { hasReadtextForSong } from '../../collection/readtext.ts';
import { resolveChartBpmRange } from '../../chart/bpm-range.ts';
import type { Lr2Kit } from '../../host/family-kit.ts';
import { logger } from '../../logger.ts';
import { LR2_TEXT_FALLBACK_FONT } from '../../scene/lr2/fonts.ts';
import {
  designRectToCanvas,
  resolveDesignTextResolution,
  resolveScaledViewport,
  setDesignPixelRatio,
  setDesignTextResolution,
  type ScaledViewport,
} from '../../scene/core/viewport.ts';
import type { PixiSceneHost } from '../../scene/host.ts';
import { PerfTracker } from '../../scene/perf.ts';
import { disposeChildren } from '../../scene/pixi-utils.ts';
import type { Lr2LoadedFont } from '../../skin/lr2/bitmap-text.ts';
import { resolveBeMusicSkinStage } from '../../skin/be-music/binding.ts';
import { loadSkinBitmapFonts } from '../../skin/lr2/font-loader.ts';
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
import { clampFontSize, isDestinationVisible, makeLr2TextSprite } from '../../skin/lr2/scene-render.ts';
import {
  collectSelectSkinTexturePaths,
  Lr2ChartGraphicTextureStore,
  Lr2SkinTextureStore,
  resolveSolidSpecialGraphicTexture,
} from '../../skin/lr2/scene-textures.ts';
import { phantomSkin } from '../../skins/phantom/index.ts';
import { renderEmptyStateHint } from '../built-in/select-empty-hint.ts';
import { SelectReadTextOverlay } from '../built-in/select-readtext.ts';
import { SelectPointer, type SelectDesignSize, type SelectPointerContext } from '../shared/select-pointer.ts';
import type { IntentSink, SelectFrame, SelectIntent, SelectView } from '../types.ts';

const log = logger('select');

const BG = new Color('#050912');
const TEXT = new Color('#f6f2e8');

/**
 * One entry of the skin's chrome, in its declaration order across kinds (`#SRC_IMAGE`, `#SRC_NUMBER`, `#SRC_TEXT`,
 * `#SRC_BUTTON`, `#SRC_ONMOUSE`, `#SRC_SLIDER`): LR2 paints a later declaration on top. `layerIsForeground` caches
 * whether it was declared after the bar list.
 */
type SortedSelectChromeEntry =
  | { kind: 'image'; order: number; layerIsForeground: boolean; element: Lr2ImageElement }
  | { kind: 'number'; order: number; layerIsForeground: boolean; element: Lr2NumberElement }
  | { kind: 'text'; order: number; layerIsForeground: boolean; element: Lr2TextElement }
  | { kind: 'button'; order: number; layerIsForeground: boolean; element: Lr2ButtonElement }
  | { kind: 'onMouse'; order: number; layerIsForeground: boolean; element: Lr2OnMouseElement }
  | { kind: 'slider'; order: number; layerIsForeground: boolean; element: Lr2SliderElement };

const NO_ENTRIES: readonly BrowserBrowseEntry[] = [];
const EMPTY_LIBRARY: BrowserSongCollection = { sources: [], songs: [], errors: [] };

/** The LR2 select view. See the module comment. */
export class Lr2SelectView implements SelectView {
  public readonly family = 'lr2' as const;
  /** An LR2 skin has no launch outro: a started chart is handed on at once. */
  public readonly launchOutroMs = 0;
  /** The viewport background and the letterboxed design canvas. */
  public readonly root: Container = new Container();
  private readonly designRoot = new Container();
  /** Clips the design canvas, so an element sliding in from off-canvas (`#DST_BAR_BODY_OFF`) is cut at its edge. */
  private readonly designClipMask = new Graphics();
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  /** The skin's chrome declared before the bar list. Cleared every frame. */
  private readonly skinLayer: Container = new Container();
  /** The bar list. Slides by {@link listScrollOffset} after a cursor move. */
  private readonly listLayer: Container = new Container();
  /** The skin's chrome declared after the bar list (e.g. the list's scroll slider), on top of it. */
  private readonly skinForegroundLayer: Container = new Container();
  private readonly readText: SelectReadTextOverlay = new SelectReadTextOverlay();
  private readonly pointer: SelectPointer;
  /** Per-frame timing, logged every second with `?perf` or `globalThis.__BE_MUSIC_PERF__ = true`. */
  private readonly perf: PerfTracker = new PerfTracker('select');
  private kit: Lr2Kit;
  private host: PixiSceneHost | undefined;
  private emit: IntentSink<SelectIntent> | undefined;
  private attached = false;
  private built = false;
  private disposed = false;
  /** The last frame drawn: what the hit tests and the pointer read between frames. */
  private frame: SelectFrame | undefined;
  /** The frame clock now, while a frame draws. */
  private nowMs = 0;
  /** When the screen was entered, on the frame clock: timer 0 counts from it and timer 1 after `#STARTINPUT`. */
  private enteredAtMs = Number.NaN;
  /**
   * When each LR2 timer the screen drives last started, on the frame clock: 0 at the entry, 10-13 on cursor moves,
   * 21-29 / 31-39 as the option panels open and close, 17 / 18 as a course starts and stops being made. A missing one
   * has not started (elapsed 0, inactive); starting one again replays the keyframes anchored to it.
   */
  private readonly timerStartedAt = new Map<number, number>();
  /** Whether a course was being made at the last frame, to start timer 17 / 18 as making starts and ends. */
  private makingCourse = false;
  /**
   * The bar list's slide after a cursor move, in design pixels: the bars stay where they were (`+slot` for a step
   * down) and ease back to their places over a few frames.
   */
  private listScrollOffset = 0;
  private lastScrollUpdate = 0;
  private cachedScreenWidth = -1;
  private cachedScreenHeight = -1;
  private cachedDesignWidth = -1;
  private cachedDesignHeight = -1;
  /** The viewport of the last frame, to place the search box on the page. */
  private lastViewport: ScaledViewport | undefined;
  /** The pointer in design pixels, `-1` while it is off the canvas (`#SRC_ONMOUSE`, `#SRC_MOUSECURSOR`). */
  private mouseX = -1;
  private mouseY = -1;
  /** The skin's chrome in declaration order, built once per skin ({@link ensureSortedChromeEntries}). */
  private sortedChromeEntries: SortedSelectChromeEntry[] = [];
  private sortedChromeSkinRef: Lr2Skin | undefined;
  /** The skin's images, loaded on the first attach; a frame skips what is still loading. */
  private readonly skinTextures = new Lr2SkinTextureStore();
  /** The skin's `#LR2FONT` fonts by index, once loaded; text draws with a system font until then. */
  private bitmapFonts: Map<number, Lr2LoadedFont> = new Map();
  /** The focused chart's STAGEFILE / BACKBMP / BANNER (`#SRC_IMAGE` gr 100-102), by chart. */
  private readonly chartGraphicTextures = new Lr2ChartGraphicTextureStore();

  public constructor(kit: Lr2Kit) {
    this.kit = kit;
    this.pointer = new SelectPointer(Lr2SelectView.createPointerContext(this));
  }

  /** Takes another LR2 select skin: its images and fonts load again, and the next frame draws with it. */
  public updateKit(kit: Lr2Kit): void {
    if (kit.skin === this.kit.skin) return;
    this.kit = kit;
    this.skinTextures.clear();
    this.bitmapFonts = new Map();
    this.sortedChromeSkinRef = undefined;
    this.sortedChromeEntries = [];
    if (this.built) this.loadSkin(kit.skin);
  }

  public attach(host: PixiSceneHost, emit: IntentSink<SelectIntent>): void {
    if (this.disposed) return;
    this.host = host;
    this.emit = emit;
    if (!this.built) {
      this.build();
      this.loadSkin(this.kit.skin);
    }
    const canvas = host.app.canvas;
    canvas.addEventListener('pointerdown', this.pointer.handlePointerDown);
    canvas.addEventListener('pointermove', this.pointer.handlePointerMove);
    canvas.addEventListener('pointerleave', this.pointer.handlePointerLeave);
    canvas.addEventListener('pointerup', this.pointer.handlePointerUp);
    canvas.addEventListener('pointercancel', this.pointer.handlePointerCancel);
    // `passive: false`, so a wheel over the list does not also scroll the page under it.
    canvas.addEventListener('wheel', this.pointer.handleWheel, { passive: false });
    // Left over from before the screen last left: a slide that would decay over minutes, a wheel throttle.
    this.listScrollOffset = 0;
    this.lastScrollUpdate = 0;
    this.pointer.lastWheelMoveAt = Number.NEGATIVE_INFINITY;
    this.attached = true;
  }

  public detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.pointer.fling = undefined;
    const canvas = this.host?.app.canvas;
    if (canvas !== undefined) {
      canvas.removeEventListener('pointerdown', this.pointer.handlePointerDown);
      canvas.removeEventListener('pointermove', this.pointer.handlePointerMove);
      canvas.removeEventListener('pointerleave', this.pointer.handlePointerLeave);
      canvas.removeEventListener('pointerup', this.pointer.handlePointerUp);
      canvas.removeEventListener('pointercancel', this.pointer.handlePointerCancel);
      canvas.removeEventListener('wheel', this.pointer.handleWheel);
    }
    this.emit = undefined;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.detach();
    this.disposed = true;
    this.root.parent?.removeChild(this.root);
    try {
      this.skinTextures.dispose();
      this.chartGraphicTextures.dispose();
    } catch (error) {
      log.warn('texture cleanup threw', error);
    }
    try {
      this.root.destroy({ children: true, context: true });
    } catch (error) {
      log.warn('root.destroy threw', error);
    }
    this.host = undefined;
  }

  public draw(frame: SelectFrame): void {
    if (this.disposed || this.host === undefined) return;
    this.frame = frame;
    this.nowMs = frame.clock.nowMs;
    if (frame.clock.enteredAtMs !== this.enteredAtMs) this.startScene(frame.clock.enteredAtMs);
    for (const event of frame.events) {
      if (event.kind === 'browse') {
        const { event: browse } = event;
        // A cursor move slides the list by its step; a folder opened slides it one bar down, one closed one bar up.
        const delta =
          browse.kind === 'cursor'
            ? browse.delta
            : browse.kind === 'folder-opened'
              ? 1
              : browse.kind === 'folder-closed'
                ? -1
                : 0;
        if (delta !== 0) this.noteCursorChange(delta, event.atMs);
      } else if (event.kind === 'panel') {
        this.applyLr2Timers(
          resolveLr2SelectTimers({ kind: 'panel', panel: event.panel, open: event.open, at: event.atMs }),
        );
      } else {
        this.readText.scrollBy(event.delta);
      }
    }
    this.readText.show(frame.readText);
    this.perf.beginTick();
    this.pointer.advanceFling(this.nowMs);
    this.pointer.settleListPull(this.nowMs);
    this.perf.time('render', () => this.render(frame));
    const report = this.perf.endFrame(() => ({
      skin: this.skinLayer.children.length,
      list: this.listLayer.children.length,
      songs: frame.library.songs.length,
    }));
    if (report) log.debug('perf', report);
  }

  /** The skin's search box on the canvas, in CSS pixels, or `undefined` when it has none (or nothing is drawn yet). */
  public searchFieldRect(): { x: number; y: number; width: number; height: number } | undefined {
    const rect = this.designSearchFieldRect();
    const viewport = this.lastViewport;
    if (rect === undefined || viewport === undefined) return undefined;
    return designRectToCanvas(rect, viewport);
  }

  /** The skin's design canvas and its size, for screenshots. */
  public getStageInfo(): { container: Container; width: number; height: number } {
    return { container: this.designRoot, width: this.kit.skin.width, height: this.kit.skin.height };
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The frame
  // ---------------------------------------------------------------------------------------------------------------------

  private get entries(): readonly BrowserBrowseEntry[] {
    return this.frame?.entries ?? NO_ENTRIES;
  }

  private get cursor(): number {
    return this.frame?.cursor ?? 0;
  }

  private get library(): BrowserSongCollection {
    return this.frame?.library ?? EMPTY_LIBRARY;
  }

  private focusedSong(): BrowserSongEntry | undefined {
    const entry = this.entries[this.cursor];
    return entry?.kind === 'song' ? entry.song : undefined;
  }

  private focusedCourse(): Extract<BrowserBrowseEntry, { kind: 'course' }>['course'] | undefined {
    const entry = this.entries[this.cursor];
    return entry?.kind === 'course' ? entry.course : undefined;
  }

  /**
   * Whether an element gated on `panel` draws, as LR2 gates them: `0` always, `-1` while no option panel is open, `1`-`9`
   * while that one is. An arrow, so it can be handed to the free helpers.
   */
  private readonly isPanelOpen = (panel: number): boolean => {
    if (panel === 0) return true;
    const open = this.frame?.panel;
    return panel === -1 ? open === undefined : open === panel;
  };

  /** Builds the scene graph under {@link root}, on the first attach. */
  private build(): void {
    this.built = true;
    this.root.label = 'select/scene';
    this.designRoot.label = 'select/root';
    this.viewportBackground.label = 'select/viewport-bg';
    this.background.label = 'select/background';
    this.skinLayer.label = 'select/skin';
    this.listLayer.label = 'select/list';
    this.skinForegroundLayer.label = 'select/skin-fg';
    this.designClipMask.label = 'select/design-clip';
    this.root.addChild(this.viewportBackground, this.designRoot);
    // Back to front: the background, the chrome declared before the bars, the bars, the chrome declared after them,
    // the README overlay. An LR2 option panel is chrome gated by its `panel` field, not a layer of its own.
    this.designRoot.addChild(
      this.background,
      this.skinLayer,
      this.listLayer,
      this.skinForegroundLayer,
      this.readText.layer,
      this.designClipMask,
    );
    this.designRoot.mask = this.designClipMask;
  }

  /** Lays the design canvas into the screen and draws the skin's frame over the session's frame. */
  private render(frame: SelectFrame): void {
    const host = this.host!;
    const app = host.app;
    const skin = this.kit.skin;
    const screenWidth = app.screen.width || app.canvas.parentElement?.clientWidth || skin.width;
    const screenHeight = app.screen.height || app.canvas.parentElement?.clientHeight || skin.height;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, skin.width, skin.height);
    setDesignTextResolution(resolveDesignTextResolution(viewport.scale, app.renderer.resolution));
    setDesignPixelRatio(viewport.scale * app.renderer.resolution);
    // The rects are drawn again only when their sizes change: a `Graphics` rebuild every frame is not free.
    if (this.cachedScreenWidth !== screenWidth || this.cachedScreenHeight !== screenHeight) {
      this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
      this.cachedScreenWidth = screenWidth;
      this.cachedScreenHeight = screenHeight;
    }
    this.designRoot.position.set(viewport.x, viewport.y);
    this.designRoot.scale.set(viewport.scale);
    this.lastViewport = viewport;
    host.setStageOrientation('landscape');
    if (this.cachedDesignWidth !== skin.width || this.cachedDesignHeight !== skin.height) {
      this.designClipMask.clear().rect(0, 0, skin.width, skin.height).fill(0xffffff);
      this.background.clear().rect(0, 0, skin.width, skin.height).fill(BG);
      this.cachedDesignWidth = skin.width;
      this.cachedDesignHeight = skin.height;
    }
    // The skin's sprites are built anew every frame; `disposeChildren` frees what Pixi keeps for the old ones.
    disposeChildren(this.skinLayer);
    disposeChildren(this.listLayer);
    disposeChildren(this.skinForegroundLayer);
    // The slide eases back with a time constant of about 80 ms, frame-rate independent; steps in quick succession add
    // onto what is left of it.
    if (this.lastScrollUpdate === 0) this.lastScrollUpdate = this.nowMs;
    const dt = this.nowMs - this.lastScrollUpdate;
    this.lastScrollUpdate = this.nowMs;
    if (this.listScrollOffset !== 0) {
      this.listScrollOffset *= Math.exp(-dt / 80);
      if (Math.abs(this.listScrollOffset) < 0.5) this.listScrollOffset = 0;
    }
    this.listLayer.y = this.listScrollOffset;
    this.syncCourseMakerTimers(frame);
    // The state is resolved once per frame for every element: its ops reflect the focused chart's features (long
    // notes, BPM changes, BACKBMP, …) onto the frame's static elements, which LR2 skins gate with ops 70-195.
    const state = this.perf.time('computeOps', () => this.computeState(skin, frame));
    this.perf.time('renderSkinFrame', () => this.renderSkinFrame(skin, state));
    this.perf.time('renderSkinBars', () => this.renderSkinBars(skin, state.ops));
    // With nothing loaded, a hint over the skin says what to drop.
    if (frame.library.songs.length === 0) {
      renderEmptyStateHint({ skinLayer: this.skinLayer, collection: frame.library }, skin.width, skin.height);
    }
    this.readText.render(skin.width, skin.height);
  }

  /**
   * The LR2 state of the select screen for the bar under the cursor (`resolveLr2SelectState`): its ops, numbers, texts,
   * button cells and sliders. A course bar lights the course-bar op (3), the playable op (5) when every stage is in the
   * library, its best lamp (100-105), its stages' difficulties (700-745) and the course ops (290 and its kind's op).
   */
  private computeState(skin: Lr2Skin, frame: SelectFrame): Lr2SelectState {
    const focused = frame.entries[frame.cursor];
    const song = focused?.kind === 'song' ? focused.song : undefined;
    const maker = frame.courseMaker;
    return resolveLr2SelectState({
      ...(focused !== undefined ? { focused } : {}),
      options: frame.playOptions,
      record:
        focused?.kind === 'song'
          ? { lamp: frame.records.chart(focused.song)?.lamp }
          : focused?.kind === 'course'
            ? { lamp: frame.records.course(focused.course)?.lamp }
            : {},
      openPanels: frame.panel !== undefined ? [frame.panel] : [],
      customOps: skin.customOptions.map((option) => option.defaultOp),
      readme: song !== undefined && hasReadtextForSong(frame.library, song),
      ...(song !== undefined ? { bpmRange: resolveChartBpmRange(song.chart) } : {}),
      // The search word is the typed query, left to the host's field while the player types in it.
      searchText: frame.searchEditing ? '' : frame.browse.searchText,
      listPosition: this.resolveListPosition(frame.entries.length),
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
      // The view samples no frame rate of its own; 60 rather than a blank panel.
      fps: 60,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Timers
  // ---------------------------------------------------------------------------------------------------------------------

  /** Starts and stops the LR2 timers a moment of the screen changes (`resolveLr2SelectTimers`). */
  private applyLr2Timers(update: Lr2TimerUpdate): void {
    for (const timer of update.stop) this.timerStartedAt.delete(timer);
    for (const [timer, at] of update.start) this.timerStartedAt.set(timer, at);
  }

  /**
   * The screen was entered at `atMs`: every timer starts again from there, so the skin's entrance (keyframes on timer 0)
   * and the bar slide-in (timer 11) play on every entry, as each LR2 scene change restarts them.
   */
  private startScene(atMs: number): void {
    this.enteredAtMs = atMs;
    this.timerStartedAt.clear();
    this.applyLr2Timers(resolveLr2SelectTimers({ kind: 'scene-start', at: atMs }));
    this.listScrollOffset = 0;
    this.lastScrollUpdate = 0;
  }

  /**
   * The cursor moved `delta` bars at `atMs`: the list timers (10, 11 and 12 / 13 by direction) start again, so the
   * keyframes anchored to them replay, and the bars slide from where they were.
   */
  private noteCursorChange(delta: number, atMs: number): void {
    this.applyLr2Timers(resolveLr2SelectTimers({ kind: 'cursor', delta, at: atMs }));
    this.listScrollOffset += delta * this.estimateSlotHeight();
  }

  /** Starts LR2's timer 17 when making a course begins (OpenLR2 L12151) and timer 18 when it ends (L11067, L11090). */
  private syncCourseMakerTimers(frame: SelectFrame): void {
    const making = frame.courseMaker?.draft !== undefined;
    if (making === this.makingCourse) return;
    this.makingCourse = making;
    this.applyLr2Timers(resolveLr2SelectTimers({ kind: 'course-making', making, at: this.nowMs }));
  }

  /**
   * The DST of an element at this moment: its keyframes interpolated by the time since their timer started, or its
   * one destination.
   */
  private evaluateElementDst(element: {
    destination: Lr2DestinationRect;
    keyframes: Lr2DestinationRect[];
  }): Lr2DestinationRect {
    return evaluateElementDestination(element, (timer) => this.elapsedSinceTimer(timer));
  }

  /** How long ago `timer` started, in ms, or 0 when it has not; timer 1 starts `#STARTINPUT` after the entry. */
  private elapsedSinceTimer(timer: number): number {
    if (timer === LR2_TIMER.START_INPUT) {
      return Math.max(0, this.nowMs - (this.enteredAtMs + (this.kit.skin.timing.startInput ?? 0)));
    }
    const startedAt = this.timerStartedAt.get(timer);
    return startedAt === undefined ? 0 : Math.max(0, this.nowMs - startedAt);
  }

  /**
   * Whether `timer` runs, so the elements anchored to it draw (`isDestinationVisible`): timer 0 always, timer 1 after
   * `#STARTINPUT`, the list timers (10-13) once started, a panel's open timer (21-29) while it is open, its close timer
   * (31-39) once started, and the course-maker timers (17 / 18) once started. The play timers never run here. An
   * arrow, so it can be handed to the free helpers.
   */
  private readonly timerActive = (timer: number): boolean => {
    if (timer === LR2_TIMER.SCENE_START) return true;
    if (timer === LR2_TIMER.START_INPUT) return this.nowMs - this.enteredAtMs >= (this.kit.skin.timing.startInput ?? 0);
    if (timer >= LR2_TIMER.SONG_BAR_MOVE && timer <= LR2_TIMER.SONG_BAR_DOWN) return this.timerStartedAt.has(timer);
    if (timer >= LR2_TIMER.PANEL1_OPEN && timer <= LR2_TIMER.PANEL9_OPEN) {
      return this.frame?.panel === timer - LR2_TIMER.PANEL1_OPEN + 1;
    }
    if (timer >= LR2_TIMER.PANEL1_CLOSE && timer <= LR2_TIMER.PANEL9_CLOSE) return this.timerStartedAt.has(timer);
    if (timer === LR2_TIMER.COURSE_MAKING_START || timer === LR2_TIMER.COURSE_MAKING_END) {
      return this.timerStartedAt.has(timer);
    }
    return false;
  };

  // ---------------------------------------------------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------------------------------------------------

  /** Loads the skin's images and fonts; frames draw what has loaded. */
  private loadSkin(skin: Lr2Skin): void {
    void this.skinTextures
      .preload(skin, collectSelectSkinTexturePaths(skin), () => !this.disposed && this.kit.skin === skin)
      .catch((error: unknown) => log.warn('skin textures failed to load', error));
    if (skin.lr2FontPaths.length === 0) return;
    void loadSkinBitmapFonts(skin.lr2FontPaths, skin.files)
      .then((fonts) => {
        if (!this.disposed && this.kit.skin === skin) this.bitmapFonts = fonts;
      })
      .catch((error: unknown) => log.warn('skin fonts failed to load', error));
  }

  /**
   * The vertical pitch between bar slots, for a one-bar slide: the median gap between adjacent slots, as the LR2
   * default skins put the center slot at a different gap from the evenly spaced others.
   */
  private estimateSlotHeight(): number {
    const ys: number[] = [];
    for (const slot of this.kit.skin.barLayout.slots) {
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

  // ---------------------------------------------------------------------------------------------------------------------
  // Pointer
  // ---------------------------------------------------------------------------------------------------------------------

  /**
   * The search box of the skin: the visible `#SRC_TEXT st=30`, where its text is drawn. Its DST often hugs the text and
   * collapses when empty, so a narrow one is widened (to the LR2 default theme's box on that theme). The default theme's
   * box stands in when no such text is visible.
   */
  private designSearchFieldRect(): { x: number; y: number; width: number; height: number } | undefined {
    const skin = this.kit.skin;
    const frame = this.frame;
    if (frame === undefined) return undefined;
    const ops = this.computeState(skin, frame).ops;
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

  /**
   * A click at design point (`x`, `y`): the skin's buttons and search box first (on the LR2 default skin they sit next
   * to the bars), then the bars. A click on a bar moves the cursor onto it and takes it at once, opening its folder or
   * starting it; the keyboard keeps LR2's two steps (land on the bar, then decide).
   */
  private handlePointerDown(x: number, y: number): void {
    const skin = this.kit.skin;
    if (this.frame === undefined || this.handleSkinHitTest(skin, x, y)) return;
    const layout = skin.barLayout;
    const center = clampSlot(layout.center, layout.slots.length);
    const available = layout.available > 0 ? layout.available : layout.slots.length;
    for (const slot of layout.slots.slice(0, available)) {
      const dst = slot.off ?? slot.on;
      if (!dst || !containsPoint(dst, x, y)) continue;
      const offset = slot.index - center;
      const target = wrapIndex(this.cursor + offset, this.entries.length);
      if (target === undefined) return;
      if (target !== this.cursor) this.emit?.({ type: 'browse', command: { type: 'move', delta: offset } });
      this.emit?.({ type: 'activate' });
      return;
    }
  }

  /**
   * Hit-tests the skin's interactive elements at the click: a `#SRC_BUTTON` (`click = 1`) runs its action, the course
   * name (text 170) asks to name the course, the search word (text 30) or the LR2 default theme's search box asks to
   * type a search. Elements count only where they draw (their panel open, their DST visible, interpolated so a click
   * during a slide-in hits what the player sees). Returns whether the click was taken.
   */
  private handleSkinHitTest(skin: Lr2Skin, x: number, y: number): boolean {
    const ops = this.computeState(skin, this.frame!).ops;
    for (const button of skin.buttons) {
      if (button.click !== 1 || !this.isPanelOpen(button.panel)) continue;
      const dst = this.evaluateElementDst(button);
      if (!isDestinationVisible(dst, ops, this.timerActive) || !containsPoint(dst, x, y)) continue;
      // LR2's value buttons step up on their right half and down on their left half (`ButtonByInput`).
      const rect = normalizeRect(dst);
      this.dispatchButtonClick(button, x >= rect.x + rect.w / 2 ? 1 : -1);
      return true;
    }
    if (this.frame?.courseMaker !== undefined && this.hitsCourseName(skin, ops, x, y)) {
      this.emit?.({ type: 'course-maker', action: { kind: 'name' } });
      return true;
    }
    for (const text of skin.texts) {
      // Any `st = 30` text, not only an `edit = 1` one: the LR2 default theme draws its search box as an image with a
      // plain search-word text on it. A stray click on a search readout only opens the host's field.
      if (text.st !== LR2_TEXT.SEARCH_WORD || !this.isPanelOpen(text.panel)) continue;
      const dst = this.evaluateElementDst(text);
      if (!isDestinationVisible(dst, ops, this.timerActive) || !containsPoint(dst, x, y)) continue;
      this.emit?.({ type: 'search' });
      return true;
    }
    if (isInsideLr2DefaultSearchBox({ width: skin.width, height: skin.height, x, y })) {
      this.emit?.({ type: 'search' });
      return true;
    }
    return false;
  }

  /**
   * Runs a clicked `#SRC_BUTTON` as an intent: a course-maker button (`resolveLr2CourseMakerAction`), or its LR2 action
   * (`resolveLr2SelectButton`): toggle a panel, step the hi-speed (`plusOnly` picks the direction), step or set a play
   * option, play the focused bar (PLAY / AUTOPLAY on a course bar start the course) or show its text file. The key
   * config, skin select and replay buttons are not implemented: a click does nothing rather than the wrong thing.
   */
  private dispatchButtonClick(button: Lr2ButtonElement, direction: 1 | -1): void {
    const emit = (intent: SelectIntent): void => this.emit?.(intent);
    const maker = resolveLr2CourseMakerAction(button.type);
    if (maker !== undefined && this.frame?.courseMaker !== undefined) {
      if (maker.kind === 'connection') emit({ type: 'course-maker', action: { ...maker, step: direction } });
      else if (maker.kind === 'default-connection')
        emit({ type: 'course-maker', action: { ...maker, step: direction } });
      else emit({ type: 'course-maker', action: maker });
      return;
    }
    const action = resolveLr2SelectButton(button.type);
    if (action === undefined) return;
    switch (action.kind) {
      case 'panel':
        // Clickable without a focused chart: the LR2 default skin's OPTION launcher works before any is selected.
        emit({ type: 'panel', panel: action.panel });
        return;
      case 'hi-speed':
        // Both sides step the one hi-speed.
        emit({ type: 'play-option', key: 'hiSpeed', step: button.plusOnly === -1 ? -1 : 1 });
        return;
      case 'cycle-option':
        emit({ type: 'play-option', key: action.option, step: 1 });
        return;
      case 'set-difficulty-filter':
        emit({ type: 'set-play-option', key: 'difficultyFilter', value: action.value });
        return;
      case 'play':
        emit({ type: 'start', autoPlay: false });
        return;
      case 'autoplay':
        emit({ type: 'start', autoPlay: true });
        return;
      case 'read-text':
        emit({ type: 'readtext' });
        return;
      default:
        return;
    }
  }

  /** Whether a click lands on the course name (text 170) while it can be edited: making a course, or on one's own. */
  private hitsCourseName(skin: Lr2Skin, ops: ReadonlySet<number>, x: number, y: number): boolean {
    if (this.frame?.courseMaker?.draft === undefined && this.focusedCourse()?.editable !== true) return false;
    return skin.texts.some((text) => {
      if (text.st !== LR2_TEXT.COURSE_TITLE || !this.isPanelOpen(text.panel)) return false;
      const dst = this.evaluateElementDst(text);
      return isDestinationVisible(dst, ops, this.timerActive) && containsPoint(dst, x, y);
    });
  }

  /** What the pointer input reads and drives: the last frame, the skin's canvas, and intents for what is asked. */
  private static createPointerContext(view: Lr2SelectView): SelectPointerContext {
    const emit = (intent: SelectIntent): void => view.emit?.(intent);
    const size = (): SelectDesignSize => ({ width: view.kit.skin.width, height: view.kit.skin.height });
    return {
      get visible(): boolean {
        return view.attached;
      },
      get launchAt(): number | undefined {
        return view.frame?.startedAtMs;
      },
      get screen() {
        return view.host!.app.screen;
      },
      get themeDesignSize(): SelectDesignSize {
        return size();
      },
      get beMusicDesignSize(): SelectDesignSize {
        return size();
      },
      // A list pulled part of a row settles by the built-in skin's list window, as the LR2 select always did; the
      // skin's slots place the bars.
      get beMusicSelectLayout(): BeMusicSelectLayout {
        const screen = view.host?.app.screen;
        const stage = resolveBeMusicSkinStage(
          phantomSkin,
          screen !== undefined && screen.width > 0 && screen.height > 0 ? screen : undefined,
        );
        return resolveBeMusicSelectLayout(phantomSkin.select, { width: stage.width, height: stage.height });
      },
      get selectedIndex(): number {
        return view.cursor;
      },
      get mouseX(): number {
        return view.mouseX;
      },
      set mouseX(value: number) {
        view.mouseX = value;
      },
      get mouseY(): number {
        return view.mouseY;
      },
      set mouseY(value: number) {
        view.mouseY = value;
      },
      get readTextOpen(): boolean {
        return view.readText.open;
      },
      scrollReadText: (delta) => view.readText.scrollBy(delta),
      closeReadText: () => emit({ type: 'readtext' }),
      resolveDesignSize: size,
      currentEntries: () => view.entries,
      moveCursorBy: (steps) => {
        const delta = steps > 0 ? 1 : -1;
        for (let step = 0; step < Math.abs(steps); step += 1)
          emit({ type: 'browse', command: { type: 'move', delta } });
      },
      stepCursor: (direction) => emit({ type: 'browse', command: { type: 'move', delta: direction } }),
      jumpCursor: (index) => emit({ type: 'browse', command: { type: 'jump', index } }),
      activateFocused: () => emit({ type: 'activate' }),
      handleThemePointerDown: (x, y) => view.handlePointerDown(x, y),
      startSelectBgm: async () => emit({ type: 'gesture' }),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------------------------------------------------

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
    const barOrder = this.kit.skin.barLayout.declarationOrder;
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
    const visualIndex = slotHeight > 0 ? this.cursor - this.listScrollOffset / slotHeight : this.cursor;
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
    const entries = this.entries;
    for (const slot of layout.slots) {
      const offset = slot.index - center;
      // Wrap so off-edge slots show entries from the opposite end. E.g. with 3 entries and a slot below the cursor's
      // "current+3" position, the slot displays `entries[0]` again — matching LR2's circular rail rendering.
      const targetIndex = wrapIndex(this.cursor + offset, entries.length);
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
      entry.kind === 'song' ? this.frame?.records.chart(entry.song) : this.frame?.records.course(entry.course);
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
    return this.chartGraphicTextures.resolve(this.library, song, path, () => undefined);
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
