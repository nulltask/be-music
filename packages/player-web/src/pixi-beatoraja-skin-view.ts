// Static-paint view for a beatoraja skin: each `image[]` / `value[]` / `text[]` declaration referenced by a
// `destination[]` becomes a Pixi `Sprite` or `Text` on a single `Container`, and `update(context)` resamples
// every destination keyframe per frame. Engine-driven dynamics (notes, judge flashes, key-on, BGA, lamps) are
// owned by the gameplay scene that drives this view from outside.

import { BitmapText, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  centerToAnchor,
  composeBeatorajaValueCells,
  composeBeatorajaValueShift,
  computeBeatorajaGaugeAnimation,
  evaluateBeatorajaCustomEvents,
  evaluateBeatorajaCustomTimers,
  normalizeBeatorajaCustomEvents,
  normalizeBeatorajaCustomTimers,
  BEATORAJA_LUA_TIMER_OFF_VALUE,
  BEATORAJA_NUM,
  evaluateBeatorajaLuaNumber,
  evaluateBeatorajaLuaString,
  expandBeatorajaJudgeDestinations,
  imageFrameAt,
  imageFrameRect,
  imageRefFrame,
  normalizeBeatorajaBpmGraphs,
  normalizeBeatorajaDestinations,
  normalizeBeatorajaGaugeGraphs,
  normalizeBeatorajaJudgeGraphs,
  normalizeBeatorajaTimingDistributionGraphs,
  normalizeBeatorajaTimingVisualizers,
  normalizeBeatorajaGauge,
  normalizeBeatorajaGraphs,
  normalizeBeatorajaImages,
  normalizeBeatorajaImagesets,
  normalizeBeatorajaPmCharas,
  normalizeBeatorajaNote,
  normalizeBeatorajaJudges,
  normalizeBeatorajaSliders,
  normalizeBeatorajaTexts,
  normalizeBeatorajaFloatValues,
  normalizeBeatorajaValues,
  OFFSET_HIDDEN_COVER,
  OFFSET_LIFT,
  pickBeatorajaGaugeNode,
  beatorajaFloatValueSlotCount,
  composeBeatorajaFloatValueCells,
  type BeatorajaBpmGraphElement,
  type BeatorajaCustomEvent,
  type BeatorajaCustomEventState,
  type BeatorajaCustomTimer,
  type BeatorajaDestinationGroup,
  type BeatorajaGaugeGraphElement,
  type BeatorajaJudgeGraphElement,
  type BeatorajaTimingDistributionGraphElement,
  type BeatorajaTimingVisualizerElement,
  type BeatorajaGaugeElement,
  type BeatorajaGraphElement,
  type BeatorajaFloatPropertyRef,
  type BeatorajaFloatValueElement,
  type BeatorajaImageElement,
  type BeatorajaImageId,
  type BeatorajaImagesetElement,
  type BeatorajaPmCharaElement,
  type BeatorajaIntegerPropertyRef,
  type BeatorajaLuaRuntimeContext,
  type BeatorajaSkin,
  type BeatorajaSkinFontId,
  type BeatorajaStringPropertyRef,
  type BeatorajaSliderElement,
  type BeatorajaTextElement,
  type BeatorajaValueElement,
} from '@be-music/beatoraja-skin';
import {
  applyBeatorajaStretchRect,
  createCroppedBeatorajaTexture,
  destinationToSpriteProps,
  type BeatorajaRenderContext,
} from './beatoraja-render.ts';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';
import { NOTE_DISTRIBUTION_COLORS } from './beatoraja-chart-note-distribution.ts';

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
   * point inside the bpmgraph's destination box (x = chart progress, y = (bpm − minBpm) /
   * (maxBpm − minBpm)). The renderer maps these onto the dst rect with `y` inverted (high BPM
   * paints toward the top of the box). Hosts compute this once per chart and hand it back from
   * the resolver. Returning `undefined` or an empty array hides every bpmgraph element.
   */
  resolveBpmGraphPoints?: () => ReadonlyArray<{ x: number; y: number }> | undefined;
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
  resolveNoteDistribution?: () => {
    buckets: ReadonlyArray<ReadonlyArray<number>>;
    maxCount: number;
    totalMs: number;
  } | undefined;
  /**
   * Resolve the BPM curve segments + mainbpm reference for `bpmgraph` destinations. Replaces
   * the legacy `{x, y}` polyline ({@link resolveBpmGraphPoints}); the new shape carries the
   * raw `(timeMs, bpm)` segments so the renderer can apply upstream's log-scaled,
   * mainbpm-relative y projection AND color-code segments by BPM identity (mainbpm = green,
   * minbpm = blue, maxbpm = red, others = yellow, stop = magenta).
   *
   * Returning `undefined` falls back to {@link resolveBpmGraphPoints}.
   */
  resolveBpmGraphData?: () => {
    segments: ReadonlyArray<{ timeMs: number; bpm: number }>;
    mainBpm: number;
    minBpm: number;
    maxBpm: number;
    totalMs: number;
  } | undefined;
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
   * renderer plots a sample per entry, fades older entries by index, and color-codes them by
   * kind. Empty array hides the visualizer.
   */
  resolveTimingSamples?: () => ReadonlyArray<{ deltaMs: number; kind: string }> | undefined;
  /**
   * Resolve the FULL run's timing samples for the `timingdistributiongraph[]` element. Same
   * shape as {@link resolveTimingSamples} but returns every judgement, not just the live ring.
   * The renderer bins these into a per-ms histogram and overlays optional average / std-dev
   * guides. Used by the result scene; the play scene typically returns `undefined` (the
   * histogram is meant for post-game review).
   */
  resolveTimingDistribution?: () => ReadonlyArray<{ deltaMs: number; kind: string }> | undefined;
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

interface SpriteEntry {
  kind: 'image';
  group: BeatorajaDestinationGroup;
  image: BeatorajaImageElement;
  /** Base texture (whole source). Sprite's texture is a cropped view of this. */
  baseTexture: ReturnType<BeatorajaTextureCache['get']>;
  sprite: Sprite;
  /** Frame index currently uploaded to `sprite.texture`. -1 means "no texture set yet". */
  currentFrame: number;
  /**
   * Last visible-height ratio painted by the disapearLine clip path. Hidden-cover entries (with
   * `image.disapearLine >= 0`) shrink the source crop and the sprite height proportionally as
   * the lift slider moves; this caches the last applied ratio so the per-frame crop only
   * rebuilds when the value actually changes. `1` (the default) is "no clip" — the full source
   * crop is used.
   */
  lastDisapearRatio: number;
}

interface FloatValueEntry {
  kind: 'floatvalue';
  group: BeatorajaDestinationGroup;
  value: BeatorajaFloatValueElement;
  /** Source strip texture (uncropped). Each digit / dot sprite crops a sub-rect from this. */
  baseTexture: ReturnType<BeatorajaTextureCache['get']>;
  /**
   * One sprite per slot. Slot count is `iketa + (fketa > 0 ? 1 : 0) + fketa`. Each frame the
   * composer hands back per-slot cell descriptors; the matching sprite gets a cropped
   * sub-texture and laid out side-by-side along the dst rect.
   */
  slotSprites: Sprite[];
  /** Last resolved float value — used to skip re-cropping when nothing changed. */
  lastValue: number;
}

interface ValueEntry {
  kind: 'value';
  group: BeatorajaDestinationGroup;
  value: BeatorajaValueElement;
  baseTexture: ReturnType<BeatorajaTextureCache['get']>;
  /** One sprite per digit position. Created upfront sized to `value.digit`. */
  digitSprites: Sprite[];
  /** Last numeric value rendered, used to skip cell-texture rebuilds when the number hasn't changed. */
  lastValue: number;
}

interface TextEntry {
  kind: 'text';
  group: BeatorajaDestinationGroup;
  element: BeatorajaTextElement;
  /**
   * Either a Pixi `Text` (CSS-fonts pipe) or a `BitmapText` (BMFont pipe). Both extend
   * `AbstractText` and share `text` / position / `style.*` accessors, so the per-frame update path
   * is identical. The pick is made once at build-time from `resolveFontKind` — no runtime
   * branching during the `update` hot path.
   */
  text: Text | BitmapText;
}

interface GraphEntry {
  kind: 'graph';
  group: BeatorajaDestinationGroup;
  element: BeatorajaGraphElement;
  /** Base texture (whole source). The sprite's texture is a cropped sub-rect of this. */
  baseTexture: ReturnType<BeatorajaTextureCache['get']>;
  /**
   * Sprite painting the graph's source crop. Width / height are scaled per-frame by the resolver's
   * 0..1 ratio along `element.angle`. The full crop is `(element.x, element.y, element.w,
   * element.h)`; the live render samples a sub-rect that grows from one edge based on the angle.
   */
  sprite: Sprite;
}

interface PolylineGraphEntry {
  kind: 'polyline-graph';
  group: BeatorajaDestinationGroup;
  element: BeatorajaGraphElement;
  /**
   * Pixi `Graphics` painting the polyline. Cleared and rebuilt every frame the points change —
   * a single `Graphics` is fine here because the polyline cap is small (~few hundred judge
   * samples), and `Graphics` rebatching is cheap relative to alternatives like keeping one
   * `Sprite` per segment.
   */
  graphics: Graphics;
  /** Last point count painted, used to skip the rebuild when the polyline hasn't grown. */
  lastPointCount: number;
}

interface BpmGraphEntry {
  kind: 'bpmgraph';
  group: BeatorajaDestinationGroup;
  element: BeatorajaBpmGraphElement;
  /** Pixi `Graphics` painting the BPM curve. Same rebuild-on-change pattern as polyline-graph. */
  graphics: Graphics;
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

interface JudgeGraphEntry {
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
   * Cached signature of the bars last painted. Per-frame stroke is skipped when the signature
   * hasn't moved, which is the common case (counts only change at judge events).
   */
  lastSignature: string;
}

interface GaugeGraphEntry {
  kind: 'gaugegraph';
  group: BeatorajaDestinationGroup;
  element: BeatorajaGaugeGraphElement;
  /**
   * Pixi `Graphics` painting the gauge polyline. Cleared and re-stroked when the host's resolver
   * returns a different number of points (= a new sample landed); same rebuild-on-change pattern
   * as `polyline-graph` and `bpmgraph`.
   */
  graphics: Graphics;
  lastPointCount: number;
}

interface TimingVisualizerEntry {
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

interface TimingDistributionEntry {
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

interface SliderEntry {
  kind: 'slider';
  group: BeatorajaDestinationGroup;
  element: BeatorajaSliderElement;
  /** Base texture (whole source). Slider sprite uses a fixed-rect crop of this. */
  baseTexture: ReturnType<BeatorajaTextureCache['get']>;
  /**
   * Sprite painting the source crop. Position is `dst.x/y + value * range` along the slider's
   * angle axis — the dst rect anchors the home position (value = 0) and the range translates
   * the sprite by up to `range` skin-pixels.
   */
  sprite: Sprite;
}

interface GaugeEntry {
  kind: 'gauge';
  group: BeatorajaDestinationGroup;
  element: BeatorajaGaugeElement;
  /**
   * Per-cell sprite pool — sized to `element.parts` at build time. Each cell paints one of the
   * `nodes[]` images, swapped per frame as the gauge value crosses thresholds. The cells share
   * the destination's keyframe-driven (x, y, w, h) — total width is divided by `parts` for the
   * per-cell width.
   */
  cells: Sprite[];
  /**
   * FLICKERING-mode overlay sprite painted on top of the topmost lit cell (the one whose
   * `i === notes` boundary marks the live gauge edge). Beatoraja's `SkinGauge.draw` blits two
   * sprites for that cell: the base lit node, then a second highlight node ON TOP of it that
   * pulses with the gauge animation. Only the FLICKERING animation type uses this — the
   * others rely on per-cell texture swaps via `pickBeatorajaGaugeNode` alone.
   *
   * Allocated once at build time (added LAST to the container so it z-orders above every base
   * cell). Hidden when the picker doesn't return a `flickerOverlayId` for any cell.
   */
  overlay: Sprite;
  /**
   * Pre-resolved `(nodeId → cropped Texture)` map. Only nodes referenced by `nodes[]` are
   * present; the renderer queries by id during the per-cell texture swap.
   */
  nodeTextures: ReadonlyMap<BeatorajaImageId, Texture>;
}

interface ImagesetEntry {
  kind: 'imageset';
  group: BeatorajaDestinationGroup;
  element: BeatorajaImagesetElement;
  /**
   * Pre-resolved sub-image data, one entry per `images[]` slot. Each carries the matching
   * `BeatorajaImageElement` (so per-frame stepping still works inside a sub-image with
   * `divx` / `divy`) plus the cropped cell-0 texture for fast first-frame rendering. Slots
   * whose image lookup failed are `undefined`; the renderer falls back to the previous valid
   * slot (or hides the entry if none).
   */
  subImages: ReadonlyArray<
    | {
        image: BeatorajaImageElement;
        baseTexture: ReturnType<BeatorajaTextureCache['get']>;
      }
    | undefined
  >;
  sprite: Sprite;
  /** Last `images[]` index painted, used to skip the texture rebuild when the ref hasn't changed. */
  lastSubIndex: number;
  /** Last frame index uploaded to the sprite. -1 = never uploaded. */
  lastFrame: number;
}

/**
 * `pmchara[]` POMYU character entry. Popn-style 9K skins author dancing-character displays
 * keyed off a `source[]` slot's full texture (no sub-rect crop). The renderer paints the
 * source's whole image at the destination rect — frame-cycled animation driven by chart cues
 * is a follow-up patch; until then this entry behaves like a static fullscreen image. Source
 * resolution gracefully hides the sprite when the slot has no texture (typical case: the
 * `def: "Off"` filepath default is set, so no character pack loads).
 */
interface PmCharaEntry {
  kind: 'pmchara';
  group: BeatorajaDestinationGroup;
  element: BeatorajaPmCharaElement;
  /** Full source texture (whole `source[].path` image) — `undefined` when no character pack loaded. */
  baseTexture: ReturnType<BeatorajaTextureCache['get']>;
  sprite: Sprite;
}

type ViewEntry =
  | SpriteEntry
  | ValueEntry
  | FloatValueEntry
  | TextEntry
  | GraphEntry
  | PolylineGraphEntry
  | BpmGraphEntry
  | JudgeGraphEntry
  | GaugeGraphEntry
  | TimingVisualizerEntry
  | TimingDistributionEntry
  | SliderEntry
  | ImagesetEntry
  | GaugeEntry
  | PmCharaEntry;

export class BeatorajaPlaySkinView {
  readonly container = new Container();
  readonly width: number;
  readonly height: number;
  /**
   * Index inside `container.children` where note / marker layers should be inserted by the host
   * to place them at the correct z-order. Beatoraja themes author a `{id = noteSection.id, offset
   * = N}` destination — the "notes" anchor — that marks WHERE in the destination z-stack the
   * playfield notes belong. Skin destinations sorted before the anchor render BEHIND notes; ones
   * sorted after render IN FRONT (the reference theme uses this so `lanecover` / `hidden-cover`
   * paint over notes). The view skips the anchor destination's sprite (it has no image content)
   * and records the resulting child count here. Hosts that don't insert at this index get the
   * legacy "notes always on top" behavior.
   *
   * Defaults to `container.children.length` (== "append at the end") when the skin omits the
   * anchor entirely.
   */
  readonly noteLayerInsertIndex: number;
  /**
   * Index inside `container.children` where the host should splice in its song-list overlay (the
   * select-scene's per-row labels). Beatoraja's select skins author a `{id = "songlist"}`
   * destination as the z-anchor for the song-bar grid — chrome declared earlier paints behind
   * the bars (background, frame), chrome declared after paints on top (cursor highlight, info
   * panels). Same anchor convention as {@link noteLayerInsertIndex}, just for a different layer.
   *
   * Defaults to `container.children.length` (= top-of-stack) when the skin doesn't author the
   * songlist anchor (most LR2 / play / decide / result themes).
   */
  readonly songListLayerInsertIndex: number;
  private readonly entries: ViewEntry[] = [];
  private readonly resolveRefValue: (refOp: number) => number;
  private readonly resolveTextContent: (refOp: number) => string | undefined;
  private readonly resolveNumberValue: (refOp: number) => number | undefined;
  private readonly resolveFontFamily: (fontId: BeatorajaSkinFontId) => string | undefined;
  private readonly resolveFontKind: (fontId: BeatorajaSkinFontId) => 'css' | 'bitmap' | undefined;
  private readonly resolveGraphValue: (type: number) => number | undefined;
  private readonly resolveGraphPolyline: (type: number) => ReadonlyArray<{ x: number; y: number }> | undefined;
  private readonly resolveSliderValue: (type: number) => number | undefined;
  private readonly resolveGaugePercent: () => number | undefined;
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
  private readonly resolveGaugeGraphPoints: () => ReadonlyArray<{ x: number; y: number }> | undefined;
  private readonly resolveTimingSamples: () => ReadonlyArray<{ deltaMs: number; kind: string }> | undefined;
  private readonly resolveTimingDistribution: () => ReadonlyArray<{ deltaMs: number; kind: string }> | undefined;
  private readonly onButtonAction:
    | ((act: number, modifiers?: { shift: boolean; ctrl: boolean; alt: boolean }) => void)
    | undefined;
  private readonly chartImageProvider: ((syntheticId: number) => Texture | undefined) | undefined;
  private readonly customEvents: ReadonlyArray<BeatorajaCustomEvent>;
  private readonly customEventState: BeatorajaCustomEventState[] = [];
  private readonly customTimers: ReadonlyArray<BeatorajaCustomTimer>;
  private readonly customTimerState: number[] = [];
  private disposed = false;

