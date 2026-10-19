import { Graphics, type Container } from 'pixi.js';
import type {
  BeatorajaBpmGraphElement,
  BeatorajaDestinationGroup,
  BeatorajaJudgeGraphElement,
} from '@be-music/beatoraja-skin';
import { NOTE_DISTRIBUTION_COLORS } from '../../../chart/beatoraja/note-distribution.ts';
import type { destinationToSpriteProps } from '../../../skin/beatoraja/render.ts';
import type { BeatorajaPlaySkinViewOptions } from './options.ts';
import { judgeColorFor } from './timing-graphs.ts';

export interface BpmGraphEntry {
  kind: 'bpmgraph';
  group: BeatorajaDestinationGroup;
  element: BeatorajaBpmGraphElement;
  /** Pixi `Graphics` painting the BPM curve. Same rebuild-on-change pattern as polyline-graph. */
  graphics: Graphics;
  /**
   * Per-frame playhead cursor (thin vertical line at `currentTimeMs / totalMs * width`).
   * Kept SEPARATE from {@link graphics} so the static curve's signature-cached redraw
   * doesn't have to invalidate every tick — only this overlay's `x` position updates.
   * Stays hidden when `resolveCurrentTimeMs` returns undefined (select scene case).
   */
  cursor: Graphics;
  /**
   * Last point count painted. The chart's BPM curve is static for the whole session, so the
   * polyline is built once and reused — `lastPointCount` flipping from `-1` to the actual count
   * is the "first paint" trigger; subsequent frames short-circuit.
   */
  lastPointCount: number;
  /**
   * Signature of the most-recent BPM graph data — `${segments.length}|${mainBpm}|...`.
   * Used by the rich segment-data path to skip rebuilds when the underlying chart data
   * hasn't changed (cursor moves through a folder still hit the same focused chart).
   */
  lastSignature: string;
}

export interface JudgeGraphEntry {
  kind: 'judgegraph';
  group: BeatorajaDestinationGroup;
  element: BeatorajaJudgeGraphElement;
  /**
   * Pixi `Graphics` painting the judge histogram bars. Cleared and rebuilt every frame the bar
   * values change — judge counts grow during a play, and the result scene's snapshot is a
   * one-time paint, so the rebuild cost is bounded.
   */
  graphics: Graphics;
  /**
   * Per-frame playhead cursor for `type=0` (note distribution). Same model as
   * {@link BpmGraphEntry.cursor} — separate Graphics so the static distribution stays
   * cached while only the cursor's `x` updates per tick. Hidden for type 1 / 2 (those
   * graphs don't have a time axis to plot a playhead on).
   */
  cursor: Graphics;
  /**
   * Cached signature of the bars last painted. Per-frame stroke is skipped when the signature
   * hasn't moved, which is the common case (counts only change at judge events).
   */
  lastSignature: string;
}

/**
 * Builds and updates the `bpmgraph[]` and `judgegraph[]` entries of a {@link BeatorajaPlaySkinView}: graphs over the
 * chart's time axis, with the playhead cursor.
 */
export class BeatorajaChartGraphRenderer {
  private readonly container: Container;
  private readonly resolveBpmGraphPoints: () => ReadonlyArray<{ x: number; y: number }> | undefined;
  private readonly resolveJudgeGraphBars: (type: number) => ReadonlyArray<number> | undefined;
  private readonly resolveNoteDistribution: () =>
    | { buckets: ReadonlyArray<ReadonlyArray<number>>; maxCount: number; totalMs: number }
    | undefined;
  private readonly resolveBpmGraphData: () =>
    | {
        segments: ReadonlyArray<{ timeMs: number; bpm: number }>;
        mainBpm: number;
        minBpm: number;
        maxBpm: number;
        totalMs: number;
      }
    | undefined;
  private readonly resolveJudgeStateBuckets: (
    type: number,
  ) => { buckets: ReadonlyArray<ReadonlyArray<number>>; maxCount: number; totalMs: number } | undefined;
  private readonly resolveCurrentTimeMs: () => number | undefined;

