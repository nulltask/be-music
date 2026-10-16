// Static-paint view for a beatoraja skin: each `image[]` / `value[]` / `text[]` declaration referenced by a
// `destination[]` becomes a Pixi `Sprite` or `Text` on a single `Container`, and `update(context)` resamples
// every destination keyframe per frame. Engine-driven dynamics (notes, judge flashes, key-on, BGA, lamps) are
// owned by the gameplay scene that drives this view from outside.

import { BitmapText, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  centerToAnchor,
  composeBeatorajaValueCells,
  composeBeatorajaValueShift,
  valueFrameAt,
  evaluateBeatorajaCustomEvents,
  evaluateBeatorajaCustomTimers,
  normalizeBeatorajaCustomEvents,
  normalizeBeatorajaCustomTimers,
  BEATORAJA_LUA_TIMER_OFF_VALUE,
  BEATORAJA_NUM,
  evaluateBeatorajaLuaNumber,
  evaluateBeatorajaLuaString,
  expandBeatorajaJudgeDestinations,
  flattenBeatorajaElements,
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
  beatorajaFloatValueSlotCount,
  composeBeatorajaFloatValueCells,
  floatValueFrameAt,
  composeBeatorajaFloatValueShift,
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
} from '../../skin/beatoraja/render.ts';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';
import { BeatorajaChartGraphRenderer, type BpmGraphEntry, type JudgeGraphEntry } from './skin-view/chart-graphs.ts';
import {
  applyTextureFilterMode,
  BEATORAJA_VIEW_DIAGNOSTICS,
  destroyTextureView,
  updateDynamicCropTexture,
} from './skin-view/common.ts';
import { BeatorajaGaugeRenderer, type GaugeEntry } from './skin-view/gauge.ts';
import {
  BeatorajaGraphRenderer,
  type GaugeGraphEntry,
  type GraphEntry,
  type PolylineGraphEntry,
  type SliderEntry,
} from './skin-view/graphs.ts';
import type { BeatorajaPlaySkinViewOptions } from './skin-view/options.ts';
import {
  BeatorajaTimingGraphRenderer,
  type TimingDistributionEntry,
  type TimingVisualizerEntry,
} from './skin-view/timing-graphs.ts';

export type { BeatorajaPlaySkinViewOptions } from './skin-view/options.ts';

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
  /** Reused for runtime-dependent crop rects so lift / hidden-cover animation does not grow the global crop cache. */
  dynamicCropTexture: Texture | undefined;
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
  /**
   * Last animation frame index applied to the slot textures. Mirrors {@link ValueEntry}'s
   * `lastFrameIndex` — re-crop runs whenever the strip's `cycle/divy` advances or the value
   * changes. `-1` is the initial sentinel.
   */
  lastFrameIndex: number;
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
  /**
   * Last animation frame index applied to the digit textures. When the value's `cycle > 0` and
   * the frame index advances, the per-digit textures are re-cropped from the matching strip row.
   * `-1` is the initial sentinel — first update always re-crops. Mirrors upstream's
   * `SkinSourceImageSet.getImageIndex` flow which re-evaluates per draw call.
   */
  lastFrameIndex: number;
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

