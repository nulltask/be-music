import type { Texture } from 'pixi.js';
import type { BeatorajaSkin, BeatorajaSkinFontId } from '@be-music/skin-beatoraja';
import type { BeMusicJudgeWindowSet } from '@be-music/player-skin-sdk';
import type { BeatorajaTextureCache } from '../../../skin/beatoraja/textures.ts';

export interface BeatorajaPlaySkinViewOptions {
  skin: BeatorajaSkin;
  textures: BeatorajaTextureCache;
  /**
   * Optional override for the runtime op-code lookup. The view itself doesn't need to know about engine ops, but
   * passing a custom function lets the host plug judgement / lamp / etc. ops in once they're available. Used by the
   * `update()` call site to compute "is this destination's `ref` op currently active?" lookups.
   */
  resolveRefValue?: (refOp: number) => number;
  /**
   * Optional callback that resolves a `text[].ref` op-code into the string to display. Returning `undefined`
   * leaves the text empty (the placeholder behavior used while the engine integration is still in progress).
   * This is also where the host should substitute placeholder strings (`'<title>'`, `'<artist>'`, …) during
   * preview if it wants to make text destinations visible without an engine running.
   */
  resolveTextContent?: (refOp: number) => string | undefined;
  /**
   * Optional callback that resolves a `value[].ref` op-code (a prop.lua `num` table key) into the
   * current numeric value to display — score / combo / BPM / etc. Returning `undefined` falls back to
   * `0`. Hosts that don't have engine state wired (preview, tests) can omit it entirely.
   */
  resolveNumberValue?: (refOp: number) => number | undefined;
  /**
   * Lookup `text[].font` slot id → registered CSS `font-family` name. Without this every label collapses
   * to the platform sans-serif, which on Japanese themes produces visibly garbled metrics — even when
   * the chart's title / artist resolve to correct UTF-8 strings, the wrong-typeface fallback re-flows
   * each glyph and looks "broken" to authors who tested on the skin's bundled TTF. Returning `undefined`
   * for an unknown id keeps the platform sans-serif fallback (matches the legacy behavior).
   */
  resolveFontFamily?: (fontId: BeatorajaSkinFontId) => string | undefined;
  /**
   * Lookup `text[].font` slot id → which Pixi text pipe to instantiate. `'bitmap'` picks
   * `BitmapText` (consumes a registered `BitmapFont` keyed by `family`); anything else picks the
   * default `Text` (CSS-font pipe). Skins that ship AngelCode `.fnt` fonts (e.g. GroundbreakinG)
   * MUST go through the bitmap pipe — `Text` can't render glyphs the browser's `FontFace` registry
   * couldn't accept. Returning `undefined` is treated as `'css'`.
   */
  resolveFontKind?: (fontId: BeatorajaSkinFontId) => 'css' | 'bitmap' | undefined;
  /**
   * Lookup `graph[].type` → fill ratio in `[0, 1]`. The renderer scales the graph's source-rect
   * along its `angle` axis by the returned value. Common types:
   *
   *   - `1` (gauge 1P) / `6` (gauge 2P) → `summary.gauge.current / summary.gauge.max`
   *   - `2` (chart progress) → `currentSeconds / totalSeconds`
   *   - `102` (load progress) → load %, currently always 1 in our pipeline (assets pre-decode)
   *
   * Polyline-style codes (`110` / `113` / `115`) should NOT be answered here — see
   * `resolveGraphPolyline`. Returning `undefined` for unknown types hides the graph.
   */
  resolveGraphValue?: (type: number) => number | undefined;
  /**
   * Lookup `graph[].type` → polyline points in `[0, 1] × [0, 1]`. Each point is a normalized
   * coordinate inside the destination's bounding box (`{x, y}` ∈ `[0, 1]²`); the renderer maps
   * these onto the dst rect with `y` inverted (so a high score draws toward the top of the box).
   * Common types:
   *
   *   - `110` — current run's EX-score over time
   *   - `113` — best-record EX-score over time (DB-backed; not yet available)
   *   - `115` — target EX-score over time (DB-backed; not yet available)
   *
   * Returning `undefined` falls through to {@link resolveGraphValue} (bar fill). Returning an
   * empty array hides the polyline (a chart that produced no judges has nothing to plot).
   */
  resolveGraphPolyline?: (type: number) => ReadonlyArray<{ x: number; y: number }> | undefined;
  /**
   * Lookup `slider[].type` → translation ratio in `[0, 1]`. The renderer translates the slider
   * sprite by `value * range` skin-pixels along its `angle` axis. Common types:
   *
   *   - `4` — 1P lanecover position
   *   - `5` — 2P lanecover position
   *   - `6` — hispeed lift / hidden indicator
   *
   * Returning `undefined` hides the slider. Most slider types map to user-config values
   * (lanecover / hispeed) the host hasn't surfaced yet; default behavior leaves them at 0
   * (slider sits at its dst-rect home position).
   */
  resolveSliderValue?: (type: number) => number | undefined;
  /**
   * Resolve the live gauge percent in `[0, 100]` for the `gauge` element. Result determines how
   * many cells of the gauge bar light up. Returning `undefined` defaults to 0 (gauge empty —
   * matches what the result scene should display before any judge has occurred).
   */
  resolveGaugePercent?: () => number | undefined;
  /**
   * Resolve the chart's BPM curve as a polyline in `[0, 1]²`. Each `{x, y}` is a normalized
   * point inside the bpmgraph's destination box (x = chart progress, y = (bpm − minBPM) /
   * (maxBPM − minBPM)). The renderer maps these onto the dst rect with `y` inverted (high BPM
   * paints toward the top of the box). Hosts compute this once per chart and hand it back from
   * the resolver. Returning `undefined` or an empty array hides every bpmgraph element.
   */
  resolveBPMGraphPoints?: () => ReadonlyArray<{ x: number; y: number }> | undefined;
  /**
   * Resolve a `judgegraph[].type` code into per-bar values for histogram rendering. The renderer
   * normalizes the returned array to `[0, 1]` against its own max and paints equal-width bars
   * stretching upward from the destination's bottom edge.
   *
   *   - `type = 0` (note distribution) → `[normal, ln, scratch, bss]` from the chart's
   *     playable-event breakdown. Used by the decide scene for pre-play "what's in this chart"
   *     readouts (ModernChic's centred chart-summary graph).
   *   - `type = 1` (judgement spread) → `[perfect, great, good, bad, poor]`
   *   - `type = 2` (early/late spread) → `[early, late]`
   *
   * Returning `undefined` or an array of all zeros hides the graph (no useful data to plot).
   */
  resolveJudgeGraphBars?: (type: number) => ReadonlyArray<number> | undefined;
  /**
   * Resolve the note-distribution histogram for `judgegraph` type=0. Returns the per-second
   * × per-category bucket data the spec-faithful renderer needs (matches upstream
   * `SkinNoteDistributionGraph.updateData()` with TYPE_NORMAL). When supplied, the
   * renderer uses this for type=0 instead of {@link resolveJudgeGraphBars}, which only
   * carries aggregate counts insufficient for the time-series histogram.
   *
   * Returning `undefined` falls back to the bars resolver (backwards-compat path).
   */
  resolveNoteDistribution?: () =>
    | {
        buckets: ReadonlyArray<ReadonlyArray<number>>;
        maxCount: number;
        totalMs: number;
      }
    | undefined;
  /**
   * Resolve the BPM curve segments + mainbpm reference for `bpmgraph` destinations. Replaces
   * the legacy `{x, y}` polyline ({@link resolveBPMGraphPoints}); the new shape carries the
   * raw `(timeMs, bpm)` segments so the renderer can apply upstream's log-scaled,
   * mainbpm-relative y projection AND color-code segments by BPM identity (mainbpm = green,
   * minbpm = blue, maxbpm = red, others = yellow, stop = magenta).
   *
   * Returning `undefined` falls back to {@link resolveBPMGraphPoints}.
   */
  resolveBPMGraphData?: () =>
    | {
        segments: ReadonlyArray<{ timeMs: number; bpm: number }>;
        mainBPM: number;
        minBPM: number;
        maxBPM: number;
        totalMs: number;
      }
    | undefined;
  /**
   * Resolve the gauge curve as a polyline in `[0, 1]²`. Each `{x, y}` is a normalized point
   * inside the gaugegraph's destination box (x = chart progress, y = gauge / 100). Result skins
   * use this to plot the gauge over time after the run. The renderer maps these onto the dst
   * rect with `y` inverted so a high gauge paints toward the top.
   *
   * Returning `undefined` or fewer than 2 points hides the graph.
   */
  resolveGaugeGraphPoints?: () => ReadonlyArray<{ x: number; y: number }> | undefined;
  /**
   * Resolve recent judgement timing samples for the `timingvisualizer[]` element. Returns the
   * adapter's circular timing buffer in oldest-first order — each entry has the signed delta
   * (positive = late, negative = early) and the judge kind (`PERFECT` / `GREAT` / ...). The
   * renderer plots a sample per entry, early ones right of the centre and late ones left as
   * beatoraja draws them, and fades older entries by index. Empty array hides the visualizer.
   */
  resolveTimingSamples?: () => ReadonlyArray<{ deltaMs: number; kind: string }> | undefined;
  /**
   * Resolve per-chart-second × per-judge-state buckets for `judgegraph[]` `type = 1`
   * (TYPE_JUDGE in upstream `SkinNoteDistributionGraph`). Each bucket is `[unjudged, PG,
   * GR, GD, BD, PR]`; the renderer stacks each second's notes vertically with judgement-
   * coloured chips. Returning `undefined` falls through to the legacy "fixed bars" path
   * via {@link resolveJudgeGraphBars} so the decide / select scenes (which lack live
   * judge state) keep working.
   *
   * `maxCount` is the y-axis cap (densest bucket × upstream's `Math.min((count/10)*10
   * + 10, 100)` formula), `totalMs` is the chart-length used for the cursor overlay.
   */
  resolveJudgeStateBuckets?: (type: number) =>
    | {
        buckets: ReadonlyArray<ReadonlyArray<number>>;
        maxCount: number;
        totalMs: number;
      }
    | undefined;
  /**
   * Resolve the judge windows the play is judged by: its judge ruleset's key-lane windows, each judgment's early and
   * late reach in ms. Drives the `timingvisualizer[]` band background per upstream `SkinTimingVisualizer.prepare`
   * (`getJudgeArea(resource)` at `SkinTimingVisualizer.java:88`): the renderer paints stacked stripes outward from the
   * visualizer's centre, one per judgment (`resolveTimingVisualizerBands`). Returning `undefined` (the engine has
   * not reported its windows yet) paints no bands.
   *
   * When omitted (decide / select scenes, headless tests), the renderer falls through to
   * IIDX-NORMAL defaults (`{16.67, 33.33, 116.67, 250}`) so the bands still render
   * approximately correct.
   */
  resolveTimingJudgeWindows?: () => BeMusicJudgeWindowSet | undefined;
  /**
   * Resolve the FULL run's timing samples for the `timingdistributiongraph[]` element. Same
   * shape as {@link resolveTimingSamples} but returns every judgement, not just the live ring.
   * The renderer bins these into a per-ms histogram (early right of the centre, late left) and
   * overlays optional average / std-dev guides. Used by the result scene; the play scene typically returns `undefined` (the
   * histogram is meant for post-game review).
   */
  resolveTimingDistribution?: () => ReadonlyArray<{ deltaMs: number; kind: string }> | undefined;
  /**
   * Resolve the current playhead position (ms since chart start) for graph cursor overlays.
   * The renderer paints a thin vertical line at this position over `bpmgraph` and `notes-graph`
   * so the player sees where they are within the chart's BPM curve / density timeline.
   *
   * Returning `undefined` (or the host omitting the resolver) hides the cursor — that's the
   * select scene case (preview-only graphs have no playhead). The play / decide scenes wire
   * this to `frame.currentSeconds * 1000` so the cursor follows the live engine clock.
   */
  resolveCurrentTimeMs?: () => number | undefined;
  /**
   * Fired when the user clicks (or taps) a skin-authored button — anything in `image[]` that
   * carries a positive `act` field (beatoraja's `button_type` action code). Default skin
   * declares 15=play / 16=autoplay / 315=practice / 19,316,317,318=replay slots; community
   * skins extend this with their own action codes (volume up/down, sort cycle, etc.).
   *
   * Hosts route the code to whatever scene-specific action it implies. The view itself doesn't
   * know what each code means — it just surfaces the click + the authored code. The optional
   * `modifiers` payload lets handlers branch on Shift / Ctrl etc. — beatoraja convention is
   * "Shift = invert" (decrement instead of increment, prev instead of next, etc.) on a couple
   * of buttons (`JUDGE_TIMING` notably).
   */
  onButtonAction?: (act: number, modifiers?: { shift: boolean; ctrl: boolean; alt: boolean }) => void;
  /**
   * Resolve a synthetic chart-image id (`-100` STAGEFILE / `-101` BACKBMP / `-102` BANNER) to
   * a Pixi `Texture`. Beatoraja's renderer treats these ids as virtual sources keyed to the
   * chart's `#STAGEFILE` / `#BACKBMP` / `#BANNER` bitmaps; skins reference them in
   * `destination[]` without bundling their own copy.
   *
   * Hosts that have the chart's image bytes pre-decoded (= the decide / select scenes once
   * the song is focused) return the matching texture; everything else returns `undefined` so
   * the destination stays hidden. The view itself doesn't know how to load chart bitmaps.
   */
  chartImageProvider?: (syntheticId: number) => Texture | undefined;
  /**
   * Skin-config-level op set (selected layout / option ops). Used to resolve INNER if-gated
   * keyframe alternatives at parse time — beatoraja's `JSONSkinLoader.setDestination` walks each
   * keyframe's array of `{if, value}` alternatives and picks the first whose codes match the
   * user's selected skin options. Without this set the resolver falls back to the catch-all
   * (empty `if`) alternative, which is correct for the default layout but wrong when the user
   * has a non-default layout option active. Pass `buildBaseOpSet(skinConfig?.option)` from the
   * gameplay host so per-layout BGA / lane / panel rects resolve to the user's chosen variant.
   */
  skinConfigOps?: ReadonlySet<number>;
}
