import { Application, Color, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import type {
  Lr2BarGraphElement,
  Lr2DestinationRect,
  Lr2GaugeChartElement,
  Lr2ImageElement,
  Lr2ImageRect,
  Lr2ScoreChartElement,
  Lr2Skin,
  Lr2SliderElement,
  Lr2SpecialGraphic,
  Lr2TextElement,
} from './lr2-skin.ts';
import { LR2_SPECIAL_GRAPHIC, isLr2SpecialGraphic } from './lr2-skin.ts';
import { loadSkinAssetTexture, loadTextureFromBytes } from './lr2-textures.ts';
import {
  applyDestinationToSprite,
  createCroppedTexture,
  evaluateKeyframes,
  normaliseRect,
  pickAnimatedCell,
  renderNumberElement,
} from './lr2-render.ts';
import { type PixiSceneHost } from './pixi-scene-host.ts';
import { resolveChartAsset, resolveSongSource } from './library.ts';
import type { BrowserSongCollection } from './types.ts';
import type { PixiGameplayResultData } from './pixi-gameplay.ts';

/**
 * Result scene. Shows the per-chart score breakdown (judge counts,
 * EX score, rate, max combo, clear lamp / rank) and animates LR2's
 * result-skin chart-draw timeline.
 *
 * Why a dedicated module: the result screen has its own LR2 timer
 * sequence (`docs/LR2SkinHelp.md` lines 10198+) that doesn't match
 * either gameplay or select. Stuffing it into one of those views
 * would pollute their state machines with result-only branches; a
 * sibling scene file mirrors the existing
 * `pixi-gameplay.ts` / `pixi-select.ts` split and keeps each
 * scene's lifecycle independent.
 *
 * The LR2 timer ladder we drive:
 *
 * - **timer 0** — scene main, fired at mount.
 * - **timer 1** — input enable, fires `#STARTINPUT` ms after mount.
 *   DST keyframes anchored to it animate from `time = 0` once
 *   the user is allowed to dismiss the result.
 * - **timer 150** — chart-draw start. We approximate "chart draw"
 *   as a fixed window after `#STARTINPUT` since we don't yet
 *   render the EX-score / gauge graph; advancing to 150 is what
 *   pulls in the score numbers.
 * - **timer 151** — chart-draw end / rank display. Fires either
 *   automatically once the draw window expires or instantly when
 *   the user presses Enter / Space (LR2's "skip" input).
 * - **timer 152** — high-score-update press, fired on the next
 *   input after 151. We never persist scores yet, so this is
 *   purely cosmetic: skins use it to swap the high-score panel
 *   from "previous" to "now" digits.
 *
 * After timer 152 fires the next input dismisses the scene via
 * the `onContinue` callback the host supplied.
 */
const FALLBACK_DESIGN_WIDTH = 1280;
const FALLBACK_DESIGN_HEIGHT = 720;
const LR2_DESIGN_WIDTH = 640;
const LR2_DESIGN_HEIGHT = 480;
const BG = new Color('#05070b');
const TEXT = new Color('#f8fafc');
const MUTED = new Color('#9aa6b2');
const ACCENT = new Color('#ffd166');
const PASS = new Color('#56b6f7');
const FAIL = new Color('#ff6b6b');

/**
 * Approximate duration of the chart-draw animation when no skin-side
 * `#SRC_SCORECHART` / `#SRC_GAUGECHART` is wired up. Mirrors the LR2
 * default skin's authored timeline (~3 s) so timer-151 anchored
 * elements (final rank, score totals) don't pop in immediately.
 */
const CHART_DRAW_DURATION_MS = 3000;

/**
 * Default `#STARTINPUT` when the loaded skin doesn't declare one.
 * The LR2 default skin's `result.lr2skin` uses 1500 ms — long enough
 * for the slide-in chrome animation to play out before the user can
 * dismiss the screen. Picked at the same value so the look matches.
 */
const DEFAULT_STARTINPUT_MS = 1500;

/**
 * Op set that's always true on the result screen. Mirrors
 * `SELECT_BASE_OPS` in `pixi-select.ts` — the ops that don't depend
 * on the played chart but on global state (filter / mode toggles,
 * IR connectivity, etc.). Numbers follow `dst_option` in
 * `docs/LR2SkinHelp.md`.
 */
const RESULT_BASE_OPS: ReadonlySet<number> = new Set<number>([
  32, // autoplay off
  34, // ghost off
  38, // scoregraph off
  40, // BGA off (no live BGA on the result screen)
  42, // 1P normal gauge
  44, // 2P normal gauge
  47, // difficulty filter disabled
  50, // offline (no IR connection yet)
  54, // autoscratch 1P off
  56, // autoscratch 2P off
  60, // save impossible (no persistence yet)
  62, // clear save impossible
  81, // load complete
  82, // replay off
  // op 350 = "result flip disabled" (no #FLIPRESULT in the skin) —
  // most LR2 default skins gate the score panel against op 350,
  // so set it. Skins that DO declare #FLIPRESULT will need op 351
  // instead, which we toggle below from the gameplay's skin.
  350,
]);

/**
 * Op slots flipped per-result. The numeric values are authoritative
 * — they match `dst_option` in `docs/LR2SkinHelp.md`.
 *
 * Notable difference from `pixi-select.ts`: the result screen has
 * its **own** rank op range (300..307 for the 1P current rank,
 * 320..327 for "before update", 340..347 for "after update").
 * The 200..207 range is a SELECT-screen scratch slot; the LR2
 * default `Result/result_normal.csv` gates rank graphics on the
 * 300/340 ranges, so binding to 200..207 (as an earlier revision
 * of this file did) leaves every rank panel hidden.
 */
export const RESULT_DYNAMIC_OPS = {
  // Cleared / failed at the play-result level. These gate the
  // background atlas (`parts.tga` vs `parts_fail.tga`) plus the
  // big "CLEARED" / "FAILED" graphic. Runtime-only — pre-set in
  // `defaultParseOps` so both atlases parse.
  RESULT_CLEARED: 90,
  RESULT_FAILED: 91,
  // Bar / cursor type duplicated here in case the skin re-uses a
  // bar-list panel (rare, but the LR2 default course-result skin
  // does for the per-stage chart graph).
  BAR_IS_SONG: 2,
  BAR_IS_PLAYABLE: 5,
  // Difficulty echoed onto the result screen — gates per-difficulty
  // panels in the default skin (`#DST_IMAGE,...,400,152,...` =
  // "show only on 7/14K NORMAL chart").
  DIFFICULTY_UNDEFINED: 150,
  DIFFICULTY_EASY: 151,
  DIFFICULTY_NORMAL: 152,
  DIFFICULTY_HYPER: 153,
  DIFFICULTY_ANOTHER: 154,
  DIFFICULTY_INSANE: 155,
  // Key mode of the played chart for the SELECT-screen op range.
  // The result skin generally uses the KEYCONFIG range (400..402)
  // instead, but a few skins reuse the select range too — so we
  // set both so each gating style works.
  KEYS_7: 160,
  KEYS_5: 161,
  KEYS_14: 162,
  KEYS_10: 163,
  KEYS_9: 164,
  // Clear lamp for THIS play. 100 = not played (won't fire on the
  // result screen — we always ran the chart), 101 = failed, 102 =
  // easy clear, 103 = normal clear, 104 = hard clear, 105 = full
  // combo. Picked from `data.cleared` + judge counts.
  LAMP_FAILED: 101,
  LAMP_EASY: 102,
  LAMP_NORMAL: 103,
  LAMP_HARD: 104,
  LAMP_FULL_COMBO: 105,
  // 1P **result-screen** rank (300..307). Distinct from the select-
  // screen rank op range (200..207) and from the 2P range (310..317).
  // The default skin's "RANK" panel gates on these.
  RANK_NOW_AAA: 300,
  RANK_NOW_AA: 301,
  RANK_NOW_A: 302,
  RANK_NOW_B: 303,
  RANK_NOW_C: 304,
  RANK_NOW_D: 305,
  RANK_NOW_E: 306,
  RANK_NOW_F: 307,
  RANK_NOW_0: 308,
  // Pre-update rank — 320..327 + 328 ("rank 0"). Without score
  // history every play is "first time" so the previous rank is
  // 0 / F. We set 327 (F) to match what real LR2 reports for an
  // un-played chart.
  RANK_PREV_AAA: 320,
  RANK_PREV_AA: 321,
  RANK_PREV_A: 322,
  RANK_PREV_B: 323,
  RANK_PREV_C: 324,
  RANK_PREV_D: 325,
  RANK_PREV_E: 326,
  RANK_PREV_F: 327,
  RANK_PREV_0: 328,
  // Post-update rank — 340..347. Same value as `RANK_NOW_*` since
  // we don't persist between plays today.
  RANK_NEXT_AAA: 340,
  RANK_NEXT_AA: 341,
  RANK_NEXT_A: 342,
  RANK_NEXT_B: 343,
  RANK_NEXT_C: 344,
  RANK_NEXT_D: 345,
  RANK_NEXT_E: 346,
  RANK_NEXT_F: 347,
  // "Score / max-combo / score-rank updated" flags. Without score
  // persistence we always claim "updated" so the LR2 default skin's
  // congratulatory artwork shows; once history persists, this
  // becomes a comparison against the stored best.
  SCORE_UPDATED: 330,
  MAXCOMBO_UPDATED: 331,
  MIN_BP_UPDATED: 332,
  RANK_UPDATED: 335,
  // Result-flip status. 350 = flip disabled (default), 351 = flip
  // enabled (skin declared `#FLIPRESULT`). We set exactly one based
  // on the gameplay skin's `scratchFlip.flipResult`.
  RESULT_FLIP_DISABLED: 350,
  RESULT_FLIP_ENABLED: 351,
  // KEYCONFIG-derived key mode used by the result skin's per-keymode
  // panels. 400 = 7/14keys, 401 = 9keys, 402 = 5/10keys.
  KEYCONFIG_7_14: 400,
  KEYCONFIG_9: 401,
  KEYCONFIG_5_10: 402,
} as const;

export interface PixiResultViewOptions {
  /**
   * LR2 result skin to render with. When provided, renders the
   * skin's `#IMAGE` / `#NUMBER` / `#TEXT` / `#SLIDER` / `#BARGRAPH`
   * elements gated on the standard ops table. When absent (or the
   * skin has no result-anchored elements), the fallback panel is
   * drawn instead.
   */
  skin?: Lr2Skin;
  /**
   * Loaded song collection — needed to resolve special graphic
   * paths (BANNER / STAGEFILE / BACKBMP) on result-screen artwork
   * via the same chart-asset loader the select view uses. May be
   * `undefined` for embed scenarios where the result is rendered
   * outside a library context.
   */
  collection?: BrowserSongCollection;
  /**
   * Callback fired when the user dismisses the result screen.
   * Hosts typically transition back to the song-select view here.
   * Triggered by Enter / Space / Escape after timer 152 has fired
   * (or immediately on Escape).
   */
  onContinue?: () => void;
}

/**
 * One-shot result scene. Mounted by the host with a
 * {@link PixiGameplayResultData} payload, drives the LR2 result
 * timer ladder, and dismisses itself via {@link onContinue} when
 * the user advances past timer 152.
 *
 * Lifecycle parallels {@link PixiSongSelectView}:
 * `mount` → `render`-on-rAF until `dispose`. We don't pause the
 * loop on hide because a result scene is short-lived (host swaps
 * it out wholesale rather than keeping it backgrounded).
 */
export class PixiResultView {
  private host: PixiSceneHost | undefined;
  private readonly sceneRoot = new Container();
  private readonly root = new Container();
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  private readonly skinLayer = new Container();
  /**
   * Decoded textures for the result skin's referenced atlases.
   * Keyed by image path (including LR2 special-graphic sentinels
   * that resolve to per-song chart assets).
   */
  private readonly skinTextures = new Map<string, Texture>();
  /** Per-song chart graphic textures (BANNER / STAGEFILE / BACKBMP). */
  private readonly chartGraphicTextures = new Map<string, Texture>();
  private readonly chartGraphicPending = new Set<string>();
  /** Fallback summary panel (used when no skin or as overlay). */
  private readonly fallbackLayer = new Container();
  private result: PixiGameplayResultData | undefined;
  /**
   * `performance.now()` of mount — reference point for timer 0
   * and the `#STARTINPUT`-derived timer 1 / 150.
   */
  private sceneStartedAt = 0;
  private animationFrame = 0;
  private disposed = false;
  /**
   * Per-timer fire timestamps. Empty until each respective timer
   * fires; entries here drive both the keyframe interpolator
   * (`elapsedSinceTimer`) and `isDestinationVisible`'s timer-active
   * gating.
   */
  private readonly timerStartedAt = new Map<number, number>();

  public constructor(private options: PixiResultViewOptions = {}) {}

  private get app(): Application {
    if (!this.host) {
      throw new Error('PixiResultView: app accessed before mount');
    }
    return this.host.app;
  }

  /**
   * Mounts the scene onto the shared host's stage and starts the
   * render loop. The result payload is stored verbatim — no
   * defensive copy — because the gameplay view that produced it
   * will be disposed shortly after the host calls this method,
   * so the snapshot won't change underneath us.
   */
  public async mount(host: PixiSceneHost, result: PixiGameplayResultData): Promise<void> {
    this.host = host;
    this.result = result;
    this.sceneRoot.label = 'result/scene';
    this.root.label = 'result/root';
    this.viewportBackground.label = 'result/viewport-bg';
    this.background.label = 'result/background';
    this.skinLayer.label = 'result/skin';
    this.fallbackLayer.label = 'result/fallback';
    this.sceneRoot.addChild(this.viewportBackground, this.root);
    this.root.addChild(this.background, this.skinLayer, this.fallbackLayer);
    host.app.stage.addChild(this.sceneRoot);
    window.addEventListener('keydown', this.handleKeyDown);
    host.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
    // Trust the loader's path filter: any `Lr2Skin` we receive here
    // was selected from `Result/*.lr2skin` candidates (see
    // `loadLr2SkinFromSourceFiles` for the kind-aware path matcher).
    // Earlier this scene gated on a "has result-anchored timer"
    // heuristic, but the LR2 default `Result/result_normal.csv`
    // anchors almost everything to timer 0 (the chart-draw timeline
    // is a thin overlay on top), so the heuristic produced a false
    // negative and the scene fell through to the fallback panel.
    if (this.options.skin) {
      void this.prepareSkinTextures(this.options.skin);
    }
    this.sceneStartedAt = performance.now();
    this.timerStartedAt.clear();
    this.timerStartedAt.set(0, this.sceneStartedAt);
    // Schedule timer 1 (#STARTINPUT) and timer 150 (chart-draw) from
    // wall clock so the skin's intro animation plays out even
    // without user interaction. Timer 151 fires automatically once
    // the chart-draw window elapses; 152 needs an input.
    const startInput = this.options.skin?.timing.startInput ?? DEFAULT_STARTINPUT_MS;
    window.setTimeout(
      () => {
        if (this.disposed) return;
        this.timerStartedAt.set(1, performance.now());
        // The LR2 reference timeline starts the chart draw the moment
        // input becomes available — keep the same anchor so the
        // numbers panel slide-in lines up with the chrome animation.
        this.timerStartedAt.set(150, performance.now());
      },
      Math.max(0, startInput),
    );
    window.setTimeout(
      () => {
        if (this.disposed) return;
        if (this.timerStartedAt.has(151)) return;
        this.timerStartedAt.set(151, performance.now());
      },
      Math.max(0, startInput) + CHART_DRAW_DURATION_MS,
    );
    this.render();
    this.startAnimationLoop();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.animationFrame !== 0) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.host) {
      this.host.app.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    }
    if (this.sceneRoot.parent) {
      this.sceneRoot.parent.removeChild(this.sceneRoot);
    }
    try {
      for (const texture of this.skinTextures.values()) {
        texture.destroy(true);
      }
      this.skinTextures.clear();
      for (const texture of this.chartGraphicTextures.values()) {
        texture.destroy(true);
      }
      this.chartGraphicTextures.clear();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[result] texture cleanup threw', error);
    }
    try {
      this.sceneRoot.destroy({ children: true });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[result] sceneRoot.destroy threw', error);
    }
    this.host = undefined;
  }

  /**
   * Pre-loads atlas textures referenced by the skin's `#IMAGE` /
   * `#SRC_NUMBER` / `#SRC_BARGRAPH` / `#SRC_SLIDER` declarations.
   * Special graphic sentinels (BANNER / STAGEFILE) are excluded —
   * those bind to per-song chart assets and are loaded lazily.
   */
  private async prepareSkinTextures(skin: Lr2Skin): Promise<void> {
    const referencedPaths = new Set<string>();
    for (const image of skin.images) {
      if (!isLr2SpecialGraphic(image.source.imagePath)) {
        referencedPaths.add(image.source.imagePath);
      }
    }
    for (const number of skin.numbers) {
      referencedPaths.add(number.source.imagePath);
    }
    for (const bargraph of skin.bargraphs) {
      referencedPaths.add(bargraph.source.imagePath);
    }
    for (const slider of skin.sliders) {
      referencedPaths.add(slider.source.imagePath);
    }
    await Promise.all(
      [...referencedPaths].map(async (path) => {
        const texture = await loadSkinAssetTexture(skin, path);
        if (texture) {
          this.skinTextures.set(path, texture);
        }
      }),
    );
    this.render();
  }

  private startAnimationLoop(): void {
    const tick = (): void => {
      if (this.disposed) {
        this.animationFrame = 0;
        return;
      }
      this.animationFrame = requestAnimationFrame(tick);
      this.render();
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  /**
   * Per-frame render. Cheap enough to run unconditionally — most
   * of the cost is sprite churn on the skin layer (one pass over
   * each element type) and Pixi's auto-batching keeps draw calls
   * low for a static panel. Mirrors `pixi-select`'s render loop.
   */
  private render(): void {
    if (!this.result) {
      return;
    }
    const screenWidth = this.app.screen.width || FALLBACK_DESIGN_WIDTH;
    const screenHeight = this.app.screen.height || FALLBACK_DESIGN_HEIGHT;
    const skin = this.options.skin;
    const useSkin = skin !== undefined;
    const designWidth = useSkin ? skin!.width : FALLBACK_DESIGN_WIDTH;
    const designHeight = useSkin ? skin!.height : FALLBACK_DESIGN_HEIGHT;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
    this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
    this.root.position.set(viewport.x, viewport.y);
    this.root.scale.set(viewport.scale);
    this.background.clear().rect(0, 0, designWidth, designHeight).fill(BG);
    this.skinLayer.removeChildren();
    this.fallbackLayer.removeChildren();
    if (useSkin && skin) {
      const ops = computeResultOps(this.result, skin);
      this.renderSkin(skin, ops);
      // No empty-state hint here — the skin's own artwork covers
      // the whole canvas. If a skin author wired a result skin
      // but no #IMAGE / #TEXT to display, that's their decision.
      return;
    }
    this.renderFallbackPanel(designWidth, designHeight);
  }

  private renderSkin(skin: Lr2Skin, ops: ReadonlySet<number>): void {
    if (!this.result) return;
    for (const image of skin.images) {
      const dst = this.evaluateElementDst(image);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const sprite = this.makeStaticImageSprite(image);
      if (sprite) this.skinLayer.addChild(sprite);
    }
    for (const number of skin.numbers) {
      const dst = this.evaluateElementDst(number);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const value = resolveResultNumber(number.source.num, this.result);
      if (value === undefined) continue;
      renderNumberElement(this.skinLayer, number, value, this.skinTextures, dst);
    }
    for (const text of skin.texts) {
      const dst = this.evaluateElementDst(text);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const value = resolveResultText(text.st, this.result);
      if (value === undefined || value.length === 0) continue;
      this.skinLayer.addChild(makeTextSprite(value, text, dst));
    }
    // BARGRAPH / SLIDER: result-screen skins use these for the
    // EX-score / rate progress bars next to the digit panels. The
    // value resolver returns 0..1 (filled ratio); the renderer
    // crops the source rect along the `muki` axis.
    for (const bargraph of skin.bargraphs) {
      const dst = this.evaluateElementDst(bargraph);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const value = resolveResultBargraphValue(bargraph.type, this.result);
      if (value === undefined) continue;
      const sprite = this.makeBargraphSprite(bargraph, dst, value);
      if (sprite) this.skinLayer.addChild(sprite);
    }
    for (const slider of skin.sliders) {
      const dst = this.evaluateElementDst(slider);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const value = resolveResultSliderValue(slider.type, this.result);
      if (value === undefined) continue;
      const sprite = this.makeSliderSprite(slider, dst, value);
      if (sprite) this.skinLayer.addChild(sprite);
    }
    // Polyline charts (`#SRC_GAUGECHART_*` / `#SRC_SCORECHART`) —
    // result-screen progress graphs, animated left-to-right between
    // SRC `start` / `end` ms once the controlling timer fires. Drawn
    // last so they sit on top of the chart-area background.
    for (const chart of skin.gaugeCharts) {
      const dst = this.evaluateElementDst(chart);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const graphic = this.makeGaugeChartGraphic(chart, dst);
      if (graphic) this.skinLayer.addChild(graphic);
    }
    for (const chart of skin.scoreCharts) {
      const dst = this.evaluateElementDst(chart);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const graphic = this.makeScoreChartGraphic(chart, dst);
      if (graphic) this.skinLayer.addChild(graphic);
    }
  }

  /**
   * Renders one `#SRC_GAUGECHART_*` polyline. Maps the gauge-history
   * series onto the chart area:
   *
   * - x = `dstX + progress * fieldWidth` (left-to-right by chart-time).
   * - y = `dstY - (value/100) * fieldHeight` — LR2 anchors the DST at
   *   the **bottom-left** of the chart area, so y grows upward.
   *
   * The reveal animation clips to `progress ≤ revealRatio`, where
   * `revealRatio = (elapsed - start) / (end - start)`. Before
   * `start` ms have elapsed nothing draws; after `end` the full
   * line stays visible.
   *
   * Index 0 (NORMAL gauge) is filtered to the cleared-style line,
   * index 1 (red gauge) to the survival-style. With a single gauge
   * type implemented today we draw whichever the skin authored —
   * if the skin only ships index 0 we use it, and likewise for
   * index 1. (A future gauge-type selector would gate which index
   * actually renders.)
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
      // DST tint colours the line.
      color: ((dst.r << 16) | (dst.g << 8) | dst.b) >>> 0,
      alpha: dst.alpha,
      label: `gaugechart[${chart.side}/idx=${chart.source.index}]`,
    });
  }

  /**
   * Renders one `#SRC_SCORECHART` polyline. Identical layout to
   * gauge-chart but the value series is EX-score / theoretical max.
   * `index` selects which dataset:
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
   * - 0 (don't draw) when the controlling timer hasn't fired or
   *   when `start` ms haven't elapsed since it did.
   * - 1 (draw fully) when `end` ms have elapsed.
   * - linear progress between for the animated reveal window.
   *
   * The default LR2 result skin uses `start=500, end=2000` (a 1.5 s
   * reveal kicking in 0.5 s after timer 150 fires).
   */
  private revealRatio(timer: number, start: number, end: number): number {
    if (!this.timerStartedAt.has(timer) && timer !== 0) return 0;
    const elapsed = this.elapsedSinceTimer(timer);
    if (elapsed < start) return 0;
    if (end <= start) return 1;
    return Math.max(0, Math.min(1, (elapsed - start) / (end - start)));
  }

  /**
   * Draws a polyline through `points` (each `(x, y)` in `[0, 1]`)
   * inside the chart area anchored at `(anchorX, anchorY)`. Both
   * axes are mapped to design-space pixels:
   *
   * - x: `0 → anchorX`, `1 → anchorX + fieldWidth`.
   * - y: `0 → anchorY` (bottom edge), `1 → anchorY - fieldHeight`
   *   (top edge), matching LR2's bottom-left anchor convention.
   *
   * `revealRatio` clips the rightmost portion of the polyline so
   * the reveal animation walks across the chart area linearly. We
   * draw the full segment up to the last point at or before
   * `revealRatio` on the x axis, then a partial segment to the
   * exact reveal-x using the next-point lerp.
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
    // Walk the points until we cross the reveal cutoff. We need the
    // first point as the move-to anchor; subsequent points are
    // line-to. If the cutoff falls between two points we interpolate.
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
        // Identical-x sample (shouldn't really happen with monotonic
        // progress, but be defensive). Just stop here.
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
      // Single-sample series (chart that ended before any judges
      // fired): emit a tiny dot so the line still has visible
      // geometry. `lineTo` to the same point is a no-op in Pixi v8,
      // so we offset by half a pixel.
      graphic.lineTo(start.sx + 0.5, start.sy);
    }
    graphic.stroke({ color, width: lineWidth, alpha: 1, alignment: 0.5 });
    return graphic;
  }

  /**
   * Built-in fallback summary used when no LR2 result skin is
   * loaded (or the loaded skin has no result-anchored elements).
   * Renders the same data the skin would show, in a plain dark
   * panel — so the demo isn't blank between gameplay and select
   * even without a theme bundle.
   */
  private renderFallbackPanel(designWidth: number, designHeight: number): void {
    const result = this.result;
    if (!result) return;
    const panel = new Graphics();
    panel.label = 'result/fallback-panel';
    const padX = 80;
    const padY = 100;
    panel
      .roundRect(padX, padY, designWidth - padX * 2, designHeight - padY * 2, 16)
      .fill({ color: 0x10141d, alpha: 0.95 });
    this.fallbackLayer.addChild(panel);

    const titleStyle = new TextStyle({
      fill: TEXT,
      fontSize: 32,
      fontWeight: '800',
      fontFamily: 'system-ui, sans-serif',
    });
    const heading = new Text({ text: result.cleared ? 'CLEARED' : 'FAILED', style: titleStyle });
    heading.label = 'result/heading';
    heading.style.fill = result.cleared ? PASS : FAIL;
    heading.position.set(padX + 32, padY + 24);
    this.fallbackLayer.addChild(heading);

    const songText = new Text({
      text: `${result.song.title}${result.song.artist ? ` — ${result.song.artist}` : ''}`,
      style: new TextStyle({
        fill: ACCENT,
        fontSize: 20,
        fontWeight: '600',
        fontFamily: 'system-ui, sans-serif',
        wordWrap: true,
        wordWrapWidth: designWidth - padX * 2 - 64,
      }),
    });
    songText.label = 'result/song';
    songText.position.set(padX + 32, padY + 70);
    this.fallbackLayer.addChild(songText);

    const rate = result.score.total > 0 ? (result.score.exScore / (result.score.total * 2)) * 100 : 0;
    const lines: Array<[string, string]> = [
      ['SCORE', String(result.score.score)],
      ['EX SCORE', `${result.score.exScore} / ${result.score.total * 2}`],
      ['RATE', `${rate.toFixed(2)} %`],
      ['RANK', resolveRankLabel(result.score.exScore, result.score.total)],
      ['MAX COMBO', String(result.maxCombo)],
      ['PERFECT', String(result.score.perfect)],
      ['GREAT', String(result.score.great)],
      ['GOOD', String(result.score.good)],
      ['BAD', String(result.score.bad)],
      ['POOR', String(result.score.poor)],
    ];
    const rowHeight = 28;
    const colX = padX + 32;
    const valueX = padX + 240;
    for (let index = 0; index < lines.length; index += 1) {
      const [label, value] = lines[index]!;
      const labelText = new Text({
        text: label,
        style: new TextStyle({ fill: MUTED, fontSize: 16, fontFamily: 'system-ui, sans-serif' }),
      });
      labelText.position.set(colX, padY + 130 + index * rowHeight);
      this.fallbackLayer.addChild(labelText);
      const valueText = new Text({
        text: value,
        style: new TextStyle({ fill: TEXT, fontSize: 18, fontWeight: '600', fontFamily: 'system-ui, sans-serif' }),
      });
      valueText.position.set(valueX, padY + 130 + index * rowHeight);
      this.fallbackLayer.addChild(valueText);
    }

    const hintText = new Text({
      text: 'Press Enter / Space / Esc to continue',
      style: new TextStyle({ fill: MUTED, fontSize: 14, fontFamily: 'system-ui, sans-serif' }),
    });
    hintText.label = 'result/hint';
    hintText.position.set(padX + 32, designHeight - padY - 32);
    this.fallbackLayer.addChild(hintText);
  }

  /**
   * Per-frame interpolated DST for an element with a keyframe
   * sequence. Mirrors `pixi-select.evaluateElementDst`.
   */
  private evaluateElementDst(element: {
    destination: Lr2DestinationRect;
    keyframes: Lr2DestinationRect[];
  }): Lr2DestinationRect {
    if (element.keyframes.length > 1) {
      const elapsed = this.elapsedSinceTimer(element.destination.timer);
      return evaluateKeyframes(element.keyframes, elapsed);
    }
    return element.destination;
  }

  /**
   * Elapsed milliseconds since `timer` started. 0 when the timer
   * hasn't fired (which keeps `evaluateKeyframes` clamped at the
   * first keyframe — the LR2-correct "pre-fire" pose).
   */
  private elapsedSinceTimer(timer: number): number {
    const startedAt = this.timerStartedAt.get(timer);
    if (startedAt === undefined) {
      return 0;
    }
    return Math.max(0, performance.now() - startedAt);
  }

  /**
   * Whether `timer` is currently active. Result-screen DSTs that
   * gate on a not-yet-fired timer (the score panel that should
   * only appear after timer 151 fires) stay hidden until then.
   *
   * Defined as an arrow-property so it survives extraction into
   * the free `isDestinationVisible` helper without losing `this`.
   */
  private readonly timerActive = (timer: number): boolean => {
    if (timer === 0) return true;
    // Driven timers — active iff fired.
    if (timer === 1 || timer === 150 || timer === 151 || timer === 152) {
      return this.timerStartedAt.has(timer);
    }
    return false;
  };

  /**
   * `keydown` handler. Implements LR2's result-screen input ladder:
   *
   * - Before timer 1 fires (`#STARTINPUT` not elapsed) — input is
   *   ignored.
   * - Between 1 and 151 — Enter / Space "skip" the chart draw
   *   (advance directly to timer 151).
   * - Between 151 and 152 — Enter / Space fire timer 152 (the
   *   high-score-update press).
   * - After 152 — any of the three keys (Enter / Space / Escape)
   *   dismisses the scene via `onContinue`.
   * - Escape always dismisses, regardless of where we are in the
   *   timeline.
   */
  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.options.onContinue?.();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    this.advance();
  };

  private readonly handlePointerDown = (): void => {
    if (this.disposed) return;
    this.advance();
  };

  /**
   * Common "advance one step" path used by both keyboard and
   * pointer input. Splitting this out keeps the input-source-
   * specific event preventDefault / key-filter logic in the
   * respective handlers.
   */
  private advance(): void {
    if (!this.timerStartedAt.has(1)) {
      // `#STARTINPUT` hasn't elapsed — ignore the press. LR2
      // suppresses input here so the player can't accidentally
      // skip past the slide-in animation before the score panel
      // appears.
      return;
    }
    if (!this.timerStartedAt.has(151)) {
      // Skip the chart draw — fire timer 151 so the score panel
      // appears immediately. Mirrors LR2's gacha-press behaviour.
      this.timerStartedAt.set(151, performance.now());
      return;
    }
    if (!this.timerStartedAt.has(152)) {
      this.timerStartedAt.set(152, performance.now());
      return;
    }
    this.options.onContinue?.();
  }

  private makeStaticImageSprite(image: Lr2ImageElement): Sprite | undefined {
    const path = image.source.imagePath;
    let texture = this.skinTextures.get(path);
    if (!texture && isLr2SpecialGraphic(path)) {
      texture = this.resolveSpecialGraphicTexture(path);
    }
    if (!texture) return undefined;
    const dst = this.evaluateElementDst(image);
    const rect = normaliseRect(dst);
    if (rect.w <= 0 || rect.h <= 0) return undefined;
    let cropped: Texture;
    if (isLr2SpecialGraphic(path)) {
      cropped = texture;
    } else {
      const elapsed = this.elapsedSinceTimer(image.source.timer);
      const cell = pickAnimatedCell(image.source, elapsed, dst.loop);
      cropped = createCroppedTexture(texture, cell) ?? texture;
    }
    const sprite = new Sprite(cropped);
    sprite.label = `image[${path}]`;
    sprite.position.set(rect.x, rect.y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, dst);
    return sprite;
  }

  /**
   * Resolves the live texture for one of LR2's runtime-bound
   * graphic slots (BACKBMP / BANNER / STAGEFILE / black / white).
   * Triggers an async load on first miss; the next render will
   * pick up the cached texture once decode completes.
   *
   * On the result screen these point at the **just-played** chart
   * — the result data carries the song reference, so the path
   * resolver doesn't need to consult a navigation cursor.
   */
  private resolveSpecialGraphicTexture(path: Lr2SpecialGraphic): Texture | undefined {
    if (path === LR2_SPECIAL_GRAPHIC.BLACK || path === LR2_SPECIAL_GRAPHIC.WHITE) {
      return Texture.WHITE;
    }
    const result = this.result;
    if (!result) return undefined;
    const cacheKey = `${result.song.id}:${path}`;
    const cached = this.chartGraphicTextures.get(cacheKey);
    if (cached) return cached;
    if (!this.chartGraphicPending.has(cacheKey)) {
      this.chartGraphicPending.add(cacheKey);
      void this.loadChartGraphic(path, cacheKey);
    }
    return undefined;
  }

  private async loadChartGraphic(path: Lr2SpecialGraphic, cacheKey: string): Promise<void> {
    try {
      const result = this.result;
      const collection = this.options.collection;
      if (!result || !collection) return;
      const meta = result.song.chart.metadata;
      const assetPath =
        path === LR2_SPECIAL_GRAPHIC.BACKBMP
          ? meta.backBmp
          : path === LR2_SPECIAL_GRAPHIC.BANNER
            ? meta.banner
            : path === LR2_SPECIAL_GRAPHIC.STAGEFILE
              ? meta.stageFile
              : undefined;
      if (!assetPath) return;
      const source = resolveSongSource(collection, result.song);
      if (!source) return;
      const bytes = resolveChartAsset(source, result.song.chartPath, assetPath);
      if (!bytes) return;
      const texture = await loadTextureFromBytes(assetPath, bytes);
      if (texture) {
        this.chartGraphicTextures.set(cacheKey, texture);
        this.render();
      }
    } finally {
      this.chartGraphicPending.delete(cacheKey);
    }
  }

  /**
   * Renders a `#SRC_BARGRAPH` element. The base sprite is sliced
   * to a fraction of its source rect along the `muki` axis so
   * the bar appears progressively filled as `value` (0..1) grows.
   * Same approach as the gameplay bargraph — but standalone here
   * so the result module doesn't have to reach into the gameplay
   * file's class.
   */
  private makeBargraphSprite(element: Lr2BarGraphElement, dst: Lr2DestinationRect, value: number): Sprite | undefined {
    const texture = this.skinTextures.get(element.source.imagePath);
    if (!texture) return undefined;
    const rect = normaliseRect(dst);
    if (rect.w <= 0 || rect.h <= 0) return undefined;
    const ratio = Math.max(0, Math.min(1, value));
    const horizontal = element.muki === 'horizontal';
    const cropW = horizontal ? element.source.w * ratio : element.source.w;
    const cropH = horizontal ? element.source.h : element.source.h * ratio;
    const cropY = horizontal ? element.source.y : element.source.y + (element.source.h - cropH);
    const cropped = createCroppedTexture(texture, {
      x: element.source.x,
      y: cropY,
      w: cropW,
      h: cropH,
    });
    if (!cropped) return undefined;
    const sprite = new Sprite(cropped);
    sprite.label = `bargraph[type=${element.type}]`;
    sprite.position.set(rect.x, horizontal ? rect.y : rect.y + rect.h * (1 - ratio));
    sprite.width = horizontal ? rect.w * ratio : rect.w;
    sprite.height = horizontal ? rect.h : rect.h * ratio;
    applyDestinationToSprite(sprite, dst);
    return sprite;
  }

  /**
   * Renders a `#SRC_SLIDER` element. The slider's "knob" sits at
   * a position along the DST track determined by `value` (0..1)
   * and the source's `muki` direction. We don't (yet) support
   * dragging the knob — sliders are read-only on the result
   * screen, the spec primarily uses them to draw "score relative
   * to perfect" indicators.
   */
  private makeSliderSprite(element: Lr2SliderElement, dst: Lr2DestinationRect, value: number): Sprite | undefined {
    const texture = this.skinTextures.get(element.source.imagePath);
    if (!texture) return undefined;
    const rect = normaliseRect(dst);
    if (rect.w <= 0 || rect.h <= 0) return undefined;
    const ratio = Math.max(0, Math.min(1, value));
    const cropped = createCroppedTexture(texture, {
      x: element.source.x,
      y: element.source.y,
      w: element.source.w / Math.max(1, element.source.divx),
      h: element.source.h / Math.max(1, element.source.divy),
    });
    if (!cropped) return undefined;
    const sprite = new Sprite(cropped);
    sprite.label = `slider[type=${element.type}]`;
    let x = rect.x;
    let y = rect.y;
    switch (element.muki) {
      case 'down':
        y = rect.y + element.range * ratio;
        break;
      case 'up':
        y = rect.y - element.range * ratio;
        break;
      case 'right':
        x = rect.x + element.range * ratio;
        break;
      case 'left':
        x = rect.x - element.range * ratio;
        break;
    }
    sprite.position.set(x, y);
    sprite.width = rect.w;
    sprite.height = rect.h;
    applyDestinationToSprite(sprite, dst);
    return sprite;
  }
}

