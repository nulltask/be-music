import { Graphics, type Container } from 'pixi.js';
import type {
  BeatorajaDestinationGroup,
  BeatorajaTimingDistributionGraphElement,
  BeatorajaTimingVisualizerElement,
} from '@be-music/skin-beatoraja';
import type { BeMusicJudgeWindowSet } from '@be-music/player-skin-sdk';
import type { destinationToSpriteProps } from '../../../skin/beatoraja/render.ts';
import type { BeatorajaPlaySkinViewOptions } from './options.ts';

export interface TimingVisualizerEntry {
  kind: 'timingvisualizer';
  group: BeatorajaDestinationGroup;
  element: BeatorajaTimingVisualizerElement;
  /**
   * Pixi `Graphics` painting the recent-timing tick marks + center / band guides. Re-stroked
   * whenever the sample count or the most-recent sample changes; older samples shift up the
   * decay tail without invalidating the buffer's earlier paint.
   */
  graphics: Graphics;
  /** Cached signature of the last sample list — same idea as judgegraph's `lastSignature`. */
  lastSignature: string;
}

export interface TimingDistributionEntry {
  kind: 'timingdistribution';
  group: BeatorajaDestinationGroup;
  element: BeatorajaTimingDistributionGraphElement;
  /**
   * Pixi `Graphics` painting the per-ms histogram + optional average / std-dev overlays.
   * Re-stroked whenever the sample count changes — typically a static result-scene paint.
   */
  graphics: Graphics;
  /** Cached sample-count signature so per-frame stroke is skipped after first paint. */
  lastSampleCount: number;
}

/**
 * Builds and updates the `timingvisualizer[]` and `timingdistributiongraph[]` entries of a
 * {@link BeatorajaPlaySkinView}.
 */
export class BeatorajaTimingGraphRenderer {
  private readonly container: Container;
  private readonly resolveTimingSamples: () => ReadonlyArray<{ deltaMs: number; kind: string }> | undefined;
  private readonly resolveTimingDistribution: () => ReadonlyArray<{ deltaMs: number; kind: string }> | undefined;
  private readonly resolveTimingJudgeWindows: () => TimingVisualizerWindows | undefined;

  constructor(container: Container, options: BeatorajaPlaySkinViewOptions) {
    this.container = container;
    this.resolveTimingSamples = options.resolveTimingSamples ?? (() => undefined);
    this.resolveTimingDistribution = options.resolveTimingDistribution ?? (() => undefined);
    this.resolveTimingJudgeWindows = options.resolveTimingJudgeWindows ?? (() => IIDX_NORMAL_JUDGE_WINDOWS);
  }

