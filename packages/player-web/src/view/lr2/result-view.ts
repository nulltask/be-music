/**
 * The LR2 family's result screen: an LR2 result skin (`Result/*.lr2skin`, or the course-result skin for a course run)
 * drawn on its canvas, letterboxed into the window. It draws the result session's frames through the LR2 result state
 * (`resolveLr2ResultState`) and LR2's result timers, which it reads off each frame ({@link resolveLr2ResultTimers}), and
 * turns a click into a `continue` intent (a press on, as Enter); the session plays the jingle and steps the screen.
 */

import type {
  Lr2DestinationRect,
  Lr2GaugeChartElement,
  Lr2ImageElement,
  Lr2ScoreChartElement,
  Lr2Skin,
  Lr2SpecialGraphic,
} from '@be-music/lr2-skin';
import { LR2_TIMER } from '@be-music/lr2-skin/ids';
import { resolveLr2ResultState, type Lr2ResultState } from '@be-music/lr2-skin/state';
import type { PlayResult } from '@be-music/scene-model';
import { Color, Container, Graphics, type Texture } from 'pixi.js';
import type { BrowserSongAssetSource } from '../../collection/types.ts';
import type { Lr2Kit } from '../../host/family-kit.ts';
import { logger } from '../../logger.ts';
import {
  resolveDesignTextResolution,
  resolveScaledViewport,
  setDesignPixelRatio,
  setDesignTextResolution,
} from '../../stage/viewport.ts';
import type { PixiSceneHost } from '../../scene/host.ts';
import { disposeChildren } from '../../stage/pixi-utils.ts';
import type { Lr2LoadedFont } from '../../skin/lr2/bitmap-text.ts';
import { loadSkinBitmapFonts } from '../../skin/lr2/font-loader.ts';
import {
  containerSpriteSink,
  evaluateElementDestination,
  makeLr2BargraphSprite,
  makeLr2SliderSprite,
  makeLr2StaticImageSprite,
  renderNumberElement,
} from '../../skin/lr2/render.ts';
import { isDestinationVisible, makeLr2TextSprite } from '../../skin/lr2/scene-render.ts';
import {
  Lr2ChartGraphicTextureStore,
  Lr2SkinTextureStore,
  collectResultSkinTexturePaths,
  resolveSolidSpecialGraphicTexture,
} from '../../skin/lr2/scene-textures.ts';
import type { IntentSink, ResultFrame, ResultIntent, ResultView, SceneViewTiming } from '../types.ts';

const log = logger('result');

/** The window size assumed while the host's screen reads 0: LR2's 640x480. */
const FALLBACK_SCREEN_WIDTH = 640;
const FALLBACK_SCREEN_HEIGHT = 480;
const BG = new Color('#05070b');

/** The input delay of a result skin without `#STARTINPUT`: the 1500 ms of LR2's stock result skin. */
export const LR2_RESULT_DEFAULT_INPUT_DELAY_MS = 1500;

/** The result skin's timing: input opens after its `#STARTINPUT` (1500 ms without one); no auto advance or fade-out. */
export function resolveLr2ResultTiming(skin: Pick<Lr2Skin, 'timing'>): SceneViewTiming {
  return {
    inputDelayMs: Math.max(0, skin.timing.startInput ?? LR2_RESULT_DEFAULT_INPUT_DELAY_MS),
    fadeOutMs: 0,
  };
}

/**
 * The LR2 timers running on a result frame, each with when it started on the frame's clock:
 *
 * - timer 0 (the scene) from the screen's entry;
 * - timers 1 (input) and 150 (the graphs start drawing) once input has opened;
 * - timer 151 (the graphs drawn: the rank and the score show) once the graphs have drawn or been skipped;
 * - timer 152 (the record update) once the player has pressed on to it.
 */
export function resolveLr2ResultTimers(
  frame: Pick<ResultFrame, 'clock' | 'inputOpenAtMs' | 'graphShownAtMs' | 'updateShownAtMs'>,
): Map<number, number> {
  const timers = new Map<number, number>([[LR2_TIMER.SCENE_START, frame.clock.enteredAtMs]]);
  if (frame.clock.nowMs >= frame.inputOpenAtMs) {
    timers.set(LR2_TIMER.START_INPUT, frame.inputOpenAtMs);
    timers.set(LR2_TIMER.RESULT_GRAPH_START, frame.inputOpenAtMs);
  }
  if (frame.graphShownAtMs !== undefined) timers.set(LR2_TIMER.RESULT_GRAPH_END, frame.graphShownAtMs);
  if (frame.updateShownAtMs !== undefined) timers.set(LR2_TIMER.RESULT_UPDATE, frame.updateShownAtMs);
  return timers;
}