// -- Free helpers (mirrors `pixi-select.ts`) --------------------------------

/**
 * Computes the LR2 op set for the result screen. Combines the
 * always-true `RESULT_BASE_OPS` with per-result flags derived from
 * the chart and the score:
 *
 * - **Cleared / failed** (op 90 / 91) — gates the chrome atlas
 *   (`parts.tga` vs `parts_fail.tga`) plus the big "CLEARED" /
 *   "FAILED" graphic in the LR2 default skin.
 * - **Bar / playable** — the result screen is always "on a song",
 *   so op 2/5 stay set.
 * - **Key mode** — set in BOTH the SELECT range (160..164, for
 *   skins that mirror select gating) AND the KEYCONFIG range
 *   (400..402, used by the default `result_normal.csv`).
 * - **Difficulty** (op 150..155) — echoed onto the result screen
 *   so per-difficulty panels (`#IF,400,152`) gate correctly.
 * - **Clear lamp** (op 101..105) — derived from `data.cleared`,
 *   judge counts, and `maxCombo`.
 * - **Result rank** — current rank lives in 300..308 (1P), pre-
 *   update in 320..328, post-update in 340..347. Without score
 *   history the "previous" rank is rank-0 (op 328 / "F" tier).
 * - **Updated flags** (op 330/331/332/335) — until score history
 *   persists, every play is treated as an update so the LR2
 *   default skin's congratulatory artwork shows.
 * - **Result flip** (op 350/351) — toggled from the played skin's
 *   `scratchFlip.flipResult`.
 */