  /** Build a timingvisualizer entry — same Graphics-node + rebuild-on-change pattern. */
  buildTimingVisualizerEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaTimingVisualizerElement,
  ): TimingVisualizerEntry {
    const graphics = new Graphics();
    graphics.alpha = 0;
    this.container.addChild(graphics);
    return { kind: 'timingvisualizer', group, element, graphics, lastSignature: '' };
  }

  /** Build a timingdistributiongraph entry — same Graphics-node + rebuild-on-change pattern. */
  buildTimingDistributionEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaTimingDistributionGraphElement,
  ): TimingDistributionEntry {
    const graphics = new Graphics();
    graphics.alpha = 0;
    this.container.addChild(graphics);
    return { kind: 'timingdistribution', group, element, graphics, lastSampleCount: -1 };
  }

  /**
   * Update a timingvisualizer entry. Mirrors upstream `SkinTimingVisualizer.prepare()` +
   * `.draw()` (`SkinTimingVisualizer.java:76-149`):
   *
   *   1. **Background** — paints the play's judge windows as stacked colour bands radiating
   *      outward from the centre line ({@link resolveTimingVisualizerBands}). PG band sits
   *      innermost, then GR / GD / BD / PR. Each band reaches the matching window's late ms
   *      to the left and its early ms to the right, mapped through `judgeWidthRate = width /
   *      (judgeWidthMillis * 2 + 1)`. Defaults to IIDX-NORMAL windows when no host resolver is
   *      wired (decide / select scenes / headless tests); no bands while a wired resolver has
   *      no windows yet.
   *   2. **Tick marks** — semi-transparent black lines every 10 ms, painted on top of the
   *      bands as a fine-grain ruler.
   *   3. **Sample lines** — recent-judge offsets from {@link resolveTimingSamples}. Each
   *      sample is one vertical line at the matching x ({@link resolveTimingVisualizerSampleX}:
   *      early judgments right of the centre, late ones left, as beatoraja draws them); with
   *      `drawDecay = 1` (the reference theme default) the line height tapers from full at the
   *      newest sample to zero at the oldest, vertically centred in the region.
   *
   * Renders the bands AND tick marks even when no samples have arrived yet — upstream
   * generates the background on chart load (per BMSModel-change), independent of judge
   * activity. The previous implementation hid the entire visualizer until the first hit,
   * which hid the player-facing band-window cue too.
   */
  updateTimingVisualizerEntry(entry: TimingVisualizerEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const graphics = entry.graphics;
    graphics.visible = props.visible;
    if (!props.visible) return;
    const samples = this.resolveTimingSamples() ?? [];
    // Half-width in ms — author-supplied or fallback. ±150 ms covers the BAD window in
    // upstream's IIDX-NORMAL judge rule; matches `JSONSkin.TimingVisualizer.judgeWidthMillis`
    // default.
    const halfWidthMs = entry.element.judgeWidthMillis > 0 ? entry.element.judgeWidthMillis : 150;
    const lineWidthPx = entry.element.lineWidth > 0 ? entry.element.lineWidth : 1;
    // Authored `width` (default 301) drives the px/ms RATE, mirroring upstream
    // `SkinTimingVisualizer.java:63`:
    //
    //     judgeWidthRate = width / (judgeWidthMillis * 2 + 1)   // px per ms
    //
    // The dst rect is independently centered on `region.width` (line 144 in upstream uses
    // `region.x + (region.width - lineWidth) / 2 + recent[j] * judgeWidthRate`). This means
    // sample-line offsets are computed from authored `width`, but their CENTERING uses the
    // runtime `region.width`. Identical when `dst.w == width` (the typical authoring); for
    // animating dst rects the author sees the authored ms scale stay constant.
    const authoredWidth = entry.element.width > 0 ? entry.element.width : 301;
    const judgeWidthRate = authoredWidth / (halfWidthMs * 2 + 1);
    const centerLineLeft = (props.width - lineWidthPx) / 2;
    // The play's judge windows; IIDX-NORMAL defaults when no host resolver is wired.
    const windows = this.resolveTimingJudgeWindows();
    // Authored band colours — fall through to upstream `JSONSkin.TimingVisualizer` defaults
    // when the skin omits a value (matches `JSONSkin.java`'s static initializer values).
    const colors = {
      center: parseHexColor(entry.element.centerColor) ?? DEFAULT_TIMING_VISUALIZER_COLORS.center,
      pg: parseHexColor(entry.element.pgColor) ?? DEFAULT_TIMING_VISUALIZER_COLORS.pg,
      gr: parseHexColor(entry.element.grColor) ?? DEFAULT_TIMING_VISUALIZER_COLORS.gr,
      gd: parseHexColor(entry.element.gdColor) ?? DEFAULT_TIMING_VISUALIZER_COLORS.gd,
      bd: parseHexColor(entry.element.bdColor) ?? DEFAULT_TIMING_VISUALIZER_COLORS.bd,
      pr: parseHexColor(entry.element.prColor) ?? DEFAULT_TIMING_VISUALIZER_COLORS.pr,
      line: parseHexColor(entry.element.lineColor) ?? DEFAULT_TIMING_VISUALIZER_COLORS.line,
    };
    const transparentPr = entry.element.transparent === 1;

    // Build a cheap signature covering everything the static layer depends on plus the
    // newest-sample identity. Re-strokes only when one of these changes — cheap per-frame
    // path the rest of the time.
    const lastSample = samples.length > 0 ? samples[samples.length - 1]! : undefined;
    const signature = [
      samples.length,
      lastSample?.deltaMs.toFixed(1) ?? '-',
      lastSample?.kind ?? '-',
      props.width,
      props.height,
      timingWindowsSignature(windows),
      colors.center,
      colors.pg,
      colors.gr,
      colors.gd,
      colors.bd,
      colors.pr,
      transparentPr ? 1 : 0,
    ].join('|');
    if (signature !== entry.lastSignature) {
      graphics.clear();
      // ─── 1. Background bands (upstream `SkinTimingVisualizer.prepare` line 90-117) ─────
      if (props.height > 0 && props.width > 0) {
        const centerX = props.width / 2;
        // Centre stripe — 1 px wide at the perfect-timing axis.
        graphics.rect(centerX - 0.5, 0, 1, props.height).fill({ color: colors.center, alpha: 1 });
        if (windows !== undefined) {
          const bands = resolveTimingVisualizerBands(windows, colors, {
            centerX,
            judgeWidthRate,
            halfWidthMs,
            transparentPr,
          });
          for (const band of bands) {
            graphics.rect(band.x, 0, band.width, props.height).fill({ color: band.color, alpha: 1 });
          }
        }
        // ─── 2. Tick marks (upstream line 114-117) ─────────────────────────────────
        // Every 10 ms (in scaled px), paint a thin semi-transparent black line.
        // Upstream walks `for (int x = center % 10; x < pwidth; x += 10)`. We mirror
        // by stepping in ms.
        for (let ms = -halfWidthMs; ms <= halfWidthMs; ms += 10) {
          if (ms === 0) continue;
          const x = centerX + ms * judgeWidthRate;
          if (x >= 0 && x <= props.width) {
            graphics.rect(x - 0.5, 0, 1, props.height).fill({ color: 0x000000, alpha: 0.25 });
          }
        }
      }
      // ─── 3. Sample lines (upstream `draw()` at line 137-149) ──────────────────────
      // Newest paints brightest, oldest faintest. Sample list is oldest-first.
      // Two height modes per beatoraja's `SkinTimingVisualizer.draw()`:
      //
      //  - `drawDecay !== 0` — each tick's height is `region.h * i / n` (i = age index,
      //    0..n-1 with 0 = oldest). Taller for newer, zero for oldest. Vertically centred
      //    in the region so the taper grows symmetrically from the middle. Mirrors
      //    upstream's `region.y + h*(n-i)/n / 2` y-anchor + `h * i / n` height.
      //  - `drawDecay === 0` — every tick paints at full region height. Just the alpha fade
      //    carries the age cue.
      //
      // Sample colour comes from the configured `lineColor` (upstream uses a single
      // `lineColors[]` array indexed by age, all derived from `lineColor`). The previous
      // per-judge-kind tint was a deviation from upstream's behaviour.
      const drawDecay = entry.element.drawDecay !== 0;
      for (let i = 0; i < samples.length; i += 1) {
        const sample = samples[i]!;
        const ageRatio = (i + 1) / samples.length; // 1 = newest, 0 ≈ oldest
        const alpha = ageRatio;
        const x = resolveTimingVisualizerSampleX(sample.deltaMs, { centerLineLeft, judgeWidthRate, halfWidthMs });
        let y: number;
        let height: number;
        if (drawDecay) {
          height = (props.height * i) / samples.length;
          y = (props.height - height) / 2;
        } else {
          y = 0;
          height = props.height;
        }
        graphics.rect(x, y, lineWidthPx, height).fill({
          color: colors.line,
          alpha,
        });
      }
      entry.lastSignature = signature;
    }
    graphics.x = props.x;
    graphics.y = props.y;
    graphics.alpha = props.alpha;
    graphics.tint = props.tint;
    graphics.angle = props.angle;
    graphics.blendMode = props.blendMode;
  }

  /**
   * Update a timingdistribution entry. Bins every judgement's signed delta into a per-ms
   * histogram across the destination box (one bar per ms bucket; bar height ∝ count), early
   * judgments right of the centre and late ones left as beatoraja bins them
   * ({@link resolveTimingDistributionBin}). Each bar is colored by the most-recent judgement
   * kind that landed at that bucket — a rough but informative cue. Optional average-line and
   * stddev-band overlays draw on top, on the same side.
   *
   * Hidden when:
   *   - The destination's standard `props` say so
   *   - The resolver returned `undefined` / fewer than 2 samples (no useful distribution)
   */
  updateTimingDistributionEntry(
    entry: TimingDistributionEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
  ): void {
    const graphics = entry.graphics;
    graphics.visible = props.visible;
    if (!props.visible) return;
    const samples = this.resolveTimingDistribution();
    if (samples === undefined || samples.length < 2) {
      graphics.visible = false;
      return;
    }
    if (entry.lastSampleCount !== samples.length) {
      graphics.clear();
      // Bin samples by ms bucket. We span the destination box from −halfWidthMs..+halfWidthMs;
      // pick a half-width that covers the most-extreme samples (clipped to a sensible cap so
      // a single outlier doesn't squish the visualization). 200ms covers the full BAD window.
      let extreme = 0;
      for (const s of samples) {
        const abs = Math.abs(s.deltaMs);
        if (abs > extreme) extreme = abs;
      }
      const halfWidthMs = Math.max(50, Math.min(200, Math.ceil(extreme)));
      const binCount = halfWidthMs * 2 + 1; // one bin per ms, inclusive of 0
      const counts = new Int32Array(binCount);
      const lastKindByBin: Array<string | undefined> = Array.from({ length: binCount });
      let sum = 0;
      let sumSq = 0;
      for (const s of samples) {
        const idx = resolveTimingDistributionBin(s.deltaMs, halfWidthMs);
        if (idx === undefined) continue;
        counts[idx]! += 1;
        lastKindByBin[idx] = s.kind;
        // In beatoraja's sign (> 0 early), so the average and deviation land on the bars' side.
        const offsetMs = beatorajaTimingOffsetMs(s.deltaMs);
        sum += offsetMs;
        sumSq += offsetMs * offsetMs;
      }
      // Bar dimensions. `lineWidth` from the skin (or fallback to 1px / bin) governs bar
      // thickness; the renderer never draws bars wider than `props.width / binCount` so the
      // histogram fits.
      const maxBarWidth = props.width / binCount;
      const barWidth = Math.max(1, Math.min(maxBarWidth, entry.element.lineWidth || 1));
      let maxCount = 0;
      for (let i = 0; i < binCount; i += 1) {
        if (counts[i]! > maxCount) maxCount = counts[i]!;
      }
      if (maxCount > 0) {
        for (let i = 0; i < binCount; i += 1) {
          const count = counts[i]!;
          if (count === 0) continue;
          const barH = (count / maxCount) * props.height;
          const x = (i / binCount) * props.width;
          const y = props.height - barH;
          graphics.rect(x, y, barWidth, barH).fill({
            color: judgeColorFor(lastKindByBin[i] ?? ''),
            alpha: 1,
          });
        }
      }
      // Center guide — perfect-timing reference column.
      graphics.rect(props.width / 2 - 0.5, 0, 1, props.height).fill({ color: 0xffffff, alpha: 0.4 });
      // Average + stddev overlays (when authored).
      if (samples.length > 0) {
        const avg = sum / samples.length;
        const variance = sumSq / samples.length - avg * avg;
        const stddev = Math.sqrt(Math.max(0, variance));
        const xForMs = (ms: number): number =>
          ((Math.max(-halfWidthMs, Math.min(halfWidthMs, ms)) + halfWidthMs) / binCount) * props.width;
        if (entry.element.drawAverage !== 0) {
          graphics.rect(xForMs(avg) - 0.5, 0, 1, props.height).fill({ color: 0xffaa00, alpha: 0.8 });
        }
        if (entry.element.drawDev !== 0 && stddev > 0) {
          const left = xForMs(avg - stddev);
          const right = xForMs(avg + stddev);
          graphics.rect(left, props.height - 2, Math.max(1, right - left), 2).fill({ color: 0x00aaff, alpha: 0.7 });
        }
      }
      entry.lastSampleCount = samples.length;
    }
    graphics.x = props.x;
    graphics.y = props.y;
    graphics.alpha = props.alpha;
    graphics.tint = props.tint;
    graphics.angle = props.angle;
    graphics.blendMode = props.blendMode;
  }
}