  constructor(options: BeatorajaPlaySkinViewOptions) {
    // Skin canvas size is authored per-skin in the top-level `w` / `h` (= `skin.w` / `skin.h` in Lua,
    // or top-level `"w"` / `"h"` in JSON). LR2 default is 640×480; beatoraja default is typically
    // 1280×720 — and skin authors freely pick other values. We MUST track each skin's authored size,
    // not a hardcoded constant, so `fitToStage`'s scale math produces the right design → screen ratio.
    //
    // Defaults to 1280×720 only when the skin emits a non-positive value (a corrupt header — refuse to
    // crash, but log it). This is a safety net, NOT a normalization step: a well-formed skin always
    // wins.
    const rawW = (options.skin as { w?: unknown }).w;
    const rawH = (options.skin as { h?: unknown }).h;
    this.width = typeof rawW === 'number' && Number.isFinite(rawW) && rawW > 0 ? rawW : 1280;
    this.height = typeof rawH === 'number' && Number.isFinite(rawH) && rawH > 0 ? rawH : 720;
    this.resolveRefValue = options.resolveRefValue ?? (() => 0);
    this.resolveTextContent = options.resolveTextContent ?? (() => undefined);
    this.resolveNumberValue = options.resolveNumberValue ?? (() => undefined);
    this.resolveFontFamily = options.resolveFontFamily ?? (() => undefined);
    this.resolveFontKind = options.resolveFontKind ?? (() => undefined);
    this.resolveGraphValue = options.resolveGraphValue ?? (() => undefined);
    this.resolveGraphPolyline = options.resolveGraphPolyline ?? (() => undefined);
    this.resolveSliderValue = options.resolveSliderValue ?? (() => undefined);
    this.resolveGaugePercent = options.resolveGaugePercent ?? (() => undefined);
    this.resolveBpmGraphPoints = options.resolveBpmGraphPoints ?? (() => undefined);
    this.resolveBpmGraphData = options.resolveBpmGraphData ?? (() => undefined);
    this.resolveJudgeGraphBars = options.resolveJudgeGraphBars ?? (() => undefined);
    this.resolveNoteDistribution = options.resolveNoteDistribution ?? (() => undefined);
    this.resolveGaugeGraphPoints = options.resolveGaugeGraphPoints ?? (() => undefined);
    this.resolveTimingSamples = options.resolveTimingSamples ?? (() => undefined);
    this.resolveTimingDistribution = options.resolveTimingDistribution ?? (() => undefined);
    this.onButtonAction = options.onButtonAction;
    this.chartImageProvider = options.chartImageProvider;
    // Parse customEvents / customTimers once at view construction. The per-frame evaluator
    // reads `this.customEventState` / `this.customTimerState` for edge detection / change
    // tracking — see `update()`. ModernChic + GdbG_Skin both populate these so panel-toggle
    // SE / fullcombo voice / IR-update notifications fire at the right moments (audit 2.2).
    this.customEvents = normalizeBeatorajaCustomEvents(
      (options.skin as { customEvents?: unknown }).customEvents,
    );
    this.customTimers = normalizeBeatorajaCustomTimers(
      (options.skin as { customTimers?: unknown }).customTimers,
    );

    const imageById = new Map<BeatorajaImageId, BeatorajaImageElement>();
    for (const image of normalizeBeatorajaImages(options.skin.image)) {
      imageById.set(image.id, image);
    }
    // `hiddenCover[]` / `liftCover[]` share the (id, src, x, y, w, h) shape with `image[]` plus
    // extra `disapearLine` / `isDisapearLineLinkLift` fields tied to the lift / lanecover
    // slider. Until those are surfaced through the resolver, each cover renders as a regular
    // image at its authored dst rect — fold both arrays into `imageById` so destinations
    // referencing `"hidden-cover"` / `"lift-cover"` etc. resolve and paint.
    //
    // Track which ids belong to each cover kind so we can later auto-append the implicit
    // offset ids (mirrors `JsonPlaySkinObjectLoader`):
    //
    //   - hiddenCover dsts get OFFSET_LIFT + OFFSET_HIDDEN_COVER appended
    //   - liftCover dsts get OFFSET_LIFT appended
    //
    // Without this auto-append, lift-cover and hidden-cover sprites stay frozen at their
    // authored y when the user drags the lift / hidden-cover sliders — the matching offset
    // ids never reach the destination's offset application path.
    const hiddenCoverIds = new Set<BeatorajaImageId>();
    const liftCoverIds = new Set<BeatorajaImageId>();
    for (const cover of normalizeBeatorajaImages(options.skin.hiddenCover)) {
      if (!imageById.has(cover.id)) imageById.set(cover.id, cover);
      hiddenCoverIds.add(cover.id);
    }
    for (const cover of normalizeBeatorajaImages(options.skin.liftCover)) {
      if (!imageById.has(cover.id)) imageById.set(cover.id, cover);
      liftCoverIds.add(cover.id);
    }
    // Element-kind resolution priority follows beatoraja's `JsonSkinObjectLoader.loadSkinObject`
    // which walks `sk.image -> sk.imageset -> sk.value -> sk.floatvalue -> sk.text -> sk.slider
    // -> sk.graph` with an early-return on each match. Earlier kinds claim id collisions ahead
    // of later ones — most importantly `imageset[]` outranks `value/text/graph/slider`. Our
    // previous registration (imageset dead last) silently dropped imageset paint when authors
    // reused the same id for a value/text/graph dst — common in skins that name their dst
    // semantically (`"info-panel"`) and bind multiple representations to it.
    //
    // Each map's "is this id already claimed?" check enumerates every higher-priority map.
    // Lower-priority kinds appended at the end inherit the same chain via the `claimedBy`
    // helper so adding new element types keeps the registration order honest.
    //
    // `imageset[]` — multi-state images (lane keybeams, bomb cycles) flipping between sub-images
    // by a runtime ref op. Mirrors upstream's #2 priority (right after `image[]`).
    const imagesetById = new Map<BeatorajaImageId, BeatorajaImagesetElement>();
    for (const imageset of normalizeBeatorajaImagesets(options.skin.imageset)) {
      if (!imageById.has(imageset.id)) imagesetById.set(imageset.id, imageset);
    }
    // `value[]` — numeric formatting metadata (`digit` / `padding` / `divx`) over the
    // `composeBeatorajaValueCells` digit composer.
    const valueById = new Map<BeatorajaImageId, BeatorajaValueElement>();
    for (const value of normalizeBeatorajaValues(options.skin.value)) {
      if (!imageById.has(value.id) && !imagesetById.has(value.id)) {
        valueById.set(value.id, value);
      }
    }
    // `floatvalue[]` — decimal-number readouts (BPM, accuracy %, timing deltas). Same digit
    // strip as `value[]` plus `iketa` / `fketa` / `gain` for the integer-dot-fractional
    // composition. Lives between value and text in upstream's resolution order.
    const floatValueById = new Map<BeatorajaImageId, BeatorajaFloatValueElement>();
    for (const fv of normalizeBeatorajaFloatValues((options.skin as { floatvalue?: unknown }).floatvalue)) {
      if (!imageById.has(fv.id) && !imagesetById.has(fv.id) && !valueById.has(fv.id)) {
        floatValueById.set(fv.id, fv);
      }
    }
    // `text[]` — font / size / ref pairs the runtime resolves into strings. Skin TTFs aren't
    // loaded yet (engine integration handles that); placeholders use the browser's default
    // sans-serif so positions and sizes are visible.
    const textById = new Map<BeatorajaImageId, BeatorajaTextElement>();
    for (const text of normalizeBeatorajaTexts(options.skin.text)) {
      if (
        !imageById.has(text.id) &&
        !imagesetById.has(text.id) &&
        !valueById.has(text.id) &&
        !floatValueById.has(text.id)
      ) {
        textById.set(text.id, text);
      }
    }
    // `slider[]` — translatable sprites driven by a runtime value (lanecover line, hispeed
    // lift, volume sliders).
    const sliderById = new Map<BeatorajaImageId, BeatorajaSliderElement>();
    for (const slider of normalizeBeatorajaSliders((options.skin as { slider?: unknown }).slider)) {
      if (
        !imageById.has(slider.id) &&
        !imagesetById.has(slider.id) &&
        !valueById.has(slider.id) &&
        !textById.has(slider.id)
      ) {
        sliderById.set(slider.id, slider);
      }
    }
    // `graph[]` — scaling-bar overlays (gauge fills, chart-progress bars).
    const graphById = new Map<BeatorajaImageId, BeatorajaGraphElement>();
    for (const graph of normalizeBeatorajaGraphs(options.skin.graph)) {
      if (
        !imageById.has(graph.id) &&
        !imagesetById.has(graph.id) &&
        !valueById.has(graph.id) &&
        !textById.has(graph.id) &&
        !sliderById.has(graph.id)
      ) {
        graphById.set(graph.id, graph);
      }
    }
    // Helper closure tracking every claimed-by-higher-priority map. New low-priority element
    // kinds (bpmgraph / judgegraph / gaugegraph / timingvisualizer / timingdistribution)
    // funnel through this so the precedence chain stays authoritative.
    const claimedBy = (id: BeatorajaImageId): boolean =>
      imageById.has(id) ||
      imagesetById.has(id) ||
      valueById.has(id) ||
      floatValueById.has(id) ||
      textById.has(id) ||
      sliderById.has(id) ||
      graphById.has(id);

    // `bpmgraph[]` — chart's BPM curve plotted across a destination box.
    const bpmGraphById = new Map<BeatorajaImageId, BeatorajaBpmGraphElement>();
    for (const bpmGraph of normalizeBeatorajaBpmGraphs((options.skin as { bpmgraph?: unknown }).bpmgraph)) {
      if (!claimedBy(bpmGraph.id)) bpmGraphById.set(bpmGraph.id, bpmGraph);
    }
    // `judgegraph[]` — judgement / early-late histogram.
    const judgeGraphById = new Map<BeatorajaImageId, BeatorajaJudgeGraphElement>();
    for (const judgeGraph of normalizeBeatorajaJudgeGraphs((options.skin as { judgegraph?: unknown }).judgegraph)) {
      if (!claimedBy(judgeGraph.id) && !bpmGraphById.has(judgeGraph.id)) {
        judgeGraphById.set(judgeGraph.id, judgeGraph);
      }
    }
    // `gaugegraph[]` — gauge polyline on the result scene.
    const gaugeGraphById = new Map<BeatorajaImageId, BeatorajaGaugeGraphElement>();
    for (const gaugeGraph of normalizeBeatorajaGaugeGraphs((options.skin as { gaugegraph?: unknown }).gaugegraph)) {
      if (!claimedBy(gaugeGraph.id) && !bpmGraphById.has(gaugeGraph.id) && !judgeGraphById.has(gaugeGraph.id)) {
        gaugeGraphById.set(gaugeGraph.id, gaugeGraph);
      }
    }
    // `timingvisualizer[]` / `hiterrorvisualizer[]` — recent-timing tick visualizer.
    const timingVisualizerById = new Map<BeatorajaImageId, BeatorajaTimingVisualizerElement>();
    const collectTimingVisualizers = (input: unknown): void => {
      for (const tv of normalizeBeatorajaTimingVisualizers(input)) {
        if (
          !claimedBy(tv.id) &&
          !bpmGraphById.has(tv.id) &&
          !judgeGraphById.has(tv.id) &&
          !gaugeGraphById.has(tv.id)
        ) {
          timingVisualizerById.set(tv.id, tv);
        }
      }
    };
    collectTimingVisualizers((options.skin as { timingvisualizer?: unknown }).timingvisualizer);
    collectTimingVisualizers((options.skin as { hiterrorvisualizer?: unknown }).hiterrorvisualizer);
    // `timingdistributiongraph[]` — full-run timing histogram on the result scene.
    const timingDistributionById = new Map<BeatorajaImageId, BeatorajaTimingDistributionGraphElement>();
    for (const tdg of normalizeBeatorajaTimingDistributionGraphs(
      (options.skin as { timingdistributiongraph?: unknown }).timingdistributiongraph,
    )) {
      if (
        !claimedBy(tdg.id) &&
        !bpmGraphById.has(tdg.id) &&
        !judgeGraphById.has(tdg.id) &&
        !gaugeGraphById.has(tdg.id) &&
        !timingVisualizerById.has(tdg.id)
      ) {
        timingDistributionById.set(tdg.id, tdg);
      }
    }
    // `gauge` element (singular — beatoraja's reference theme authors at most one gauge per
    // skin). Same id-namespace contention rule as the others.
    const gauge = normalizeBeatorajaGauge(options.skin.gauge);
    let gaugeElement: BeatorajaGaugeElement | undefined;
    if (
      gauge !== undefined &&
      !claimedBy(gauge.id) &&
      !bpmGraphById.has(gauge.id) &&
      !judgeGraphById.has(gauge.id) &&
      !gaugeGraphById.has(gauge.id) &&
      !timingVisualizerById.has(gauge.id) &&
      !timingDistributionById.has(gauge.id)
    ) {
      gaugeElement = gauge;
    }

    // `pmchara[]` — POMYU character display block, popn-style 9K skin only
    // (`default/play9.json`). Same id-namespace contention rule as the others; loses to every
    // prior kind on collision. Skins without `pmchara[]` get an empty map and the rest of the
    // pipeline runs unchanged.
    const pmcharaById = new Map<BeatorajaImageId, BeatorajaPmCharaElement>();
    for (const pmchara of normalizeBeatorajaPmCharas((options.skin as { pmchara?: unknown }).pmchara)) {
      if (
        !claimedBy(pmchara.id) &&
        !bpmGraphById.has(pmchara.id) &&
        !judgeGraphById.has(pmchara.id) &&
        !gaugeGraphById.has(pmchara.id) &&
        !timingVisualizerById.has(pmchara.id) &&
        !timingDistributionById.has(pmchara.id) &&
        gaugeElement?.id !== pmchara.id
      ) {
        pmcharaById.set(pmchara.id, pmchara);
      }
    }

    // Expand `judge[]` entries into synthetic destinations gated on the matching judge ops
    // (`P1_JUDGE_PERFECT = 241` etc.). The expansion adds one destination per (judge entry ×
    // image / number sub-entry × judge kind), each with the per-judge op appended to the gate.
    // Concatenated with `skin.destination` so the standard destination pipeline handles them.
    const judges = normalizeBeatorajaJudges(options.skin.judge);
    const expandedJudgeDestinations = expandBeatorajaJudgeDestinations(judges);
    // Beatoraja themes mark the playfield's z-order with a `{id = noteSection.id, offset = N}`
    // destination — the "notes anchor". Skin authors typically write it WITHOUT a `dst[]` field
    // since it carries no visual content (`table.insert(skin.destination, {id = "notes", offset =
    // 30})`), but our destination normalizer drops anything missing `dst[]`. Inject a sentinel
    // keyframe so the anchor survives normalization + sorting and we can find its index later.
    const noteSection = normalizeBeatorajaNote(options.skin.note);
    const noteAnchorId: BeatorajaImageId | undefined =
      typeof noteSection.id === 'string' && noteSection.id.length > 0 ? noteSection.id : undefined;
    // Songlist anchor — `{id = "songlist"}` in select-scene destination[]. Same z-anchor pattern
    // as the notes anchor: the host's per-row label layer splices in at this index. Only the
    // select scene's skins author it, so most other scenes' destinations carry no `songlist`
    // entry and the anchor is a no-op there.
    const SONG_LIST_ANCHOR_ID: BeatorajaImageId = 'songlist';
    const layerAnchorIds = new Set<BeatorajaImageId>();
    if (noteAnchorId !== undefined) layerAnchorIds.add(noteAnchorId);
    layerAnchorIds.add(SONG_LIST_ANCHOR_ID);
    const rawDestinations: ReadonlyArray<unknown> = Array.isArray(options.skin.destination)
      ? options.skin.destination.map((entry) => ensureLayerAnchorDst(entry, layerAnchorIds))
      : [];
    const allDestinations: ReadonlyArray<unknown> = [...rawDestinations, ...expandedJudgeDestinations];
    const groups = normalizeBeatorajaDestinations(allDestinations, options.skinConfigOps);

    // Render order: PURELY by author declaration order. Beatoraja's `JSONSkinLoader.loadJsonSkin`
    // walks `sk.destination` in source order and `Skin.drawAllObjects` iterates without sorting,
    // so the JSON's array index IS the z-order. Earlier drafts of this code sorted by `offset`
    // first, mistaking it for a z-layer — but the singular `offset` field is just a convenience
    // alias for `offsets[]` (a user-adjustable position offset id like `OFFSET_LIFT = 3`). Sorting
    // by it bunched all lane-chrome elements together regardless of where they were authored,
    // putting (e.g.) `disapearLine` and key-bombs at the same depth as their neighbors and
    // breaking the carefully ordered "lane bg → keybeams → notes anchor → bombs → cover"
    // sequence the reference themes rely on.
    //
    // `normalizeBeatorajaDestinations` assigns `declarationOrder = i` walking the input array, so
    // the groups are already in the right order — this sort is a no-op for already-ordered input,
    // but is kept defensively for the (rare) case where merging emits judges out of order.
    groups.sort((a, b) => a.declarationOrder - b.declarationOrder);

    // Auto-append the implicit offset ids that beatoraja's `JsonPlaySkinObjectLoader` adds
    // post-construction onto hidden-cover / lift-cover destinations:
    //
    //   - hiddenCover dsts → OFFSET_LIFT (3) + OFFSET_HIDDEN_COVER (5)
    //   - liftCover dsts   → OFFSET_LIFT (3)
    //
    // Without this, dragging the lift / hidden-cover sliders does nothing visible — the
    // sliders update the offset table fine, but the matching destinations have no link to
    // those ids in their `offsets[]`. Skips ids already authored on the destination so we
    // don't double-apply when an author manually listed the same id.
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i]!;
      const isHidden = hiddenCoverIds.has(group.id);
      const isLift = liftCoverIds.has(group.id);
      if (!isHidden && !isLift) continue;
      const next: number[] = group.offsets.slice();
      if (!next.includes(OFFSET_LIFT)) next.push(OFFSET_LIFT);
      if (isHidden && !next.includes(OFFSET_HIDDEN_COVER)) next.push(OFFSET_HIDDEN_COVER);
      groups[i] = { ...group, offsets: next };
    }

