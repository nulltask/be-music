/**
 * The built-in family's select view: a be-music skin's `select` screen (`BeMusicSelectBinding`), letterboxed into the
 * window, with the README overlay on top. It draws the select session's frames and turns the player's pointer input
 * (a tap or a click on a bar, a swipe and its glide, the wheel, the skin's PLAY / AUTO / search / play option / readme
 * hit areas) into intents.
 */

import { cyclePlayOptionValue, normalizeSearchQuery, PLAY_OPTION_CHOICES } from '@be-music/scene-model';
import { resolveBeMusicSelectLayout, resolveStageOrientation, type BeMusicSelectLayout } from '@be-music/skin-sdk';
import { Color, Container, Graphics } from 'pixi.js';
import { resolveSongSource } from '../../collection/collection.ts';
import type { BuiltInKit } from '../../host/family-kit.ts';
import type { SelectDesignSize } from '../../scene/core/select.ts';
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
import { SelectPointer, type SelectPointerContext } from '../../session/select/select-pointer.ts';
import { BeMusicSelectBinding, resolveBeMusicSkinStage } from '../../skin/be-music/binding.ts';
import { resolveSelectListWindow } from '../../skin/be-music/registry.ts';
import { SongImageCache } from '../../skin/be-music/song-images.ts';
import type { BeMusicSelectActions } from '../../skin/be-music/types.ts';
import { logger } from '../../logger.ts';
import type { IntentSink, SelectFrame, SelectIntent, SelectView } from '../types.ts';
import { SelectReadTextOverlay } from './select-readtext.ts';

const log = logger('select');

const BG = new Color('#050912');

/** The built-in select view. See the module comment. */
export class BuiltInSelectView implements SelectView {
  public readonly family = 'built-in' as const;
  /** The viewport background and the letterboxed design canvas. */
  public readonly root: Container = new Container();
  private readonly designRoot = new Container();
  /** Clips the design canvas, so an element sliding in from off-canvas is cut at its edge, not drawn in the bars. */
  private readonly designClipMask = new Graphics();
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  /** Where the be-music skin's back and front layers mount; the skin owns what is inside. */
  private readonly beMusicBackHolder: Container = new Container();
  private readonly beMusicFrontHolder: Container = new Container();
  private readonly readText: SelectReadTextOverlay = new SelectReadTextOverlay();
  private readonly pointer: SelectPointer;
  /** Per-frame timing, logged every second with `?perf` or `globalThis.__BE_MUSIC_PERF__ = true`. */
  private readonly perf: PerfTracker = new PerfTracker('select');
  private kit: BuiltInKit;
  private host: PixiSceneHost | undefined;
  private emit: IntentSink<SelectIntent> | undefined;
  private attached = false;
  private built = false;
  private disposed = false;
  private renderer: BeMusicSelectBinding | undefined;
  private songImages: SongImageCache | undefined;
  /** The last frame drawn: what the pointer reads (the list, the cursor) between frames. */
  private frame: SelectFrame | undefined;
  /** The frame revision the skin was last built from; it rebuilds when the session's state changes. */
  private builtRevision = -1;
  /** The skin reported an unfinished transition (a launch outro): build it again next frame. */
  private needsFrame = false;
  /** When the cursor last moved, on the host clock: the skin's focus transitions count from it. */
  private cursorChangedAt = 0;
  private cachedScreenWidth = -1;
  private cachedScreenHeight = -1;
  private cachedDesignWidth = -1;
  private cachedDesignHeight = -1;
  /** The viewport of the last build, to place the search box on the page. */
  private lastViewport: ScaledViewport | undefined;
  /** The pointer in design pixels, `-1` while it is off the canvas. */
  private mouseX = -1;
  private mouseY = -1;

  public constructor(kit: BuiltInKit) {
    this.kit = kit;
    this.pointer = new SelectPointer(BuiltInSelectView.createPointerContext(this));
  }