/**
 * How much of a result graph shows, 0..1, `elapsedMs` after its timer started (`undefined`: not started): nothing before
 * the graph's `start` ms, then a linear sweep to all of it at `end` ms. LR2's stock result skin sweeps from 500 to
 * 2000 ms after timer 150.
 */
export function resolveLr2GraphReveal(elapsedMs: number | undefined, start: number, end: number): number {
  if (elapsedMs === undefined || elapsedMs < start) return 0;
  if (end <= start) return 1;
  return Math.max(0, Math.min(1, (elapsedMs - start) / (end - start)));
}

export interface Lr2ResultViewOptions {
  /** Where the result's chart files are, for its `*STAGEFILE`, `*BANNER` and `*BACKBMP`; none load without one. */
  readonly source?: BrowserSongAssetSource;
}

/** A point of a result graph, both axes 0..1. */
interface GraphPoint {
  readonly x: number;
  readonly y: number;
}

/** The LR2 result view. See the module comment. */
export class Lr2ResultView implements ResultView {
  public readonly family = 'lr2' as const;
  public readonly root: Container = new Container();
  public readonly timing: SceneViewTiming;
  private readonly designRoot = new Container();
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  private readonly skinLayer = new Container();
  /** Keeps the skin's artwork out of the letterbox bars. */
  private readonly designClipMask = new Graphics();
  /** The sizes the static rects were last drawn at; Pixi rebuilds a `Graphics` on every redraw. */
  private cachedScreenWidth = -1;
  private cachedScreenHeight = -1;
  private cachedDesignWidth = -1;
  private cachedDesignHeight = -1;
  private readonly kit: Lr2Kit;
  private readonly source: BrowserSongAssetSource | undefined;
  private readonly skinTextures = new Lr2SkinTextureStore();
  private readonly chartGraphicTextures = new Lr2ChartGraphicTextureStore();
  /** The skin's `#LR2FONT` bitmap fonts, once loaded. */
  private bitmapFonts: ReadonlyMap<number, Lr2LoadedFont> = new Map();
  /** The frame being drawn: its clock and its running timers. */
  private nowMs = 0;
  private timers: ReadonlyMap<number, number> = new Map();
  private host: PixiSceneHost | undefined;
  private emit: IntentSink<ResultIntent> | undefined;
  private built = false;
  private disposed = false;

  public constructor(kit: Lr2Kit, options: Lr2ResultViewOptions = {}) {
    this.kit = kit;
    this.source = options.source;
    this.timing = resolveLr2ResultTiming(kit.skin);
  }

  /** An LR2 kit carries nothing but its skin, which the view keeps: another skin needs another view. */
  public updateKit(kit: Lr2Kit): void {
    if (kit.skin !== this.kit.skin) log.warn('a result view keeps its skin; ignoring a kit of another skin');
  }