/**
 * Map a judge-kind string (`PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR`) to the tick color
 * the timingvisualizer paints. Colors mirror beatoraja's reference theme palette — yellow for
 * PERFECT (PG), green / blue / red / purple for the lower tiers. Unknown kinds default to white.
 */
export function judgeColorFor(kind: string): number {
  switch (kind) {
    case 'PERFECT':
      return 0xffff00;
    case 'GREAT':
      return 0x00ff00;
    case 'GOOD':
      return 0x00aaff;
    case 'BAD':
      return 0xff0000;
    case 'POOR':
      return 0xff00ff;
    default:
      return 0xffffff;
  }
}

/** The judge windows a `timingvisualizer[]` paints its bands from: each judgment's early and late reach in ms. */
export type TimingVisualizerWindows = Pick<BeMusicJudgeWindowSet, 'perfect' | 'great' | 'good' | 'bad'>;

/** One background band of a `timingvisualizer[]`: a slice `width` px wide from `x` (px from its left edge). */
export interface TimingVisualizerBand {
  readonly x: number;
  readonly width: number;
  readonly color: number;
}

/** Where a `timingvisualizer[]` paints: its centre (px), its scale (px per ms), its edge (ms) and its POOR band. */
export interface TimingVisualizerBandLayout {
  readonly centerX: number;
  readonly judgeWidthRate: number;
  readonly halfWidthMs: number;
  /** `transparent = 1`: no POOR band. */
  readonly transparentPr: boolean;
}