  /** How long the skin's launch outro plays: none with the skin's effects off. */
  public get launchOutroMs(): number {
    return (this.kit.effects ?? 'full') === 'off' ? 0 : (this.kit.skin.select.outroMs ?? 0);
  }

  /** Takes the player's new settings for the skin (the skin keeps its family and identity). */
  public updateKit(kit: BuiltInKit): void {
    this.kit = { ...kit, skin: this.kit.skin };
    this.renderer?.setSettings(kit.settings);
    this.builtRevision = -1;
  }

  public attach(host: PixiSceneHost, emit: IntentSink<SelectIntent>): void {
    if (this.disposed) return;
    this.host = host;
    this.emit = emit;
    if (!this.built) this.build();
    const canvas = host.app.canvas;
    canvas.addEventListener('pointerdown', this.pointer.handlePointerDown);
    canvas.addEventListener('pointermove', this.pointer.handlePointerMove);
    canvas.addEventListener('pointerleave', this.pointer.handlePointerLeave);
    canvas.addEventListener('pointerup', this.pointer.handlePointerUp);
    canvas.addEventListener('pointercancel', this.pointer.handlePointerCancel);
    // `passive: false`, so a wheel over the list does not also scroll the page under it.
    canvas.addEventListener('wheel', this.pointer.handleWheel, { passive: false });
    // A wheel throttle left over from before the screen last left would eat the first notch.
    this.pointer.lastWheelMoveAt = Number.NEGATIVE_INFINITY;
    this.builtRevision = -1;
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
    this.renderer?.dispose();
    this.renderer = undefined;
    this.songImages?.dispose();
    this.songImages = undefined;
    this.root.parent?.removeChild(this.root);
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
    const now = frame.clock.nowMs;
    for (const event of frame.events) {
      if (event.kind === 'browse' && event.event.kind !== 'list-changed' && event.event.kind !== 'favorite') {
        this.cursorChangedAt = event.atMs;
      } else if (event.kind === 'readtext-scroll') {
        this.readText.scrollBy(event.delta);
      }
    }
    this.readText.show(frame.readText);
    this.perf.beginTick();
    this.pointer.advanceFling(now);
    this.pointer.settleListPull(now);
    const screen = this.host.app.screen;
    // The skin is built again only when the session's state changed, while a transition is unfinished, or when the
    // screen was resized (a rotation can switch the skin to its other stage); between, it draws itself every tick.
    if (
      frame.revision !== this.builtRevision ||
      this.needsFrame ||
      screen.width !== this.cachedScreenWidth ||
      screen.height !== this.cachedScreenHeight
    ) {
      this.perf.time('render', () => this.buildFrame(frame));
    }
    if (this.readText.open) {
      const { width, height } = this.beMusicDesignSize;
      this.readText.render(width, height);
    }
    const renderer = this.renderer;
    if (renderer !== undefined) {
      const { width, height } = this.beMusicDesignSize;
      const onStage = this.mouseX >= 0 && this.mouseY >= 0 && this.mouseX < width && this.mouseY < height;
      renderer.setPointer(onStage ? this.mouseX : undefined, onStage ? this.mouseY : undefined);
      renderer.setListScroll(this.pointer.shownListPull());
      const focused = frame.entries[frame.cursor];
      renderer.tick(now, focused?.kind === 'song' ? focused.song : undefined, frame.startedAtMs, frame.audio);
    }
    const report = this.perf.endFrame(() => ({ entries: frame.entries.length, songs: frame.library.songs.length }));
    if (report) log.debug('perf', report);
  }

  /**
   * Where the skin's search box is on the canvas, in CSS pixels from its top-left corner, or `undefined` when the skin
   * has none (or nothing is drawn yet).
   */
  public searchFieldRect(): { x: number; y: number; width: number; height: number } | undefined {
    const rect = this.renderer?.searchFieldRect;
    const viewport = this.lastViewport;
    if (rect === undefined || viewport === undefined) return undefined;
    return designRectToCanvas(rect, viewport);
  }