export function computeResultOps(data: PixiGameplayResultData, skin: Lr2Skin): ReadonlySet<number> {
  const ops = new Set<number>(RESULT_BASE_OPS);
  ops.add(data.cleared ? RESULT_DYNAMIC_OPS.RESULT_CLEARED : RESULT_DYNAMIC_OPS.RESULT_FAILED);
  ops.add(RESULT_DYNAMIC_OPS.BAR_IS_SONG);
  ops.add(RESULT_DYNAMIC_OPS.BAR_IS_PLAYABLE);

  // Key mode set in both ranges so a skin can gate either way.
  for (const op of resolveKeyModeOps(data)) {
    ops.add(op);
  }
  ops.add(resolveDifficultyOp(data));
  ops.add(resolveResultLampOp(data));
  // Current 1P rank goes into the 300 / 340 ranges (the result-
  // screen-specific slots — 200..207 is the SELECT-side rank op
  // and the LR2 default skin doesn't gate on it). Both "now" and
  // "next" carry the same value because we don't yet persist a
  // best-score baseline to compare against.
  const rankIndex = resolveResultRankIndex(data);
  ops.add(RESULT_DYNAMIC_OPS.RANK_NOW_AAA + rankIndex);
  ops.add(RESULT_DYNAMIC_OPS.RANK_NEXT_AAA + rankIndex);
  // Pre-update rank is rank-0 (no prior history) — the default
  // skin uses 328 ("0" tier) for that, with 320..327 reserved for
  // each historical rank.
  ops.add(RESULT_DYNAMIC_OPS.RANK_PREV_0);

  // No score history yet — claim "updated" on every result.
  ops.add(RESULT_DYNAMIC_OPS.SCORE_UPDATED);
  ops.add(RESULT_DYNAMIC_OPS.MAXCOMBO_UPDATED);
  ops.add(RESULT_DYNAMIC_OPS.MIN_BP_UPDATED);
  ops.add(RESULT_DYNAMIC_OPS.RANK_UPDATED);

  // Result-flip status toggled from the gameplay skin (#FLIPRESULT).
  // Default-disabled is already in `RESULT_BASE_OPS`; if the skin
  // declares flipResult we swap to the enabled slot.
  if (skin.scratchFlip.flipResult) {
    ops.delete(RESULT_DYNAMIC_OPS.RESULT_FLIP_DISABLED);
    ops.add(RESULT_DYNAMIC_OPS.RESULT_FLIP_ENABLED);
  }

  return ops;
}