  constructor(container: Container, options: BeatorajaPlaySkinViewOptions) {
    this.container = container;
    this.resolveBpmGraphPoints = options.resolveBpmGraphPoints ?? (() => undefined);
    this.resolveBpmGraphData = options.resolveBpmGraphData ?? (() => undefined);
    this.resolveJudgeGraphBars = options.resolveJudgeGraphBars ?? (() => undefined);
    this.resolveNoteDistribution = options.resolveNoteDistribution ?? (() => undefined);
    this.resolveJudgeStateBuckets = options.resolveJudgeStateBuckets ?? (() => undefined);
    this.resolveCurrentTimeMs = options.resolveCurrentTimeMs ?? (() => undefined);
  }

  /**
   * Build a bpmgraph entry — pre-allocates the `Graphics` node; the actual polyline gets drawn
   * once on first `update()` (the chart's BPM curve is static, so we don't re-stroke per frame).
   */
  buildBpmGraphEntry(group: BeatorajaDestinationGroup, element: BeatorajaBpmGraphElement): BpmGraphEntry {
    const graphics = new Graphics();
    graphics.alpha = 0;
    this.container.addChild(graphics);
    // Playhead cursor — separate Graphics so curve stays cached. Stroke once at construction
    // (a thin 2px-wide vertical line); per-frame updates only set `cursor.x` / `cursor.visible`.
    const cursor = new Graphics();
    cursor.rect(-1, 0, 2, 1).fill({ color: 0xffffff, alpha: 0.85 });
    cursor.visible = false;
    this.container.addChild(cursor);
    return { kind: 'bpmgraph', group, element, graphics, cursor, lastPointCount: -1, lastSignature: '' };
  }

  /**
   * Build a judgegraph entry. Same rebuild-on-change pattern as bpmgraph — the `Graphics` node is
   * pre-allocated; bars are stroked when the resolver returns a different signature.
   */
  buildJudgeGraphEntry(group: BeatorajaDestinationGroup, element: BeatorajaJudgeGraphElement): JudgeGraphEntry {
    const graphics = new Graphics();
    graphics.alpha = 0;
    this.container.addChild(graphics);
    const cursor = new Graphics();
    cursor.rect(-1, 0, 2, 1).fill({ color: 0xffffff, alpha: 0.85 });
    cursor.visible = false;
    this.container.addChild(cursor);
    return { kind: 'judgegraph', group, element, graphics, cursor, lastSignature: '' };
  }

