import { Graphics, Texture } from 'pixi.js';
import type {
  Lr2DestinationRect,
  Lr2GaugeChartElement,
  Lr2ImageElement,
  Lr2ImageRect,
  Lr2ScoreChartElement,
  Lr2Skin,
  Lr2SpecialGraphic,
} from '@be-music/lr2-skin';
import {
  containerSpriteSink,
  evaluateElementDestination,
  makeLr2BargraphSprite,
  makeLr2SliderSprite,
  makeLr2StaticImageSprite,
  renderNumberElement,
} from '../../skin/lr2/render.ts';
import {
  Lr2ChartGraphicTextureStore,
  Lr2SkinTextureStore,
  collectResultSkinTexturePaths,
  resolveSolidSpecialGraphicTexture,
} from '../../skin/lr2/scene-textures.ts';
import { isDestinationVisible, makeLr2TextSprite } from '../../skin/lr2/scene-render.ts';
import { loadSkinBitmapFonts } from '../../skin/lr2/font-loader.ts';
import type { Lr2LoadedFont } from '../../skin/lr2/bitmap-text.ts';
import { CoreResultView, type CoreResultViewOptions } from '../core/result.ts';
import type { SceneCourseInfo } from '../course-info.ts';
import { resolveLr2ResultState, type Lr2ResultState } from '@be-music/lr2-skin/state';

/** Constructor options for {@link PixiResultView}: the core result options plus the LR2 result skin and course. */
export interface PixiResultViewOptions extends CoreResultViewOptions {
  /**
   * LR2 result skin to render with. When provided, renders the skin's `#IMAGE` / `#NUMBER` / `#TEXT` / `#SLIDER` /
   * `#BARGRAPH` elements gated on the standard ops table. When absent (or the skin has no result-anchored elements),
   * the fallback panel is drawn instead.
   */
  skin?: Lr2Skin;
  /**
   * The course this result belongs to: a stage of a running course (with its `stageIndex`) or, on the course result,
   * the whole course. Lights the course ops (290 + kind, 280-289 for a stage) and feeds the course numbers and texts
   * (250-259, 150-170).
   */
  courseInfo?: SceneCourseInfo;
}

/**
 * One-shot LR2 result scene. Mounted by the host with a `PixiGameplayResultData` payload; {@link CoreResultView}
 * drives the result timer ladder (0 / 1 / 150 / 151 / 152, LR2's result timers; timer 1 fires `#STARTINPUT` ms after
 * mount) and dismissal, this class paints the LR2 result skin through the theme hooks from the result's LR2 state
 * (`resolveLr2ResultState`).
 */
export class PixiResultView extends CoreResultView {
  declare protected options: PixiResultViewOptions;
  /**
   * Decoded textures for the result skin's referenced atlases. Keyed by image path (including LR2 special-graphic
   * sentinels that resolve to per-song chart assets).
   */
  private readonly skinTextures = new Lr2SkinTextureStore();
  /** Per-song chart graphic textures (BANNER / STAGEFILE / BACKBMP). */
  private readonly chartGraphicTextures = new Lr2ChartGraphicTextureStore();
  /** Lazy-loaded LR2 bitmap fonts — see `prepareBitmapFonts`. */
  private bitmapFonts: Map<number, Lr2LoadedFont> = new Map();

  public constructor(options: PixiResultViewOptions = {}) {
    super(options);
  }

  /** The LR2 skin's declared canvas size; falls back to the core 640×480 canvas without a skin. */
  protected override get themeDesignSize(): { width: number; height: number } | undefined {
    const skin = this.options.skin;
    return skin ? { width: skin.width, height: skin.height } : super.themeDesignSize;
  }

  /** The skin's `#STARTINPUT`, or the core default when no skin (or no directive) is loaded. */
  protected override get startInputMs(): number {
    return this.options.skin?.timing.startInput ?? super.startInputMs;
  }

  /** Starts decoding the skin's atlases and bitmap fonts; each re-renders once it lands. */
  protected override prepareTheme(): void {
    // Trust the loader's path filter: any `Lr2Skin` we receive here was selected from `Result/*.lr2skin` candidates
    // (see `loadLr2SkinFromSourceFiles` for the kind-aware path matcher). Earlier this scene gated on a "has
    // result-anchored timer" heuristic, but the LR2 default `Result/result_normal.csv` anchors almost everything to
    // timer 0 (the chart-draw timeline is a thin overlay on top), so the heuristic produced a false negative and the
    // scene fell through to the fallback panel.
    if (this.options.skin) {
      void this.prepareSkinTextures(this.options.skin);
      void this.prepareBitmapFonts(this.options.skin);
    }
  }