/**
 * Returns the LR2 ops needed to advertise the played chart's key
 * mode on the result screen. Sets the matching slot in BOTH the
 * select-screen range (160..164) and the result-screen KEYCONFIG
 * range (400..402) — different skin authors gate either way and
 * the two ranges aren't redundant gating-wise (KEYCONFIG groups
 * 7+14 / 5+10 together).
 */
function resolveKeyModeOps(data: PixiGameplayResultData): number[] {
  const modeHint = data.song.chart.bmson.info?.modeHint?.toLowerCase() ?? '';
  let selectOp: number;
  if (modeHint.includes('14k')) selectOp = RESULT_DYNAMIC_OPS.KEYS_14;
  else if (modeHint.includes('10k')) selectOp = RESULT_DYNAMIC_OPS.KEYS_10;
  else if (modeHint.includes('9k')) selectOp = RESULT_DYNAMIC_OPS.KEYS_9;
  else if (modeHint.includes('7k')) selectOp = RESULT_DYNAMIC_OPS.KEYS_7;
  else if (modeHint.includes('5k')) selectOp = RESULT_DYNAMIC_OPS.KEYS_5;
  else {
    let usesPlayer2 = false;
    let uses6or7 = false;
    for (const event of data.song.chart.events) {
      const ch = event.channel;
      if (!ch || ch.length !== 2) continue;
      if (ch[0] === '2') usesPlayer2 = true;
      if (ch === '18' || ch === '19' || ch === '28' || ch === '29') uses6or7 = true;
      if (usesPlayer2 && uses6or7) break;
    }
    if (usesPlayer2 || data.song.chart.bms.player === 3) {
      selectOp = uses6or7 ? RESULT_DYNAMIC_OPS.KEYS_14 : RESULT_DYNAMIC_OPS.KEYS_10;
    } else {
      selectOp = uses6or7 ? RESULT_DYNAMIC_OPS.KEYS_7 : RESULT_DYNAMIC_OPS.KEYS_5;
    }
  }
  // Map the select-range op onto the KEYCONFIG range. 7K + 14K
  // share op 400 because the LR2 default skin doesn't draw a
  // separate 14K layout. Likewise 5K + 10K share 402.
  let keyConfigOp: number;
  if (selectOp === RESULT_DYNAMIC_OPS.KEYS_9) {
    keyConfigOp = RESULT_DYNAMIC_OPS.KEYCONFIG_9;
  } else if (selectOp === RESULT_DYNAMIC_OPS.KEYS_5 || selectOp === RESULT_DYNAMIC_OPS.KEYS_10) {
    keyConfigOp = RESULT_DYNAMIC_OPS.KEYCONFIG_5_10;
  } else {
    keyConfigOp = RESULT_DYNAMIC_OPS.KEYCONFIG_7_14;
  }
  return [selectOp, keyConfigOp];
}