  /**
   * Update a bpmgraph entry. Strokes the chart's BPM polyline once on first paint (the curve is
   * static for the whole session) and re-positions the `Graphics` to the destination box every
   * frame after that. Y is inverted (`1 - p.y`) so a high BPM paints toward the top of the box —
   * matches beatoraja's reference theme convention.
   *
   * Hidden when:
   *   - The destination's standard `props` say so (op gate, timer not started, alpha 0)
   *   - The resolver returned `undefined` or fewer than 2 points (no BPM data on this chart)
   */
  updateBpmGraphEntry(entry: BpmGraphEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const graphics = entry.graphics;
    graphics.visible = props.visible;
    if (!props.visible) {
      entry.cursor.visible = false;
      return;
    }
    // Prefer the rich segment-data resolver (`{segments, mainBpm, minBpm, maxBpm, totalMs}`);
    // matches upstream `SkinBPMGraph.draw()` which paints color-coded segments at log-scaled
    // y positions relative to mainBpm. Falls back to the legacy `[{x, y}]` polyline resolver
    // when the host hasn't wired the rich data — produces a single white curve instead of
    // the per-segment color identity, but at least keeps something visible.
    const data = this.resolveBpmGraphData();
    if (data === undefined) {
      this.updateBpmGraphLegacy(entry, props);
      entry.cursor.visible = false;
      return;
    }
    const { segments, mainBpm, minBpm, maxBpm, totalMs } = data;
    if (segments.length < 1 || totalMs <= 0 || mainBpm <= 0) {
      graphics.visible = false;
      entry.cursor.visible = false;
      return;
    }
    const signature = `${segments.length}|${mainBpm}|${minBpm}|${maxBpm}|${totalMs}`;
    if (signature !== entry.lastSignature) {
      graphics.clear();
      // Log-scale window: BPM is plotted as `log10(bpm / mainBpm)` clamped to [1/8, 8] —
      // the same range upstream uses (`SkinBPMGraph.minValue = 1/8, maxValue = 8`). Within
      // this band, mainBpm sits at the middle of the destination box; values doubling
      // above mainBpm climb toward the top edge, values halving below sink toward the
      // bottom. Beyond 8x or below 1/8 clamp to the edges.
      const minRatio = 1 / 8;
      const maxRatio = 8;
      const minRatioLog = Math.log10(minRatio);
      const maxRatioLog = Math.log10(maxRatio);
      const ratioLogRange = maxRatioLog - minRatioLog;
      const projectY = (bpm: number): number => {
        if (bpm <= 0) return props.height; // stop → bottom edge
        const ratio = Math.min(maxRatio, Math.max(minRatio, bpm / mainBpm));
        const norm = (Math.log10(ratio) - minRatioLog) / ratioLogRange;
        // Pixi y grows DOWNWARD; invert so high BPM paints toward the top.
        return (1 - norm) * props.height;
      };
      const colorFor = (bpm: number): number => {
        if (bpm <= 0) return 0xff00ff; // stop → magenta
        if (bpm === mainBpm) return 0x00ff00; // main → green
        if (bpm === minBpm) return 0x0000ff; // min → blue
        if (bpm === maxBpm) return 0xff0000; // max → red
        return 0xffff00; // other → yellow
      };
      const transitionColor = 0x7f7f7f; // gray
      const lineWidth = 2;
      // Walk segments. Each segment's BPM applies from `segments[i].timeMs` until
      // `segments[i+1].timeMs` (or `totalMs` for the last). Render as a horizontal line at
      // `projectY(segments[i].bpm)`; render a vertical transition line where the BPM
      // changes between adjacent segments.
      for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i]!;
        const next = segments[i + 1];
        const x1 = (seg.timeMs / totalMs) * props.width;
        const x2 = ((next?.timeMs ?? totalMs) / totalMs) * props.width;
        const y = projectY(seg.bpm);
        // Horizontal line for the segment.
        graphics.rect(x1, y - lineWidth / 2, Math.max(lineWidth, x2 - x1), lineWidth);
        graphics.fill({ color: colorFor(seg.bpm), alpha: 1 });
        // Vertical transition line at the segment boundary (when bpm changes).
        if (next !== undefined && next.bpm !== seg.bpm) {
          const yNext = projectY(next.bpm);
          const yMin = Math.min(y, yNext);
          const yMax = Math.max(y, yNext);
          if (yMax - yMin > lineWidth) {
            graphics.rect(x2 - lineWidth / 2, yMin, lineWidth, yMax - yMin);
            graphics.fill({ color: transitionColor, alpha: 1 });
          }
        }
      }
      entry.lastSignature = signature;
    }
    graphics.x = props.x;
    graphics.y = props.y;
    graphics.alpha = props.alpha;
    // Don't tint — segments already author their own colours per BPM identity. Tinting
    // would multiply through (e.g. yellow segments would go red under a red tint), losing
    // the color identity. Keep tint at white.
    graphics.tint = 0xffffff;
    graphics.angle = props.angle;
    graphics.blendMode = props.blendMode;
    this.positionGraphCursor(entry.cursor, props, totalMs);
  }

  /**
   * Legacy `{x, y}` polyline path — used when `resolveBpmGraphData` isn't wired (older host
   * code paths). Single white step curve, no per-segment colours.
   */
  private updateBpmGraphLegacy(entry: BpmGraphEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const graphics = entry.graphics;
    const points = this.resolveBpmGraphPoints();
    if (points === undefined || points.length < 2) {
      graphics.visible = false;
      return;
    }
    if (entry.lastPointCount !== points.length) {
      graphics.clear();
      const first = points[0]!;
      graphics.moveTo(first.x * props.width, (1 - first.y) * props.height);
      for (let i = 1; i < points.length; i += 1) {
        const p = points[i]!;
        graphics.lineTo(p.x * props.width, (1 - p.y) * props.height);
      }
      graphics.stroke({ color: props.tint, width: 2, alpha: 1 });
      entry.lastPointCount = points.length;
    }
    graphics.x = props.x;
    graphics.y = props.y;
    graphics.alpha = props.alpha;
    graphics.tint = props.tint;
    graphics.angle = props.angle;
    graphics.blendMode = props.blendMode;
  }

  /**
   * Update a judgegraph entry. Strokes equal-width filled bars along the destination box's bottom
   * edge, each bar's height proportional to `bar / max(bars)` × `dst.h`. Bars are painted with
   * the destination's tint (a single fill color for now — beatoraja's reference theme uses tinted
   * lines, which loses the per-judgement color of the original `judgegraph` source texture but
   * preserves the data shape).
   *
   * Hidden when:
   *   - The destination's standard `props` say so (op gate, timer not started, alpha 0)
   *   - The resolver returned `undefined` (the type isn't surfaced by the host)
   *   - All bars are 0 (no judges yet — nothing to plot)
   */
  updateJudgeGraphEntry(entry: JudgeGraphEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const graphics = entry.graphics;
    graphics.visible = props.visible;
    if (!props.visible) {
      entry.cursor.visible = false;
      return;
    }
    // Type 0 (note distribution) — when the host wires `resolveNoteDistribution`, render
    // the per-second × per-category histogram + olive background bands per upstream's
    // `SkinNoteDistributionGraph`. Falls through to the bars resolver if no host has
    // wired the rich data (legacy / decide-scene path).
    if (entry.element.type === 0) {
      const distribution = this.resolveNoteDistribution();
      if (distribution !== undefined && distribution.buckets.length > 0) {
        this.paintTimeAxisHistogram(entry, props, distribution, NOTE_DISTRIBUTION_COLORS);
        return;
      }
    }
    // Type 1 (judge state) — same time-axis-stacked-histogram shape as type 0, but the
    // category axis tracks live judgement state (`[unjudged, PG, GR, GD, BD, PR]`). Mirrors
    // upstream `SkinNoteDistributionGraph` TYPE_JUDGE: each chart-second column stacks
    // notes from the bottom in JGRAPH[1] order — the unjudged "gray" cell shrinks as the
    // run progresses and verdict-coloured cells stack on top.
    if (entry.element.type === 1) {
      const stateData = this.resolveJudgeStateBuckets(entry.element.type);
      if (stateData !== undefined && stateData.buckets.length > 0) {
        this.paintTimeAxisHistogram(entry, props, stateData, JUDGE_STATE_COLORS);
        return;
      }
    }
    // Cursor is only meaningful for time-axis graphs (type 0 / 1). Hide on the bar paths below.
    entry.cursor.visible = false;
    const bars = this.resolveJudgeGraphBars(entry.element.type);
    if (bars === undefined || bars.length === 0) {
      graphics.visible = false;
      return;
    }
    let max = 0;
    for (const v of bars) {
      if (Number.isFinite(v) && v > max) max = v;
    }
    if (max <= 0) {
      // No judgements yet → hide. The first judgement re-shows the graph.
      graphics.visible = false;
      return;
    }
    const signature = `${bars.length}|${max}|${bars.join(',')}|${entry.element.backTexOff}`;
    if (signature !== entry.lastSignature) {
      graphics.clear();
      const barCount = bars.length;
      const barWidth = props.width / barCount;
      // Small horizontal gap between bars so adjacent values stay distinguishable. 10% of the
      // slot width matches the look of beatoraja's reference judgegraph (which strokes thin
      // tinted lines per bar).
      const gap = barWidth * 0.1;
      // Background "guide" panel — beatoraja's `backTexOff = 0` (the default) means draw a
      // faint full-height panel BEHIND each bar so the player can read each value as a
      // fraction of the box at a glance. `backTexOff = 1` skips the panel entirely. ModernChic
      // explicitly authors `backTexOff = MAIN.JUDGEGRAPH.BACKTEX.OFF` (= 0) to opt INTO the
      // backdrop on its play info pane.
      const drawBackdrop = entry.element.backTexOff === 0;
      if (drawBackdrop) {
        for (let i = 0; i < barCount; i += 1) {
          const x = i * barWidth + gap / 2;
          const w = barWidth - gap;
          graphics.rect(x, 0, w, props.height);
        }
        graphics.fill({ color: 0xffffff, alpha: 0.18 });
      }
      // Foreground bars — drawn AFTER the backdrop so they paint on top.
      //
      // For `type === 2` (early/late hit-fail histogram), color each bar by the bin's
      // offset distance so the player sees their hit cluster against the judge windows
      // at a glance: PERFECT bins (centre) are cyan, GREAT bins yellow-green, GOOD bins
      // yellow, BAD/POOR-saturated edge bins red. Mirrors upstream `SkinJudgeGraph`'s
      // per-band coloring of TYPE_HIT_FAIL_DISTRIBUTION.
      //
      // Other types (1 = judgement spread) get uniform white fill so the destination's
      // own `tint` colors the whole histogram — beatoraja's default play skin tints these
      // graphs per-side.
      const isHitFailHistogram = entry.element.type === 2;
      for (let i = 0; i < barCount; i += 1) {
        const v = Number.isFinite(bars[i]) ? Math.max(0, bars[i]!) : 0;
        if (v <= 0) continue;
        const ratio = v / max;
        const barH = props.height * ratio;
        const x = i * barWidth + gap / 2;
        const y = props.height - barH;
        const w = barWidth - gap;
        graphics.rect(x, y, w, barH);
        if (isHitFailHistogram) {
          // Bin layout: 21 bins covering [-100, +100] ms, 10 ms each. Bin centre =
          // `(i - 10) * 10 + 5` ms; bin 10 spans [-5, +5] (centre 0). Edge bins 0 / 20
          // saturate everything beyond ±100 ms so we mark them BAD.
          const binCentreMs = (i - 10) * 10 + 5;
          const colour = hitFailBinColour(binCentreMs, i === 0 || i === barCount - 1);
          graphics.fill({ color: colour, alpha: 1 });
        }
      }
      if (!isHitFailHistogram) {
        graphics.fill({ color: 0xffffff, alpha: 1 });
      }
      entry.lastSignature = signature;
    }
    graphics.x = props.x;
    graphics.y = props.y;
    graphics.alpha = props.alpha;
    // For `type === 2` colours are baked per-bar (judge-band hue) — tint would multiply
    // through and distort them, so keep tint white. Other types take the destination's
    // tint as the histogram colour.
    graphics.tint = entry.element.type === 2 ? 0xffffff : props.tint;
    graphics.angle = props.angle;
    graphics.blendMode = props.blendMode;
  }

  /**
   * Paint a time-axis stacked histogram (judgegraph types 0 / 1). Mirrors upstream
   * `SkinNoteDistributionGraph.draw()`:
   *
   *   1. Background panel: black 80% alpha + olive bands every 10 height units +
   *      time-axis guide lines (gray every 60 sec, dim gray every 10 sec)
   *   2. Per-bucket stacked chips: each entry paints as a coloured block at the
   *      appropriate height in the bucket's stack, color-coded by `colors[cat]` where
   *      `cat` is the bucket's per-cell category index.
   *
   * The destination's `tint` is intentionally ignored — categories carry their own
   * colors (NOTE_DISTRIBUTION_COLORS for type=0 / JUDGE_STATE_COLORS for type=1), so a
   * tint multiplier would distort the palette.
   *
   * The `colors` palette is the type-specific JGRAPH lookup from upstream:
   *   - type 0 (TYPE_NORMAL) → JGRAPH[0]: 7-entry note-category palette
   *   - type 1 (TYPE_JUDGE)  → JGRAPH[1]: 6-entry judge-state palette
   *     (gray for unjudged, blue/cyan/yellow/orange/red for PG/GR/GD/BD/PR)
   */
  private paintTimeAxisHistogram(
    entry: JudgeGraphEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    data: { buckets: ReadonlyArray<ReadonlyArray<number>>; maxCount: number; totalMs: number },
    colors: ReadonlyArray<number>,
  ): void {
    const graphics = entry.graphics;
    const { buckets, maxCount } = data;
    if (buckets.length === 0 || maxCount <= 0) {
      graphics.visible = false;
      entry.cursor.visible = false;
      return;
    }
    // Signature includes bucket count + maxCount + a sampled hash of bucket totals so
    // cursor moves through a folder don't redraw if the focused chart's distribution is
    // unchanged. Lightweight — full equality check would walk every bucket × category.
    let totalsHash = 0;
    for (let i = 0; i < buckets.length; i += 1) {
      let total = 0;
      for (const v of buckets[i]!) total += v;
      totalsHash = (totalsHash * 31 + total) | 0;
    }
    const signature = `nd|${buckets.length}|${maxCount}|${totalsHash}|${entry.element.backTexOff}`;
    if (signature !== entry.lastSignature) {
      graphics.clear();
      const bucketCount = buckets.length;
      const bucketWidth = props.width / bucketCount;
      // Bucket "chip" height = props.height / maxCount. One chip per note in the
      // category stack; leave a 1-pixel gap (matches upstream's 4×4 chip in 5×5 cell).
      const cellHeight = props.height / maxCount;
      const chipHeight = Math.max(1, cellHeight * 0.8);
      const chipWidth = Math.max(1, bucketWidth * 0.8);
      const chipXOffset = (bucketWidth - chipWidth) / 2;

      // Background — black 80% alpha (`backTexOff = 0` is upstream's default).
      if (entry.element.backTexOff === 0) {
        graphics.rect(0, 0, props.width, props.height);
        graphics.fill({ color: 0x000000, alpha: 0.8 });

        // Olive horizontal bands at every 10 height units. Color gradient: `(0.007*i,
        // 0.007*i, 0)` — a slowly-darkening yellow-olive.
        for (let i = 10; i < maxCount; i += 10) {
          const bandColor = ((Math.floor(0.007 * i * 255) << 16) | (Math.floor(0.007 * i * 255) << 8) | 0) >>> 0;
          // Y from BOTTOM (Pixi y from top) — band at i*cellHeight from bottom = props.height - (i+10)*cellHeight from top.
          const yTop = props.height - (i + 10) * cellHeight;
          const bandHeight = 10 * cellHeight;
          graphics.rect(0, yTop, props.width, bandHeight);
          graphics.fill({ color: bandColor, alpha: 1 });
        }

        // Vertical x-axis guide lines: every 60 sec (gray) / 10 sec (dim gray).
        for (let i = 0; i < bucketCount; i += 1) {
          if (i % 60 === 0 && i > 0) {
            graphics.rect(i * bucketWidth, 0, 1, props.height);
            graphics.fill({ color: 0x404040, alpha: 1 });
          } else if (i % 10 === 0 && i > 0) {
            graphics.rect(i * bucketWidth, 0, 1, props.height);
            graphics.fill({ color: 0x202020, alpha: 1 });
          }
        }
      }

      // Foreground — per-bucket stacked chips. Walk categories 0..colors.length-1, stack
      // each category's chip count at the bottom of the bucket. Pixi y is inverted so chip
      // y_top = props.height - (stack_height + 1) * cellHeight.
      for (let i = 0; i < bucketCount; i += 1) {
        const bucket = buckets[i]!;
        const x = i * bucketWidth + chipXOffset;
        let stackedCount = 0;
        for (let cat = 0; cat < bucket.length; cat += 1) {
          const count = bucket[cat]!;
          if (count === 0) continue;
          const color = colors[cat] ?? 0xffffff;
          for (let chip = 0; chip < count && stackedCount < maxCount; chip += 1) {
            const yTop = props.height - (stackedCount + 1) * cellHeight;
            graphics.rect(x, yTop, chipWidth, chipHeight);
            graphics.fill({ color, alpha: 1 });
            stackedCount += 1;
          }
        }
      }

      entry.lastSignature = signature;
    }
    graphics.x = props.x;
    graphics.y = props.y;
    graphics.alpha = props.alpha;
    // Don't tint — note categories have their own colors.
    graphics.tint = 0xffffff;
    graphics.angle = props.angle;
    graphics.blendMode = props.blendMode;
    this.positionGraphCursor(entry.cursor, props, data.totalMs);
  }

  /**
   * Position + show / hide the playhead cursor over a graph's destination rect. Called by
   * `updateBpmGraphEntry` and `paintNoteDistribution`. Reads `resolveCurrentTimeMs()` and
   * `totalMs` to compute the X position; hides the cursor when either is missing or when
   * the destination's `props.visible` is false.
   *
   * Cursor is a 2-px-wide vertical line (drawn once at construction with `rect(-1, 0, 2, 1)`
   * — height-1 unit then height-stretched here). `cursor.x` is the live position; `cursor.y`
   * matches the graph's top edge so the line spans the full height.
   */
  private positionGraphCursor(
    cursor: Graphics,
    props: ReturnType<typeof destinationToSpriteProps>,
    totalMs: number,
  ): void {
    if (!props.visible || totalMs <= 0) {
      cursor.visible = false;
      return;
    }
    const currentMs = this.resolveCurrentTimeMs();
    if (currentMs === undefined || !Number.isFinite(currentMs) || currentMs < 0) {
      cursor.visible = false;
      return;
    }
    const ratio = Math.min(1, Math.max(0, currentMs / totalMs));
    cursor.visible = true;
    cursor.x = props.x + ratio * props.width;
    cursor.y = props.y;
    cursor.scale.set(1, props.height);
    cursor.alpha = props.alpha;
    cursor.angle = props.angle;
    cursor.blendMode = props.blendMode;
  }
}