  /** Paints the LR2 skin when one is loaded; returns `false` (core fallback panel) otherwise. */
  protected override renderTheme(): boolean {
    const skin = this.options.skin;
    if (!skin || !this.result) return false;
    this.renderSkin(
      skin,
      resolveLr2ResultState({
        result: this.result,
        ...(this.options.courseInfo !== undefined ? { course: this.options.courseInfo } : {}),
        // The `#FLIPRESULT` of the skin the result is shown on (op 351).
        flipResult: skin.scratchFlip?.flipResult === true,
        // The skin's CUSTOMOPTION defaults: LITONE4-style result skins gate most of their chrome on `#IF,<default>`.
        customOps: (skin.customOptions ?? []).map((option) => option.defaultOp),
      }),
    );
    // No empty-state hint here — the skin's own artwork covers the whole canvas. If a skin author wired a result skin
    // but no #IMAGE / #TEXT to display, that's their decision.
    return true;
  }

  /** Releases the skin atlas and per-song chart graphic textures. */
  protected override disposeTheme(): void {
    this.skinTextures.dispose();
    this.chartGraphicTextures.dispose();
  }
  /**
   * Pre-loads atlas textures referenced by the skin's `#IMAGE` / `#SRC_NUMBER` / `#SRC_BARGRAPH` / `#SRC_SLIDER`
   * declarations. Special graphic sentinels (BANNER / STAGEFILE) are excluded — those bind to per-song chart assets and
   * are loaded lazily.
   */
  private async prepareSkinTextures(skin: Lr2Skin): Promise<void> {
    const loaded = await this.skinTextures.preload(
      skin,
      collectResultSkinTexturePaths(skin),
      () => !this.disposed && this.options.skin === skin,
    );
    if (loaded) {
      this.render();
    }
  }

  private async prepareBitmapFonts(skin: Lr2Skin): Promise<void> {
    if (skin.lr2FontPaths.length === 0) return;
    const loaded = await loadSkinBitmapFonts(skin.lr2FontPaths, skin.files);
    if (this.disposed || this.options.skin !== skin) return;
    this.bitmapFonts = loaded;
    this.render();
  }