  /** The skin's design canvas and its size, for screenshots. */
  public getStageInfo(): { container: Container; width: number; height: number } {
    const { width, height } = this.beMusicDesignSize;
    return { container: this.designRoot, width, height };
  }

  /** Builds the scene graph under {@link root}, on the first attach. */
  private build(): void {
    this.built = true;
    this.root.label = 'select/scene';
    this.designRoot.label = 'select/root';
    this.viewportBackground.label = 'select/viewport-bg';
    this.background.label = 'select/background';
    this.designClipMask.label = 'select/design-clip';
    this.beMusicBackHolder.label = 'select/be-music-back';
    this.beMusicFrontHolder.label = 'select/be-music-front';
    this.root.addChild(this.viewportBackground, this.designRoot);
    this.designRoot.addChild(
      this.background,
      this.beMusicBackHolder,
      this.beMusicFrontHolder,
      this.readText.layer,
      this.designClipMask,
    );
    this.designRoot.mask = this.designClipMask;
  }

  /** Lays the design canvas into the screen and has the skin build the frame. */
  private buildFrame(frame: SelectFrame): void {
    const host = this.host!;
    const app = host.app;
    const screenWidth = app.screen.width || app.canvas.parentElement?.clientWidth || 640;
    const screenHeight = app.screen.height || app.canvas.parentElement?.clientHeight || 480;
    const { width: designWidth, height: designHeight } = this.beMusicDesignSize;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
    setDesignTextResolution(resolveDesignTextResolution(viewport.scale, app.renderer.resolution));
    setDesignPixelRatio(viewport.scale * app.renderer.resolution);
    // The rects are drawn again only when their sizes change: a `Graphics` rebuild every frame is not free.
    if (this.cachedScreenWidth !== app.screen.width || this.cachedScreenHeight !== app.screen.height) {
      this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
      this.cachedScreenWidth = app.screen.width;
      this.cachedScreenHeight = app.screen.height;
    }
    this.designRoot.position.set(viewport.x, viewport.y);
    this.designRoot.scale.set(viewport.scale);
    this.lastViewport = viewport;
    host.setStageOrientation(resolveStageOrientation({ width: designWidth, height: designHeight }));
    if (this.cachedDesignWidth !== designWidth || this.cachedDesignHeight !== designHeight) {
      this.designClipMask.clear().rect(0, 0, designWidth, designHeight).fill(0xffffff);
      this.background.clear().rect(0, 0, designWidth, designHeight).fill(BG);
      this.cachedDesignWidth = designWidth;
      this.cachedDesignHeight = designHeight;
    }
    const renderer = this.ensureRenderer(frame);
    const window = resolveSelectListWindow(this.beMusicSelectLayout, designHeight, frame.cursor, frame.entries.length);
    const focused = frame.entries[frame.cursor];
    const folder = frame.browse.path[frame.browse.path.length - 1];
    renderer.render({
      designWidth,
      designHeight,
      nowMs: frame.clock.nowMs,
      sceneStartedAt: frame.clock.enteredAtMs,
      cursorChangedAt: this.cursorChangedAt,
      entries: frame.entries,
      selectedIndex: frame.cursor,
      firstVisibleIndex: window.firstVisibleIndex,
      visibleRows: window.visibleRows,
      focusedSong: focused?.kind === 'song' ? focused.song : undefined,
      focusedCourse: focused?.kind === 'course' ? focused.course : undefined,
      folderLabel: folder?.label,
      searchQuery: normalizeSearchQuery(frame.browse.searchText),
      searchEditing: frame.searchEditing,
      totalCharts: frame.library.songs.length,
      actions: this.actions,
      effects: this.kit.effects ?? 'full',
      launchAt: frame.startedAtMs,
      playOptions: frame.playOptions,
      playOptionChoices: PLAY_OPTION_CHOICES,
    });
    this.builtRevision = frame.revision;
    // The skin draws itself every tick; only a launch outro needs it built again each frame.
    this.needsFrame = frame.startedAtMs !== undefined;
  }