function resolveDifficultyOp(data: PixiGameplayResultData): number {
  switch (data.song.chart.metadata.difficulty) {
    case 1:
      return RESULT_DYNAMIC_OPS.DIFFICULTY_EASY;
    case 2:
      return RESULT_DYNAMIC_OPS.DIFFICULTY_NORMAL;
    case 3:
      return RESULT_DYNAMIC_OPS.DIFFICULTY_HYPER;
    case 4:
      return RESULT_DYNAMIC_OPS.DIFFICULTY_ANOTHER;
    case 5:
      return RESULT_DYNAMIC_OPS.DIFFICULTY_INSANE;
    default:
      // Real LR2 maps "no difficulty declared" to the NORMAL slot
      // for the result-screen panel split (the default skin only
      // ships per-difficulty graphics for 152..155 and would
      // otherwise leave the panel blank). Mirror that.
      return RESULT_DYNAMIC_OPS.DIFFICULTY_NORMAL;
  }
}

/**
 * Picks the clear-lamp op for the played chart. Priority:
 *
 *   1. **Failed** (op 101) — gauge ended below the pass threshold.
 *   2. **Full combo** (op 105) — every note hit GREAT-or-better
 *      AND at least one note exists.
 *   3. **Hard clear** (op 104) — placeholder for HARD-style gauges
 *      (not yet selectable; we never set this today).
 *   4. **Normal clear** (op 103) — the default for any cleared
 *      play with at least one BAD/POOR.
 *   5. **Easy clear** (op 102) — placeholder for EASY-style gauge.
 */
