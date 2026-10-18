import { Graphics, type Container } from 'pixi.js';
import type {
  BeatorajaDestinationGroup,
  BeatorajaTimingDistributionGraphElement,
  BeatorajaTimingVisualizerElement,
} from '@be-music/beatoraja-skin';
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
  private readonly resolveTimingJudgeWindowsMs: () =>
    | { pgreat: number; great: number; good: number; bad: number }
    | undefined;

  constructor(container: Container, options: BeatorajaPlaySkinViewOptions) {
    this.container = container;
    this.resolveTimingSamples = options.resolveTimingSamples ?? (() => undefined);
    this.resolveTimingDistribution = options.resolveTimingDistribution ?? (() => undefined);
    this.resolveTimingJudgeWindowsMs = options.resolveTimingJudgeWindowsMs ?? (() => undefined);
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
   *   1. **Background** — paints the judge windows as stacked colour bands radiating
   *      outward from the centre line. PG band sits innermost, then GR / GD / BD / PR.
   *      Each band's half-width = the matching `JudgeWindowsMs` value mapped through
   *      `judgeWidthRate = width / (judgeWidthMillis * 2 + 1)`. Defaults to IIDX-NORMAL
   *      windows when no host resolver is wired (decide / select scenes / headless tests).
   *   2. **Tick marks** — semi-transparent black lines every 10 ms, painted on top of the
   *      bands as a fine-grain ruler.
   *   3. **Sample lines** — recent-judge offsets from {@link resolveTimingSamples}. Each
   *      sample is one vertical line at the matching x; with `drawDecay = 1` (the
   *      reference theme default) the line height tapers from full at the newest sample
   *      to zero at the oldest, vertically centred in the region.
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
    // upstream's IIDX-NORMAL judge rule; matches `JsonSkin.TimingVisualizer.judgeWidthMillis`
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
    // Resolve judge windows — host resolver wins, otherwise IIDX-NORMAL defaults so the
    // background band still renders something sensible.
    const windows = this.resolveTimingJudgeWindowsMs() ?? IIDX_NORMAL_JUDGE_WINDOWS_MS;
    // Authored band colours — fall through to upstream `JsonSkin.TimingVisualizer` defaults
    // when the skin omits a value (matches `JsonSkin.java`'s static initializer values).
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
      windows.pgreat.toFixed(2),
      windows.great.toFixed(2),
      windows.good.toFixed(2),
      windows.bad.toFixed(2),
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
      //
      // Bands stack OUTWARD from the centre — PG fills `[-pgreat, +pgreat]`, then GR
      // extends beyond that to `[-great, -pgreat) ∪ (+pgreat, +great]`, etc. We track
      // the previously-painted left/right edges and only fill the new outer slice on
      // each iteration so adjacent bands don't overdraw each other (mirrors upstream's
      // `beforex1 / beforex2` walk).
      if (props.height > 0 && props.width > 0) {
        const centerX = props.width / 2;
        // Centre stripe — 1 px wide at the perfect-timing axis.
        graphics.rect(centerX - 0.5, 0, 1, props.height).fill({ color: colors.center, alpha: 1 });
        const bands: ReadonlyArray<{ halfMs: number; color: number }> = [
          { halfMs: windows.pgreat, color: colors.pg },
          { halfMs: windows.great, color: colors.gr },
          { halfMs: windows.good, color: colors.gd },
          { halfMs: windows.bad, color: colors.bd },
          // PR band saturates at the visualizer's edge — beatoraja's
          // `BMSPlayerRule.getNoteJudge()` returns a final "POOR" entry that's clamped
          // to the visualizer's `±center` width. With `transparent = 1`, the band is
          // skipped entirely (the player's PR hits show against whatever's behind the
          // visualizer instead of the black PR band).
          ...(transparentPr ? [] : [{ halfMs: halfWidthMs, color: colors.pr }]),
        ];
        let leftEdge = centerX;
        let rightEdge = centerX;
        for (const band of bands) {
          const halfPx = Math.min(centerX, band.halfMs * judgeWidthRate);
          const newLeft = centerX - halfPx;
          const newRight = centerX + halfPx;
          if (newLeft < leftEdge) {
            graphics.rect(newLeft, 0, leftEdge - newLeft, props.height).fill({ color: band.color, alpha: 1 });
            leftEdge = newLeft;
          }
          if (newRight > rightEdge) {
            graphics.rect(rightEdge, 0, newRight - rightEdge, props.height).fill({ color: band.color, alpha: 1 });
            rightEdge = newRight;
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
        // Clamp to ±halfWidthMs in ms space (mirrors upstream `if (-center <= recent[j] &&
        // recent[j] <= center)` gate in SkinTimingVisualizer.java:142). Beyond that, the
        // sample is OFF-SCREEN; we just clamp to the edge so it stays visible at the rim.
        const clampedDeltaMs = Math.max(-halfWidthMs, Math.min(halfWidthMs, sample.deltaMs));
        // `x` is the LEFT edge of the line rect (matches upstream's draw-x convention).
        const x = centerLineLeft + clampedDeltaMs * judgeWidthRate;
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
   * histogram across the destination box (one bar per ms bucket; bar height ∝ count). Each bar
   * is colored by the most-recent judgement kind that landed at that bucket — a rough but
   * informative cue. Optional average-line and stddev-band overlays draw on top.
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
        const idx = Math.round(s.deltaMs) + halfWidthMs;
        if (idx < 0 || idx >= binCount) continue;
        counts[idx]! += 1;
        lastKindByBin[idx] = s.kind;
        sum += s.deltaMs;
        sumSq += s.deltaMs * s.deltaMs;
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

/**
 * IIDX-NORMAL judge window fallback for the `timingvisualizer[]` background bands when no
 * host resolver is wired (decide / select scenes / headless tests). Values from the judge
 * window constants behind `@be-music/player/ruleset`'s `resolveJudgeWindowsMs` — keep in sync
 * with the engine's actual IIDX_*_WINDOW_MS constants.
 */
const IIDX_NORMAL_JUDGE_WINDOWS_MS = {
  pgreat: 16.67,
  great: 33.33,
  good: 116.67,
  bad: 250,
} as const;

/**
 * Default colours for the `timingvisualizer[]` band background, mirroring upstream
 * `JsonSkin.TimingVisualizer`'s static field initializers (`JsonSkin.java`):
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