/**
 * A judgment's timing offset in beatoraja's sign: note time minus press time, so > 0 is early (`JudgeManager`'s
 * `dmtime = judgenote.getMicroTime() - pmtime`, which `updateMicro` stores as `recentJudges` and the note's play time),
 * where be-music's `deltaMs` is > 0 late. beatoraja's timing visualizer and timing distribution graph both draw offset
 * `x` at `centre + x` (`SkinTimingVisualizer.java:145`, `SkinTimingDistributionGraph.java:129`), so early judgments
 * sit right of the centre and late ones left.
 */
export function beatorajaTimingOffsetMs(deltaMs: number): number {
  // `0 - x` rather than `-x`: a dead-on judgment stays `0`, not `-0`.
  return 0 - deltaMs;
}

/** Where a `timingvisualizer[]` draws its sample lines: the centre line's left edge (px), its scale and its edge (ms). */
export interface TimingVisualizerSampleLayout {
  readonly centerLineLeft: number;
  readonly judgeWidthRate: number;
  readonly halfWidthMs: number;
}

/**
 * The left edge (px from the visualizer's left) of a `timingvisualizer[]` sample line for a judgment `deltaMs` off
 * (> 0 late): early judgments right of the centre, late ones left, as upstream `SkinTimingVisualizer.draw` places
 * `recent[j]` (`SkinTimingVisualizer.java:145`). Upstream skips a sample beyond `±halfWidthMs`; this clamps it to the
 * edge so it stays visible at the rim.
 */