    // Walk the sorted destinations; capture each anchor's position so the host can splice in its
    // note / marker / song-list layers at exactly that z-order. Skin destinations sorted BEFORE
    // an anchor paint behind that layer; ones AFTER paint in front (lanecover / hidden-cover /
    // chrome over the song bars).
    let noteAnchorIndex: number | undefined;
    let songListAnchorIndex: number | undefined;

    for (const group of groups) {
      // Notes anchor: skip the sprite, record where in `container.children` the host should insert
      // its note + marker layers. Only the FIRST anchor matching the section id wins — duplicates
      // (uncommon in well-formed themes) are ignored.
      if (noteAnchorId !== undefined && group.id === noteAnchorId && noteAnchorIndex === undefined) {
        noteAnchorIndex = this.container.children.length;
        continue;
      }
      // Songlist anchor — same idea, different layer. Tells the select scene where to splice its
      // per-row labels overlay so it sits between the background chrome and the cursor / info
      // panels in the skin's authored z-stack.
      if (group.id === SONG_LIST_ANCHOR_ID && songListAnchorIndex === undefined) {
        songListAnchorIndex = this.container.children.length;
        continue;
      }
      // Synthetic image ids — beatoraja's renderer treats these as virtual images that don't
      // need a `source[]` declaration. Skin authors reference them directly:
      //   -110 BLACK — solid black panel (transitions / overlays / "letterbox-style" frames).
      //   -100 STAGEFILE / -101 BACKBMP / -102 BANNER — chart-bitmap virtual sources keyed off
      //     the host's `chartImageProvider` callback. Resolves to `undefined` (hidden) when no
      //     chart imagery is available.
      // Without virtual handling, these destinations get filtered as "no matching image" and
      // never render. ModernChic's decide pane authors a -110 panel that fades to fullscreen
      // on FADEOUT and a -100 stagefile preview that scales out from the centre.
      if (group.id === SYNTHETIC_IMAGE_BLACK_ID) {
        const sprite = new Sprite({ texture: ensureBlackTexture(), alpha: 0 });
        this.container.addChild(sprite);
        this.entries.push({
          kind: 'image',
          group,
          image: SYNTHETIC_BLACK_IMAGE,
          baseTexture: ensureBlackTexture(),
          sprite,
          currentFrame: 0,
          lastDisapearRatio: 1,
        });
        continue;
      }
      if (
        group.id === SYNTHETIC_IMAGE_STAGEFILE_ID ||
        group.id === SYNTHETIC_IMAGE_BACKBMP_ID ||
        group.id === SYNTHETIC_IMAGE_BANNER_ID
      ) {
        const provided = this.chartImageProvider?.(group.id);
        if (provided !== undefined && provided !== Texture.EMPTY) {
          const sprite = new Sprite({ texture: provided, alpha: 0 });
          this.container.addChild(sprite);
          this.entries.push({
            kind: 'image',
            group,
            // Synthesised image: source rect spans the texture's natural pixel bounds so the
            // dst-rect scaling math works the same as for any normal image source.
            image: makeSyntheticChartImage(group.id, provided.width, provided.height),
            baseTexture: provided,
            sprite,
            currentFrame: 0,
            lastDisapearRatio: 1,
          });
        }
        continue;
      }
      const image = imageById.get(group.id);
      if (image === undefined) {
        // Resolution priority mirrors `JsonSkinObjectLoader.loadSkinObject`:
        //   image -> imageset -> value -> floatvalue -> text -> slider -> graph
        // The registration phase above already deduped ids by this priority, so each
        // `*ById.get(id)` here only returns truthy for the WINNING kind. The order is still
        // worth preserving for predictability: a future de-dedup change shouldn't accidentally
        // re-introduce the imageset-dead-last bug.
        const imagesetElement = imagesetById.get(group.id);
        if (imagesetElement !== undefined) {
          const imagesetEntry = this.buildImagesetEntry(group, imagesetElement, imageById, options.textures);
          if (imagesetEntry !== undefined) this.entries.push(imagesetEntry);
          continue;
        }
        const valueElement = valueById.get(group.id);
        if (valueElement !== undefined) {
          const valueEntry = this.buildValueEntry(group, valueElement, options.textures);
          if (valueEntry !== undefined) this.entries.push(valueEntry);
          continue;
        }
        const floatValueElement = floatValueById.get(group.id);
        if (floatValueElement !== undefined) {
          const floatValueEntry = this.buildFloatValueEntry(group, floatValueElement, options.textures);
          if (floatValueEntry !== undefined) this.entries.push(floatValueEntry);
          continue;
        }
        const textElement = textById.get(group.id);
        if (textElement !== undefined) {
          this.entries.push(this.buildTextEntry(group, textElement));
          continue;
        }
        const sliderElement = sliderById.get(group.id);
        if (sliderElement !== undefined) {
          const sliderEntry = this.buildSliderEntry(group, sliderElement, options.textures);
          if (sliderEntry !== undefined) this.entries.push(sliderEntry);
          continue;
        }
        const graphElement = graphById.get(group.id);
        if (graphElement !== undefined) {
          const graphEntry = this.buildGraphEntry(group, graphElement, options.textures);
          if (graphEntry !== undefined) this.entries.push(graphEntry);
          continue;
        }
        const bpmGraphElement = bpmGraphById.get(group.id);
        if (bpmGraphElement !== undefined) {
          this.entries.push(this.buildBpmGraphEntry(group, bpmGraphElement));
          continue;
        }
        const judgeGraphElement = judgeGraphById.get(group.id);
        if (judgeGraphElement !== undefined) {
          this.entries.push(this.buildJudgeGraphEntry(group, judgeGraphElement));
          continue;
        }
        const gaugeGraphElement = gaugeGraphById.get(group.id);
        if (gaugeGraphElement !== undefined) {
          this.entries.push(this.buildGaugeGraphEntry(group, gaugeGraphElement));
          continue;
        }
        const timingElement = timingVisualizerById.get(group.id);
        if (timingElement !== undefined) {
          this.entries.push(this.buildTimingVisualizerEntry(group, timingElement));
          continue;
        }
        const tdgElement = timingDistributionById.get(group.id);
        if (tdgElement !== undefined) {
          this.entries.push(this.buildTimingDistributionEntry(group, tdgElement));
          continue;
        }
        const pmcharaElement = pmcharaById.get(group.id);
        if (pmcharaElement !== undefined) {
          this.entries.push(this.buildPmCharaEntry(group, pmcharaElement, options.textures));
          continue;
        }
        if (gaugeElement !== undefined && group.id === gaugeElement.id) {
          const gaugeEntry = this.buildGaugeEntry(group, gaugeElement, imageById, options.textures);
          if (gaugeEntry !== undefined) this.entries.push(gaugeEntry);
        }
        continue;
      }
      const baseTexture = options.textures.get(image.src);
      // Mount with `visible = true` (Pixi default) + `alpha = 0` instead of `visible = false`. PixiJS v8 batchers
      // skip texture-binding setup for invisible sprites on the first render pass, and the second-pass flip-on
      // crashes the bind-group cache (`textureSource1` null on WebGPU, `addressModeU` null on WebGL2). Painting
      // alpha-0 from frame 0 warms up every bind group; `update()` writes the real alpha next tick.
      //
      // The cell-0 cropped sub-texture is also pre-built here so the first render pass has a fully-resolved
      // texture for every sprite — same bind-group reasoning.
      const baseIsBindable = baseTexture !== undefined && baseTexture !== Texture.EMPTY;
      let initialTexture: Texture | undefined;
      let currentFrame = -1;
      if (baseIsBindable) {
        // Same `w <= 0 / h <= 0` "full texture" sentinel as the per-frame update path —
        // bypass the cropper when the author meant "use the entire source as-is" (audit 3.17).
        const useFullTexture = image.w <= 0 || image.h <= 0;
        if (useFullTexture) {
          initialTexture = baseTexture;
          currentFrame = 0;
        } else {
          const cell = imageFrameRect(image, 0);
          const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
          if (cropped !== undefined) {
            initialTexture = cropped;
            currentFrame = 0;
          }
        }
      }
      const sprite = new Sprite({ texture: initialTexture, alpha: 0 });
      this.container.addChild(sprite);
      applyTextureFilterMode(baseTexture, group.filter);
      // Skin-authored interactive button — `image.act` carries beatoraja's `button_type` action
      // code (15=play, 16=autoplay, 315=practice, 19/316/317/318=replay slots, etc.). When set,
      // wire the sprite up as a clickable surface and forward the action code to the host's
      // `onButtonAction` callback. The host (= scene) maps the code onto its real action
      // (start play, start autoplay, restore replay slot, …).
      //
      // Modifier keys (shift / ctrl / alt) are sniffed from the underlying DOM event and
      // forwarded — beatoraja convention is "Shift = invert" on increment-style buttons
      // (JUDGE_TIMING decrement, sort previous, etc.).
      if (image.act > 0 && this.onButtonAction !== undefined) {
        sprite.eventMode = 'static';
        sprite.cursor = 'pointer';
        const handler = this.onButtonAction;
        const actCode = image.act;
        sprite.on('pointertap', (event) => {
          // Pixi's `FederatedPointerEvent` exposes the originating DOM event for modifier-key
          // inspection. The `originalEvent` chain ends at a `KeyboardEvent`-shaped object that
          // has the `shiftKey` / `ctrlKey` / `altKey` flags we need.
          const orig = event as unknown as { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean };
          handler(actCode, {
            shift: orig.shiftKey === true,
            ctrl: orig.ctrlKey === true,
            alt: orig.altKey === true,
          });
        });
      }
      this.entries.push({ kind: 'image', group, image, baseTexture, sprite, currentFrame, lastDisapearRatio: 1 });
    }

    // Resolve each layer-anchor's insert position. Anchors were captured during the destination
    // loop; skins that omit one (e.g. select / decide / result themes don't have notes; play
    // skins don't have songlist) get the legacy "append at the end" behavior for the missing
    // anchor, which matches the previous layering.
    this.noteLayerInsertIndex = noteAnchorIndex ?? this.container.children.length;
    this.songListLayerInsertIndex = songListAnchorIndex ?? this.container.children.length;