  private ensureRenderer(frame: SelectFrame): BeMusicSelectBinding {
    if (this.renderer !== undefined) {
      if (this.songImages !== undefined && this.imagesLibrary !== frame.library) {
        // Images cached for the previous library's charts may not match the new one's files.
        this.songImages.clear();
        this.imagesLibrary = frame.library;
      }
      return this.renderer;
    }
    this.imagesLibrary = frame.library;
    const songImages = new SongImageCache({
      resolveSource: (song) => (this.frame === undefined ? undefined : resolveSongSource(this.frame.library, song)),
      onLoaded: () => this.renderer?.invalidate(),
    });
    this.songImages = songImages;
    this.renderer = new BeMusicSelectBinding(this.kit.skin, {
      resolveSongRecord: (song) => this.frame?.records.chart(song),
      resolveCourseRecord: (course) => this.frame?.records.course(course),
      songImage: songImages.lookup,
      settings: this.kit.settings,
      renderer: this.host?.app.renderer,
    });
    this.beMusicBackHolder.addChild(this.renderer.backLayer);
    this.beMusicFrontHolder.addChild(this.renderer.frontLayer);
    return this.renderer;
  }

  /** The library the song images were cached for. */
  private imagesLibrary: SelectFrame['library'] | undefined;

  /** The skin's hit areas, as intents. */
  private readonly actions: BeMusicSelectActions = {
    play: (): void => this.emit?.({ type: 'start', autoPlay: false }),
    autoPlay: (): void => this.emit?.({ type: 'start', autoPlay: true }),
    activateSearch: (): void => this.emit?.({ type: 'search' }),
    setPlayOption: (key, value): void => this.emit?.({ type: 'set-play-option', key, value }),
    cyclePlayOption: (key, step = 1): void => {
      // Options without a fixed set of choices (the hi-speed, the shutter) do not cycle from a skin.
      if (this.frame === undefined || cyclePlayOptionValue(key, this.frame.playOptions[key], step) === undefined)
        return;
      this.emit?.({ type: 'play-option', key, step });
    },
    toggleReadme: (): void => this.emit?.({ type: 'readtext' }),
  };

  /** The be-music skin's stage for the screen: its portrait stage while the screen is upright and it has one. */
  private get beMusicDesignSize(): SelectDesignSize {
    const screen = this.host?.app.screen;
    const stage = resolveBeMusicSkinStage(
      this.kit.skin,
      screen && screen.width > 0 && screen.height > 0 ? screen : undefined,
    );
    return { width: stage.width, height: stage.height };
  }

  /** Where the skin's song list sits on the stage. */
  private get beMusicSelectLayout(): BeMusicSelectLayout {
    return resolveBeMusicSelectLayout(this.kit.skin.select, this.beMusicDesignSize);
  }

  /** What the pointer input reads and drives: the last frame, and intents for what the player asks. */
  private static createPointerContext(view: BuiltInSelectView): SelectPointerContext {
    const emit = (intent: SelectIntent): void => view.emit?.(intent);
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
      themeDesignSize: undefined,
      get beMusicDesignSize(): SelectDesignSize {
        return view.beMusicDesignSize;
      },
      get beMusicSelectLayout(): BeMusicSelectLayout {
        return view.beMusicSelectLayout;
      },
      get selectedIndex(): number {
        return view.frame?.cursor ?? 0;
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
      resolveDesignSize: () => view.beMusicDesignSize,
      currentEntries: () => view.frame?.entries ?? [],
      moveCursorBy: (steps) => {
        const delta = steps > 0 ? 1 : -1;
        for (let step = 0; step < Math.abs(steps); step += 1)
          emit({ type: 'browse', command: { type: 'move', delta } });
      },
      stepCursor: (direction) => emit({ type: 'browse', command: { type: 'move', delta: direction } }),
      jumpCursor: (index) => emit({ type: 'browse', command: { type: 'jump', index } }),
      activateFocused: () => emit({ type: 'activate' }),
      handleThemePointerDown: () => {},
      startSelectBgm: async () => emit({ type: 'gesture' }),
    };
  }
}