export function resolveTimingVisualizerSampleX(deltaMs: number, layout: TimingVisualizerSampleLayout): number {
  const { centerLineLeft, judgeWidthRate, halfWidthMs } = layout;
  const offsetMs = Math.max(-halfWidthMs, Math.min(halfWidthMs, beatorajaTimingOffsetMs(deltaMs)));
  return centerLineLeft + offsetMs * judgeWidthRate;
}

/**
 * The `timingdistributiongraph[]` histogram bin (one per ms, `halfWidthMs` either side of the centre bin) of a judgment
 * `deltaMs` off (> 0 late): early judgments right of the centre, late ones left, as upstream bins a note's play time
 * (`AbstractResult.TimingDistribution.add`, drawn at `c + i` in `SkinTimingDistributionGraph.java:129`); `undefined`
 * beyond the edge.
 */
export function resolveTimingDistributionBin(deltaMs: number, halfWidthMs: number): number | undefined {
  const index = Math.round(beatorajaTimingOffsetMs(deltaMs)) + halfWidthMs;
  return index >= 0 && index <= halfWidthMs * 2 ? index : undefined;
}

/**
 * The background bands of a `timingvisualizer[]` (upstream `SkinTimingVisualizer.prepare`, the `beforex1 / beforex2`
 * walk at `SkinTimingVisualizer.java:95-113`): PERFECT innermost, then GREAT, GOOD and BAD, each reaching its window's
 * late ms to the left of the centre and its early ms to the right (where the judgments' sample lines land, see
 * {@link resolveTimingVisualizerSampleX}), less what the windows inside it already cover; then POOR out to
 * `halfWidthMs`, the visualizer's edge (none with `transparentPr`). Every reach clamps to the visualizer's width
 * (`centerX` either side).
 */
