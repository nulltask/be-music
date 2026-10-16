import { Graphics, Texture } from 'pixi.js';
import { resolveIidxRankIndexFromScore } from '@be-music/player/core/scoring';
import { resolveClearLamp } from '@be-music/player/ruleset';
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
import type { PixiGameplayResultData } from '../core/result-data.ts';
import { CoreResultView, type CoreResultViewOptions } from '../core/result.ts';
import { LR2_NUM, LR2_OP, LR2_TEXT } from '@be-music/lr2-skin/ids';
import type { SceneCourseInfo } from '../course-info.ts';
import {
  resolveLr2CourseNumber,
  resolveLr2CourseOps,
  resolveLr2CourseText,
  resolveLr2KeyModeOp,
  resolveLr2LampOp,
} from '@be-music/lr2-skin/state';

/**
 * LR2 result scene. Layers LR2's result-skin rendering on top of {@link CoreResultView}, which owns the mount / ticker /
 * timer ladder / input / BGM lifecycle and the skinless be-music panel.
 *
 * Why a dedicated module: the result screen has its own LR2 timer sequence (`docs/LR2SkinHelp.md` lines 10198+) that
 * doesn't match either gameplay or select. Stuffing it into one of those views would pollute their state machines with
 * result-only branches; a sibling scene file mirrors the existing `scene/lr2/gameplay.ts` / `scene/lr2/select.ts` split and keeps
 * each scene's lifecycle independent.
 *
 * The core timer ladder (0 / 1 / 150 / 151 / 152) maps onto LR2's result timers directly; timer 1 fires `#STARTINPUT`
 * ms after mount (see {@link PixiResultView.startInputMs}).
 */
/**
 * Op set that's always true on the result screen. Mirrors `SELECT_BASE_OPS` in `scene/lr2/select.ts` — the ops that don't
 * depend on the played chart but on global state (filter / mode toggles, IR connectivity, etc.). Numbers follow
 * `dst_option` in `docs/LR2SkinHelp.md`.
 */