    // Per-skin construction summary. `JSON.stringify` so devtools shows the full payload as a
    // selectable string (vs the collapsible tree `console.log(obj)` produces) — easier to copy
    // out and paste into a JSON formatter / a bug report.
    const counts = this.entries.reduce(
      (acc, entry) => {
        acc[entry.kind] += 1;
        return acc;
      },
      { image: 0, value: 0, text: 0 } as Record<ViewEntry['kind'], number>,
    );
    const noteAnchorConsumed = noteAnchorIndex !== undefined ? 1 : 0;
    const songListAnchorConsumed = songListAnchorIndex !== undefined ? 1 : 0;
    const skipped = groups.length - this.entries.length - noteAnchorConsumed - songListAnchorConsumed;
    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-view] skin view built',
      JSON.stringify({
        canvas: { w: this.width, h: this.height },
        destinations: groups.length,
        image: { declared: imageById.size, mounted: counts.image },
        value: { declared: valueById.size, mounted: counts.value },
        text: { declared: textById.size, mounted: counts.text },
        skipped,
        noteAnchor: { id: noteAnchorId, index: this.noteLayerInsertIndex, found: noteAnchorIndex !== undefined },
        songListAnchor: {
          id: SONG_LIST_ANCHOR_ID,
          index: this.songListLayerInsertIndex,
          found: songListAnchorIndex !== undefined,
        },
      }),
    );
    if (skipped > 0) {
      const unmatchedIds = groups
        .filter(
          (group) =>
            group.id !== noteAnchorId &&
            group.id !== SONG_LIST_ANCHOR_ID &&
            !imageById.has(group.id) &&
            !imagesetById.has(group.id) &&
            !valueById.has(group.id) &&
            !textById.has(group.id),
        )
        .map((group) => group.id);
      // eslint-disable-next-line no-console
      console.log(
        '[beatoraja-view] skipped destinations (no matching image/value/text)',
        JSON.stringify({
          count: skipped,
          ids: unmatchedIds.slice(0, 32),
          truncated: unmatchedIds.length > 32,
        }),
      );
    }
  }

  private buildValueEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaValueElement,
    textures: BeatorajaTextureCache,
  ): ValueEntry | undefined {
    const baseTexture = textures.get(element.src);
    const digits = Math.max(1, Math.trunc(element.digit));
    const digitSprites: Sprite[] = [];
    // Pre-build one sprite per digit slot. Mount with `alpha: 0` to dodge the same first-pass
    // bind-group race the image entries handle. The actual textures get cropped on first `update()`
    // when we know the resolved numeric value — until then each slot uses cell 0 as a placeholder so
    // PixiJS sees a non-EMPTY texture from frame 0.
    const baseIsBindable = baseTexture !== undefined && baseTexture !== Texture.EMPTY;
    for (let i = 0; i < digits; i += 1) {
      let initialTexture: Texture | undefined;
      if (baseIsBindable) {
        const placeholderCells = composeBeatorajaValueCells(element, 0);
        const cell = placeholderCells[i] ?? placeholderCells[0]!;
        const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
        if (cropped !== undefined) initialTexture = cropped;
      }
      const sprite = new Sprite({ texture: initialTexture, alpha: 0 });
      this.container.addChild(sprite);
      digitSprites.push(sprite);
    }
    return { kind: 'value', group, value: element, baseTexture, digitSprites, lastValue: 0 };
  }

  /**
   * Build a `floatvalue[]` entry. Pre-allocates one sprite per slot — the slot count is fixed
   * by `iketa` + (`fketa > 0 ? 1 : 0`) + `fketa` regardless of value magnitude, so we mount
   * the row once at construction. Each slot's texture gets cropped on first `update()` from
   * the source strip via {@link composeBeatorajaFloatValueCells}.
   */
  private buildFloatValueEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaFloatValueElement,
    textures: BeatorajaTextureCache,
  ): FloatValueEntry | undefined {
    const baseTexture = textures.get(element.src);
    const slotCount = beatorajaFloatValueSlotCount(element);
    const slotSprites: Sprite[] = [];
    const baseIsBindable = baseTexture !== undefined && baseTexture !== Texture.EMPTY;
    for (let i = 0; i < slotCount; i += 1) {
      let initialTexture: Texture | undefined;
      if (baseIsBindable) {
        const placeholderCells = composeBeatorajaFloatValueCells(element, 0);
        const cell = placeholderCells[i] ?? placeholderCells[0]!;
        const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
        if (cropped !== undefined) initialTexture = cropped;
      }
      const sprite = new Sprite({ texture: initialTexture, alpha: 0 });
      this.container.addChild(sprite);
      slotSprites.push(sprite);
    }
    return { kind: 'floatvalue', group, value: element, baseTexture, slotSprites, lastValue: 0 };
  }

  private buildTextEntry(group: BeatorajaDestinationGroup, element: BeatorajaTextElement): TextEntry {
    // Pick the skin-author's font (TTF or BMFont) when one was loaded for this `font` slot; fall
    // back to the platform sans-serif chain otherwise. For CSS fonts the stack fallback
    // (`sans-serif` after the skin family) covers two cases at once: (1) the skin family hasn't
    // finished registering yet, and (2) a glyph not present in the skin font (Japanese full-width,
    // emoji, etc.) gets borrowed from the system font without showing tofu. BMFonts don't get a
    // sans-serif fallback baked into the family — Pixi's BitmapText cache lookup is exact, so
    // appending `, sans-serif` would just miss the cache.
    const skinFamily = this.resolveFontFamily(element.fontId);
    const fontKind = this.resolveFontKind(element.fontId) ?? 'css';
    const fontFamily =
      skinFamily === undefined ? 'sans-serif' : fontKind === 'bitmap' ? skinFamily : `'${skinFamily}', sans-serif`;
    // Mirror beatoraja's `SkinTextFont.draw()`:
    //
    //     font.getData().setScale(region.height / parameter.size);
    //
    // The font is loaded at `text[].size` glyph height, then scaled at draw time so the
    // rendered glyph height matches the destination rect's `h`. Final on-screen text height
    // is `dst.h` regardless of the authored `size` — that's why default beatoraja's
    // `genre` / `artist` (dst.h=20) render visibly smaller than `title` (dst.h=24) even
    // though all three set `size: 24`.
    //
    // Pixi's `Text` / `BitmapText` `fontSize` is the rendered height directly (no
    // separate scale stage), so we set it to `dst.h`. Falls back to `text[].size` when
    // the destination omits a height (rare); final guard at 24 for skins authoring
    // neither.
    const firstFrame = group.dst[0];
    const rectH = firstFrame !== undefined && firstFrame.h > 0 ? firstFrame.h : 0;
    const requestedSize = rectH > 0 ? rectH : element.size > 0 ? element.size : 24;
    // Pick `BitmapText` for BMFonts and `Text` for everything else. Both share the same constructor
    // surface (`text`, `style.fontFamily`, `style.fontSize`, `style.align`, `alpha`, anchors), so
    // downstream update code doesn't branch — see `updateTextEntry`.
    const TextCtor: typeof Text | typeof BitmapText =
      fontKind === 'bitmap' && skinFamily !== undefined ? BitmapText : Text;
    // Outline / drop-shadow styling (audit 2.10). Beatoraja's text element carries
    // `outlineColor`/`outlineWidth` and `shadowColor`/`shadowOffset{X,Y}`/`shadowSmoothness`;
    // the alpha byte of the color string is `00` when the feature is disabled, so we gate
    // application on `alpha > 0` (matching beatoraja's "outline color disabled" sentinel).
    // ModernChic Decide's title / genre / artist / stage labels (textproperty.lua:62-71)
    // rely on this — without the styling the text reads as flat white-on-bg with no outline,
    // which loses the difficulty-tinted ring the skin uses to communicate the chart's
    // difficulty level.
    const stroke =
      element.outlineColor.alpha > 0 && element.outlineWidth > 0
        ? { color: element.outlineColor.rgb, alpha: element.outlineColor.alpha, width: element.outlineWidth }
        : undefined;
    // Pixi expresses drop shadow as `{ distance, angle }` polar coordinates. Beatoraja
    // authors offsets in `(x, y)` cartesian — convert via hypot / atan2.
    const dropShadow =
      element.shadowColor.alpha > 0 && (element.shadowOffsetX !== 0 || element.shadowOffsetY !== 0)
        ? {
            color: element.shadowColor.rgb,
            alpha: element.shadowColor.alpha,
            distance: Math.hypot(element.shadowOffsetX, element.shadowOffsetY),
            angle: Math.atan2(element.shadowOffsetY, element.shadowOffsetX),
            blur: element.shadowSmoothness,
          }
        : undefined;
    const text = new TextCtor({
      text: '',
      style: {
        fontFamily,
        fontSize: requestedSize,
        fill: 0xffffff,
        align: element.align,
        // Pixi types treat `wordWrap` and `wordWrapWidth` as a pair; we leave the width
        // unset so it falls back to the dst rect bounds the entry sets per-frame in
        // `updateTextEntry` (via `style.wordWrapWidth`).
        wordWrap: element.wrapping,
        ...(stroke !== undefined ? { stroke } : {}),
        ...(dropShadow !== undefined ? { dropShadow } : {}),
      },
      alpha: 0,
    });
    // Anchor controls the (x, y) origin point. Beatoraja's reference theme positions text by the
    // dst rect's TOP-LEFT (or top-center / top-right with `align`); the y-anchor stays 0 so the
    // text's top edge sits at `props.y`.
    if (element.align === 'center') text.anchor.set(0.5, 0);
    else if (element.align === 'right') text.anchor.set(1, 0);
    this.container.addChild(text);
    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-view] text entry built',
      JSON.stringify({
        id: element.id,
        ref: element.ref,
        fontId: element.fontId,
        size: requestedSize,
        align: element.align,
        family: fontFamily,
        kind: fontKind,
        firstRect: firstFrame ? { x: firstFrame.x, y: firstFrame.y, w: firstFrame.w, h: firstFrame.h } : undefined,
      }),
    );
    return { kind: 'text', group, element, text };
  }

  /**
   * Build a graph entry. Polyline-style graphs (whose `type` the host's `resolveGraphPolyline`
   * answers) get a `PolylineGraphEntry` with a Pixi `Graphics` for line strokes. Everything else
   * falls through to the bar-fill `GraphEntry` path. The polyline check uses `resolveGraphPolyline`
   * — if it returns `undefined` for the type at build time, the renderer assumes that type will
   * never produce polyline data and goes straight to the bar entry.
   */
  private buildGraphEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaGraphElement,
    textures: BeatorajaTextureCache,
  ): ViewEntry | undefined {
    if (this.resolveGraphPolyline(element.type) !== undefined) {
      const graphics = new Graphics();
      graphics.alpha = 0;
      this.container.addChild(graphics);
      return { kind: 'polyline-graph', group, element, graphics, lastPointCount: -1 };
    }
    const baseTexture = textures.get(element.src);
    const baseIsBindable = baseTexture !== undefined && baseTexture !== Texture.EMPTY;
    // Pre-build the cell-0 cropped sub-texture for the same WebGPU-bind-group warm-up reasoning
    // used by `image` entries. The first render pass needs a fully-resolved texture; the per-frame
    // sampling re-crops along the angle axis.
    let initialTexture: Texture | undefined;
    if (baseIsBindable) {
      const cropped = createCroppedBeatorajaTexture(baseTexture, {
        x: element.x,
        y: element.y,
        w: element.w,
        h: element.h,
      });
      if (cropped !== undefined) initialTexture = cropped;
    }
    const sprite = new Sprite({ texture: initialTexture, alpha: 0 });
    this.container.addChild(sprite);
    applyTextureFilterMode(baseTexture, group.filter);
    return { kind: 'graph', group, element, baseTexture, sprite };
  }

  /**
   * Build a gauge entry — `parts` cell sprites pre-cropped from the `nodes[]` images. The cell
   * sprites share the destination's keyframe-driven (x, y, w, h); per-cell width is the total
   * width divided by `parts`. Each frame, every cell's texture is swapped to the matching
   * lit / off node based on the live gauge percent (`pickBeatorajaGaugeNode`).
   */
  private buildGaugeEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaGaugeElement,
    imageById: ReadonlyMap<BeatorajaImageId, BeatorajaImageElement>,
    textures: BeatorajaTextureCache,
  ): GaugeEntry | undefined {
    const nodeTextures = new Map<BeatorajaImageId, Texture>();
    for (const nodeId of element.nodes) {
      if (nodeTextures.has(nodeId)) continue;
      const image = imageById.get(nodeId);
      if (image === undefined) continue;
      const baseTexture = textures.get(image.src);
      if (baseTexture === undefined) continue;
      const cropped = createCroppedBeatorajaTexture(baseTexture, {
        x: image.x,
        y: image.y,
        w: image.w,
        h: image.h,
      });
      if (cropped !== undefined) nodeTextures.set(nodeId, cropped);
    }
    if (nodeTextures.size === 0) return undefined;
    const cells: Sprite[] = [];
    // Pick a default initial texture so the first render pass has something — `nodeTextures`
    // values() is order-of-insertion, so this always exists when `size > 0`.
    const firstTexture = nodeTextures.values().next().value;
    for (let i = 0; i < element.parts; i += 1) {
      const sprite = new Sprite({ texture: firstTexture, alpha: 0 });
      this.container.addChild(sprite);
      cells.push(sprite);
    }
    // FLICKERING overlay sprite. Mounted AFTER the base cells so its draw order is on top of
    // them — beatoraja's `SkinGauge.draw` paints the second blit overtop the first. Hidden by
    // default; `updateGaugeEntry` flips it visible and positions it on the topmost lit cell
    // when the picker returns a `flickerOverlayId` (FLICKERING animation type only).
    const overlay = new Sprite({ texture: firstTexture, alpha: 0 });
    overlay.visible = false;
    this.container.addChild(overlay);
    // Filter mode applies to every node texture used by this gauge, but they likely share a
    // single source (the gauge atlas). Apply to the first one and trust that pattern.
    const firstNode = nodeTextures.values().next().value;
    if (firstNode !== undefined) applyTextureFilterMode(firstNode, group.filter);
    return { kind: 'gauge', group, element, cells, overlay, nodeTextures };
  }

  /**
   * Build an imageset entry. Pre-resolves each `images[]` slot to its `image[]` element + base
   * texture so the per-frame update only swaps the cropped texture without re-walking the
   * imageById map. Returns `undefined` when none of the sub-images resolved (skin omitted them
   * all — better to skip than render an always-hidden sprite).
   */
  private buildImagesetEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaImagesetElement,
    imageById: ReadonlyMap<BeatorajaImageId, BeatorajaImageElement>,
    textures: BeatorajaTextureCache,
  ): ImagesetEntry | undefined {
    const subImages: ImagesetEntry['subImages'] = element.images.map((subId) => {
      const image = imageById.get(subId);
      if (image === undefined) return undefined;
      const baseTexture = textures.get(image.src);
      if (baseTexture === undefined) return undefined;
      return { image, baseTexture };
    });
    if (subImages.every((s) => s === undefined)) return undefined;
    // Pre-bind the first non-undefined sub-image's cell-0 texture so the first render pass has
    // something to paint (same WebGPU bind-group warm-up reasoning as the image / graph paths).
    let initialTexture: Texture | undefined;
    for (const sub of subImages) {
      if (sub === undefined) continue;
      const cell = imageFrameRect(sub.image, 0);
      const cropped = createCroppedBeatorajaTexture(sub.baseTexture, cell);
      if (cropped !== undefined) {
        initialTexture = cropped;
        break;
      }
    }
    const sprite = new Sprite({ texture: initialTexture, alpha: 0 });
    this.container.addChild(sprite);
    // Apply filter mode to the first resolvable sub-image's source. Sub-images typically share
    // a source (it's the same atlas), so this propagates to siblings.
    for (const sub of subImages) {
      if (sub !== undefined) {
        applyTextureFilterMode(sub.baseTexture, group.filter);
        break;
      }
    }
    // Click dispatch (audit 2.5). `imageset[].act` was previously dropped at the parser layer,
    // so default's `modeset` (act:11 cycles keymode filter) and similar imageset-driven cycle
    // buttons in GdbG / ModernChic didn't react to clicks. Mirror the `image[]` interactive
    // wiring — when `act > 0` and the host wires `onButtonAction`, hook a `pointertap`
    // handler that forwards the action code.
    if (element.act > 0 && this.onButtonAction !== undefined) {
      sprite.eventMode = 'static';
      sprite.cursor = 'pointer';
      const handler = this.onButtonAction;
      const actCode = element.act;
      sprite.on('pointertap', (event) => {
        const orig = event as unknown as { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean };
        handler(actCode, {
          shift: orig.shiftKey === true,
          ctrl: orig.ctrlKey === true,
          alt: orig.altKey === true,
        });
      });
    }
    return { kind: 'imageset', group, element, subImages, sprite, lastSubIndex: -1, lastFrame: -1 };
  }

  /**
   * Build a `pmchara[]` entry — POMYU character display. The source's full texture is used as
   * the sprite (no sub-rect crop, no cell-strip animation). Hidden cleanly when the source
   * has no resolved texture (e.g. the user picked `def: "Off"` for the character filepath, or
   * the wildcard's `|TAG|` syntax didn't match any file in the pack — both are graceful
   * degradation paths for the common "no character pack dropped" case).
   */
  private buildPmCharaEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaPmCharaElement,
    textures: BeatorajaTextureCache,
  ): PmCharaEntry {
    const baseTexture = textures.get(element.src);
    const sprite = new Sprite({ texture: baseTexture, alpha: 0 });
    this.container.addChild(sprite);
    applyTextureFilterMode(baseTexture, group.filter);
    return { kind: 'pmchara', group, element, baseTexture, sprite };
  }

  /**
   * Build a slider entry — a `Sprite` with a fixed source-rect crop that translates within its
   * destination box per frame. The base texture is captured once at build time; per-frame updates
   * only adjust position (no re-cropping needed since the slider's crop is constant).
   */
  private buildSliderEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaSliderElement,
    textures: BeatorajaTextureCache,
  ): SliderEntry | undefined {
    const baseTexture = textures.get(element.src);
    const baseIsBindable = baseTexture !== undefined && baseTexture !== Texture.EMPTY;
    let initialTexture: Texture | undefined;
    if (baseIsBindable) {
      const cropped = createCroppedBeatorajaTexture(baseTexture, {
        x: element.x,
        y: element.y,
        w: element.w,
        h: element.h,
      });
      if (cropped !== undefined) initialTexture = cropped;
    }
    const sprite = new Sprite({ texture: initialTexture, alpha: 0 });
    this.container.addChild(sprite);
    applyTextureFilterMode(baseTexture, group.filter);
    return { kind: 'slider', group, element, baseTexture, sprite };
  }

  /**
   * Build a bpmgraph entry — pre-allocates the `Graphics` node; the actual polyline gets drawn
   * once on first `update()` (the chart's BPM curve is static, so we don't re-stroke per frame).
   */
  private buildBpmGraphEntry(group: BeatorajaDestinationGroup, element: BeatorajaBpmGraphElement): BpmGraphEntry {
    const graphics = new Graphics();
    graphics.alpha = 0;
    this.container.addChild(graphics);
    return { kind: 'bpmgraph', group, element, graphics, lastPointCount: -1, lastSignature: '' };
  }

  /**
   * Build a judgegraph entry. Same rebuild-on-change pattern as bpmgraph — the `Graphics` node is
   * pre-allocated; bars are stroked when the resolver returns a different signature.
   */
  private buildJudgeGraphEntry(group: BeatorajaDestinationGroup, element: BeatorajaJudgeGraphElement): JudgeGraphEntry {
    const graphics = new Graphics();
    graphics.alpha = 0;
    this.container.addChild(graphics);
    return { kind: 'judgegraph', group, element, graphics, lastSignature: '' };
  }

  /** Build a gaugegraph entry — same Graphics-node + rebuild-on-change pattern as bpmgraph. */
  private buildGaugeGraphEntry(group: BeatorajaDestinationGroup, element: BeatorajaGaugeGraphElement): GaugeGraphEntry {
    const graphics = new Graphics();
    graphics.alpha = 0;
    this.container.addChild(graphics);
    return { kind: 'gaugegraph', group, element, graphics, lastPointCount: -1 };
  }

  /** Build a timingvisualizer entry — same Graphics-node + rebuild-on-change pattern. */
  private buildTimingVisualizerEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaTimingVisualizerElement,
  ): TimingVisualizerEntry {
    const graphics = new Graphics();
    graphics.alpha = 0;
    this.container.addChild(graphics);
    return { kind: 'timingvisualizer', group, element, graphics, lastSignature: '' };
  }

  /** Build a timingdistributiongraph entry — same Graphics-node + rebuild-on-change pattern. */
  private buildTimingDistributionEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaTimingDistributionGraphElement,
  ): TimingDistributionEntry {
    const graphics = new Graphics();
    graphics.alpha = 0;
    this.container.addChild(graphics);
    return { kind: 'timingdistribution', group, element, graphics, lastSampleCount: -1 };
  }

  private buildLuaRuntimeContext(context: BeatorajaRenderContext): BeatorajaLuaRuntimeContext {
    return {
      option: (id) => context.activeOps.has(id),
      number: (id) => this.resolveNumberValue(id),
      floatNumber: (id) => this.resolveSliderValue(id) ?? this.resolveGraphValue(id),
      text: (id) => this.resolveTextContent(id),
      offset: (id) => context.resolveOffset?.(id),
      timer: (id) => {
        const start = id === 0 ? 0 : context.getTimerStart(id);
        return start === undefined ? BEATORAJA_LUA_TIMER_OFF_VALUE : start * 1000;
      },
      time: () => context.nowMs * 1000,
      rate: () => this.resolveNumberValue(BEATORAJA_NUM.SCORE_RATE),
      exscore: () => this.resolveNumberValue(BEATORAJA_NUM.POINT),
      judge: (judge) => {
        const refs = [
          BEATORAJA_NUM.PERFECT,
          BEATORAJA_NUM.GREAT,
          BEATORAJA_NUM.GOOD,
          BEATORAJA_NUM.BAD,
          BEATORAJA_NUM.POOR,
          BEATORAJA_NUM.COMBOBREAK,
        ] as const;
        const ref = refs[judge];
        return ref === undefined ? undefined : this.resolveNumberValue(ref);
      },
      gauge: () => {
        const percent = this.resolveGaugePercent();
        return percent;
      },
      // `main_state.gauge_type()` — beatoraja's `BEATORAJA_GAUGE_MODE.*` int constant.
      // Sourced from the runtime adapter's `resolveGaugeState`. Returns `undefined` when no
      // frame has landed yet; the Lua bridge defaults to 0 in that case.
      gaugeType: () => context.resolveGaugeState?.()?.mode,
      // Forward host audio hooks so BooleanProperty / customEvent callbacks evaluated at draw
      // time can fire SE. The hooks themselves come from the demo's `BeatorajaSkinAudioPlayer`
      // (one per loaded theme bundle); the skin-view never owns audio state.
      audioPlay: context.audioPlay,
      audioLoop: context.audioLoop,
      audioStop: context.audioStop,
    };
  }

  private resolveIntegerProperty(
    property: BeatorajaIntegerPropertyRef,
    luaContext: BeatorajaLuaRuntimeContext,
  ): number {
    if (typeof property === 'number') return this.resolveNumberValue(property) ?? 0;
    return evaluateBeatorajaLuaNumber(property, luaContext) ?? 0;
  }

  private resolveStringProperty(property: BeatorajaStringPropertyRef, luaContext: BeatorajaLuaRuntimeContext): string {
    if (typeof property === 'number') return this.resolveTextContent(property) ?? '';
    return evaluateBeatorajaLuaString(property, luaContext) ?? '';
  }

  private resolveFloatProperty(
    property: BeatorajaFloatPropertyRef,
    luaContext: BeatorajaLuaRuntimeContext,
    kind: 'graph' | 'slider',
  ): number | undefined {
    if (typeof property === 'number') {
      return kind === 'graph' ? this.resolveGraphValue(property) : this.resolveSliderValue(property);
    }
    return evaluateBeatorajaLuaNumber(property, luaContext);
  }

  /**
   * Re-sample every destination at `context.nowMs` and update the matching `Sprite` / `Text`. Call once per frame.
   */
  update(context: BeatorajaRenderContext): void {
    if (this.disposed) return;
    const luaContext = this.buildLuaRuntimeContext(context);
    const renderContext: BeatorajaRenderContext = { ...context, lua: luaContext };
    // customEvents / customTimers (audit 2.2). Fire any condition-flipped event actions and
    // stamp any updated custom timers BEFORE walking the destination entries — that way
    // BooleanProperty closures evaluated during destination paint observe the freshly-fired
    // events and freshly-stamped timers in the same frame.
    if (this.customEvents.length > 0) {
      evaluateBeatorajaCustomEvents(this.customEvents, this.customEventState, luaContext, context.nowMs);
    }
    if (this.customTimers.length > 0) {
      // customTimers stamp host engine timers — the host wires that via
      // `BeatorajaLuaRuntimeContext.setTimer`. When the host omits the wiring (Node tests,
      // hosts that don't carry a per-side timer table) the timer slot just doesn't update.
      evaluateBeatorajaCustomTimers(this.customTimers, this.customTimerState, luaContext, (id, value) => {
        luaContext.setTimer?.(id, value);
      });
    }
    // Pass the skin's authored canvas height into the renderer so it can flip Y-UP dst rects
    // (libGDX origin at canvas bottom-left) into Pixi Y-DOWN screen coords. The view owns this
    // value (`skin.h`) — callers don't need to thread it through.
    const canvasHeight = this.height;
    for (const entry of this.entries) {
      const props = destinationToSpriteProps(entry.group, renderContext, canvasHeight);
      switch (entry.kind) {
        case 'image':
          this.updateImageEntry(entry, renderContext, props);
          break;
        case 'value':
          this.updateValueEntry(entry, props, luaContext);
          break;
        case 'floatvalue':
          this.updateFloatValueEntry(entry, props, luaContext);
          break;
        case 'text':
          this.updateTextEntry(entry, props, luaContext);
          break;
        case 'graph':
          this.updateGraphEntry(entry, props, luaContext);
          break;
        case 'polyline-graph':
          this.updatePolylineGraphEntry(entry, props);
          break;
        case 'bpmgraph':
          this.updateBpmGraphEntry(entry, props);
          break;
        case 'judgegraph':
          this.updateJudgeGraphEntry(entry, props);
          break;
        case 'gaugegraph':
          this.updateGaugeGraphEntry(entry, props);
          break;
        case 'timingvisualizer':
          this.updateTimingVisualizerEntry(entry, props);
          break;
        case 'timingdistribution':
          this.updateTimingDistributionEntry(entry, props);
          break;
        case 'slider':
          this.updateSliderEntry(entry, props, luaContext);
          break;
        case 'imageset':
          this.updateImagesetEntry(entry, renderContext, props, luaContext);
          break;
        case 'gauge':
          this.updateGaugeEntry(entry, props, renderContext);
          break;
        case 'pmchara':
          this.updatePmCharaEntry(entry, props);
          break;
      }
    }
  }

  private updateImageEntry(
    entry: SpriteEntry,
    context: BeatorajaRenderContext,
    props: ReturnType<typeof destinationToSpriteProps>,
  ): void {
    const sprite = entry.sprite;

    // No base texture (or `Texture.EMPTY`, source-less) → must not enter the renderer's batch; WebGPU's
    // `_createBindGroup` deref's a null source.
    const baseTexture = entry.baseTexture;
    if (baseTexture === undefined || baseTexture === Texture.EMPTY) {
      sprite.visible = false;
      return;
    }

    sprite.visible = props.visible;
    if (!props.visible) return;

    // `ref` (op-driven frame) takes precedence over `cycle` animation — that's how lamp / judge-icon textures
    // swap between cells.
    const frameIndex =
      entry.image.ref !== 0
        ? imageRefFrame(entry.image, this.resolveRefValue(entry.image.ref))
        : imageFrameAt(entry.image, computeAnimationElapsed(entry, context));

    // `disapearLine` clip — hidden-cover sprites trim the BOTTOM portion of the rect (skin Y-UP
    // semantics: only `y > disapearLineAddedLift` is shown). In Pixi Y-DOWN that means the
    // sprite's TOP edge stays at `props.y` and the bottom edge gets pulled up to a Pixi y of
    // `canvasH - disapearLineAddedLift`. Without this, hidden-cover entries paint as plain
    // sprites at their full rect — which is why the reference theme's hidden-cover used to
    // appear at the bottom of the screen even when the lift slider was at home. The lift offset
    // resolution depends on `OFFSET_LIFT` going through `context.resolveOffset`; until that's
    // wired, lift defaults to 0 and the hidden-cover collapses to invisible (matching beatoraja's
    // "lift hides the cover by default" behavior — the player has to drag to reveal it).
    const disapearRatio = computeDisapearVisibleRatio(entry.image, props, this.height, context.resolveOffset);
    if (disapearRatio === 0) {
      // Whole rect is below the disappear line → nothing to paint.
      sprite.visible = false;
      return;
    }
    const visibleHeight = props.height * disapearRatio;

    if (frameIndex !== entry.currentFrame || disapearRatio !== entry.lastDisapearRatio) {
      const cell = imageFrameRect(entry.image, frameIndex);
      // ModernChic `Play/lua/sp/bomb.lua` (and similar Lua-driven skins) author `image[]`
      // entries with `w = -1, h = -1` — beatoraja's loader interprets that as "use the
      // texture's natural size, no crop" rather than as a flip flag (audit 3.17). Without
      // honoring the sentinel our impl returned `undefined` from the cropper and the bomb
      // sprites were silently hidden. Detect the sentinel here and pass the base texture
      // through unscaled — `disapearRatio < 1` cases still use the cropper for their partial
      // re-crop, but those are mutually exclusive with the "full texture" sentinel.
      const useFullTexture = entry.image.w <= 0 || entry.image.h <= 0;
      const cropped = useFullTexture
        ? entry.baseTexture
        : createCroppedBeatorajaTexture(entry.baseTexture, {
            x: cell.x,
            y: cell.y,
            w: cell.w,
            h: cell.h * disapearRatio,
          });
      if (cropped === undefined) {
        // Cell width/height collapsed to 0 — hiding avoids the same null-source bind-group crash above.
        sprite.visible = false;
        return;
      }
      sprite.texture = cropped;
      entry.currentFrame = frameIndex;
      entry.lastDisapearRatio = disapearRatio;
    }

    // Apply the destination's `stretch` mode (audit 2.12). `stretch=0` (default = STRETCH)
    // is a no-op; FIT_INNER / FIT_OUTER / FIT_WIDTH / FIT_HEIGHT / NO_RESIZE / NO_EXPANDING
    // all preserve the source sprite's natural aspect ratio in some way. Without this the
    // dst rect always wins, so banner / jacket / stagefile elements that author `stretch:1`
    // got squashed to the dst rect's aspect (most visible: ModernChic Result mainmenu's
    // stagefile thumbnail authored `stretch = MAIN.STRETCH.FIT_OUTER_TRIMMED`).
    //
    // `stretchSource` reflects the source sprite's natural cell size from the texture; for
    // multi-cell `divx/divy` strips this is the cell size, not the entire atlas dimensions.
    const cellRectAtFrame = imageFrameRect(entry.image, entry.currentFrame);
    const stretched = applyBeatorajaStretchRect(
      { x: props.x, y: props.y, width: props.width, height: visibleHeight },
      { width: cellRectAtFrame.w, height: cellRectAtFrame.h },
      entry.group.stretch,
    );
    const center = centerToAnchor(entry.group.center);
    sprite.anchor.set(center.x, center.y);
    sprite.x = stretched.x + center.x * stretched.width;
    // Top edge is fixed at the stretched y; clip-trimmed bottom uses `visibleHeight`-scaled
    // height (already absorbed into `stretched.height` via the dst rect we passed in).
    sprite.y = stretched.y + center.y * stretched.height;
    sprite.width = stretched.width;
    sprite.height = stretched.height;
    // Honor the destination's authored mirror flag (negative `w` / `h` in beatoraja's skin).
    // `props.width` is already non-negative; we apply the mirror via `scale` so the texture
    // flips horizontally without disturbing the positioning math above.
    if (props.mirrorX) sprite.scale.x = -Math.abs(sprite.scale.x);
    if (props.mirrorY) sprite.scale.y = -Math.abs(sprite.scale.y);
    sprite.alpha = props.alpha;
    sprite.tint = props.tint;
    sprite.angle = props.angle;
    sprite.blendMode = props.blendMode;
  }

  private updateValueEntry(
    entry: ValueEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    luaContext: BeatorajaLuaRuntimeContext,
  ): void {
    const baseTexture = entry.baseTexture;
    if (baseTexture === undefined || baseTexture === Texture.EMPTY) {
      for (const sprite of entry.digitSprites) sprite.visible = false;
      return;
    }
    if (!props.visible) {
      for (const sprite of entry.digitSprites) sprite.visible = false;
      return;
    }

    // Resolve the dynamic numeric value through the host's `prop.lua num` adapter. `0` when no value
    // is wired — keeps the readout visually stable while engine state is wiring up.
    const value =
      entry.value.valueProperty !== undefined
        ? this.resolveIntegerProperty(entry.value.valueProperty, luaContext)
        : ((entry.value.ref !== 0 ? this.resolveNumberValue(entry.value.ref) : 0) ?? 0);

    // Re-compose digit-cell textures only when the value changes. The composer hands back one
    // source-rect per digit slot; we crop a sub-texture per slot and assign it to the matching sprite.
    let cells: ReturnType<typeof composeBeatorajaValueCells> | undefined;
    if (value !== entry.lastValue) {
      entry.lastValue = value;
      cells = composeBeatorajaValueCells(entry.value, value);
      for (let i = 0; i < entry.digitSprites.length; i += 1) {
        const cell = cells[i];
        if (cell === undefined || cell.hidden) continue;
        const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
        if (cropped !== undefined) {
          entry.digitSprites[i]!.texture = cropped;
        }
      }
    }
    // Always recompute hidden flags — visibility depends on the latest value even when textures
    // weren't refreshed (the composer might emit `hidden: true` for slots that don't paint).
    if (cells === undefined) cells = composeBeatorajaValueCells(entry.value, value);

    // Lay the digit row across the destination rect. Per beatoraja's convention, `dst.w` is the
    // PER-DIGIT slot width (NOT the total strip width) — the reference theme writes things like
    // `{w = 18, h = 18}` with `digit = 4` for BPM readouts and expects each digit to render as an
    // 18×18 square (total strip = 72px wide). Treating `dst.w` as the total instead made every
    // digit collapse to `dst.w / digit` pixels wide, which is what produced the "potsubureteru"
    // (squashed-text) reports. Height stays at `dst.h`.
    const slotWidth = props.width;
    // Inter-digit gap from beatoraja's `value.space`. Most authoring uses 0; some banner-style
    // digit fonts use small positive values (1-3 px) to recover natural letter spacing. Per
    // beatoraja, each subsequent slot is offset by `slotWidth + space`, NOT just `slotWidth`.
    const space = Number.isFinite(entry.value.space) ? entry.value.space : 0;
    const slotStep = slotWidth + space;
    // Honor `value.align` (0 = right / no shift, 1 = left, 2 = center) — see
    // `composeBeatorajaValueShift` for the formula. Without this, every authored `align: 1`
    // (left-flush) and `align: 2` (centered) rendered identically to `align: 0`, which is what
    // ModernChic's Result mainmenu (40+ sites) was hitting — score / miss / FAST / SLOW digits
    // showed natural-right-aligned with leading blanks instead of flush-left.
    const alignShift = composeBeatorajaValueShift(entry.value, value, slotWidth);
    // Apply the destination's center anchor across the whole digit strip — each digit slot
    // shares the same pivot proportions, computed against the strip's full width (not the per-
    // digit width) so rotation pivots around the strip's authored center, not each digit's
    // local middle. The +i*slotWidth offset stays as before.
    const center = centerToAnchor(entry.group.center);
    for (let i = 0; i < entry.digitSprites.length; i += 1) {
      const sprite = entry.digitSprites[i]!;
      const cell = cells[i];
      if (cell !== undefined && cell.hidden) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;
      sprite.anchor.set(center.x, center.y);
      sprite.x = props.x + i * slotStep + center.x * slotWidth - alignShift;
      sprite.y = props.y + center.y * props.height;
      sprite.width = slotWidth;
      sprite.height = props.height;
      sprite.alpha = props.alpha;
      sprite.tint = props.tint;
      sprite.angle = props.angle;
      sprite.blendMode = props.blendMode;
    }
  }

  /**
   * Update a `floatvalue[]` entry. Resolves the live value via the host's `resolveNumberValue`
   * (or `valueProperty` when authored), formats it as `<integer>.<fractional>` with the
   * declared `iketa` / `fketa` widths and `gain` multiplier, then crops one cell per slot from
   * the source strip and lays the row across the dst rect — same alignment / spacing logic as
   * the integer value path. Skips the re-crop pass when the value hasn't changed.
   */
  private updateFloatValueEntry(
    entry: FloatValueEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    luaContext: BeatorajaLuaRuntimeContext,
  ): void {
    const baseTexture = entry.baseTexture;
    if (baseTexture === undefined || baseTexture === Texture.EMPTY) {
      for (const sprite of entry.slotSprites) sprite.visible = false;
      return;
    }
    if (!props.visible) {
      for (const sprite of entry.slotSprites) sprite.visible = false;
      return;
    }

    // Resolve the dynamic value through `valueProperty` (Lua function) when authored, else
    // fall through to the host's `resolveNumberValue(ref)`. Defaults to 0 when neither path
    // returns a finite number — keeps the readout stable while engine state is wiring up.
    const value =
      entry.value.valueProperty !== undefined
        ? this.resolveIntegerProperty(entry.value.valueProperty, luaContext)
        : ((entry.value.ref !== 0 ? this.resolveNumberValue(entry.value.ref) : 0) ?? 0);

    let cells: ReturnType<typeof composeBeatorajaFloatValueCells> | undefined;
    if (value !== entry.lastValue) {
      entry.lastValue = value;
      cells = composeBeatorajaFloatValueCells(entry.value, value);
      for (let i = 0; i < entry.slotSprites.length; i += 1) {
        const cell = cells[i];
        if (cell === undefined || cell.hidden) continue;
        const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
        if (cropped !== undefined) {
          entry.slotSprites[i]!.texture = cropped;
        }
      }
    }
    if (cells === undefined) cells = composeBeatorajaFloatValueCells(entry.value, value);

    // Lay the slot row across the dst rect — same convention as `value[]`: `dst.w` is per-slot
    // width, `space` adds inter-slot gap. No `align` shift here; floatvalue authors typically
    // pin the dot at a specific x by sizing slots manually rather than relying on alignment.
    const slotWidth = props.width;
    const space = Number.isFinite(entry.value.space) ? entry.value.space : 0;
    const slotStep = slotWidth + space;
    const center = centerToAnchor(entry.group.center);
    for (let i = 0; i < entry.slotSprites.length; i += 1) {
      const sprite = entry.slotSprites[i]!;
      const cell = cells[i];
      if (cell !== undefined && cell.hidden) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;
      sprite.anchor.set(center.x, center.y);
      sprite.x = props.x + i * slotStep + center.x * slotWidth;
      sprite.y = props.y + center.y * props.height;
      sprite.width = slotWidth;
      sprite.height = props.height;
      sprite.alpha = props.alpha;
      sprite.tint = props.tint;
      sprite.angle = props.angle;
      sprite.blendMode = props.blendMode;
    }
  }

  private updateTextEntry(
    entry: TextEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    luaContext: BeatorajaLuaRuntimeContext,
  ): void {
    const text = entry.text;
    text.visible = props.visible;
    if (!props.visible) return;

    // Skip the assignment when the string hasn't changed — assigning the same string still triggers
    // a Pixi glyph relayout, which is expensive (canvas rasterization).
    //
    // Resolution priority:
    //   1. `constantText` — Lua-baked literal (GdbG result's `Avg N ms` strings, etc.) wins
    //      unconditionally. Beatoraja's reference renderer treats this as a static label
    //      regardless of `ref` / `valueProperty`.
    //   2. `valueProperty` — Lua function-as-string-property (uncommon).
    //   3. `ref` — runtime-resolved op code (titles / artists / etc.).
    //   4. Empty fallback for `ref = 0` placeholder rows.
    const next =
      entry.element.constantText !== undefined
        ? entry.element.constantText
        : entry.element.valueProperty !== undefined
          ? this.resolveStringProperty(entry.element.valueProperty, luaContext)
          : entry.element.ref !== 0
            ? (this.resolveTextContent(entry.element.ref) ?? '')
            : '';
    if (text.text !== next) {
      text.text = next;
      // eslint-disable-next-line no-console
      console.log(
        '[beatoraja-view] text content',
        JSON.stringify({ id: entry.element.id, ref: entry.element.ref, text: next }),
      );
    }

    // The destination's `x` is the bounding box's left edge. With `align: center` / `right` the
    // Pixi anchor is 0.5 / 1.0 (set in `buildTextEntry`), so we add half / full width of the
    // destination box to land on the box's center / right edge respectively.
    //
    // Width / height aren't forced onto the Text node: beatoraja's `text[]` semantics is "render
    // glyphs at `size` px with auto-width" — clamping to the dst rect would scale the type, which
    // is what beatoraja explicitly avoids (the dst rect describes the *anchor*, not the text bbox).
    let x = props.x;
    if (entry.element.align === 'center') x += props.width / 2;
    else if (entry.element.align === 'right') x += props.width;
    text.x = x;
    text.y = props.y;
    text.alpha = props.alpha;
    text.tint = props.tint;
    text.angle = props.angle;
    text.blendMode = props.blendMode;
    // `overflow = 1` (= shrink-to-fit): when the rendered text is wider than the destination box,
    // scale it down proportionally so it stays inside. Beatoraja's reference does this so song
    // titles / playernames that don't fit the chrome's reserved width don't bleed into adjacent
    // panels. We measure via Pixi's own `text.width` (the post-glyph-layout bbox), divide by the
    // box width, and apply the ratio to `text.scale` keeping aspect (community skins universally
    // expect proportional shrink — anamorphic squish would distort the type). Boxes with no width
    // (`props.width <= 0`) skip the math; oversized scale ratios (≥ 1) leave the text at its
    // native size. Other `overflow` modes (`0` = no handling, `2` = clip — uncommon in practice)
    // also leave scale at 1.
    if (entry.element.overflow === 1 && props.width > 0) {
      const measured = text.width;
      const ratio = measured > 0 ? Math.min(1, props.width / measured) : 1;
      text.scale.set(ratio);
    } else {
      text.scale.set(1);
    }
  }

  /**
   * Update a graph entry's sprite for the current frame. Renders the source crop into the
   * destination box, then scales the painted region along `angle` by the resolver's 0..1 ratio.
   *
   * The crop semantics depend on the fill direction:
   *   - `right` / `left`: scale source-rect width AND destination-rect width by `ratio`
   *   - `up` / `down`: scale height by `ratio`
   *
   * For `left` and `up` the source rect is anchored to its right / bottom edge respectively, so
   * the bar appears to "fill" inward from the opposite side. This matches LR2 / beatoraja's
   * documented graph-direction semantics.
   *
   * Hidden when:
   *   - The destination's standard `props` say so (op gate, timer not started, etc.)
   *   - The graph's runtime resolver returns `undefined` (unknown / unsupported `type`)
   *   - The base texture isn't bindable
   *   - `ratio === 0` (the bar is empty — could also paint a 0-width sprite, but skipping the
   *     bind-group setup avoids per-frame `Texture` allocations for hidden bars)
   */
  private updateGraphEntry(
    entry: GraphEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    luaContext: BeatorajaLuaRuntimeContext,
  ): void {
    const sprite = entry.sprite;
    sprite.visible = props.visible;
    if (!props.visible) return;
    const baseTexture = entry.baseTexture;
    if (baseTexture === undefined || baseTexture === Texture.EMPTY) {
      sprite.visible = false;
      return;
    }
    const rawRatio =
      entry.element.valueProperty !== undefined
        ? this.resolveFloatProperty(entry.element.valueProperty, luaContext, 'graph')
        : this.resolveGraphValue(entry.element.type);
    if (rawRatio === undefined) {
      sprite.visible = false;
      return;
    }
    const ratio = clampUnit01(rawRatio);
    if (ratio === 0) {
      sprite.visible = false;
      return;
    }
    const el = entry.element;
    // Compute the source-rect crop along the fill axis. Width / height shrink to `ratio` of full
    // size; for `left` / `up`, the crop is anchored to the FAR edge so the painted area grows
    // inward from there.
    let cropX = el.x;
    let cropY = el.y;
    let cropW = el.w;
    let cropH = el.h;
    let destX = props.x;
    let destY = props.y;
    let destW = props.width;
    let destH = props.height;
    switch (el.angle) {
      case 'right':
        cropW = el.w * ratio;
        destW = props.width * ratio;
        break;
      case 'left':
        // Anchor the crop to the right edge so the bar fills leftward.
        cropX = el.x + el.w * (1 - ratio);
        cropW = el.w * ratio;
        destX = props.x + props.width * (1 - ratio);
        destW = props.width * ratio;
        break;
      case 'up':
        // Anchor the crop to the bottom edge so the bar fills upward.
        cropY = el.y + el.h * (1 - ratio);
        cropH = el.h * ratio;
        destY = props.y + props.height * (1 - ratio);
        destH = props.height * ratio;
        break;
      case 'down':
        cropH = el.h * ratio;
        destH = props.height * ratio;
        break;
    }
    const cropped = createCroppedBeatorajaTexture(baseTexture, {
      x: cropX,
      y: cropY,
      w: cropW,
      h: cropH,
    });
    if (cropped === undefined) {
      sprite.visible = false;
      return;
    }
    if (sprite.texture !== cropped) sprite.texture = cropped;
    const center = centerToAnchor(entry.group.center);
    sprite.anchor.set(center.x, center.y);
    sprite.x = destX + center.x * destW;
    sprite.y = destY + center.y * destH;
    sprite.width = destW;
    sprite.height = destH;
    sprite.alpha = props.alpha;
    sprite.tint = props.tint;
    sprite.angle = props.angle;
    sprite.blendMode = props.blendMode;
  }

  /**
   * Update a polyline-graph entry. Plots the resolver's `(x, y)` points (each in `[0, 1]²`)
   * across the destination's bounding box, with `y` inverted so a high score draws toward the
   * top of the box (matches LR2 / beatoraja's "score climbs upward" convention).
   *
   * Skips the rebuild when the point count hasn't grown — polylines accumulate monotonically
   * during a run, so most frames re-paint the same line; the cache check avoids the
   * `clear() + moveTo() + lineTo()...` storm on every tick.
   *
   * Hidden when:
   *   - The destination's `props` say so (op gate, timer not started, alpha 0)
   *   - The resolver returned `undefined` (this graph isn't a polyline after all — should never
   *     happen since `buildGraphEntry` already checked, but guard anyway)
   *   - The polyline has fewer than 2 points (a single-point line is invisible)
   */
  private updatePolylineGraphEntry(
    entry: PolylineGraphEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
  ): void {
    const graphics = entry.graphics;
    graphics.visible = props.visible;
    if (!props.visible) return;
    const points = this.resolveGraphPolyline(entry.element.type);
    if (points === undefined || points.length < 2) {
      graphics.visible = false;
      return;
    }
    if (entry.lastPointCount !== points.length) {
      // Re-stroke the polyline. We use `props.tint` as the line color (beatoraja's reference
      // theme paints score-history graphs with a tinted "line" texture; collapsing to a single
      // color line is a simplification that loses texture detail but preserves the data shape).
      graphics.clear();
      const first = points[0]!;
      graphics.moveTo(first.x * props.width, (1 - first.y) * props.height);
      for (let i = 1; i < points.length; i += 1) {
        const p = points[i]!;
        graphics.lineTo(p.x * props.width, (1 - p.y) * props.height);
      }
      // 2-pixel stroke is readable across most skin canvas sizes (640×480 LR2 → 1920×1080
      // beatoraja result skins). Authors who need a different thickness can revisit when
      // we expose a per-graph stroke-width knob.
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
   * Update a bpmgraph entry. Strokes the chart's BPM polyline once on first paint (the curve is
   * static for the whole session) and re-positions the `Graphics` to the destination box every
   * frame after that. Y is inverted (`1 - p.y`) so a high BPM paints toward the top of the box —
   * matches beatoraja's reference theme convention.
   *
   * Hidden when:
   *   - The destination's standard `props` say so (op gate, timer not started, alpha 0)
   *   - The resolver returned `undefined` or fewer than 2 points (no BPM data on this chart)
   */
  private updateBpmGraphEntry(entry: BpmGraphEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const graphics = entry.graphics;
    graphics.visible = props.visible;
    if (!props.visible) return;
    // Prefer the rich segment-data resolver (`{segments, mainBpm, minBpm, maxBpm, totalMs}`);
    // matches upstream `SkinBPMGraph.draw()` which paints color-coded segments at log-scaled
    // y positions relative to mainBpm. Falls back to the legacy `[{x, y}]` polyline resolver
    // when the host hasn't wired the rich data — produces a single white curve instead of
    // the per-segment color identity, but at least keeps something visible.
    const data = this.resolveBpmGraphData();
    if (data === undefined) {
      this.updateBpmGraphLegacy(entry, props);
      return;
    }
    const { segments, mainBpm, minBpm, maxBpm, totalMs } = data;
    if (segments.length < 1 || totalMs <= 0 || mainBpm <= 0) {
      graphics.visible = false;
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
  private updateJudgeGraphEntry(entry: JudgeGraphEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const graphics = entry.graphics;
    graphics.visible = props.visible;
    if (!props.visible) return;
    // Type 0 (note distribution) — when the host wires `resolveNoteDistribution`, render
    // the per-second × per-category histogram + olive background bands per upstream's
    // `SkinNoteDistributionGraph`. Falls through to the bars resolver if no host has
    // wired the rich data (legacy / decide-scene path).
    if (entry.element.type === 0) {
      const distribution = this.resolveNoteDistribution();
      if (distribution !== undefined && distribution.buckets.length > 0) {
        this.paintNoteDistribution(entry, props, distribution);
        return;
      }
    }
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
      for (let i = 0; i < barCount; i += 1) {
        const v = Number.isFinite(bars[i]) ? Math.max(0, bars[i]!) : 0;
        if (v <= 0) continue;
        const ratio = v / max;
        const barH = props.height * ratio;
        const x = i * barWidth + gap / 2;
        const y = props.height - barH;
        const w = barWidth - gap;
        graphics.rect(x, y, w, barH);
      }
      graphics.fill({ color: 0xffffff, alpha: 1 });
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
   * Paint the spec-faithful note distribution (judgegraph type=0) — mirrors upstream
   * `SkinNoteDistributionGraph.draw()`:
   *
   *   1. Background panel: black 80% alpha + olive bands every 10 height units +
   *      time-axis guide lines (gray every 60 sec, dim gray every 10 sec)
   *   2. Per-bucket stacked chips: each note paints as a 4-pixel-tall coloured block at
   *      the appropriate height in the bucket's stack, color-coded by category
   *      (`NOTE_DISTRIBUTION_COLORS`).
   *
   * The destination's `tint` is intentionally ignored — note categories carry their own
   * colors, so a tint multiplier would distort the palette.
   */
  private paintNoteDistribution(
    entry: JudgeGraphEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    data: { buckets: ReadonlyArray<ReadonlyArray<number>>; maxCount: number; totalMs: number },
  ): void {
    const graphics = entry.graphics;
    const { buckets, maxCount } = data;
    if (buckets.length === 0 || maxCount <= 0) {
      graphics.visible = false;
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
          const bandColor = ((Math.floor(0.007 * i * 255) << 16) |
            (Math.floor(0.007 * i * 255) << 8) |
            0) >>> 0;
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

      // Foreground — per-bucket stacked chips. Walk categories 0..6, stack each
      // category's chip count at the bottom of the bucket. Pixi y is inverted so chip
      // y_top = props.height - (stack_height + 1) * cellHeight.
      for (let i = 0; i < bucketCount; i += 1) {
        const bucket = buckets[i]!;
        const x = i * bucketWidth + chipXOffset;
        let stackedCount = 0;
        for (let cat = 0; cat < bucket.length; cat += 1) {
          const count = bucket[cat]!;
          if (count === 0) continue;
          const color = NOTE_DISTRIBUTION_COLORS[cat] ?? 0xffffff;
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
  }

  /**
   * Update a gaugegraph entry. Strokes the gauge polyline (`{x ∈ [0, 1], y ∈ [0, 1]}` points,
   * y = `gauge / 100`) across the destination box; y is inverted so a high gauge paints toward
   * the top of the box (matches beatoraja's reference "gauge climbs upward" convention).
   *
   * Hidden when:
   *   - The destination's standard `props` say so (op gate, alpha 0)
   *   - The resolver returned `undefined` or fewer than 2 points (no run history yet)
   */
  private updateGaugeGraphEntry(entry: GaugeGraphEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const graphics = entry.graphics;
    graphics.visible = props.visible;
    if (!props.visible) return;
    const points = this.resolveGaugeGraphPoints();
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
      // Reference theme tints gaugegraph per gauge type; we don't surface the player's gauge
      // type to the resolver yet, so paint the line in the destination's tint and let authors
      // pick the color via dst rgb. 2px stroke matches the polyline-graph and bpmgraph
      // conventions.
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
   * Update a timingvisualizer entry. Plots the recent-judge timing samples as colored ticks
   * across the destination box: x = sample's signed `deltaMs` mapped onto the rect's horizontal
   * span, y = age-decayed vertical position (oldest at the top, newest near the bottom). Each
   * tick is colored by judge kind (PG/GR/GD/BD/PR) and fades out with age.
   *
   * Hidden when the resolver returns `undefined` / empty (no judgement has fired yet).
   */
  private updateTimingVisualizerEntry(
    entry: TimingVisualizerEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
  ): void {
    const graphics = entry.graphics;
    graphics.visible = props.visible;
    if (!props.visible) return;
    const samples = this.resolveTimingSamples();
    if (samples === undefined || samples.length === 0) {
      graphics.visible = false;
      return;
    }
    // Build a cheap signature so the per-frame stroke skips when nothing changed. Length + last
    // sample's deltaMs cover all the cases that need a re-stroke (new judgement, reset, …).
    const last = samples[samples.length - 1]!;
    const signature = `${samples.length}|${last.deltaMs.toFixed(1)}|${last.kind}`;
    if (signature !== entry.lastSignature) {
      graphics.clear();
      // Half-width in ms — author-supplied or fallback. ±100ms covers the GOOD window in most
      // judges; a reasonable default for skins that leave it unset.
      const halfWidthMs = entry.element.judgeWidthMillis > 0 ? entry.element.judgeWidthMillis : 100;
      const halfWidthPx = props.width / 2;
      const lineWidthPx = entry.element.lineWidth > 0 ? entry.element.lineWidth : 1;
      // Faint center line — perfect-timing reference. Only draw when the author didn't pin
      // `centerColor` to an empty string AND only when the visualizer has space (props.height > 0).
      if (props.height > 0) {
        graphics.rect(halfWidthPx - 0.5, 0, 1, props.height).fill({ color: 0xffffff, alpha: 0.25 });
      }
      // Ticks — newest paints brightest, oldest faintest. Sample list is oldest-first; map each
      // index to a vertical position (oldest at top, newest at bottom) and an alpha that decays
      // toward the top. The judge kind picks the color (PG/GR/GD/BD/PR fall back to white).
      for (let i = 0; i < samples.length; i += 1) {
        const sample = samples[i]!;
        const ageRatio = (i + 1) / samples.length; // 1 = newest, 0 ≈ oldest
        const alpha = ageRatio; // linear fade — could be tuned by `drawDecay` later
        const xRatio = Math.max(-1, Math.min(1, sample.deltaMs / halfWidthMs));
        const x = halfWidthPx + xRatio * halfWidthPx;
        const y = props.height * (1 - ageRatio);
        graphics.rect(x - lineWidthPx / 2, y, lineWidthPx, 4).fill({
          color: judgeColorFor(sample.kind),
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
  private updateTimingDistributionEntry(
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

  /**
   * Update a slider entry. Translates the sprite within the destination box by
   * `value * range` skin-pixels along its angle axis, leaving width / height at the source-rect
   * crop's natural size (sliders don't scale — they translate).
   *
   * Hidden when the resolver returns `undefined` (the runtime doesn't have data for this slider's
   * `type`) or `props.visible` says so. Defaulting to `value = 0` (slider at home position) when
   * the resolver returns 0 is intentional — that's the "neutral" pose for sliders that map to
   * disabled-by-default user-config knobs (lanecover off → slider at the bottom of its track).
   */
  private updateSliderEntry(
    entry: SliderEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    luaContext: BeatorajaLuaRuntimeContext,
  ): void {
    const sprite = entry.sprite;
    sprite.visible = props.visible;
    if (!props.visible) return;
    if (entry.baseTexture === undefined || entry.baseTexture === Texture.EMPTY) {
      sprite.visible = false;
      return;
    }
    const rawValue =
      entry.element.valueProperty !== undefined
        ? this.resolveFloatProperty(entry.element.valueProperty, luaContext, 'slider')
        : this.resolveSliderValue(entry.element.type);
    if (rawValue === undefined) {
      sprite.visible = false;
      return;
    }
    const value = clampUnit01(rawValue);
    const offset = value * entry.element.range;
    let dx = 0;
    let dy = 0;
    switch (entry.element.angle) {
      case 'right':
        dx = offset;
        break;
      case 'left':
        dx = -offset;
        break;
      case 'up':
        dy = -offset;
        break;
      case 'down':
        dy = offset;
        break;
    }
    const center = centerToAnchor(entry.group.center);
    sprite.anchor.set(center.x, center.y);
    sprite.x = props.x + dx + center.x * props.width;
    sprite.y = props.y + dy + center.y * props.height;
    sprite.width = props.width;
    sprite.height = props.height;
    sprite.alpha = props.alpha;
    sprite.tint = props.tint;
    sprite.angle = props.angle;
    sprite.blendMode = props.blendMode;
  }

  /**
   * Update an imageset entry. Resolves the runtime ref op to a sub-image index (clamped to the
   * `images[]` range), then paints the matching sub-image's cell-0 texture into the sprite. The
   * sub-image's own `divx` / `divy` / `timer` / `cycle` settings still apply — multi-frame
   * sub-images animate the same way regular `image[]` entries do, with the extra wrinkle that
   * the active sub-image switches based on `ref`.
   *
   * Hidden when:
   *   - The destination's standard `props` say so
   *   - The resolved sub-image is `undefined` (skin omitted that slot)
   *   - The sub-image's frame crop fails (degenerate `divx` / `divy` / source-rect)
   */
  private updateImagesetEntry(
    entry: ImagesetEntry,
    context: BeatorajaRenderContext,
    props: ReturnType<typeof destinationToSpriteProps>,
    luaContext: BeatorajaLuaRuntimeContext,
  ): void {
    const sprite = entry.sprite;
    sprite.visible = props.visible;
    if (!props.visible) return;
    // Resolve the sub-image index from the ref op. `ref = 0` means "no ref" → always slot 0.
    // Out-of-range values clamp to the available images so a runtime that pushes a 1 into a
    // 1-slot imageset doesn't blank the sprite.
    let subIndex = 0;
    if (entry.element.valueProperty !== undefined || entry.element.ref !== 0) {
      const raw =
        entry.element.valueProperty !== undefined
          ? this.resolveIntegerProperty(entry.element.valueProperty, luaContext)
          : this.resolveRefValue(entry.element.ref);
      if (Number.isFinite(raw) && raw >= 0) {
        subIndex = Math.min(entry.element.images.length - 1, Math.floor(raw));
      }
    }
    const sub = entry.subImages[subIndex];
    if (sub === undefined) {
      // Fall back to the first valid slot — better than blanking when the skin authored a sub-id
      // that didn't resolve to a known image.
      let fallback: (typeof entry.subImages)[number];
      for (const s of entry.subImages) {
        if (s !== undefined) {
          fallback = s;
          break;
        }
      }
      if (fallback === undefined) {
        sprite.visible = false;
        return;
      }
      this.paintImagesetSprite(sprite, fallback, entry, context, props);
      return;
    }
    // Track the last index so we can short-circuit the texture rebuild when the ref didn't change.
    if (entry.lastSubIndex !== subIndex) {
      entry.lastSubIndex = subIndex;
      // Force a frame rebuild on the next branch so the sprite picks up the new sub-image.
      entry.lastFrame = -1;
    }
    this.paintImagesetSprite(sprite, sub, entry, context, props);
  }

  /**
   * Helper for `updateImagesetEntry`. Computes the active frame index for the picked sub-image
   * (using its own `divx` / `divy` / `timer` / `cycle`), crops the matching cell, and writes
   * sprite props. Extracted because the resolver-fallback path needs the same logic.
   */
  private paintImagesetSprite(
    sprite: Sprite,
    sub: NonNullable<ImagesetEntry['subImages'][number]>,
    entry: ImagesetEntry,
    context: BeatorajaRenderContext,
    props: ReturnType<typeof destinationToSpriteProps>,
  ): void {
    const baseTexture = sub.baseTexture;
    if (baseTexture === undefined || baseTexture === Texture.EMPTY) {
      sprite.visible = false;
      return;
    }
    // Frame selection mirrors `updateImageEntry` — when the sub-image carries its own `ref` op,
    // sample that and let `imageRefFrame` map the op value to a frame index; otherwise advance
    // by timer / cycle. (Distinct from the OUTER `element.ref` which selects WHICH sub-image is
    // active — that one already happened in `updateImagesetEntry`.)
    const refFrame = sub.image.ref !== 0 ? imageRefFrame(sub.image, this.resolveRefValue(sub.image.ref)) : -1;
    const frame = refFrame >= 0 ? refFrame : imageFrameAt(sub.image, computeImagesetTimerElapsed(sub.image, context));
    if (frame !== entry.lastFrame) {
      entry.lastFrame = frame;
      const cell = imageFrameRect(sub.image, frame);
      const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
      if (cropped === undefined) {
        sprite.visible = false;
        return;
      }
      sprite.texture = cropped;
    }
    const center = centerToAnchor(entry.group.center);
    sprite.anchor.set(center.x, center.y);
    sprite.x = props.x + center.x * props.width;
    sprite.y = props.y + center.y * props.height;
    sprite.width = props.width;
    sprite.height = props.height;
    sprite.alpha = props.alpha;
    sprite.tint = props.tint;
    sprite.angle = props.angle;
    sprite.blendMode = props.blendMode;
  }

  /**
   * Update a gauge entry. Lays out `element.parts` cells horizontally inside the destination
   * rect, picking each cell's node texture from `pickBeatorajaGaugeNode` based on the live gauge
   * percent. Cells whose threshold is below the gauge value paint the lit-state node; those
   * above paint the off-state node. The dst rect's center anchor still applies (whole bar
   * pivots together).
   */
  private updateGaugeEntry(
    entry: GaugeEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    context: BeatorajaRenderContext,
  ): void {
    const visible = props.visible;
    if (!visible) {
      for (const cell of entry.cells) cell.visible = false;
      entry.overlay.visible = false;
      return;
    }
    // Pull the full gauge state for the spec-correct picker (audit 1.4). Falls back to a
    // synthesized state derived from the legacy percent resolver when the host hasn't wired
    // `resolveGaugeState` (= the test path or pre-frame state). `mode` defaults to NORMAL
    // (= 2) which produces beatoraja's groove-gauge slab.
    const fullState = context.resolveGaugeState?.();
    const state =
      fullState ??
      (() => {
        const pct = this.resolveGaugePercent() ?? 0;
        return { value: pct, max: 100, border: 80, mode: 2 };
      })();
    // Compute animation phase once per frame — the picker reads it for non-FLICKERING types.
    const animation = computeBeatorajaGaugeAnimation(entry.element, context.nowMs);
    const cellWidth = props.width / Math.max(1, entry.element.parts);
    const center = centerToAnchor(entry.group.center);
    // Track the topmost lit cell's overlay request — only one cell receives `flickerOverlayId`
    // per frame (the picker emits it for `i == notes` only). Defer the overlay paint until
    // after the cell loop so it lands on the resolved cell coordinates.
    let overlayCellIndex = -1;
    let overlayNodeId: BeatorajaImageId | undefined;
    for (let i = 0; i < entry.cells.length; i += 1) {
      const cell = entry.cells[i]!;
      const pick = pickBeatorajaGaugeNode(entry.element, i, state, animation);
      if (pick === undefined) {
        cell.visible = false;
        continue;
      }
      const texture = entry.nodeTextures.get(pick.nodeId);
      if (texture === undefined) {
        cell.visible = false;
        continue;
      }
      cell.visible = true;
      cell.texture = texture;
      cell.anchor.set(center.x, center.y);
      cell.x = props.x + i * cellWidth + center.x * cellWidth;
      cell.y = props.y + center.y * props.height;
      cell.width = cellWidth;
      cell.height = props.height;
      cell.alpha = props.alpha;
      cell.tint = props.tint;
      cell.angle = props.angle;
      cell.blendMode = props.blendMode;
      if (pick.flickerOverlayId !== undefined) {
        overlayCellIndex = i;
        overlayNodeId = pick.flickerOverlayId;
      }
    }
    // FLICKERING overlay paint — beatoraja's `SkinGauge.draw` blits the highlight node ON TOP
    // of the topmost lit cell as a second sprite. Mirror that here: position on the resolved
    // cell, share the cell's tint/alpha/blend so the overlay reads as a true compositing pass
    // rather than a separately-styled element.
    if (overlayCellIndex < 0 || overlayNodeId === undefined) {
      entry.overlay.visible = false;
    } else {
      const overlayTexture = entry.nodeTextures.get(overlayNodeId);
      if (overlayTexture === undefined) {
        entry.overlay.visible = false;
      } else {
        entry.overlay.visible = true;
        entry.overlay.texture = overlayTexture;
        entry.overlay.anchor.set(center.x, center.y);
        entry.overlay.x = props.x + overlayCellIndex * cellWidth + center.x * cellWidth;
        entry.overlay.y = props.y + center.y * props.height;
        entry.overlay.width = cellWidth;
        entry.overlay.height = props.height;
        entry.overlay.alpha = props.alpha;
        entry.overlay.tint = props.tint;
        entry.overlay.angle = props.angle;
        entry.overlay.blendMode = props.blendMode;
      }
    }
  }

  /**
   * Update a `pmchara` entry — popn-style 9K POMYU character. Paints the source's full texture
   * at the destination rect (no sub-rect crop, no animation cycling). Hidden when:
   *
   *   - The destination's standard `props.visible` says so
   *   - The source has no texture (no character pack loaded, the wildcard's `|TAG|` syntax
   *     didn't match anything, or the `def: "Off"` filepath default is in effect)
   *
   * Frame-cycling animation driven by chart cues is a follow-up patch — most users running
   * 9K charts won't have a character pack dropped anyway, so the static rendering is graceful
   * out of the box.
   */
  private updatePmCharaEntry(entry: PmCharaEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const sprite = entry.sprite;
    if (!props.visible || entry.baseTexture === undefined || entry.baseTexture === Texture.EMPTY) {
      sprite.visible = false;
      return;
    }
    sprite.visible = true;
    sprite.texture = entry.baseTexture;
    const center = centerToAnchor(entry.group.center);
    sprite.anchor.set(center.x, center.y);
    sprite.x = props.x + center.x * props.width;
    sprite.y = props.y + center.y * props.height;
    sprite.width = props.width;
    sprite.height = props.height;
    sprite.alpha = props.alpha;
    sprite.tint = props.tint;
    sprite.angle = props.angle;
    sprite.blendMode = props.blendMode;
  }

  /** Tear down sprites and the container. Textures live on the cache (no `dispose()` by design). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries) {
      switch (entry.kind) {
        case 'image':
          entry.sprite.destroy({ children: false, texture: false, textureSource: false });
          break;
        case 'value':
          for (const sprite of entry.digitSprites) {
            sprite.destroy({ children: false, texture: false, textureSource: false });
          }
          break;
        case 'floatvalue':
          for (const sprite of entry.slotSprites) {
            sprite.destroy({ children: false, texture: false, textureSource: false });
          }
          break;
        case 'text':
          // Pixi `Text` owns an internal canvas-rendered texture not tracked by our texture cache —
          // destroy along with the node.
          entry.text.destroy({ children: false, texture: true, textureSource: true });
          break;
        case 'graph':
          entry.sprite.destroy({ children: false, texture: false, textureSource: false });
          break;
        case 'polyline-graph':
          entry.graphics.destroy({ children: false, texture: false, textureSource: false });
          break;
        case 'bpmgraph':
          entry.graphics.destroy({ children: false, texture: false, textureSource: false });
          break;
        case 'judgegraph':
          entry.graphics.destroy({ children: false, texture: false, textureSource: false });
          break;
        case 'gaugegraph':
          entry.graphics.destroy({ children: false, texture: false, textureSource: false });
          break;
        case 'timingvisualizer':
          entry.graphics.destroy({ children: false, texture: false, textureSource: false });
          break;
        case 'timingdistribution':
          entry.graphics.destroy({ children: false, texture: false, textureSource: false });
          break;
        case 'slider':
          entry.sprite.destroy({ children: false, texture: false, textureSource: false });
          break;
        case 'imageset':
          entry.sprite.destroy({ children: false, texture: false, textureSource: false });
          break;
        case 'gauge':
          for (const cell of entry.cells) {
            cell.destroy({ children: false, texture: false, textureSource: false });
          }
          break;
        case 'pmchara':
          entry.sprite.destroy({ children: false, texture: false, textureSource: false });
          break;
      }
    }
    this.entries.length = 0;
    this.container.destroy({ children: false });
  }
}

/**
 * Per-sub-image animation clock — same lookup as `computeAnimationElapsed` but typed against the
 * sub-image's own `BeatorajaImageElement` instead of the SpriteEntry wrapper. Imageset sub-images
 * animate independently of one another even though they share an enclosing destination.
 */
function computeImagesetTimerElapsed(image: BeatorajaImageElement, context: BeatorajaRenderContext): number {
  const start = imageTimerStart(image, context);
  if (start === undefined) return 0;
  return Math.max(0, context.nowMs - start);
}

function computeAnimationElapsed(entry: SpriteEntry, context: BeatorajaRenderContext): number {
  // Animation timer defaults to "scene start" when the image's `timer` is 0. Otherwise wait for the named timer to
  // fire before advancing the cycle (mirrors beatoraja's behavior — a key-bomb animation only animates after the
  // matching key-bomb timer started).
  const start = imageTimerStart(entry.image, context);
  if (start === undefined) return 0;
  return Math.max(0, context.nowMs - start);
}

function imageTimerStart(image: BeatorajaImageElement, context: BeatorajaRenderContext): number | undefined {
  if (image.timerFunction !== undefined) {
    const value = evaluateBeatorajaLuaNumber(image.timerFunction, context.lua);
    if (value === undefined || value < 0) return undefined;
    return value / 1000;
  }
  if (image.timer === 0) return 0;
  return context.getTimerStart(image.timer);
}

/**
 * Apply the destination's `filter` field to the underlying texture source. `1` requests bilinear
 * filtering (smooth scaling); anything else is a no-op (sources default to `'nearest'` at decode
 * time, set by `decodeAsset` in `beatoraja-textures.ts`). Filter is set on the source rather
 * than the sprite — Pixi v8 exposes scale mode at the source level — so every sprite sharing
 * the source picks up the change. In practice skin authors apply `filter=1` to atlases where
 * every cell wants the same treatment, so the source-level scope is the right granularity.
 */
function applyTextureFilterMode(texture: Texture | undefined, filter: number): void {
  if (filter !== 1) return;
  if (texture === undefined || texture === Texture.EMPTY) return;
  if (texture.source) texture.source.scaleMode = 'linear';
}

/**
 * Map a judge-kind string (`PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR`) to the tick color
 * the timingvisualizer paints. Colors mirror beatoraja's reference theme palette — yellow for
 * PERFECT (PG), green / blue / red / purple for the lower tiers. Unknown kinds default to white.
 */
function judgeColorFor(kind: string): number {
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

/** Clamp a number to `[0, 1]`. NaN / negative / overshoot all collapse to a safe in-range value. */
function clampUnit01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/**
 * Compute the visible-height ratio for a sprite carrying a `disapearLine` clip (= the hidden-
 * cover behavior). Returns `1` when no clip is active (no disapearLine on the image OR the
 * line sits above the rect's top edge), `0` when the rect is entirely below the line (totally
 * hidden), and a fractional `[0, 1]` when the rect straddles the line. Mirrors `SkinHidden.java`'s
 * draw-time logic: only `y_skin > disapearLineAddedLift` shows.
 */
function computeDisapearVisibleRatio(
  image: BeatorajaImageElement,
  props: { y: number; height: number },
  canvasHeight: number,
  resolveOffset: BeatorajaRenderContext['resolveOffset'],
): number {
  if (!(image.disapearLine >= 0)) return 1;
  if (props.height <= 0) return 0;
  // OFFSET_LIFT.y is the player's lift slider in skin-pixel Y-UP units. `OFFSET_LIFT` is
  // property id `3` in beatoraja's `SkinProperty` constants. Without a wired resolver (or with
  // the lift slider at home) the value is 0 and the cover stays fully tucked away — matching
  // the reference theme's "lift hides the cover by default" behavior.
  const liftY = image.isDisapearLineLinkLift && resolveOffset !== undefined ? (resolveOffset(3)?.y ?? 0) : 0;
  const lineSkin = image.disapearLine + liftY;
  // Convert the skin-Y-UP line to a Pixi Y-DOWN coordinate so we can compare against the
  // sprite's screen-space rect. `props.y` is the sprite's top in Pixi (smaller y = higher up);
  // `props.y + props.height` is the bottom.
  const linePixi = canvasHeight - lineSkin;
  if (linePixi <= props.y) return 0; // Entire rect below the line — nothing visible.
  if (linePixi >= props.y + props.height) return 1; // Line above the rect's bottom — full draw.
  return (linePixi - props.y) / props.height;
}

/**
 * Synthetic image id `-110` BLACK — beatoraja's renderer recognises it as a virtual solid-black
 * panel. Skin authors reference it directly in `destination[]` for transition overlays / panel
 * backings without bundling a black PNG.
 */
const SYNTHETIC_IMAGE_BLACK_ID = -110;
/** `-100` STAGEFILE — the chart's `#STAGEFILE` bitmap (loading-screen art). */
const SYNTHETIC_IMAGE_STAGEFILE_ID = -100;
/** `-101` BACKBMP — the chart's `#BACKBMP` bitmap (select-scene preview). */
const SYNTHETIC_IMAGE_BACKBMP_ID = -101;
/** `-102` BANNER — the chart's `#BANNER` bitmap (small song-bar banner). */
const SYNTHETIC_IMAGE_BANNER_ID = -102;

/**
 * Build a synthetic `BeatorajaImageElement` for one of the chart-image sentinel ids. `w / h` are
 * sourced from the texture's natural pixel size so the destination's cell-cropping math
 * produces the right source rect — the dst rect handles the on-screen scaling separately.
 */
function makeSyntheticChartImage(id: number, w: number, h: number): BeatorajaImageElement {
  return {
    id,
    src: 0,
    x: 0,
    y: 0,
    w,
    h,
    divx: 1,
    divy: 1,
    timer: 0,
    cycle: 0,
    ref: 0,
    len: 0,
    act: 0,
    click: 0,
    disapearLine: -1,
    isDisapearLineLinkLift: false,
    ifCodes: [],
  };
}

/**
 * `BeatorajaImageElement` shape for the synthetic black panel. The `src` is irrelevant since we
 * supply the texture directly (1×1 black canvas via `ensureBlackTexture`); the `w / h` need to
 * be `1 × 1` so the destination's cell-cropping math leaves the texture intact.
 */
const SYNTHETIC_BLACK_IMAGE: BeatorajaImageElement = {
  id: SYNTHETIC_IMAGE_BLACK_ID,
  src: 0,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  divx: 1,
  divy: 1,
  timer: 0,
  cycle: 0,
  ref: 0,
  len: 0,
  act: 0,
  click: 0,
  disapearLine: -1,
  isDisapearLineLinkLift: false,
  ifCodes: [],
};

/**
 * Module-singleton 1×1 black texture. Built lazily on first use so headless test environments
 * (no `document`) can construct `BeatorajaPlaySkinView` without crashing — they fall back to
 * `Texture.EMPTY` (renders as transparent, which still keeps the rest of the scene functional).
 */
let blackTextureCache: Texture | undefined;
function ensureBlackTexture(): Texture {
  if (blackTextureCache !== undefined) return blackTextureCache;
  if (typeof document === 'undefined') {
    blackTextureCache = Texture.EMPTY;
    return blackTextureCache;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    blackTextureCache = Texture.EMPTY;
    return blackTextureCache;
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 1, 1);
  blackTextureCache = Texture.from(canvas);
  return blackTextureCache;
}

/**
 * Inject a sentinel `dst[]` keyframe into the named anchor destination(s) so they survive
 * `normalizeBeatorajaDestinations` (which drops anything missing `dst[]`). Skin authors typically
 * write anchors as `{id = "notes", offset = N}` or `{id = "songlist"}` with no `dst` field — the
 * entry exists purely to mark a z-order slot, not to render anything. Inflating with a 0-sized
 * keyframe lets the normalizer keep it; the view consumes the anchor and never builds a sprite
 * for it.
 */
function ensureLayerAnchorDst(entry: unknown, anchorIds: ReadonlySet<BeatorajaImageId>): unknown {
  if (anchorIds.size === 0) return entry;
  if (entry === null || typeof entry !== 'object') return entry;
  const obj = entry as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== 'string' && typeof id !== 'number') return entry;
  if (!anchorIds.has(id)) return entry;
  if (Array.isArray(obj.dst) && obj.dst.length > 0) return entry;
  return { ...obj, dst: [{ time: 0, x: 0, y: 0, w: 0, h: 0 }] };
}