export function resolveTimingVisualizerBands(
  windows: TimingVisualizerWindows,
  colors: { readonly pg: number; readonly gr: number; readonly gd: number; readonly bd: number; readonly pr: number },
  layout: TimingVisualizerBandLayout,
): TimingVisualizerBand[] {
  const { centerX, judgeWidthRate, halfWidthMs, transparentPr } = layout;
  const reaches: ReadonlyArray<{ earlyMs: number; lateMs: number; color: number }> = [
    { ...windows.perfect, color: colors.pg },
    { ...windows.great, color: colors.gr },
    { ...windows.good, color: colors.gd },
    { ...windows.bad, color: colors.bd },
    // PR band saturates at the visualizer's edge — beatoraja's `BMSPlayerRule.getNoteJudge()` returns a final "POOR"
    // entry that's clamped to the visualizer's `±center` width. With `transparent = 1`, the band is skipped entirely
    // (the player's PR hits show against whatever's behind the visualizer instead of the black PR band).
    ...(transparentPr ? [] : [{ earlyMs: halfWidthMs, lateMs: halfWidthMs, color: colors.pr }]),
  ];
  const bands: TimingVisualizerBand[] = [];
  let leftEdge = centerX;
  let rightEdge = centerX;
  for (const reach of reaches) {
    // Upstream's `judgeArea` is in beatoraja's sign (> 0 early): its lower bound, the late reach, goes left.
    const newLeft = centerX - Math.min(centerX, Math.max(0, reach.lateMs) * judgeWidthRate);
    const newRight = centerX + Math.min(centerX, Math.max(0, reach.earlyMs) * judgeWidthRate);
    if (newLeft < leftEdge) {
      bands.push({ x: newLeft, width: leftEdge - newLeft, color: reach.color });
      leftEdge = newLeft;
    }
    if (newRight > rightEdge) {
      bands.push({ x: rightEdge, width: newRight - rightEdge, color: reach.color });
      rightEdge = newRight;
    }
  }
  return bands;
}

function timingWindowsSignature(windows: TimingVisualizerWindows | undefined): string {
  if (windows === undefined) return '-';
  const { perfect, great, good, bad } = windows;
  return [perfect, great, good, bad].map((w) => `${w.earlyMs.toFixed(2)}/${w.lateMs.toFixed(2)}`).join(',');
}

/** One IIDX-NORMAL judgment's window, the same both ways. */
function iidxNormalWindow(ms: number): { earlyMs: number; lateMs: number } {
  return { earlyMs: ms, lateMs: ms };
}

/**
 * IIDX-NORMAL judge window fallback for the `timingvisualizer[]` background bands when no
 * host resolver is wired (decide / select scenes / headless tests): the IIDX ruleset's
 * windows (PG 16.67, GR 33.33, GD 116.67, BD 250 ms).
 */
const IIDX_NORMAL_JUDGE_WINDOWS: TimingVisualizerWindows = {
  perfect: iidxNormalWindow(16.67),
  great: iidxNormalWindow(33.33),
  good: iidxNormalWindow(116.67),
  bad: iidxNormalWindow(250),
};

/**
 * Default colours for the `timingvisualizer[]` band background, mirroring upstream
 * `JSONSkin.TimingVisualizer`'s static field initializers (`JSONSkin.java`):
 *
 *   - `centerColor = "FFFFFFFF"` (white)
 *   - `PGColor = "000088FF"` (dark blue, innermost)
 *   - `GRColor = "008800FF"` (dark green)
 *   - `GDColor = "888800FF"` (dark olive)
 *   - `BDColor = "880000FF"` (dark red)
 *   - `PRColor = "000000FF"` (black, edge)
 *   - `lineColor = "00FF00FF"` (green, sample lines)
 *
 * These apply when the skin's `timingvisualizer[]` element omits the matching colour
 * field — the parser passes through empty strings for unset fields and the renderer
 * falls through here.
 */
const DEFAULT_TIMING_VISUALIZER_COLORS = {
  center: 0xffffff,
  pg: 0x000088,
  gr: 0x008800,
  gd: 0x888800,
  bd: 0x880000,
  pr: 0x000000,
  line: 0x00ff00,
} as const;

/**
 * Parse a beatoraja-style hex colour string (`RRGGBB` or `RRGGBBAA`, no `#` prefix). Returns
 * the 24-bit RGB integer or `undefined` for malformed / empty input. Alpha is dropped — the
 * caller owns alpha via Pixi's `fill({ alpha })` API.
 *
 * Mirrors upstream `SkinTimingVisualizer.colorStringValidation` semantics: invalid strings
 * fall through to `undefined` so the caller can apply its own default.
 */
function parseHexColor(input: string): number | undefined {
  if (typeof input !== 'string' || input.length < 6) return undefined;
  const cleaned = input.replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length < 6) return undefined;
  const rgb = Number.parseInt(cleaned.slice(0, 6), 16);
  return Number.isFinite(rgb) ? rgb : undefined;
}