/** `main_state.judge(n)`'s number ids: PERFECT, GREAT, GOOD, BAD, POOR, combo break. */
const LUA_JUDGE_NUMBERS = [
  BEATORAJA_NUM.PERFECT,
  BEATORAJA_NUM.GREAT,
  BEATORAJA_NUM.GOOD,
  BEATORAJA_NUM.BAD,
  BEATORAJA_NUM.POOR,
  BEATORAJA_NUM.COMBOBREAK,
] as const;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export class BeatorajaPlaySkinView {
  readonly container: Container = new Container();
  readonly width: number;
  readonly height: number;
  /**
   * Clip mask that bounds every descendant of `container` to the skin's authored canvas
   * `(0, 0, width, height)`. Mirrors the LR2 path's `designClipMask` at
   * `scene/lr2/gameplay.ts:469`: an off-stage skin destination (slide-ins authored from
   * negative coordinates, scroll-from-top effects, lane chrome that extends past the
   * skin's authored stage edge, etc.) gets clipped at the canvas edge instead of
   * bleeding into the host's letterbox / pillarbox bars.
   *
   * Drawn as a child of `container` so the same `fitToStage` transform applied to the
   * canvas also applies to the mask — Pixi clips against the mask's WORLD-space bounds,
   * which therefore line up with the on-screen rect of the authored canvas regardless of
   * window aspect ratio.
   */
  private readonly clipMask = new Graphics();

  /**
   * `container.children` filtered to exclude the {@link clipMask} — i.e. the actual sprite /
   * graphics children produced by the skin. Test utilities and host-side z-order callers prefer
   * this so the clip-mask Graphics doesn't pollute their counts / indexing logic.
   */
  get renderableChildren(): ReadonlyArray<Container['children'][number]> {
    return this.container.children.filter((child) => child !== this.clipMask);
  }
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
   * Index inside `container.children` where the host should splice in its BGA layer (the
   * play scene's chart-time-driven background animation). Beatoraja's play skins author a
   * `{id = skin.bga.id}` destination — typically `"bga"` — at the position where the BGA
   * should sit in the z-stack: chrome declared earlier (background, lane bg) paints
   * behind, chrome declared after (judgegraph / bpmgraph / HUD readouts) paints on top.
   * Mirrors upstream `JSONSkinLoader`'s `for (Destination dst : sk.destination)` loop
   * which adds each constructed `SkinObject` (including the `SkinBGA` returned by
   * `JsonPlaySkinObjectLoader.loadSkinObject` for the matching id) to the render list in
   * array order, so later destinations naturally paint on top.
   *
   * Defaults to `container.children.length` (= top-of-stack) when the skin doesn't author
   * a BGA destination (rare — most play skins do).
   */
  readonly bgaLayerInsertIndex: number;
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
  private readonly resolveSliderValue: (type: number) => number | undefined;
  private readonly resolveGaugePercent: () => number | undefined;
  private readonly onButtonAction:
    | ((act: number, modifiers?: { shift: boolean; ctrl: boolean; alt: boolean }) => void)
    | undefined;
  private readonly chartImageProvider: ((syntheticId: number) => Texture | undefined) | undefined;
  private readonly customEvents: ReadonlyArray<BeatorajaCustomEvent>;
  private readonly customEventState: BeatorajaCustomEventState[] = [];
  private readonly customTimers: ReadonlyArray<BeatorajaCustomTimer>;
  private readonly customTimerState: number[] = [];
  private readonly graphs: BeatorajaGraphRenderer;
  private readonly chartGraphs: BeatorajaChartGraphRenderer;
  private readonly timingGraphs: BeatorajaTimingGraphRenderer;
  private readonly gauges: BeatorajaGaugeRenderer;
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
    this.resolveSliderValue = options.resolveSliderValue ?? (() => undefined);
    this.resolveGaugePercent = options.resolveGaugePercent ?? (() => undefined);
    this.onButtonAction = options.onButtonAction;
    this.chartImageProvider = options.chartImageProvider;
    this.graphs = new BeatorajaGraphRenderer(this.container, options, (property, luaContext, kind) =>
      this.resolveFloatProperty(property, luaContext, kind),
    );
    this.chartGraphs = new BeatorajaChartGraphRenderer(this.container, options);
    this.timingGraphs = new BeatorajaTimingGraphRenderer(this.container, options);
    this.gauges = new BeatorajaGaugeRenderer(this.container, options);
    // Parse customEvents / customTimers once at view construction. The per-frame evaluator
    // reads `this.customEventState` / `this.customTimerState` for edge detection / change
    // tracking — see `update()`. ModernChic + GdbG_Skin both populate these so panel-toggle
    // SE / fullcombo voice / IR-update notifications fire at the right moments (audit 2.2).
    this.customEvents = normalizeBeatorajaCustomEvents((options.skin as { customEvents?: unknown }).customEvents);
    this.customTimers = normalizeBeatorajaCustomTimers((options.skin as { customTimers?: unknown }).customTimers);

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
        if (!claimedBy(tv.id) && !bpmGraphById.has(tv.id) && !judgeGraphById.has(tv.id) && !gaugeGraphById.has(tv.id)) {
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
    // Walk `skin.destination` (recursively descending into `if`/`values` wrappers) to
    // collect every authored destination id — used to filter `parts.judge[]` so only entries
    // actually referenced by `parts.destination` get expanded. Mirrors upstream's
    // `JsonPlaySkinObjectLoader.java:220-221`:
    //
    //     for (JsonSkin.Judge judge : sk.judge) {
    //         if (dst.id.equals(judge.id)) { ... instantiate ... }
    //     }
    //
    // upstream iterates the FLATTENED destination list, so an `id` nested under
    // `{ "if": [920], "values": [...] }` is reachable. Our previous filter only walked the
    // raw top-level array and missed nested ids — default 5K (`play5.json`) wraps the
    // judge anchor `{ "id": 2010 }` inside the 1P/2P side `if:[920]/[921]` blocks, so the
    // filter incorrectly skipped the judge expansion and the popup's text / combo never
    // rendered. ModernChic's separate-layout judges (`def`, `laneCoverRest_*`,
    // `constantRest_*`) live at the top level of `parts.destination`, so the flat fallback
    // still catches them.
    //
    // We use the package's `flattenBeatorajaElements` so the recursion semantics match the
    // standard destination pipeline exactly (including `if/value` single-keyframe wrappers).
    const referencedJudgeIds = new Set<string>();
    if (Array.isArray(options.skin.destination)) {
      for (const entry of flattenBeatorajaElements(options.skin.destination)) {
        const id = entry.fields.id;
        if (typeof id === 'string') referencedJudgeIds.add(id);
        else if (typeof id === 'number') referencedJudgeIds.add(String(id));
      }
    }
    // Pass `valueById` so `judge[].numbers[]` (combo digits) get upstream's pre-shift
    // (`ckf.w * digit / 2`) applied to each fold AND have their value declarations'
    // `align` mutated to 2 (CENTER). Without these, "GREAT 46" rendered with a 160 px gap
    // between the judge word and combo digit.
    const expandedJudgeDestinations = expandBeatorajaJudgeDestinations(judges, valueById, referencedJudgeIds);
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
    // BGA anchor — `{id = skin.bga.id}` in play-scene destination[]. The play skin's
    // `bga = {id = "bga"}` block (`play7main.lua:606`) names the destination whose
    // keyframes describe where the BGA should be drawn; matching the SAME id again in
    // `destination[]` (line 748) authors the actual rect + z-order anchor. Without
    // capturing this index, the host's separately-mounted BGA layer ends up at the
    // bottom of the stack (behind every authored backdrop) instead of at the
    // skin-authored position.
    const bgaAnchorRaw = (options.skin as { bga?: { id?: unknown } }).bga?.id;
    const bgaAnchorId: BeatorajaImageId | undefined =
      typeof bgaAnchorRaw === 'string' && bgaAnchorRaw.length > 0
        ? bgaAnchorRaw
        : typeof bgaAnchorRaw === 'number' && Number.isFinite(bgaAnchorRaw)
          ? bgaAnchorRaw
          : undefined;
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
    let bgaAnchorIndex: number | undefined;

    for (const group of groups) {
      // Notes anchor: skip the sprite, record where in `container.children` the host should insert
      // its note + marker layers. Only the FIRST anchor matching the section id wins — duplicates
      // (uncommon in well-formed themes) are ignored.
      if (noteAnchorId !== undefined && group.id === noteAnchorId && noteAnchorIndex === undefined) {
        noteAnchorIndex = this.container.children.length;
        continue;
      }
      // BGA anchor: same pattern as the notes anchor. The skin authors `bga = {id = "bga"}`
      // and a matching `destination[]` entry whose dst rect / `if[]` keyframes describe
      // where the BGA should sit. We capture the index now so the host can splice in its
      // chart-time-driven `BeatorajaBgaLayer` exactly there — matching upstream's
      // destination[]-array-order render priority. Falling through to a generic match
      // would have the BGA-id destination silently drop (no image / value / text element
      // matches that id), and the host's BGA layer mounted at index 0 would land behind
      // every authored backdrop.
      if (bgaAnchorId !== undefined && group.id === bgaAnchorId && bgaAnchorIndex === undefined) {
        bgaAnchorIndex = this.container.children.length;
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
          dynamicCropTexture: undefined,
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
            dynamicCropTexture: undefined,
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
          const sliderEntry = this.graphs.buildSliderEntry(group, sliderElement, options.textures);
          if (sliderEntry !== undefined) this.entries.push(sliderEntry);
          continue;
        }
        const graphElement = graphById.get(group.id);
        if (graphElement !== undefined) {
          const graphEntry = this.graphs.buildGraphEntry(group, graphElement, options.textures);
          if (graphEntry !== undefined) this.entries.push(graphEntry);
          continue;
        }
        const bpmGraphElement = bpmGraphById.get(group.id);
        if (bpmGraphElement !== undefined) {
          this.entries.push(this.chartGraphs.buildBpmGraphEntry(group, bpmGraphElement));
          continue;
        }
        const judgeGraphElement = judgeGraphById.get(group.id);
        if (judgeGraphElement !== undefined) {
          this.entries.push(this.chartGraphs.buildJudgeGraphEntry(group, judgeGraphElement));
          continue;
        }
        const gaugeGraphElement = gaugeGraphById.get(group.id);
        if (gaugeGraphElement !== undefined) {
          this.entries.push(this.graphs.buildGaugeGraphEntry(group, gaugeGraphElement));
          continue;
        }
        const timingElement = timingVisualizerById.get(group.id);
        if (timingElement !== undefined) {
          this.entries.push(this.timingGraphs.buildTimingVisualizerEntry(group, timingElement));
          continue;
        }
        const tdgElement = timingDistributionById.get(group.id);
        if (tdgElement !== undefined) {
          this.entries.push(this.timingGraphs.buildTimingDistributionEntry(group, tdgElement));
          continue;
        }
        const pmcharaElement = pmcharaById.get(group.id);
        if (pmcharaElement !== undefined) {
          this.entries.push(this.buildPmCharaEntry(group, pmcharaElement, options.textures));
          continue;
        }
        // Gauge id matching uses string-coerced equality. Upstream's `JsonSkin.Gauge.id` is
        // declared as `String` (`JsonSkin.java:217`), so when the JSON authoring uses a numeric
        // literal (`"id": 2001`) the JSON deserializer coerces it to the string "2001" — and
        // `dst.id.equals(sk.gauge.id)` then matches against destinations whose id was authored
        // either as `2001` or `"2001"`. Our Lua-table parser preserves both numeric and string
        // forms verbatim (BeatorajaImageId = number | string), so ModernChic's split authoring
        // (`parts.gauge.id = 2001` numeric vs `destination.id = "2001"` string) only matches
        // here when we string-coerce both sides — without this the gauge entry was never
        // built, leaving the gauge canvas pure black.
        if (gaugeElement !== undefined && String(group.id) === String(gaugeElement.id)) {
          const gaugeEntry = this.gauges.buildGaugeEntry(group, gaugeElement, imageById, options.textures);
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
      this.entries.push({
        kind: 'image',
        group,
        image,
        baseTexture,
        sprite,
        currentFrame,
        lastDisapearRatio: 1,
        dynamicCropTexture: undefined,
      });
    }

    // Resolve each layer-anchor's insert position. Anchors were captured during the destination
    // loop; skins that omit one (e.g. select / decide / result themes don't have notes; play
    // skins don't have songlist) get the legacy "append at the end" behavior for the missing
    // anchor, which matches the previous layering.
    this.noteLayerInsertIndex = noteAnchorIndex ?? this.container.children.length;
    this.songListLayerInsertIndex = songListAnchorIndex ?? this.container.children.length;
    this.bgaLayerInsertIndex = bgaAnchorIndex ?? this.container.children.length;

    // Install the canvas-edge clip mask LAST so the mask sits at top of the child stack and
    // its bounds inherit the full `(0, 0, width, height)` rect of the container's local space.
    // Anything authored outside this rect (notes that haven't scrolled into view, slide-in
    // chrome animated from negative coords, etc.) is clipped at the canvas edge — matching the
    // LR2 path's `designClipMask` behaviour. The mask is invisible by design (it's a mask, not
    // a paint), so its z-position relative to siblings doesn't affect what's rendered; we just
    // need it to live under the same transform so its world-space bounds line up with the
    // visible canvas after `fitToStage`'s scale + translate cascades down from the host.
    this.clipMask.label = 'beatoraja-skin-view/clip-mask';
    this.clipMask.rect(0, 0, this.width, this.height).fill(0xffffff);
    this.container.addChild(this.clipMask);
    this.container.mask = this.clipMask;

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
    const bgaAnchorConsumed = bgaAnchorIndex !== undefined ? 1 : 0;
    const skipped =
      groups.length - this.entries.length - noteAnchorConsumed - songListAnchorConsumed - bgaAnchorConsumed;
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
        bgaAnchor: { id: bgaAnchorId, index: this.bgaLayerInsertIndex, found: bgaAnchorIndex !== undefined },
      }),
    );
    if (skipped > 0) {
      const unmatchedIds = groups
        .filter(
          (group) =>
            group.id !== noteAnchorId &&
            group.id !== SONG_LIST_ANCHOR_ID &&
            group.id !== bgaAnchorId &&
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
    return { kind: 'value', group, value: element, baseTexture, digitSprites, lastValue: 0, lastFrameIndex: -1 };
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
    return { kind: 'floatvalue', group, value: element, baseTexture, slotSprites, lastValue: 0, lastFrameIndex: -1 };
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
    // The font is loaded ONCE at `text[].size` glyph height (= `parameter.size`), then
    // scaled at draw time so the rendered glyph height matches the destination rect's
    // current `h`. Final on-screen text height = `dst.h` regardless of the authored
    // `size` — that's why default beatoraja's `genre` / `artist` (dst.h=20) render
    // visibly smaller than `title` (dst.h=24) even though all three set `size: 24`.
    //
    // We rasterize Pixi's `Text` / `BitmapText` at the AUTHORED `text[].size` (so the
    // glyph bitmap is sharp at the author's intended baseline), then apply a per-frame
    // `text.scale.y = props.height / fontSize` in `updateTextEntry` to mirror upstream's
    // `setScale`. This handles two cases the previous "fontSize = dst[0].h" approach
    // got wrong:
    //   1. Animated text (h changes over time): we used to lock fontSize at the t=0
    //      keyframe and never updated, so a 540→24 zoom-down would render at 540 forever.
    //      Now scale tracks the current keyframe's h.
    //   2. Layout-variant gated dst[]: when the t=0 frame's `if[]` resolves to a huge
    //      catch-all variant (because the matching layout op isn't in activeOps), we'd
    //      lock fontSize at that giant value. Now the visible size is governed by the
    //      runtime keyframe's h, which is bounded sensibly by the resolver fallback.
    //
    // Falls back to `dst[0].h` only when `text[].size` is omitted (some Lua skins author
    // size on the destination rather than the element); final guard at 24 for skins
    // authoring neither.
    //
    // **Sign normalization** — AngelCode BMFont's authoring convention is "POSITIVE = points,
    // NEGATIVE = pixels", and the sign is also baked into the .fnt's `info size=N` line. Skins
    // pair the two: when the .fnt declares `size=-120` (the GroundbreakinG `Title.fnt` does
    // exactly this), the skin authors `text.size = -118` to match. Upstream
    // `SkinTextBitmap.draw` line 59 computes `scale = this.size / source.getOriginalSize()`,
    // and the matched signs cancel to a positive scale (`-118 / -120 = +0.983`); the rendered
    // glyph height ends up `|text.size|` px. We mirror this by taking `Math.abs(element.size)`
    // — Pixi's `style.fontSize` doesn't have well-defined semantics for negative values
    // (BMFont layout would compute a NEGATIVE scale and render the text 180° flipped), so we
    // can't pass the sign through. Pairing this with the `Math.abs(parsed.fontSize)` we apply
    // when registering the BitmapFont (see `beatoraja-fonts.ts`) reproduces upstream's
    // "rendered height = |text.size|" identity exactly.
    const firstFrame = group.dst[0];
    const rectH = firstFrame !== undefined && firstFrame.h > 0 ? firstFrame.h : 0;
    const absElementSize = Math.abs(element.size);
    const requestedSize = absElementSize > 0 ? absElementSize : rectH > 0 ? rectH : 24;
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
   * The Lua runtime context for this frame. Built once and kept: its functions read the frame through
   * {@link luaFrame}, set here each frame, instead of a fresh set of closures being made every frame. The Lua bridge
   * only reads the context while it evaluates a call (`update` does that synchronously), never later.
   */
  private buildLuaRuntimeContext(context: BeatorajaRenderContext): BeatorajaLuaRuntimeContext {
    this.luaFrame = context;
    const lua = (this.luaRuntimeContext ??= this.createLuaRuntimeContext());
    // Forward host audio hooks so BooleanProperty / customEvent callbacks evaluated at draw
    // time can fire SE. The hooks themselves come from the demo's `BeatorajaSkinAudioPlayer`
    // (one per loaded theme bundle); the skin-view never owns audio state.
    lua.audioPlay = context.audioPlay;
    lua.audioLoop = context.audioLoop;
    lua.audioStop = context.audioStop;
    return lua;
  }

  private luaFrame: BeatorajaRenderContext | undefined;
  private luaRuntimeContext: Mutable<BeatorajaLuaRuntimeContext> | undefined;

  private createLuaRuntimeContext(): Mutable<BeatorajaLuaRuntimeContext> {
    const frame = (): BeatorajaRenderContext => this.luaFrame!;
    return {
      option: (id) => frame().activeOps.has(id),
      number: (id) => this.resolveNumberValue(id),
      floatNumber: (id) => this.resolveSliderValue(id) ?? this.resolveGraphValue(id),
      text: (id) => this.resolveTextContent(id),
      offset: (id) => frame().resolveOffset?.(id),
      timer: (id) => {
        const start = id === 0 ? 0 : frame().getTimerStart(id);
        return start === undefined ? BEATORAJA_LUA_TIMER_OFF_VALUE : start * 1000;
      },
      time: () => frame().nowMs * 1000,
      rate: () => this.resolveNumberValue(BEATORAJA_NUM.SCORE_RATE),
      exscore: () => this.resolveNumberValue(BEATORAJA_NUM.POINT),
      judge: (judge) => {
        const ref = LUA_JUDGE_NUMBERS[judge];
        return ref === undefined ? undefined : this.resolveNumberValue(ref);
      },
      gauge: () => {
        const percent = this.resolveGaugePercent();
        return percent;
      },
      // `main_state.gauge_type()` — beatoraja's `BEATORAJA_GAUGE_MODE.*` int constant.
      // Sourced from the runtime adapter's `resolveGaugeState`. Returns `undefined` when no
      // frame has landed yet; the Lua bridge defaults to 0 in that case.
      gaugeType: () => frame().resolveGaugeState?.()?.mode,
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
          this.updateValueEntry(entry, props, luaContext, context.resolveOffset, context.nowMs);
          break;
        case 'floatvalue':
          this.updateFloatValueEntry(entry, props, luaContext, context.resolveOffset, context.nowMs);
          break;
        case 'text':
          this.updateTextEntry(entry, props, luaContext);
          break;
        case 'graph':
          this.graphs.updateGraphEntry(entry, props, luaContext);
          break;
        case 'polyline-graph':
          this.graphs.updatePolylineGraphEntry(entry, props);
          break;
        case 'bpmgraph':
          this.chartGraphs.updateBpmGraphEntry(entry, props);
          break;
        case 'judgegraph':
          this.chartGraphs.updateJudgeGraphEntry(entry, props);
          break;
        case 'gaugegraph':
          this.graphs.updateGaugeGraphEntry(entry, props);
          break;
        case 'timingvisualizer':
          this.timingGraphs.updateTimingVisualizerEntry(entry, props);
          break;
        case 'timingdistribution':
          this.timingGraphs.updateTimingDistributionEntry(entry, props);
          break;
        case 'slider':
          this.graphs.updateSliderEntry(entry, props, luaContext);
          break;
        case 'imageset':
          this.updateImagesetEntry(entry, renderContext, props, luaContext);
          break;
        case 'gauge':
          this.gauges.updateGaugeEntry(entry, props, renderContext);
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
      let cropped: Texture | undefined;
      if (useFullTexture) {
        entry.dynamicCropTexture = destroyTextureView(entry.dynamicCropTexture);
        cropped = entry.baseTexture;
      } else {
        const rect = {
          x: cell.x,
          y: cell.y,
          w: cell.w,
          h: cell.h * disapearRatio,
        };
        if (disapearRatio === 1) {
          entry.dynamicCropTexture = destroyTextureView(entry.dynamicCropTexture);
          cropped = createCroppedBeatorajaTexture(entry.baseTexture, rect);
        } else {
          entry.dynamicCropTexture = updateDynamicCropTexture(entry.dynamicCropTexture, entry.baseTexture, rect);
          cropped = entry.dynamicCropTexture;
        }
      }
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
    // Note: `dst.filter` (= `SkinObject.java:536-538`) is applied at BUILD time via
    // `applyTextureFilterMode(baseTexture, group.filter)` higher up in this file. Pixi's
    // `scaleMode` lives on the texture source (not the sprite), so a single application
    // when the entry is first mounted is sufficient — the mode persists across update
    // ticks regardless of which sprite is sampling the texture.
  }

  /**
   * Convert one digit slot's libGDX-space rect (after per-digit offset) into Pixi-space sprite
   * props honoring the parent's `center` anchor. Shared between `updateValueEntry` and
   * `updateFloatValueEntry` so the two paths can't drift.
   *
   * Mirrors upstream `SkinNumber.draw()` (`SkinNumber.java:189-199`):
   *
   *     draw(sprite, currentImages[j],
   *          region.x + (region.width + space) * j - shift + offsets[j].x,
   *          region.y + offsets[j].y,
   *          region.width + offsets[j].w,
   *          region.height + offsets[j].h);
   *
   * Two upstream-faithfulness points:
   *
   *   1. **Y sign.** `offsets[j].y > 0` shifts the slot UP in libGDX (Y-UP) — i.e., its libGDX
   *      bottom-edge moves to a HIGHER y. After the Pixi Y-flip
   *      (`pixiTop = canvasH - libgdxBottom - libgdxHeight`), the slot's Pixi top must DECREASE
   *      by `offsets[j].y` AND by `offsets[j].h` (because libGDX height grew upward).
   *      The previous impl added `+ offsets[j].y` directly to `sprite.y`, flipping the sign.
   *
   *   2. **Center anchor on post-offset rect.** The rotation pivot in libGDX is at
   *      `(slot.x + centerx*slot.w, slot.y + centery*slot.h)` — using the FULL post-offset
   *      width/height, NOT the base slotWidth. The previous impl multiplied centerx by the
   *      base `slotWidth`, leaving the pivot off-center whenever `offsets[j].w/h ≠ 0`.
   *
   * The `relative` flag from the parent destination does NOT apply here. SkinObject's
   * `region.x += off.x - off.w/2` center-shift is applied at the destination level (already
   * baked into `parent.x/y`); per-digit offsets in `SkinNumber.draw()` are added without
   * center-shift regardless of `relative`.
   */
  private static perDigitSlotPixiProps(args: {
    /** Pixi-space parent destination rect (already Y-flipped). */
    parent: { x: number; y: number; height: number };
    /** `(slotWidth + space) * j`, the per-slot horizontal step before alignment shift. */
    slotIndexX: number;
    /** Un-offset slot width (= the per-digit `region.width`). */
    slotBaseWidth: number;
    /** Alignment shift (subtracted from x — see `composeBeatorajaValueShift`). */
    alignShift: number;
    /** Per-digit offset in libGDX semantics (or all-zeros when no offset id is set). */
    off: { x: number; y: number; w: number; h: number };
    /** Pixi anchor for the parent destination's `center` field (already Y-flipped). */
    centerPixi: { x: number; y: number };
  }): { x: number; y: number; width: number; height: number } {
    const { parent, slotIndexX, slotBaseWidth, alignShift, off, centerPixi } = args;
    // Slot's libGDX bottom-left, after per-digit offset. (Bottom-left is the natural anchor
    // because libGDX `SpriteBatch.draw(image, x, y, w, h)` interprets x/y as bottom-left in
    // Y-UP, mirrored by our parent.x = libGDX bottom-left x.)
    const slotPixiLeft = parent.x + slotIndexX - alignShift + off.x;
    // Pixi top = parent's Pixi top, MINUS off.y (slot moves up = Pixi-y decreases) and
    // MINUS off.h (height grew upward in libGDX → Pixi top moves up by full off.h).
    const slotPixiTop = parent.y - off.y - off.h;
    const slotWidth = slotBaseWidth + off.w;
    const slotHeight = parent.height + off.h;
    return {
      x: slotPixiLeft + slotWidth * centerPixi.x,
      y: slotPixiTop + slotHeight * centerPixi.y,
      width: slotWidth,
      height: slotHeight,
    };
  }

  /**
   * Resolve a per-digit offset id (or `undefined` when the slot has no offset). Returns the
   * zero offset when the resolver isn't wired or the id maps to nothing — keeps the caller's
   * arithmetic uniform regardless of authoring.
   */
  private static readonly ZERO_PER_DIGIT_OFFSET = Object.freeze({ x: 0, y: 0, w: 0, h: 0 });
  private resolvePerDigitOffsetOrZero(
    offsetId: number | undefined,
    resolveOffset: BeatorajaRenderContext['resolveOffset'],
  ): { x: number; y: number; w: number; h: number } {
    if (offsetId === undefined || resolveOffset === undefined) {
      return BeatorajaPlaySkinView.ZERO_PER_DIGIT_OFFSET;
    }
    const off = resolveOffset(offsetId);
    return off ?? BeatorajaPlaySkinView.ZERO_PER_DIGIT_OFFSET;
  }

  private updateValueEntry(
    entry: ValueEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    luaContext: BeatorajaLuaRuntimeContext,
    resolveOffset: BeatorajaRenderContext['resolveOffset'],
    nowMs: number,
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

    // Resolve the dynamic numeric value through the host's `prop.lua num` adapter. The host
    // returns `undefined` when the ref doesn't apply to the current scene state (e.g.
    // `folder_totalsongs = 300` returns `MIN_VALUE` upstream while the cursor is on a song
    // bar — our adapter's equivalent is `undefined`). Mirrors upstream `SkinNumber.prepare`
    // (`SkinNumber.java:133-136`) which sets `draw = false` and skips rendering when the
    // resolved value is `Integer.MIN_VALUE`. Hide every digit sprite in that case.
    //
    // Refs returning a real number (including `0`) keep rendering — many score / combo
    // readouts legitimately read 0 in the idle state. The skin-side `valueProperty` (Lua
    // function) path always returns a finite number from `resolveIntegerProperty`, so it
    // skips the hide branch (matches upstream where Lua-driven values can't return MIN_VALUE).
    const resolved =
      entry.value.valueProperty !== undefined
        ? this.resolveIntegerProperty(entry.value.valueProperty, luaContext)
        : entry.value.ref !== 0
          ? this.resolveNumberValue(entry.value.ref)
          : 0;
    if (resolved === undefined) {
      for (const sprite of entry.digitSprites) sprite.visible = false;
      return;
    }
    const value = resolved;

    // Animation frame for `cycle`-driven strips — picks the current `divy` row. Mirrors
    // upstream `SkinSourceImageSet.getImageIndex(time, state)` (with `timer == null`, since
    // our value-element schema doesn't expose the source-level `timer` field yet — most skins
    // including ModernChic / default authors omit it). Re-crop runs whenever the frame index
    // changes OR the value changes.
    const frameIndex = valueFrameAt(entry.value, nowMs);

    // Re-compose digit-cell textures when the value OR animation frame changes. The composer
    // hands back one source-rect per digit slot (with the row's y-offset baked in); we crop a
    // sub-texture per slot and assign it to the matching sprite.
    let cells: ReturnType<typeof composeBeatorajaValueCells> | undefined;
    const valueChanged = value !== entry.lastValue;
    const frameChanged = frameIndex !== entry.lastFrameIndex;
    if (valueChanged || frameChanged) {
      entry.lastValue = value;
      entry.lastFrameIndex = frameIndex;
      cells = composeBeatorajaValueCells(entry.value, value, frameIndex);
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
    if (cells === undefined) cells = composeBeatorajaValueCells(entry.value, value, frameIndex);

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
    // Per-digit offsets — `value[].offset = [id0, id1, ...]` (parallel array, one offset
    // id per slot). Mirrors upstream `SkinNumber.draw()`'s `+ offsets[j].x / .y / .w / .h`
    // terms. Empty (= the default) keeps every slot at the un-offset position. Per-digit
    // offsets operate on a single sprite and DO NOT inherit the parent's `relative` flag —
    // SkinObject's center-shift is already baked into the parent's region; SkinNumber.draw
    // adds offsets[j].* without center-shift regardless of `relative`.
    const perDigitOffsets = entry.value.offsets;
    for (let i = 0; i < entry.digitSprites.length; i += 1) {
      const sprite = entry.digitSprites[i]!;
      const cell = cells[i];
      if (cell !== undefined && cell.hidden) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;
      sprite.anchor.set(center.x, center.y);
      const off = this.resolvePerDigitOffsetOrZero(perDigitOffsets[i], resolveOffset);
      const slot = BeatorajaPlaySkinView.perDigitSlotPixiProps({
        parent: { x: props.x, y: props.y, height: props.height },
        slotIndexX: i * slotStep,
        slotBaseWidth: slotWidth,
        alignShift,
        off,
        centerPixi: center,
      });
      sprite.x = slot.x;
      sprite.y = slot.y;
      sprite.width = slot.width;
      sprite.height = slot.height;
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
    resolveOffset: BeatorajaRenderContext['resolveOffset'],
    nowMs: number,
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
    // fall through to the host's `resolveNumberValue(ref)`. `undefined` from the ref path
    // mirrors upstream `MIN_VALUE` (= "ref doesn't apply now") — same hide-everything
    // behaviour as the integer-value path above. See that block's comment for the
    // upstream-faithfulness rationale.
    const resolved =
      entry.value.valueProperty !== undefined
        ? this.resolveIntegerProperty(entry.value.valueProperty, luaContext)
        : entry.value.ref !== 0
          ? this.resolveNumberValue(entry.value.ref)
          : 0;
    if (resolved === undefined) {
      for (const sprite of entry.slotSprites) sprite.visible = false;
      return;
    }
    const value = resolved;

    // Animation frame for `cycle`-driven strips — selects which `divy` row the slot textures
    // crop from. Mirrors `SkinSourceImageSet.getImageIndex(time, state)` (with `timer == null`).
    const frameIndex = floatValueFrameAt(entry.value, nowMs);

    let cells: ReturnType<typeof composeBeatorajaFloatValueCells> | undefined;
    const valueChanged = value !== entry.lastValue;
    const frameChanged = frameIndex !== entry.lastFrameIndex;
    if (valueChanged || frameChanged) {
      entry.lastValue = value;
      entry.lastFrameIndex = frameIndex;
      cells = composeBeatorajaFloatValueCells(entry.value, value, frameIndex);
      for (let i = 0; i < entry.slotSprites.length; i += 1) {
        const cell = cells[i];
        if (cell === undefined || cell.hidden) continue;
        const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
        if (cropped !== undefined) {
          entry.slotSprites[i]!.texture = cropped;
        }
      }
    }
    if (cells === undefined) cells = composeBeatorajaFloatValueCells(entry.value, value, frameIndex);

    // Lay the slot row across the dst rect — same convention as `value[]`: `dst.w` is per-slot
    // width, `space` adds inter-slot gap.
    const slotWidth = props.width;
    const space = Number.isFinite(entry.value.space) ? entry.value.space : 0;
    const slotStep = slotWidth + space;
    // Honor `value.align` — same formula as the integer `value[]` path. For float, leading
    // hidden slots are the leading-blank pads on the integer half (when the value's int part
    // has fewer digits than `iketa`). align=1 (LEFT) shifts the row left so significant
    // digits flush with the dst's left edge; align=2 (CENTER) shifts half. Without this,
    // ModernChic / GdbG result-screen `floatvalue` displays (BPM avg, accuracy %, ms delta)
    // with explicit `align` rendered with leading blanks on the wrong side.
    // Compute shift, then NEGATE — `SkinFloat.java:193` ADDS the shift to slot.x while our
    // `perDigitSlotPixiProps` helper SUBTRACTS the `alignShift` parameter (modeled after
    // `SkinNumber.draw()`'s `- shift`). Negating preserves a single helper for both element
    // types: `slot.x = parent.x + j*slotStep - alignShift` with `alignShift = -upstreamShift`
    // is equivalent to upstream's `slot.x = parent.x + j*slotStep + upstreamShift`.
    const alignShift = -composeBeatorajaFloatValueShift(entry.value, value, slotWidth);
    const center = centerToAnchor(entry.group.center);
    // Per-digit offsets — same semantics as `value[]`. See `perDigitSlotPixiProps` for the
    // upstream-faithful x/y/w/h derivation (mirrors `SkinFloat.java:189-199`).
    const perDigitOffsets = entry.value.offsets;
    for (let i = 0; i < entry.slotSprites.length; i += 1) {
      const sprite = entry.slotSprites[i]!;
      const cell = cells[i];
      if (cell !== undefined && cell.hidden) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;
      sprite.anchor.set(center.x, center.y);
      const off = this.resolvePerDigitOffsetOrZero(perDigitOffsets[i], resolveOffset);
      const slot = BeatorajaPlaySkinView.perDigitSlotPixiProps({
        parent: { x: props.x, y: props.y, height: props.height },
        slotIndexX: i * slotStep,
        slotBaseWidth: slotWidth,
        alignShift,
        off,
        centerPixi: center,
      });
      sprite.x = slot.x;
      sprite.y = slot.y;
      sprite.width = slot.width;
      sprite.height = slot.height;
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
      if (BEATORAJA_VIEW_DIAGNOSTICS) {
        // eslint-disable-next-line no-console
        console.log(
          '[beatoraja-view] text content',
          JSON.stringify({ id: entry.element.id, ref: entry.element.ref, text: next }),
        );
      }
    }

    // The destination's `x` is the ANCHOR POINT, not the bounding-box left edge. Upstream
    // `SkinTextFont.java:107` interprets `region.x` per align:
    //
    //     final float x = (getAlign() == 2 ? region.x - region.width
    //                    : getAlign() == 1 ? region.x - region.width / 2
    //                    : region.x);
    //     sprite.draw(font, layout, x + offsetX, ...);   // layout halign = ALIGN[getAlign()]
    //
    // After libGDX's `GlyphLayout` applies the layout's `halign` within `[x, x + region.width]`:
    //   - align=0 LEFT:   text's LEFT edge at `region.x` (no shift).
    //   - align=1 CENTER: text's CENTER at `region.x` (shifted by -region.width/2 then centered).
    //   - align=2 RIGHT:  text's RIGHT edge at `region.x` (shifted by -region.width then right-anchored).
    //
    // In Pixi we get the same effect by setting `text.x = props.x` regardless of align, with
    // the Pixi `text.anchor.x = 0 / 0.5 / 1` set at build time per the same align value. The
    // anchor's local-space pivot lands at `text.x` in parent coords, so the LEFT / CENTER /
    // RIGHT of the text span sits at `region.x` exactly as upstream — no per-frame offset.
    //
    // Audit A-4 (2024-12): the previous TS impl added `+ props.width / 2` (center) and
    // `+ props.width` (right) to text.x, treating the dst rect as a bounding box rather than
    // an anchor point. That landed `align=2 RIGHT` text `region.width` to the RIGHT of where
    // upstream paints it.
    //
    // Width / height aren't forced onto the Text node: beatoraja's `text[]` semantics is
    // "render glyphs at `size` px with auto-width" — clamping to the dst rect would scale
    // the type, which is what beatoraja explicitly avoids.
    text.x = props.x;
    text.y = props.y;
    text.alpha = props.alpha;
    text.tint = props.tint;
    text.angle = props.angle;
    text.blendMode = props.blendMode;
    // Word-wrap width — Pixi's text style treats `wordWrap` and `wordWrapWidth` as a pair, so
    // when authors set `wrapping = true` we need a width or Pixi falls back to its 100px
    // default. Mirror the destination's current width so wrapping happens at the dst rect
    // boundary (matches beatoraja's libGDX `BitmapFontCache.addText(..., maxWidth, ...)` where
    // `maxWidth = region.width`). Skip when wrapping is off — wordWrapWidth is harmless then,
    // but keeping it untouched avoids gratuitous Pixi style invalidation on non-wrap text.
    if (entry.element.wrapping && props.width > 0 && text.style.wordWrapWidth !== props.width) {
      text.style.wordWrapWidth = props.width;
    }
    // Per-frame scale — diverges between TTF (CSS-fonts) and bitmap (.fnt) text per upstream:
    //
    //  - **TTF / FreeType** (`SkinTextFont.java:103`):
    //        font.getData().setScale(region.height / parameter.size);
    //    The font is rasterized at `text[].size` and the per-frame scale tracks the current
    //    keyframe's `region.height`. Animated-h dst rects scale the glyphs proportionally.
    //
    //  - **Bitmap font / .fnt** (`SkinTextBitmap.java:59`):
    //        float scale = this.size / source.getOriginalSize();
    //        font.getData().setScale(scale);
    //    The scale is a CONSTANT derived from the authored `text[].size` and the .fnt's
    //    natural size. `region.height` is IGNORED for sizing — the displayed glyph height
    //    equals `text[].size` regardless of the dst rect's height.
    //
    //    Pixi's BitmapText resolves the bitmap's natural size automatically and renders at
    //    `style.fontSize` (= `text[].size`, set at build time). With `scale = 1` the rendered
    //    height equals `text[].size` — matching upstream's effective output.
    //
    // `overflow = 1` (= shrink-to-fit, `SkinTextFont.java:124-130` & `SkinTextBitmap.java:94-100`):
    // when the rendered text is wider than the destination box at the height-derived scale,
    // x-shrink proportionally so it stays inside. Applies to both TTF and bitmap. Other
    // `overflow` modes (`0` = no handling, `2` = clip — uncommon) leave xScale at the
    // height-derived value (no horizontal shrink applied).
    //
    // `Math.abs` mirrors the build-time `absElementSize` derivation in `buildTextEntry` — the
    // BMFont sign convention treats `text.size`'s sign as a pixel-vs-point unit hint, not a
    // signed magnitude, and upstream's `scale = this.size / originalSize` cancels the matched
    // negatives. We strip the sign on both sides (.fnt fontSize and skin text.size) so the
    // resulting Pixi scale is positive and the rendered glyph height equals `|text.size|`.
    const referenceSize = Math.abs(entry.element.size) > 0 ? Math.abs(entry.element.size) : 24;
    const isBitmap = text instanceof BitmapText;
    const baseScale = isBitmap ? 1 : props.height > 0 ? props.height / referenceSize : 1;
    let scaleX = baseScale;
    const scaleY = baseScale;
    if (entry.element.overflow === 1 && props.width > 0) {
      // text.width is the natural width at the current scale (Pixi reports post-scale
      // dimensions). Recover the unscaled width by dividing by the current scale, then check
      // if the would-be drawn width at `baseScale` exceeds the box — shrink x if so.
      const unscaledWidth = text.width / Math.max(text.scale.x, 0.0001);
      const drawnWidth = unscaledWidth * baseScale;
      if (drawnWidth > props.width && drawnWidth > 0) {
        scaleX = baseScale * (props.width / drawnWidth);
      }
    }
    text.scale.set(scaleX, scaleY);
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
          entry.dynamicCropTexture = destroyTextureView(entry.dynamicCropTexture);
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
          entry.dynamicCropTexture = destroyTextureView(entry.dynamicCropTexture);
          break;
        case 'polyline-graph':
          entry.graphics.destroy({ children: false, texture: false, textureSource: false, context: true });
          break;
        case 'bpmgraph':
          entry.graphics.destroy({ children: false, texture: false, textureSource: false, context: true });
          break;
        case 'judgegraph':
          entry.graphics.destroy({ children: false, texture: false, textureSource: false, context: true });
          break;
        case 'gaugegraph':
          entry.graphics.destroy({ children: false, texture: false, textureSource: false, context: true });
          break;
        case 'timingvisualizer':
          entry.graphics.destroy({ children: false, texture: false, textureSource: false, context: true });
          break;
        case 'timingdistribution':
          entry.graphics.destroy({ children: false, texture: false, textureSource: false, context: true });
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
    // Detach the clip mask reference before destroy so Pixi doesn't keep the (already-pending-
    // destruction) Graphics alive through the container's `mask` slot. Destroy the mask
    // explicitly — it doesn't appear in `entries[]` and would otherwise leak its
    // GraphicsContext / GPU buffer.
    this.container.mask = null;
    this.clipMask.destroy({ children: false, texture: false, textureSource: false, context: true });
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