/**
 * Per-state judgement-history palette for `judgegraph[]` `type = 1` (TYPE_JUDGE). Mirrors
 * upstream `SkinNoteDistributionGraph.JGRAPH[1]` exactly:
 *
 *   0 = unjudged → `#555555` (gray)
 *   1 = PG       → `#0088ff` (blue)
 *   2 = GR       → `#00ff88` (cyan)
 *   3 = GD       → `#ffff00` (yellow)
 *   4 = BD       → `#ff8800` (orange)
 *   5 = PR / MISS → `#ff0000` (red)
 *
 * Each chart-second's bucket stacks counts from index 0 (gray, bottom) up to index 5
 * (red, top), so a fresh chart paints entirely gray and the bars colour up as the
 * player progresses.
 */
const JUDGE_STATE_COLORS: ReadonlyArray<number> = [0x555555, 0x0088ff, 0x00ff88, 0xffff00, 0xff8800, 0xff0000];

/**
 * Map a hit-fail histogram bin's centre offset (ms) to a judge-band colour. Used by
 * `judgegraph type=2` so each bar paints in the colour of the judgement that bin's hits
 * would have produced — PERFECT (yellow) at the centre, fading out through GREAT (green) /
 * GOOD (blue) and ending in BAD (red) at the edges.
 *
 * Thresholds use the default RANK 2 (NORMAL) judge windows: PERFECT ±21 ms / GREAT ±60 ms
 * / GOOD ±120 ms. Charts that author non-default `#RANK` shift the actual windows, but
 * we don't yet route the live values through to the renderer — the visual bias is small
 * enough at typical ranks that the player still reads "centre = good, edge = bad" the
 * same way.
 *
 * `isEdgeBin = true` flips inner-window classifications to BAD because edge bins
 * saturate every sample beyond ±100 ms (the histogram's range), so they include real
 * BAD / POOR hits regardless of what their nominal centre would suggest.
 */
function hitFailBinColour(centreOffsetMs: number, isEdgeBin: boolean): number {
  if (isEdgeBin) return judgeColorFor('BAD');
  const abs = Math.abs(centreOffsetMs);
  if (abs <= 21) return judgeColorFor('PERFECT');
  if (abs <= 60) return judgeColorFor('GREAT');
  if (abs <= 120) return judgeColorFor('GOOD');
  return judgeColorFor('BAD');
}