const RESULT_BASE_OPS: ReadonlySet<number> = new Set<number>([
  LR2_OP.AUTOPLAY_OFF,
  LR2_OP.GHOST_OFF,
  LR2_OP.SCORE_GRAPH_OFF,
  // No live BGA on the result screen.
  LR2_OP.BGA_OFF,
  LR2_OP.GAUGE_1P_NORMAL,
  LR2_OP.GAUGE_2P_NORMAL,
  LR2_OP.DIFFICULTY_FILTER_OFF,
  // No IR connection yet.
  LR2_OP.OFFLINE,
  LR2_OP.AUTO_SCRATCH_1P_OFF,
  LR2_OP.AUTO_SCRATCH_2P_OFF,
  // No persistence yet.
  LR2_OP.SCORE_SAVE_OFF,
  LR2_OP.CLEAR_SAVE_OFF,
  LR2_OP.LOADED,
  LR2_OP.REPLAY_OFF,
  // No #FLIPRESULT in the skin — most LR2 default skins gate the score panel against op 350, so set it. Skins that DO
  // declare #FLIPRESULT need op 351 instead, which we toggle below from the gameplay's skin.
  LR2_OP.RESULT_FLIP_OFF,
]);

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
 * One-shot LR2 result scene. Mounted by the host with a {@link PixiGameplayResultData} payload; {@link CoreResultView}
 * drives the result timer ladder and dismissal, this class paints the LR2 result skin through the theme hooks.
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
    const ops = computeResultOps(this.result, skin, this.options.courseInfo);
    this.renderSkin(skin, ops);
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

  private renderSkin(skin: Lr2Skin, ops: ReadonlySet<number>): void {
    if (!this.result) return;
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
      const course = this.options.courseInfo;
      const value =
        (course !== undefined ? resolveLr2CourseNumber(number.source.num, course) : undefined) ??
        resolveResultNumber(number.source.num, this.result);
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
      const course = this.options.courseInfo;
      const value =
        (course !== undefined ? resolveLr2CourseText(text.st, course) : undefined) ??
        resolveResultText(text.st, this.result);
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
      const value = resolveResultBargraphValue(bargraph.type, this.result);
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
      const value = resolveResultSliderValue(slider.type, this.result);
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

// -- Free helpers ------------------------------------------------------------

/**
 * Computes the LR2 op set for the result screen. Combines the always-true `RESULT_BASE_OPS` with per-result flags
 * derived from the chart and the score:
 *
 * - **Cleared / failed** (op 90 / 91) — gates the chrome atlas (`parts.tga` vs `parts_fail.tga`) plus the big "CLEARED"
 *   / "FAILED" graphic in the LR2 default skin.
 * - **Bar / playable** — the result screen is always "on a song", so op 2/5 stay set.
 * - **Key mode** — set in BOTH the SELECT range (160..164, for skins that mirror select gating) AND the KEYCONFIG range
 *   (400..402, used by the default `result_normal.csv`).
 * - **Difficulty** (op 150..155) — echoed onto the result screen so per-difficulty panels (`#IF,400,152`) gate
 *   correctly.
 * - **Clear lamp** (op 101..105) — the play's clear lamp (`data.lamp`) on LR2's six lamps.
 * - **Result rank** — current rank lives in 300..308 (1P), pre- update in 320..328, post-update in 340..347. Without
 *   score history the "previous" rank is rank-0 (op 328 / "F" tier).
 * - **Updated flags** (op 330/331/332/335) — until score history persists, every play is treated as an update so the
 *   LR2 default skin's congratulatory artwork shows.
 * - **Result flip** (op 350/351) — toggled from the played skin's `scratchFlip.flipResult`.
 * - **Course** (op 290 + kind, 280-289 for a stage) — when the result belongs to a course.
 */
export function computeResultOps(
  data: PixiGameplayResultData,
  skin: Lr2Skin,
  course?: SceneCourseInfo,
): ReadonlySet<number> {
  const ops = new Set<number>(RESULT_BASE_OPS);
  // CUSTOMOPTION defaults declared by the loaded skin — same idiom as `resolveLr2SelectState` and
  // `PixiGameplayView.initializeRuntimeOps`. Without this, every `#IF,N` block gated on a CUSTOMOPTION's default
  // value gets filtered out at render time, leaving the LITONE4-style result screen with only the few elements that
  // happen to lack CUSTOMOPTION gating. Visible symptom on LITONE4 RESULT: most chrome missing, only the BACKBMP +
  // bitmap-font title / artist labels survive.
  //
  // Defensive iteration guard — existing unit tests build stub `Lr2Skin` objects that only fill the fields they
  // exercise (`customOptions` was previously unused by `computeResultOps`). Treat a missing array as empty.
  for (const option of skin.customOptions ?? []) {
    ops.add(option.defaultOp);
  }
  ops.add(data.cleared ? LR2_OP.RESULT_CLEAR : LR2_OP.RESULT_FAIL);
  ops.add(LR2_OP.SONG_BAR);
  ops.add(LR2_OP.PLAYABLE_BAR);

  // Key mode set in both ranges so a skin can gate either way.
  for (const op of resolveKeyModeOps(data)) {
    ops.add(op);
  }
  ops.add(resolveDifficultyOp(data));
  ops.add(resolveResultLampOp(data));
  // Current 1P rank goes into the 300 / 340 ranges (the result- screen-specific slots — 200..207 is the SELECT-side
  // rank op and the LR2 default skin doesn't gate on it). Both "now" and "next" carry the same value because we don't
  // yet persist a best-score baseline to compare against.
  const rankIndex = resolveResultRankIndex(data);
  ops.add(LR2_OP.RESULT_RANK_AAA + rankIndex);
  ops.add(LR2_OP.UPDATED_RANK_AAA + rankIndex);
  // Pre-update rank is rank-0 (no prior history) — the default skin uses 328 ("0" tier) for that, with 320..327
  // reserved for each historical rank.
  ops.add(LR2_OP.PREVIOUS_RANK_0);

  // No score history yet — claim "updated" on every result.
  ops.add(LR2_OP.SCORE_UPDATED);
  ops.add(LR2_OP.MAX_COMBO_UPDATED);
  ops.add(LR2_OP.MIN_BP_UPDATED);
  ops.add(LR2_OP.RANK_UPDATED);

  // Result-flip status toggled from the gameplay skin (#FLIPRESULT). Default-disabled is already in `RESULT_BASE_OPS`;
  // if the skin declares flipResult we swap to the enabled slot.
  if (skin.scratchFlip.flipResult) {
    ops.delete(LR2_OP.RESULT_FLIP_OFF);
    ops.add(LR2_OP.RESULT_FLIP_ON);
  }

  if (course !== undefined) resolveLr2CourseOps(course).forEach((op) => ops.add(op));
  return ops;
}

/**
 * Returns the LR2 ops needed to advertise the played chart's key mode on the result screen. Sets the matching slot in
 * BOTH the select-screen range (160..164) and the result-screen KEYCONFIG range (400..402) — different skin authors
 * gate either way and the two ranges aren't redundant gating-wise (KEYCONFIG groups 7+14 / 5+10 together).
 */
function resolveKeyModeOps(data: PixiGameplayResultData): number[] {
  // The same key-mode op the select and decide screens light: the chart's play variant (`resolveChartPlayVariant`),
  // so `.pms` / 9 KEY, `#LNTYPE` lanes and the extended modes read the way the gameplay scene lays the chart out.
  const selectOp = resolveLr2KeyModeOp(data.song);
  // Map the select-range op onto the KEYCONFIG range. 7K + 14K share op 400 because the LR2 default skin doesn't draw a
  // separate 14K layout. Likewise 5K + 10K share 402.
  let keyConfigOp: number;
  if (selectOp === LR2_OP.KEYS_9) {
    keyConfigOp = LR2_OP.KEY_CONFIG_9;
  } else if (selectOp === LR2_OP.KEYS_5 || selectOp === LR2_OP.KEYS_10) {
    keyConfigOp = LR2_OP.KEY_CONFIG_5_10;
  } else {
    keyConfigOp = LR2_OP.KEY_CONFIG_7_14;
  }
  return [selectOp, keyConfigOp];
}

function resolveDifficultyOp(data: PixiGameplayResultData): number {
  switch (data.song.chart.metadata.difficulty) {
    case 1:
      return LR2_OP.DIFFICULTY_BEGINNER;
    case 2:
      return LR2_OP.DIFFICULTY_NORMAL;
    case 3:
      return LR2_OP.DIFFICULTY_HYPER;
    case 4:
      return LR2_OP.DIFFICULTY_ANOTHER;
    case 5:
      return LR2_OP.DIFFICULTY_INSANE;
    default:
      // Real LR2 maps "no difficulty declared" to the NORMAL slot for the result-screen panel split (the default skin
      // only ships per-difficulty graphics for 152..155 and would otherwise leave the panel blank). Mirror that.
      return LR2_OP.DIFFICULTY_NORMAL;
  }
}

/**
 * The clear-lamp op for the play: its lamp (`data.lamp`, else the one clear-lamp rule over its result) on LR2's lamps,
 * as the select screen lights a record's (`resolveLr2LampOp`): EASY for an ASSIST EASY or EASY clear, HARD for a HARD
 * or EX HARD one, FULL COMBO for a full combo.
 */
function resolveResultLampOp(data: PixiGameplayResultData): number {
  const lamp =
    data.lamp ??
    resolveClearLamp({
      cleared: data.cleared,
      score: data.score,
      ...(data.gaugeType !== undefined ? { gauge: data.gaugeType } : {}),
      ...(data.judgeRuleset !== undefined ? { ruleset: data.judgeRuleset } : {}),
    });
  return resolveLr2LampOp(lamp);
}

/**
 * Returns the rank index 0..7 (0=AAA, 7=F) for the played chart. Used to seed both the "current" (300+i) and
 * "after-update" (340+i) result-rank slots. The rank-0 slot (308 / 348) is reserved for charts with `total === 0` — we
 * map those to AAA here so something visible always renders.
 */
function resolveResultRankIndex(data: PixiGameplayResultData): number {
  return resolveIidxRankIndexFromScore(data.score) ?? 0;
}

/**
 * Resolves an LR2 `#SRC_NUMBER` slot to a numeric value from the play result. Coverage matches `docs/LR2SkinHelp.md`'s
 * `# num list` section (`# num 一覧` in the original Japanese):
 *
 * - **70..76** — best-score panel slots, treated here as the just-played chart's totals (no history yet, so "best" =
 *   "current"). 72 = theoretical EX max = `totalNotes * 2`.
 * - **77..89** — best-score-style "perfect / great / …". Mapped to the just-played counts since the result screen is
 *   the one place they actually mean "this play".
 * - **100..116** — gameplay-side panel reused for live readouts. The skin authors use these on the result screen too
 *   because they share a num namespace.
 * - **170..184** — result-specific high-score deltas. Without persistence the "before" value is 0 and the "now" /
 *   "diff" values are the live scores.
 *
 * Returning `undefined` makes the renderer skip the slot.
 */
function resolveResultNumber(num: number, data: PixiGameplayResultData): number | undefined {
  const score = data.score;
  const totalNotes = score.total;
  const exMax = totalNotes * 2;
  const rate = exMax > 0 ? score.exScore / exMax : 0;
  const minBp = score.bad + score.poor;
  switch (num) {
    case LR2_NUM.BEST_SCORE:
      return score.score;
    case LR2_NUM.BEST_EXSCORE:
      return score.exScore;
    case LR2_NUM.EXSCORE_MAX:
      return exMax;
    case LR2_NUM.BEST_RATE:
      // LR2 spec: rate as integer percent.
      return Math.round(rate * 100);
    case LR2_NUM.TOTAL_NOTES:
      return totalNotes;
    case LR2_NUM.BEST_MAX_COMBO:
      return data.maxCombo;
    case LR2_NUM.BEST_MIN_BP:
      return minBp;
    case LR2_NUM.PLAY_COUNT:
    case LR2_NUM.CLEAR_COUNT:
    case LR2_NUM.FAIL_COUNT:
      return 0;
    case LR2_NUM.BEST_PERFECT:
      return score.perfect;
    case LR2_NUM.BEST_GREAT:
      return score.great;
    case LR2_NUM.BEST_GOOD:
      return score.good;
    case LR2_NUM.BEST_BAD:
      return score.bad;
    case LR2_NUM.BEST_POOR:
      return score.poor;
    case LR2_NUM.BEST_PERFECT_RATE:
      return totalNotes > 0 ? Math.round((score.perfect / totalNotes) * 100) : 0;
    case LR2_NUM.BEST_GREAT_RATE:
      return totalNotes > 0 ? Math.round((score.great / totalNotes) * 100) : 0;
    case LR2_NUM.BEST_GOOD_RATE:
      return totalNotes > 0 ? Math.round((score.good / totalNotes) * 100) : 0;
    case LR2_NUM.BEST_BAD_RATE:
      return totalNotes > 0 ? Math.round((score.bad / totalNotes) * 100) : 0;
    case LR2_NUM.BEST_POOR_RATE:
      return totalNotes > 0 ? Math.round((score.poor / totalNotes) * 100) : 0;
    case LR2_NUM.MAX_BPM:
    case LR2_NUM.MIN_BPM:
      return data.song.bpm ?? data.song.chart.metadata.bpm;
    case LR2_NUM.SCORE:
      return score.score;
    case LR2_NUM.EXSCORE:
      return score.exScore;
    case LR2_NUM.SCORE_RATE:
      return Math.round(rate * 100);
    case LR2_NUM.SCORE_RATE_AFTERDOT:
      return Math.round(rate * 10000);
    case LR2_NUM.COMBO:
      // Result screen: there's no "live" combo, but the LR2 default skin reuses num=104 for the per-result "MAX COMBO"
      // digit panel as a fallback. Surface the achieved max combo so the panel doesn't read 0.
      return data.maxCombo;
    case LR2_NUM.MAX_COMBO:
      return data.maxCombo;
    case LR2_NUM.NOTES:
      return totalNotes;
    case LR2_NUM.GAUGE:
      return Math.round(data.gauge);
    case LR2_NUM.PERFECT:
      return score.perfect;
    case LR2_NUM.GREAT:
      return score.great;
    case LR2_NUM.GOOD:
      return score.good;
    case LR2_NUM.BAD:
      return score.bad;
    case LR2_NUM.POOR:
      return score.poor;
    case LR2_NUM.TOTAL_RATE:
      return Math.round(rate * 100);
    case LR2_NUM.TOTAL_RATE_AFTERDOT:
      return Math.round(rate * 10000) % 100;
    case LR2_NUM.PLAY_MINUTE:
      return Math.floor(data.playSeconds / 60);
    case LR2_NUM.PLAY_SECOND:
      return Math.floor(data.playSeconds % 60);
    case LR2_NUM.LOADING_PROGRESS:
      return 100;
    // Result-specific high-score deltas. "before" = 0 (no history), "now" = the live values, "diff" = "now" - "before"
    // = "now".
    case LR2_NUM.RESULT_EXSCORE_BEFORE:
      return 0;
    case LR2_NUM.RESULT_EXSCORE:
      return score.exScore;
    case LR2_NUM.RESULT_EXSCORE_DIFF:
      return score.exScore;
    case LR2_NUM.RESULT_MAX_COMBO_BEFORE:
      return 0;
    case LR2_NUM.RESULT_MAX_COMBO:
      return data.maxCombo;
    case LR2_NUM.RESULT_MAX_COMBO_DIFF:
      return data.maxCombo;
    case LR2_NUM.RESULT_MIN_BP_BEFORE:
      // Without history, treat the "before" number as the chart's theoretical worst (every note BAD) so the diff column
      // shows a positive improvement.
      return totalNotes;
    case LR2_NUM.RESULT_MIN_BP:
      return minBp;
    case LR2_NUM.RESULT_MIN_BP_DIFF:
      return Math.max(0, totalNotes - minBp);
    case LR2_NUM.RESULT_RATE_BEFORE:
      return 0;
    case LR2_NUM.RESULT_RATE_BEFORE_AFTERDOT:
      return 0;
    default:
      return undefined;
  }
}

function resolveResultText(st: number, data: PixiGameplayResultData): string | undefined {
  const song = data.song;
  const subartists = song.chart.bmson.info?.subartists?.join(' / ');
  switch (st) {
    case LR2_TEXT.RIVAL:
      return 'TARGET';
    case LR2_TEXT.PLAYER:
      return 'PLAYER';
    case LR2_TEXT.TITLE:
    case LR2_TEXT.TITLE_ALT:
      return song.title;
    case LR2_TEXT.SUBTITLE:
    case LR2_TEXT.SUBTITLE_ALT:
      return song.subtitle ?? '';
    case LR2_TEXT.FULL_TITLE:
    case LR2_TEXT.FULL_TITLE_ALT:
      return [song.title, song.subtitle].filter((value): value is string => Boolean(value)).join(' ');
    case LR2_TEXT.GENRE:
    case LR2_TEXT.GENRE_ALT:
      return song.genre ?? '';
    case LR2_TEXT.ARTIST:
    case LR2_TEXT.ARTIST_ALT:
      return song.artist ?? '';
    case LR2_TEXT.SUBARTIST:
    case LR2_TEXT.SUBARTIST_ALT:
      return subartists ?? '';
    case LR2_TEXT.FULL_ARTIST:
    case LR2_TEXT.FULL_ARTIST_ALT:
      return song.fileLabel;
    case LR2_TEXT.PLAY_LEVEL:
    case LR2_TEXT.PLAY_LEVEL_ALT:
      return song.playLevel?.toString() ?? '';
    case LR2_TEXT.DIFFICULTY:
    case LR2_TEXT.DIFFICULTY_ALT:
      switch (song.chart.metadata.difficulty) {
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
    default:
      return undefined;
  }
}

/**
 * Resolves an LR2 `#SRC_BARGRAPH` `type` to the 0..1 fill ratio. Result-screen bargraphs are usually anchored to score
 * / EX-score progress against theoretical max, so the same value drives both the "rate" digits and the bargraph fill.
 *
 * Returns `undefined` for type codes outside the result-relevant range; the renderer skips those.
 */
function resolveResultBargraphValue(type: number, data: PixiGameplayResultData): number | undefined {
  // Per `bargraph.txt`: 1 = score, 2 = exscore, 3 = exscore best, 4 = exscore target, 6 = gauge, 7 = max-combo, 9 =
  // rate. Many result skins use type 1 / 2 / 9 for the EX-score progress bar.
  const exMax = data.score.total * 2;
  switch (type) {
    case 1:
      // Score uses the IIDX 200000 scale per the gameplay code.
      return Math.max(0, Math.min(1, data.score.score / 200000));
    case 2:
    case 9:
      return exMax > 0 ? data.score.exScore / exMax : 0;
    case 6:
      return Math.max(0, Math.min(1, data.gauge / 100));
    case 7:
      return data.score.total > 0 ? Math.max(0, Math.min(1, data.maxCombo / data.score.total)) : 0;
    default:
      return undefined;
  }
}

function resolveResultSliderValue(type: number, data: PixiGameplayResultData): number | undefined {
  // Slider types overlap with bargraph types in the LR2 spec; the result screen typically only wires "song progress"
  // (type 1) and "rate" (type 6). Reuse the bargraph resolver so any new slot landing in either gets one shared
  // implementation.
  return resolveResultBargraphValue(type, data);
}

// Re-export this small LR2 geometry type so result-scene consumers do not have to import from `skin.ts` directly.
export type { Lr2ImageRect };