  /**
   * Builds the scene graph and starts loading the skin's images and bitmap fonts on the first attach, then listens for
   * clicks on the canvas.
   */
  public attach(host: PixiSceneHost, emit: IntentSink<ResultIntent>): void {
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

  public draw(frame: ResultFrame): void {
    const host = this.host;
    if (host === undefined || this.disposed) return;
    this.nowMs = frame.clock.nowMs;
    this.timers = resolveLr2ResultTimers(frame);
    const skin = this.kit.skin;
    const screenWidth = host.app.screen.width || FALLBACK_SCREEN_WIDTH;
    const screenHeight = host.app.screen.height || FALLBACK_SCREEN_HEIGHT;
    const designWidth = skin.width;
    const designHeight = skin.height;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
    setDesignTextResolution(resolveDesignTextResolution(viewport.scale, host.app.renderer.resolution));
    setDesignPixelRatio(viewport.scale * host.app.renderer.resolution);
    if (this.cachedScreenWidth !== screenWidth || this.cachedScreenHeight !== screenHeight) {
      this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
      this.cachedScreenWidth = screenWidth;
      this.cachedScreenHeight = screenHeight;
    }
    this.designRoot.position.set(viewport.x, viewport.y);
    this.designRoot.scale.set(viewport.scale);
    host.setStageOrientation('landscape');
    if (this.cachedDesignWidth !== designWidth || this.cachedDesignHeight !== designHeight) {
      this.designClipMask.clear().rect(0, 0, designWidth, designHeight).fill(0xffffff);
      this.background.clear().rect(0, 0, designWidth, designHeight).fill(BG);
      this.cachedDesignWidth = designWidth;
      this.cachedDesignHeight = designHeight;
    }
    // `disposeChildren`, not a bare `removeChildren`: each frame builds fresh sprites, texts and graph polylines, and
    // detached ones would keep their renderer-side state alive (see `pixi-utils.ts`).
    disposeChildren(this.skinLayer);
    const { result } = frame;
    this.drawSkin(
      skin,
      result,
      resolveLr2ResultState({
        result,
        ...(result.course !== undefined ? { course: result.course } : {}),
        // The `#FLIPRESULT` of the skin the result is shown on (op 351).
        flipResult: skin.scratchFlip?.flipResult === true,
        // The skin's CUSTOMOPTION defaults: LITONE4-style result skins gate most of their chrome on `#IF,<default>`.
        customOps: (skin.customOptions ?? []).map((option) => option.defaultOp),
      }),
    );
  }

  /** Builds the scene graph under {@link root}, once. */
  private build(): void {
    this.built = true;
    this.root.label = 'result/scene';
    this.designRoot.label = 'result/root';
    this.viewportBackground.label = 'result/viewport-bg';
    this.background.label = 'result/background';
    this.skinLayer.label = 'result/skin';
    this.designClipMask.label = 'result/design-clip';
    this.root.addChild(this.viewportBackground, this.designRoot);
    this.designRoot.addChild(this.background, this.skinLayer, this.designClipMask);
    this.designRoot.mask = this.designClipMask;
  }

  private async loadSkinTextures(): Promise<void> {
    const skin = this.kit.skin;
    await this.skinTextures.preload(skin, collectResultSkinTexturePaths(skin), () => !this.disposed);
  }

  private async loadBitmapFonts(): Promise<void> {
    const skin = this.kit.skin;
    if (skin.lr2FontPaths.length === 0) return;
    const loaded = await loadSkinBitmapFonts(skin.lr2FontPaths, skin.files);
    if (!this.disposed) this.bitmapFonts = loaded;
  }

  /**
   * Draws the skin's images, numbers, texts, bar graphs, sliders and graphs in their declaration order, as LR2 paints
   * its CSV stream (a later line paints on top): the stock result skin declares its high-score panel after the score
   * numbers and the graphs, and the panel has to cover them once timer 152 shows it.
   */
  private drawSkin(skin: Lr2Skin, result: PlayResult, state: Lr2ResultState): void {
    const { ops } = state;
    const work: { readonly order: number; readonly paint: () => void }[] = [];
    const textures = this.skinTextures.asReadonlyMap();
    for (const image of skin.images) {
      const dst = this.evaluateElementDst(image);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      work.push({
        order: image.declarationOrder,
        paint: () => {
          const sprite = this.makeStaticImageSprite(image, dst, result);
          if (sprite) this.skinLayer.addChild(sprite);
        },
      });
    }
    for (const number of skin.numbers) {
      const dst = this.evaluateElementDst(number);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const value = state.number(number.source.num);
      if (value === undefined) continue;
      work.push({
        order: number.declarationOrder,
        paint: () => renderNumberElement(containerSpriteSink(this.skinLayer), number, value, textures, dst),
      });
    }
    for (const text of skin.texts) {
      const dst = this.evaluateElementDst(text);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const value = state.text(text.st);
      if (value === undefined || value.length === 0) continue;
      work.push({
        order: text.declarationOrder,
        paint: () => {
          this.skinLayer.addChild(
            makeLr2TextSprite(value, text, dst, {
              bitmapFonts: this.bitmapFonts,
              systemFontSizes: skin.systemFontSizes,
            }),
          );
        },
      });
    }
    // The EX-score and rate bars next to the numbers: the value is the filled share, 0..1.
    for (const bargraph of skin.bargraphs) {
      const dst = this.evaluateElementDst(bargraph);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const value = state.bargraph(bargraph.type);
      if (value === undefined) continue;
      work.push({
        order: bargraph.declarationOrder,
        paint: () => {
          const sprite = makeLr2BargraphSprite(bargraph, dst, value, textures);
          if (sprite) this.skinLayer.addChild(sprite);
        },
      });
    }
    for (const slider of skin.sliders) {
      const dst = this.evaluateElementDst(slider);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const value = state.slider(slider.type);
      if (value === undefined) continue;
      work.push({
        order: slider.declarationOrder,
        paint: () => {
          const sprite = makeLr2SliderSprite(slider, dst, value, textures);
          if (sprite) this.skinLayer.addChild(sprite);
        },
      });
    }
    for (const chart of skin.gaugeCharts) {
      const dst = this.evaluateElementDst(chart);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      work.push({
        order: chart.declarationOrder,
        paint: () => {
          const graphic = this.makeGaugeChartGraphic(chart, dst, result);
          if (graphic) this.skinLayer.addChild(graphic);
        },
      });
    }
    for (const chart of skin.scoreCharts) {
      const dst = this.evaluateElementDst(chart);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      work.push({
        order: chart.declarationOrder,
        paint: () => {
          const graphic = this.makeScoreChartGraphic(chart, dst, result);
          if (graphic) this.skinLayer.addChild(graphic);
        },
      });
    }
    // A stable sort, so elements on the same line keep the order they were collected in.
    work.sort((a, b) => a.order - b.order);
    for (const item of work) item.paint();
  }

  /**
   * One `#SRC_GAUGECHART_*` line: the gauge over the play, left to right, from the bottom-left corner the destination
   * names (`y` grows upward). Only the 1P line draws: a play has one gauge.
   */
  private makeGaugeChartGraphic(
    chart: Lr2GaugeChartElement,
    dst: Lr2DestinationRect,
    result: PlayResult,
  ): Graphics | undefined {
    const { fieldWidth, fieldHeight, start, end } = chart.source;
    if (fieldWidth <= 0 || fieldHeight <= 0) return undefined;
    const series = chart.side === '2P' ? [] : result.gaugeHistory;
    if (series.length === 0) return undefined;
    const revealRatio = this.graphReveal(chart.destination.timer, start, end);
    if (revealRatio <= 0) return undefined;
    return drawGraphLine({
      points: series.map((sample) => ({
        x: clamp01(sample.progress),
        // The gauge is already 0..100.
        y: clamp01(sample.value / 100),
      })),
      revealRatio,
      dst,
      fieldWidth,
      fieldHeight,
      label: `gaugechart[${chart.side}/idx=${chart.source.index}]`,
    });
  }

  /**
   * One `#SRC_SCORECHART` line: the EX score over its maximum, laid out as a gauge line. Only line 0, this play,
   * draws: the best record (1) and the rival (2) do not reach the result.
   */
  private makeScoreChartGraphic(
    chart: Lr2ScoreChartElement,
    dst: Lr2DestinationRect,
    result: PlayResult,
  ): Graphics | undefined {
    if (chart.source.index !== 0) return undefined;
    const { fieldWidth, fieldHeight, start, end } = chart.source;
    if (fieldWidth <= 0 || fieldHeight <= 0) return undefined;
    const exMax = result.score.total * 2;
    if (exMax <= 0) return undefined;
    const series = result.scoreHistory;
    if (series.length === 0) return undefined;
    const revealRatio = this.graphReveal(chart.destination.timer, start, end);
    if (revealRatio <= 0) return undefined;
    return drawGraphLine({
      points: series.map((sample) => ({ x: clamp01(sample.progress), y: clamp01(sample.exScore / exMax) })),
      revealRatio,
      dst,
      fieldWidth,
      fieldHeight,
      label: `scorechart[idx=${chart.source.index}]`,
    });
  }

  /** How much of a graph on `timer` shows this frame (see {@link resolveLr2GraphReveal}). */
  private graphReveal(timer: number, start: number, end: number): number {
    const elapsedMs =
      this.timers.has(timer) || timer === LR2_TIMER.SCENE_START ? this.elapsedSinceTimer(timer) : undefined;
    return resolveLr2GraphReveal(elapsedMs, start, end);
  }

  private evaluateElementDst(element: {
    destination: Lr2DestinationRect;
    keyframes: Lr2DestinationRect[];
  }): Lr2DestinationRect {
    return evaluateElementDestination(element, this.elapsedSinceTimer);
  }

  /** How long `timer` has run on the frame's clock; 0 before it starts, which holds an element at its first keyframe. */
  private readonly elapsedSinceTimer = (timer: number): number => {
    const startedAt = this.timers.get(timer);
    return startedAt === undefined ? 0 : Math.max(0, this.nowMs - startedAt);
  };

  /** Whether `timer` runs on the frame: timer 0 always does; an element on a timer that has not started stays hidden. */
  private readonly timerActive = (timer: number): boolean => timer === LR2_TIMER.SCENE_START || this.timers.has(timer);

  private makeStaticImageSprite(image: Lr2ImageElement, dst: Lr2DestinationRect, result: PlayResult) {
    return makeLr2StaticImageSprite(image, dst, {
      textures: this.skinTextures.asReadonlyMap(),
      elapsedSinceTimer: this.elapsedSinceTimer,
      resolveSpecialGraphicTexture: (path) => this.chartGraphicTexture(result, path),
    });
  }

  /**
   * The texture of one of LR2's chart-bound images (`*BANNER`, `*STAGEFILE`, `*BACKBMP`, or the solid `*BLACK` /
   * `*WHITE`) for the chart just played; the first miss starts loading it, and a later frame draws it.
   */
  private chartGraphicTexture(result: PlayResult, path: Lr2SpecialGraphic): Texture | undefined {
    return (
      resolveSolidSpecialGraphicTexture(path) ??
      this.chartGraphicTextures.resolveFromSource(this.source, result.song, path, () => undefined)
    );
  }

  private readonly handlePointerDown = (): void => {
    this.emit?.({ type: 'continue' });
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Draws a result graph's line through `points` (both axes 0..1) on the field whose bottom-left corner is the
 * destination's `(x, y)`: x runs to `x + fieldWidth`, y up to `y - fieldHeight`. The line stops at `revealRatio` along
 * x, partway through the segment it falls in. Its width is the destination's `w` (at least 1), its colour the
 * destination's tint and its alpha the destination's.
 */
function drawGraphLine(input: {
  readonly points: readonly GraphPoint[];
  readonly revealRatio: number;
  readonly dst: Lr2DestinationRect;
  readonly fieldWidth: number;
  readonly fieldHeight: number;
  readonly label: string;
}): Graphics | undefined {
  const { points, dst, fieldWidth, fieldHeight } = input;
  if (points.length === 0) return undefined;
  const cutoff = clamp01(input.revealRatio);
  if (cutoff <= 0) return undefined;
  const toScreen = (point: GraphPoint): { sx: number; sy: number } => ({
    sx: dst.x + point.x * fieldWidth,
    sy: dst.y - point.y * fieldHeight,
  });
  const graphic = new Graphics();
  graphic.label = input.label;
  graphic.alpha = dst.alpha;
  const first = points[0]!;
  const start = toScreen(first);
  graphic.moveTo(start.sx, start.sy);
  let drewAny = false;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (current.x <= cutoff) {
      const screen = toScreen(current);
      graphic.lineTo(screen.sx, screen.sy);
      drewAny = true;
      continue;
    }
    // The cutoff falls inside this segment: end the line where it crosses it.
    const span = current.x - previous.x;
    if (span <= 0) break;
    const t = clamp01((cutoff - previous.x) / span);
    const screen = toScreen({
      x: previous.x + (current.x - previous.x) * t,
      y: previous.y + (current.y - previous.y) * t,
    });
    graphic.lineTo(screen.sx, screen.sy);
    drewAny = true;
    break;
  }
  if (!drewAny && points.length === 1) {
    // A single sample (a chart that ended before any judgement): a dot half a pixel wide, since a `lineTo` to the same
    // point draws nothing.
    graphic.lineTo(start.sx + 0.5, start.sy);
  }
  const color = ((dst.r << 16) | (dst.g << 8) | dst.b) >>> 0;
  graphic.stroke({ color, width: Math.max(1, Math.abs(dst.w || 2)), alpha: 1, alignment: 0.5 });
  return graphic;
}