  private renderSkin(skin: Lr2Skin, state: Lr2ResultState): void {
    if (!this.result) return;
    const ops = state.ops;
    // Build a unified work list keyed on `declarationOrder` so the resulting paint order matches LR2's CSV-stream
    // contract ("later declarations paint on top"). The previous kind-grouped loop (images first, then numbers, then
    // texts, …) inverted the z-order whenever a later-kind element was authored EARLIER than a same-layer earlier-kind
    // element — most visibly the LR2 default result skin's high-score panel (image declared after the score
    // `#SRC_NUMBER`s) bled the score digits through the panel background once timer 152 fired and revealed the panel on
    // Enter.
    interface ChromePaint {
      order: number;
      paint: () => void;
    }
    const work: ChromePaint[] = [];

    for (const image of skin.images) {
      const dst = this.evaluateElementDst(image);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      work.push({
        order: image.declarationOrder,
        paint: () => {
          const sprite = this.makeStaticImageSprite(image);
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
        paint: () => {
          renderNumberElement(
            containerSpriteSink(this.skinLayer),
            number,
            value,
            this.skinTextures.asReadonlyMap(),
            dst,
          );
        },
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

    // BARGRAPH / SLIDER: result-screen skins use these for the EX-score / rate progress bars next to the digit panels.
    // The value resolver returns 0..1 (filled ratio); the renderer crops the source rect along the `muki` axis.
    for (const bargraph of skin.bargraphs) {
      const dst = this.evaluateElementDst(bargraph);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const value = state.bargraph(bargraph.type);
      if (value === undefined) continue;
      work.push({
        order: bargraph.declarationOrder,
        paint: () => {
          const sprite = makeLr2BargraphSprite(bargraph, dst, value, this.skinTextures.asReadonlyMap());
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
          const sprite = makeLr2SliderSprite(slider, dst, value, this.skinTextures.asReadonlyMap());
          if (sprite) this.skinLayer.addChild(sprite);
        },
      });
    }

    // Polyline charts (`#SRC_GAUGECHART_*` / `#SRC_SCORECHART`) also live on `declarationOrder`: the LR2 default result
    // skin declares the high-score panel image AFTER the graphs, so a proper sort puts the panel on top of the
    // polylines too. The previous unsorted-tail pass left the polylines painting over the panel even though the CSV
    // order said otherwise.
    for (const chart of skin.gaugeCharts) {
      const dst = this.evaluateElementDst(chart);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      work.push({
        order: chart.declarationOrder,
        paint: () => {
          const graphic = this.makeGaugeChartGraphic(chart, dst);
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
          const graphic = this.makeScoreChartGraphic(chart, dst);
          if (graphic) this.skinLayer.addChild(graphic);
        },
      });
    }

    // Stable sort by declaration order; ties (rare — usually only when two element kinds share a SRC line, which the
    // LR2 parser forbids) keep their push order so the pre-sort pass acts as the secondary key.
    work.sort((a, b) => a.order - b.order);
    for (const item of work) {
      item.paint();
    }
  }

  /**
   * Renders one `#SRC_GAUGECHART_*` polyline. Maps the gauge-history series onto the chart area:
   *
   * - x = `dstX + progress * fieldWidth` (left-to-right by chart-time).
   * - y = `dstY - (value/100) * fieldHeight` — LR2 anchors the DST at the **bottom-left** of the chart area, so y grows
   *   upward.
   *
   * The reveal animation clips to `progress ≤ revealRatio`, where `revealRatio = (elapsed - start) / (end - start)`.
   * Before `start` ms have elapsed nothing draws; after `end` the full line stays visible.
   *
   * Index 0 (NORMAL gauge) is filtered to the cleared-style line, index 1 (red gauge) to the survival-style. With a
   * single gauge type implemented today we draw whichever the skin authored — if the skin only ships index 0 we use it,
   * and likewise for index 1. (A future gauge-type selector would gate which index actually renders.)
   */
  private makeGaugeChartGraphic(chart: Lr2GaugeChartElement, dst: Lr2DestinationRect): Graphics | undefined {
    const result = this.result;
    if (!result) return undefined;
    const { fieldWidth, fieldHeight, start, end } = chart.source;
    if (fieldWidth <= 0 || fieldHeight <= 0) return undefined;
    const series = chart.side === '2P' ? [] : result.gaugeHistory;
    if (series.length === 0) return undefined;
    const revealRatio = this.revealRatio(chart.destination.timer, start, end);
    if (revealRatio <= 0) return undefined;
    return this.drawPolyline({
      points: series.map((sample) => ({
        x: Math.max(0, Math.min(1, sample.progress)),
        // gauge value is 0..100 already.
        y: Math.max(0, Math.min(1, sample.value / 100)),
      })),
      revealRatio,
      // DST `(x, y)` = bottom-left, `(w, h)` = line thickness.
      anchorX: dst.x,
      anchorY: dst.y,
      fieldWidth,
      fieldHeight,
      lineWidth: Math.max(1, Math.abs(dst.w || 2)),
      // DST tint colors the line.
      color: ((dst.r << 16) | (dst.g << 8) | dst.b) >>> 0,
      alpha: dst.alpha,
      label: `gaugechart[${chart.side}/idx=${chart.source.index}]`,
    });
  }

  /**
   * Renders one `#SRC_SCORECHART` polyline. Identical layout to gauge-chart but the value series is EX-score /
   * theoretical max. `index` selects which dataset:
   *
   * - 0 = current play (we always have this).
   * - 1 = personal best (we don't persist scores yet → skipped).
   * - 2 = rival / target (no rival mode → skipped).
   */
  private makeScoreChartGraphic(chart: Lr2ScoreChartElement, dst: Lr2DestinationRect): Graphics | undefined {
    const result = this.result;
    if (!result) return undefined;
    if (chart.source.index !== 0) return undefined;
    const { fieldWidth, fieldHeight, start, end } = chart.source;
    if (fieldWidth <= 0 || fieldHeight <= 0) return undefined;
    const exMax = result.score.total * 2;
    if (exMax <= 0) return undefined;
    const series = result.scoreHistory;
    if (series.length === 0) return undefined;
    const revealRatio = this.revealRatio(chart.destination.timer, start, end);
    if (revealRatio <= 0) return undefined;
    return this.drawPolyline({
      points: series.map((sample) => ({
        x: Math.max(0, Math.min(1, sample.progress)),
        y: Math.max(0, Math.min(1, sample.exScore / exMax)),
      })),
      revealRatio,
      anchorX: dst.x,
      anchorY: dst.y,
      fieldWidth,
      fieldHeight,
      lineWidth: Math.max(1, Math.abs(dst.w || 2)),
      color: ((dst.r << 16) | (dst.g << 8) | dst.b) >>> 0,
      alpha: dst.alpha,
      label: `scorechart[idx=${chart.source.index}]`,
    });
  }

  /**
   * Computes the 0..1 reveal fraction for a chart polyline. Returns:
   *
   * - 0 (don't draw) when the controlling timer hasn't fired or when `start` ms haven't elapsed since it did.
   * - 1 (draw fully) when `end` ms have elapsed.
   * - linear progress between for the animated reveal window.
   *
   * The default LR2 result skin uses `start=500, end=2000` (a 1.5 s reveal kicking in 0.5 s after timer 150 fires).
   */
  private revealRatio(timer: number, start: number, end: number): number {
    if (!this.timerStartedAt.has(timer) && timer !== 0) return 0;
    const elapsed = this.elapsedSinceTimer(timer);
    if (elapsed < start) return 0;
    if (end <= start) return 1;
    return Math.max(0, Math.min(1, (elapsed - start) / (end - start)));
  }

  /**
   * Draws a polyline through `points` (each `(x, y)` in `[0, 1]`) inside the chart area anchored at `(anchorX,
   * anchorY)`. Both axes are mapped to design-space pixels:
   *
   * - x: `0 → anchorX`, `1 → anchorX + fieldWidth`.
   * - y: `0 → anchorY` (bottom edge), `1 → anchorY - fieldHeight` (top edge), matching LR2's bottom-left anchor
   *   convention.
   *
   * `revealRatio` clips the rightmost portion of the polyline so the reveal animation walks across the chart area
   * linearly. We draw the full segment up to the last point at or before `revealRatio` on the x axis, then a partial
   * segment to the exact reveal-x using the next-point lerp.
   */
  private drawPolyline(input: {
    points: Array<{ x: number; y: number }>;
    revealRatio: number;
    anchorX: number;
    anchorY: number;
    fieldWidth: number;
    fieldHeight: number;
    lineWidth: number;
    color: number;
    alpha: number;
    label: string;
  }): Graphics | undefined {
    const { points, revealRatio, anchorX, anchorY, fieldWidth, fieldHeight, lineWidth, color, alpha, label } = input;
    if (points.length === 0) return undefined;
    const cutoff = Math.max(0, Math.min(1, revealRatio));
    if (cutoff <= 0) return undefined;
    const toScreen = (point: { x: number; y: number }): { sx: number; sy: number } => ({
      sx: anchorX + point.x * fieldWidth,
      sy: anchorY - point.y * fieldHeight,
    });
    const graphic = new Graphics();
    graphic.label = label;
    graphic.alpha = alpha;
    // Walk the points until we cross the reveal cutoff. We need the first point as the move-to anchor; subsequent
    // points are line-to. If the cutoff falls between two points we interpolate.
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
      // Cutoff falls inside this segment — interpolate.
      const span = current.x - previous.x;
      if (span <= 0) {
        // Identical-x sample (shouldn't really happen with monotonic progress, but be defensive). Just stop here.
        break;
      }
      const t = Math.max(0, Math.min(1, (cutoff - previous.x) / span));
      const interpolated = {
        x: previous.x + (current.x - previous.x) * t,
        y: previous.y + (current.y - previous.y) * t,
      };
      const screen = toScreen(interpolated);
      graphic.lineTo(screen.sx, screen.sy);
      drewAny = true;
      break;
    }
    if (!drewAny && points.length === 1) {
      // Single-sample series (chart that ended before any judges fired): emit a tiny dot so the line still has visible
      // geometry. `lineTo` to the same point is a no-op in Pixi v8, so we offset by half a pixel.
      graphic.lineTo(start.sx + 0.5, start.sy);
    }
    graphic.stroke({ color, width: lineWidth, alpha: 1, alignment: 0.5 });
    return graphic;
  }

  private evaluateElementDst(element: {
    destination: Lr2DestinationRect;
    keyframes: Lr2DestinationRect[];
  }): Lr2DestinationRect {
    return evaluateElementDestination(element, (timer) => this.elapsedSinceTimer(timer));
  }

  private makeStaticImageSprite(image: Lr2ImageElement) {
    return makeLr2StaticImageSprite(image, this.evaluateElementDst(image), {
      textures: this.skinTextures.asReadonlyMap(),
      elapsedSinceTimer: (timer) => this.elapsedSinceTimer(timer),
      resolveSpecialGraphicTexture: (path) => this.resolveSpecialGraphicTexture(path),
    });
  }

  /**
   * Resolves the live texture for one of LR2's runtime-bound graphic slots (BACKBMP / BANNER / STAGEFILE / black /
   * white). Triggers an async load on first miss; the next render will pick up the cached texture once decode
   * completes.
   *
   * On the result screen these point at the **just-played** chart — the result data carries the song reference, so the
   * path resolver doesn't need to consult a navigation cursor.
   */
  private resolveSpecialGraphicTexture(path: Lr2SpecialGraphic): Texture | undefined {
    const solidTexture = resolveSolidSpecialGraphicTexture(path);
    if (solidTexture) {
      return solidTexture;
    }
    const result = this.result;
    const collection = this.options.collection;
    if (!result || !collection) return undefined;
    return this.chartGraphicTextures.resolve(collection, result.song, path, () => this.render());
  }
}

// Re-export this small LR2 geometry type so result-scene consumers do not have to import from `skin.ts` directly.
export type { Lr2ImageRect };
