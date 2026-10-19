/**
 * The LR2 family's decide screen: an LR2 decide skin (`Decide/decide.lr2skin`) drawn on its canvas over the chart's
 * `#STAGEFILE`, letterboxed into the window. It draws the decide session's frames through the LR2 decide state
 * (`resolveLR2DecideState`) and LR2's scene timers (`resolveLR2DecideTimers`), which it reads off each frame, and
 * turns a click into a `continue` intent; the session times the screen from the skin's timing
 * ({@link resolveLR2DecideTiming}).
 */

import {
  LR2_SPECIAL_GRAPHIC,
  type LR2DestinationRect,
  type LR2ImageElement,
  type LR2Skin,
  type LR2SpecialGraphic,
} from '@be-music/lr2-skin';
import { LR2_TIMER } from '@be-music/lr2-skin/ids';
import { resolveLR2DecideState, resolveLR2DecideTimers, type LR2SceneState } from '@be-music/lr2-skin/state';
import type { LibraryChart } from '@be-music/scene-model';
import { Color, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { BrowserSongAssetSource } from '../../collection/types.ts';
import type { LR2Kit } from '../../host/family-kit.ts';
import { logger } from '../../logger.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import { disposeChildren } from '../../stage/pixi-utils.ts';
import type { LR2LoadedFont } from '../../skin/lr2/bitmap-text.ts';
import { loadSkinBitmapFonts } from '../../skin/lr2/font-loader.ts';
import { evaluateElementDestination, makeLR2StaticImageSprite } from '../../skin/lr2/render.ts';
import { isDestinationVisible, makeLR2TextSprite, resolveScaledViewport } from '../../skin/lr2/scene-render.ts';
import {
  LR2ChartGraphicTextureStore,
  LR2SkinTextureStore,
  collectDecideSkinTexturePaths,
  resolveSolidSpecialGraphicTexture,
} from '../../skin/lr2/scene-textures.ts';
import type { DecideFrame, DecideIntent, DecideView, IntentSink, SceneViewTiming } from '../types.ts';

const log = logger('decide');

/** The window size assumed while the host's screen reads 0: LR2's 640x480. */
const FALLBACK_SCREEN_WIDTH = 640;
const FALLBACK_SCREEN_HEIGHT = 480;
const BG = new Color('#05070b');

/** The input delay of a decide skin without `#STARTINPUT`: the 1500 ms of LR2's stock decide skin. */
export const LR2_DECIDE_DEFAULT_INPUT_DELAY_MS = 1500;

/**
 * How long the decide screen stays after input opens before it moves on to the play by itself: long enough to read the
 * title and artist once they have faded in, short enough that a hands-off play starts promptly.
 */
export const LR2_DECIDE_AUTO_ADVANCE_AFTER_INPUT_MS = 1200;

/**
 * The decide skin's timing: input opens after its `#STARTINPUT` (1500 ms without one), the screen moves on by itself
 * {@link LR2_DECIDE_AUTO_ADVANCE_AFTER_INPUT_MS} later, and it fades out over its `#FADEOUT` as it leaves (at once
 * without one).
 */
export function resolveLR2DecideTiming(skin: Pick<LR2Skin, 'timing'>): SceneViewTiming {
  const inputDelayMs = Math.max(0, skin.timing.startInput ?? LR2_DECIDE_DEFAULT_INPUT_DELAY_MS);
  return {
    inputDelayMs,
    autoAdvanceMs: inputDelayMs + LR2_DECIDE_AUTO_ADVANCE_AFTER_INPUT_MS,
    fadeOutMs: Math.max(0, skin.timing.fadeOut ?? 0),
  };
}

export interface LR2DecideViewOptions {
  /** Where the chart's files are, for its `#STAGEFILE`, `*BANNER` and `*BACKBMP`; none load without one. */
  readonly source?: BrowserSongAssetSource;
}

/** The LR2 decide view. See the module comment. */
export class LR2DecideView implements DecideView {
  public readonly family = 'lr2' as const;
  public readonly root: Container = new Container();
  public readonly timing: SceneViewTiming;
  private readonly designRoot = new Container();
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  /**
   * The chart's `#STAGEFILE`, drawn over the whole canvas between the background and the skin, so the skin's chrome
   * (title plates, difficulty stickers, slide-in lines) paints over it, as on LR2's decide screen. Empty for a chart
   * without one.
   */
  private readonly stageFileLayer = new Container();
  private readonly skinLayer = new Container();
  /** Keeps the skin's artwork out of the letterbox bars. */
  private readonly designClipMask = new Graphics();
  /** The sizes the static rects were last drawn at; Pixi rebuilds a `Graphics` on every redraw. */
  private cachedScreenWidth = -1;
  private cachedScreenHeight = -1;
  private cachedDesignWidth = -1;
  private cachedDesignHeight = -1;
  private readonly kit: LR2Kit;
  private readonly source: BrowserSongAssetSource | undefined;
  private readonly skinTextures = new LR2SkinTextureStore();
  private readonly chartGraphicTextures = new LR2ChartGraphicTextureStore();
  /** The skin's `#LR2FONT` bitmap fonts, once loaded. */
  private bitmapFonts: ReadonlyMap<number, LR2LoadedFont> = new Map();
  /** The frame being drawn: its clock and its running timers. */
  private nowMs = 0;
  private timers: ReadonlyMap<number, number> = new Map();
  private host: PixiSceneHost | undefined;
  private emit: IntentSink<DecideIntent> | undefined;
  private built = false;
  private disposed = false;

  public constructor(kit: LR2Kit, options: LR2DecideViewOptions = {}) {
    this.kit = kit;
    this.source = options.source;
    this.timing = resolveLR2DecideTiming(kit.skin);
  }

  /** An LR2 kit carries nothing but its skin, which the view keeps: another skin needs another view. */
  public updateKit(kit: LR2Kit): void {
    if (kit.skin !== this.kit.skin) log.warn('a decide view keeps its skin; ignoring a kit of another skin');
  }

  /**
   * Builds the scene graph and starts loading the skin's images and bitmap fonts on the first attach, then listens for
   * clicks on the canvas.
   */
  public attach(host: PixiSceneHost, emit: IntentSink<DecideIntent>): void {
    if (this.disposed) return;
    if (!this.built) {
      this.build();
      void this.loadSkinTextures();
      void this.loadBitmapFonts();
    }
    this.host = host;
    this.emit = emit;
    host.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
  }

  public detach(): void {
    this.host?.app.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.host = undefined;
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
  }

  public draw(frame: DecideFrame): void {
    const host = this.host;
    if (host === undefined || this.disposed) return;
    this.nowMs = frame.clock.nowMs;
    this.timers = resolveLR2DecideTimers(frame);
    const skin = this.kit.skin;
    const screenWidth = host.app.screen.width || FALLBACK_SCREEN_WIDTH;
    const screenHeight = host.app.screen.height || FALLBACK_SCREEN_HEIGHT;
    const designWidth = skin.width;
    const designHeight = skin.height;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
    if (this.cachedScreenWidth !== screenWidth || this.cachedScreenHeight !== screenHeight) {
      this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
      this.cachedScreenWidth = screenWidth;
      this.cachedScreenHeight = screenHeight;
    }
    this.designRoot.position.set(viewport.x, viewport.y);
    this.designRoot.scale.set(viewport.scale);
    if (this.cachedDesignWidth !== designWidth || this.cachedDesignHeight !== designHeight) {
      this.designClipMask.clear().rect(0, 0, designWidth, designHeight).fill(0xffffff);
      this.background.clear().rect(0, 0, designWidth, designHeight).fill(BG);
      this.cachedDesignWidth = designWidth;
      this.cachedDesignHeight = designHeight;
    }
    disposeChildren(this.stageFileLayer);
    disposeChildren(this.skinLayer);
    this.drawStageFile(frame.chart, designWidth, designHeight);
    // The decide skin's ops and texts: the chart's difficulty and key mode, its title, artist, …, and the course's.
    this.drawSkin(
      skin,
      frame.chart,
      resolveLR2DecideState({ chart: frame.chart, ...(frame.course !== undefined ? { course: frame.course } : {}) }),
    );
  }

  /** Builds the scene graph under {@link root}, once. */
  private build(): void {
    this.built = true;
    this.root.label = 'decide/scene';
    this.designRoot.label = 'decide/root';
    this.viewportBackground.label = 'decide/viewport-bg';
    this.background.label = 'decide/background';
    this.stageFileLayer.label = 'decide/stagefile';
    this.skinLayer.label = 'decide/skin';
    this.designClipMask.label = 'decide/design-clip';
    this.root.addChild(this.viewportBackground, this.designRoot);
    this.designRoot.addChild(this.background, this.stageFileLayer, this.skinLayer, this.designClipMask);
    this.designRoot.mask = this.designClipMask;
  }

  private async loadSkinTextures(): Promise<void> {
    const skin = this.kit.skin;
    await this.skinTextures.preload(skin, collectDecideSkinTexturePaths(skin), () => !this.disposed);
  }

  private async loadBitmapFonts(): Promise<void> {
    const skin = this.kit.skin;
    if (skin.lr2FontPaths.length === 0) return;
    const loaded = await loadSkinBitmapFonts(skin.lr2FontPaths, skin.files);
    if (!this.disposed) this.bitmapFonts = loaded;
  }

  /**
   * Draws the chart's `#STAGEFILE` (or a bmson's `info.back_image`) over the whole canvas, under whatever the skin
   * draws, so a theme gets the artwork whether or not its skin references `*STAGEFILE`. The texture loads on the first
   * frame and shows from a later one; without a stage file the background shows through.
   */
  private drawStageFile(chart: LibraryChart, designWidth: number, designHeight: number): void {
    if (!chart.chart.metadata.stageFile) return;
    const texture = this.chartGraphicTexture(chart, LR2_SPECIAL_GRAPHIC.STAGEFILE);
    if (texture === undefined) return;
    const sprite = new Sprite(texture);
    sprite.label = 'decide/stagefile-backdrop';
    sprite.position.set(0, 0);
    sprite.width = designWidth;
    sprite.height = designHeight;
    this.stageFileLayer.addChild(sprite);
  }

  private drawSkin(skin: LR2Skin, chart: LibraryChart, state: LR2SceneState): void {
    const { ops } = state;
    for (const image of skin.images) {
      const dst = this.evaluateElementDst(image);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const sprite = this.makeStaticImageSprite(image, dst, chart);
      if (sprite) this.skinLayer.addChild(sprite);
    }
    for (const text of skin.texts) {
      const dst = this.evaluateElementDst(text);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const value = state.text(text.st);
      if (value === undefined || value.length === 0) continue;
      this.skinLayer.addChild(
        makeLR2TextSprite(value, text, dst, {
          maxFontSize: 22,
          bitmapFonts: this.bitmapFonts,
          systemFontSizes: skin.systemFontSizes,
        }),
      );
    }
  }

  private evaluateElementDst(element: {
    destination: LR2DestinationRect;
    keyframes: LR2DestinationRect[];
  }): LR2DestinationRect {
    return evaluateElementDestination(element, this.elapsedSinceTimer);
  }

  /** How long `timer` has run on the frame's clock; 0 before it starts, which holds an element at its first keyframe. */
  private readonly elapsedSinceTimer = (timer: number): number => {
    const startedAt = this.timers.get(timer);
    return startedAt === undefined ? 0 : Math.max(0, this.nowMs - startedAt);
  };

  /** Whether `timer` runs on the frame: timer 0 always does; an element on a timer that has not started stays hidden. */
  private readonly timerActive = (timer: number): boolean => timer === LR2_TIMER.SCENE_START || this.timers.has(timer);

  private makeStaticImageSprite(image: LR2ImageElement, dst: LR2DestinationRect, chart: LibraryChart) {
    return makeLR2StaticImageSprite(image, dst, {
      textures: this.skinTextures.asReadonlyMap(),
      elapsedSinceTimer: this.elapsedSinceTimer,
      resolveSpecialGraphicTexture: (path) => this.chartGraphicTexture(chart, path),
    });
  }

  /**
   * The texture of one of LR2's chart-bound images (`*BANNER`, `*STAGEFILE`, `*BACKBMP`, or the solid `*BLACK` /
   * `*WHITE`) for the chart; the first miss starts loading it, and a later frame draws it.
   */
  private chartGraphicTexture(chart: LibraryChart, path: LR2SpecialGraphic): Texture | undefined {
    return (
      resolveSolidSpecialGraphicTexture(path) ??
      this.chartGraphicTextures.resolveFromSource(this.source, chart, path, () => undefined)
    );
  }

  private readonly handlePointerDown = (): void => {
    this.emit?.({ type: 'continue' });
  };
}