function resolveResultLampOp(data: PixiGameplayResultData): number {
  if (!data.cleared) {
    return RESULT_DYNAMIC_OPS.LAMP_FAILED;
  }
  if (data.score.total > 0 && data.score.bad === 0 && data.score.poor === 0) {
    return RESULT_DYNAMIC_OPS.LAMP_FULL_COMBO;
  }
  // Single gauge type today — every clear maps to NORMAL. Once
  // gauge-type selection lands, branch on that here for HARD / EASY.
  return RESULT_DYNAMIC_OPS.LAMP_NORMAL;
}

/**
 * Returns the rank index 0..7 (0=AAA, 7=F) for the played chart.
 * Used to seed both the "current" (300+i) and "after-update"
 * (340+i) result-rank slots. The rank-0 slot (308 / 348) is
 * reserved for charts with `total === 0` — we map those to AAA
 * here so something visible always renders.
 */
function resolveResultRankIndex(data: PixiGameplayResultData): number {
  if (data.score.total <= 0) return 0;
  const rate = data.score.exScore / (data.score.total * 2);
  if (rate >= 8 / 9) return 0;
  if (rate >= 7 / 9) return 1;
  if (rate >= 6 / 9) return 2;
  if (rate >= 5 / 9) return 3;
  if (rate >= 4 / 9) return 4;
  if (rate >= 3 / 9) return 5;
  if (rate >= 2 / 9) return 6;
  return 7;
}

/**
 * Resolves an LR2 `#SRC_NUMBER` slot to a numeric value from the
 * play result. Coverage matches `docs/LR2SkinHelp.md` `# num 一覧`:
 *
 * - **70..76** — best-score panel slots, treated here as the
 *   just-played chart's totals (no history yet, so "best" =
 *   "current"). 72 = theoretical EX max = `totalNotes * 2`.
 * - **77..89** — best-score-style "perfect / great / …". Mapped
 *   to the just-played counts since the result screen is the
 *   one place they actually mean "this play".
 * - **100..116** — gameplay-side panel reused for live readouts.
 *   The skin authors use these on the result screen too because
 *   they share a num namespace.
 * - **170..184** — result-specific high-score deltas. Without
 *   persistence the "before" value is 0 and the "now" / "diff"
 *   values are the live scores.
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
    case 70:
      return score.score;
    case 71:
      return score.exScore;
    case 72:
      return exMax;
    case 73:
      // LR2 spec: rate as integer percent.
      return Math.round(rate * 100);
    case 74:
      return totalNotes;
    case 75:
      return data.maxCombo;
    case 76:
      return minBp;
    case 77: // playcount
    case 78: // clear
    case 79: // fail
      return 0;
    case 80:
      return score.perfect;
    case 81:
      return score.great;
    case 82:
      return score.good;
    case 83:
      return score.bad;
    case 84:
      return score.poor;
    case 85:
      return totalNotes > 0 ? Math.round((score.perfect / totalNotes) * 100) : 0;
    case 86:
      return totalNotes > 0 ? Math.round((score.great / totalNotes) * 100) : 0;
    case 87:
      return totalNotes > 0 ? Math.round((score.good / totalNotes) * 100) : 0;
    case 88:
      return totalNotes > 0 ? Math.round((score.bad / totalNotes) * 100) : 0;
    case 89:
      return totalNotes > 0 ? Math.round((score.poor / totalNotes) * 100) : 0;
    case 90:
    case 91:
      return data.song.bpm ?? data.song.chart.metadata.bpm;
    case 100:
      return score.score;
    case 101:
      return score.exScore;
    case 102:
      return Math.round(rate * 100);
    case 103:
      return Math.round(rate * 10000);
    case 104:
      // Result screen: there's no "live" combo, but the LR2 default
      // skin reuses num=104 for the per-result "MAX COMBO" digit
      // panel as a fallback. Surface the achieved max combo so the
      // panel doesn't read 0.
      return data.maxCombo;
    case 105:
      return data.maxCombo;
    case 106:
      return totalNotes;
    case 107:
      return Math.round(data.gauge);
    case 110:
      return score.perfect;
    case 111:
      return score.great;
    case 112:
      return score.good;
    case 113:
      return score.bad;
    case 114:
      return score.poor;
    case 115:
      return Math.round(rate * 100);
    case 116:
      return Math.round(rate * 10000) % 100;
    case 161:
      return Math.floor(data.playSeconds / 60);
    case 162:
      return Math.floor(data.playSeconds % 60);
    case 165:
      return 100;
    // Result-specific high-score deltas. "before" = 0 (no history),
    // "now" = the live values, "diff" = "now" - "before" = "now".
    case 170: // EX score (before)
      return 0;
    case 171: // EX score (now)
      return score.exScore;
    case 172: // EX score (diff)
      return score.exScore;
    case 173: // max combo (before)
      return 0;
    case 174: // max combo (now)
      return data.maxCombo;
    case 175: // max combo (diff)
      return data.maxCombo;
    case 176: // min B+P (before)
      // Without history, treat the "before" number as the chart's
      // theoretical worst (every note BAD) so the diff column
      // shows a positive improvement.
      return totalNotes;
    case 177: // min B+P (now)
      return minBp;
    case 178: // min B+P (diff)
      return Math.max(0, totalNotes - minBp);
    case 183: // rate (before)
      return 0;
    case 184: // rate (before, decimals)
      return 0;
    default:
      return undefined;
  }
}

function resolveResultText(st: number, data: PixiGameplayResultData): string | undefined {
  const song = data.song;
  const subartists = song.chart.bmson.info?.subartists?.join(' / ');
  switch (st) {
    case 1:
      return 'TARGET';
    case 2:
      return 'PLAYER';
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
 * Resolves an LR2 `#SRC_BARGRAPH` `type` to the 0..1 fill ratio.
 * Result-screen bargraphs are usually anchored to score / EX-score
 * progress against theoretical max, so the same value drives both
 * the "rate" digits and the bargraph fill.
 *
 * Returns `undefined` for type codes outside the result-relevant
 * range; the renderer skips those.
 */
function resolveResultBargraphValue(type: number, data: PixiGameplayResultData): number | undefined {
  // Per `bargraph.txt`: 1 = score, 2 = exscore, 3 = exscore best,
  // 4 = exscore target, 6 = gauge, 7 = max-combo, 9 = rate. Many
  // result skins use type 1 / 2 / 9 for the EX-score progress bar.
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
  // Slider types overlap with bargraph types in the LR2 spec; the
  // result screen typically only wires "song progress" (type 1)
  // and "rate" (type 6). Reuse the bargraph resolver so any new
  // slot landing in either gets one shared implementation.
  return resolveResultBargraphValue(type, data);
}

function resolveRankLabel(exScore: number, total: number): string {
  if (total <= 0) return 'AAA';
  const rate = exScore / (total * 2);
  if (rate >= 8 / 9) return 'AAA';
  if (rate >= 7 / 9) return 'AA';
  if (rate >= 6 / 9) return 'A';
  if (rate >= 5 / 9) return 'B';
  if (rate >= 4 / 9) return 'C';
  if (rate >= 3 / 9) return 'D';
  if (rate >= 2 / 9) return 'E';
  return 'F';
}

/**
 * `pixi-select.ts` has the canonical version of this helper. Kept
 * private to this file (not imported) so the result module
 * remains self-contained — the visibility predicate is small, and
 * factoring it would cross-couple two scenes that otherwise share
 * no state.
 */
function isDestinationVisible(
  destination: Lr2DestinationRect,
  ops: ReadonlySet<number>,
  timerActive: (timer: number) => boolean,
): boolean {
  if (!timerActive(destination.timer)) {
    return false;
  }
  for (const op of destination.ops) {
    if (op === 0) continue;
    if (op > 0) {
      if (!ops.has(op)) {
        return false;
      }
    } else if (ops.has(-op)) {
      return false;
    }
  }
  return true;
}

function makeTextSprite(value: string, element: Lr2TextElement, dst: Lr2DestinationRect): Text {
  const rect = normaliseRect(dst);
  const fontSize = clampFontSize(rect.h - 2, 8, 18);
  const text = new Text({
    text: value,
    style: new TextStyle({
      fill: dst.alpha > 0 ? (dst.r << 16) | (dst.g << 8) | dst.b : 0xffffff,
      fontSize,
      fontFamily: 'system-ui, sans-serif',
      wordWrap: rect.w > 0,
      wordWrapWidth: rect.w > 0 ? rect.w : undefined,
      // 袋文字 stroke matches the select-screen text path so result
      // titles stay legible against busy stagefile / skin frames.
      stroke: { color: 0x000000, width: 2, alignment: 0.5, join: 'round' },
    }),
  });
  text.label = `text[st=${element.st}]`;
  text.alpha = dst.alpha;
  if (element.alignment === 'center') {
    text.anchor.set(0.5, 0);
  } else if (element.alignment === 'right') {
    text.anchor.set(1, 0);
  } else {
    text.anchor.set(0, 0);
  }
  text.position.set(rect.x, rect.y);
  return text;
}

function clampFontSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function resolveScaledViewport(
  screenWidth: number,
  screenHeight: number,
  designWidth: number = LR2_DESIGN_WIDTH,
  designHeight: number = LR2_DESIGN_HEIGHT,
): { x: number; y: number; scale: number } {
  const scale = Math.min(screenWidth / designWidth, screenHeight / designHeight);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: (screenWidth - designWidth * safeScale) / 2,
    y: (screenHeight - designHeight * safeScale) / 2,
    scale: safeScale,
  };
}

// `Lr2ImageRect` is referenced in the imports for `makeBargraphSprite`'s
// `element.source` type narrowing — exporting nothing else from this
// module beyond the public API surface above. Re-export to keep
// downstream consumers from having to import from `lr2-skin.ts`
// directly when wiring up a result scene.
export type { Lr2ImageRect };
