// Static-paint view for a beatoraja skin: each `image[]` / `value[]` / `text[]` declaration referenced by a
// `destination[]` becomes a Pixi `Sprite` or `Text` on a single `Container`, and `update(context)` resamples
// every destination keyframe per frame. Engine-driven dynamics (notes, judge flashes, key-on, BGA, lamps) are
// owned by the gameplay scene that drives this view from outside.

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import {
  evaluateBeatorajaCustomEvents,
  evaluateBeatorajaCustomTimers,
  normalizeBeatorajaCustomEvents,
  normalizeBeatorajaCustomTimers,
  expandBeatorajaJudgeDestinations,
  flattenBeatorajaElements,
  imageFrameRect,
  normalizeBeatorajaBPMGraphs,
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
  type BeatorajaBPMGraphElement,
  type BeatorajaCustomEvent,
  type BeatorajaCustomEventState,
  type BeatorajaCustomTimer,
  type BeatorajaGaugeGraphElement,
  type BeatorajaJudgeGraphElement,
  type BeatorajaTimingDistributionGraphElement,
  type BeatorajaTimingVisualizerElement,
  type BeatorajaGaugeElement,
  type BeatorajaGraphElement,
  type BeatorajaFloatValueElement,
  type BeatorajaImageElement,
  type BeatorajaImageId,
  type BeatorajaImagesetElement,
  type BeatorajaPmCharaElement,
  type BeatorajaSliderElement,
  type BeatorajaTextElement,
  type BeatorajaValueElement,
} from '@be-music/beatoraja-skin';
import {
  createCroppedBeatorajaTexture,
  destinationToSpriteProps,
  type BeatorajaRenderContext,
} from '../../skin/beatoraja/render.ts';
import { BeatorajaChartGraphRenderer, type BPMGraphEntry, type JudgeGraphEntry } from './skin-view/chart-graphs.ts';
import { applyTextureFilterMode, destroyTextureView } from './skin-view/common.ts';
import { BeatorajaGaugeRenderer, type GaugeEntry } from './skin-view/gauge.ts';
import {
  BeatorajaGraphRenderer,
  type GaugeGraphEntry,
  type GraphEntry,
  type PolylineGraphEntry,
  type SliderEntry,
} from './skin-view/graphs.ts';
import {
  BeatorajaImageRenderer,
  ensureBlackTexture,
  makeSyntheticChartImage,
  SYNTHETIC_BLACK_IMAGE,
  SYNTHETIC_IMAGE_BACKBMP_ID,
  SYNTHETIC_IMAGE_BANNER_ID,
  SYNTHETIC_IMAGE_BLACK_ID,
  SYNTHETIC_IMAGE_STAGEFILE_ID,
  type ImagesetEntry,
  type PmCharaEntry,
  type SpriteEntry,
} from './skin-view/images.ts';
import { BeatorajaSkinLuaContext } from './skin-view/lua-context.ts';
import { BeatorajaNumberRenderer, type FloatValueEntry, type ValueEntry } from './skin-view/numbers.ts';
import type { BeatorajaPlaySkinViewOptions } from './skin-view/options.ts';
import { BeatorajaTextRenderer, type TextEntry } from './skin-view/text.ts';
import {
  BeatorajaTimingGraphRenderer,
  type TimingDistributionEntry,
  type TimingVisualizerEntry,
} from './skin-view/timing-graphs.ts';

export type { BeatorajaPlaySkinViewOptions } from './skin-view/options.ts';

type ViewEntry =
  | SpriteEntry
  | ValueEntry
  | FloatValueEntry
  | TextEntry
  | GraphEntry
  | PolylineGraphEntry
  | BPMGraphEntry
  | JudgeGraphEntry
  | GaugeGraphEntry
  | TimingVisualizerEntry
  | TimingDistributionEntry
  | SliderEntry
  | ImagesetEntry
  | GaugeEntry
  | PmCharaEntry;

export class BeatorajaPlaySkinView {
  readonly container: Container = new Container();
  readonly width: number;
  readonly height: number;
  /**
   * Clip mask that bounds every descendant of `container` to the skin's authored canvas
   * `(0, 0, width, height)`. Mirrors the play frame's `designClipMask` in
   * `view/shared/play-frame.ts`: an off-stage skin destination (slide-ins authored from
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
  private readonly onButtonAction:
    | ((act: number, modifiers?: { shift: boolean; ctrl: boolean; alt: boolean }) => void)
    | undefined;
  private readonly chartImageProvider: ((syntheticId: number) => Texture | undefined) | undefined;
  private readonly customEvents: ReadonlyArray<BeatorajaCustomEvent>;
  private readonly customEventState: BeatorajaCustomEventState[] = [];
  private readonly customTimers: ReadonlyArray<BeatorajaCustomTimer>;
  private readonly customTimerState: number[] = [];
  private readonly lua: BeatorajaSkinLuaContext;
  private readonly images: BeatorajaImageRenderer;
  private readonly numbers: BeatorajaNumberRenderer;
  private readonly texts: BeatorajaTextRenderer;
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
    this.onButtonAction = options.onButtonAction;
    this.chartImageProvider = options.chartImageProvider;
    this.lua = new BeatorajaSkinLuaContext(options);
    this.images = new BeatorajaImageRenderer(this.container, this.height, options, (property, luaContext) =>
      this.lua.resolveIntegerProperty(property, luaContext),
    );
    this.numbers = new BeatorajaNumberRenderer(this.container, options, (property, luaContext) =>
      this.lua.resolveIntegerProperty(property, luaContext),
    );
    this.texts = new BeatorajaTextRenderer(this.container, options, (property, luaContext) =>
      this.lua.resolveStringProperty(property, luaContext),
    );
    this.graphs = new BeatorajaGraphRenderer(this.container, options, (property, luaContext, kind) =>
      this.lua.resolveFloatProperty(property, luaContext, kind),
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
    // Element-kind resolution priority follows beatoraja's `JSONSkinObjectLoader.loadSkinObject`
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
    // `text[]` — font / size / ref pairs the runtime resolves into strings. Skin TTFS aren't
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
    const bpmGraphById = new Map<BeatorajaImageId, BeatorajaBPMGraphElement>();
    for (const bpmGraph of normalizeBeatorajaBPMGraphs((options.skin as { bpmgraph?: unknown }).bpmgraph)) {
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
    //     for (JSONSkin.Judgment judge : sk.judge) {
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

    // Render order: PURELY by author declaration order. Beatoraja's `JSONSkinLoader.loadJSONSkin`
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
      // chart-time-driven `BeatorajaBGALayer` exactly there — matching upstream's
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
        // Resolution priority mirrors `JSONSkinObjectLoader.loadSkinObject`:
        //   image -> imageset -> value -> floatvalue -> text -> slider -> graph
        // The registration phase above already deduped ids by this priority, so each
        // `*ById.get(id)` here only returns truthy for the WINNING kind. The order is still
        // worth preserving for predictability: a future de-dedup change shouldn't accidentally
        // re-introduce the imageset-dead-last bug.
        const imagesetElement = imagesetById.get(group.id);
        if (imagesetElement !== undefined) {
          const imagesetEntry = this.images.buildImagesetEntry(group, imagesetElement, imageById, options.textures);
          if (imagesetEntry !== undefined) this.entries.push(imagesetEntry);
          continue;
        }
        const valueElement = valueById.get(group.id);
        if (valueElement !== undefined) {
          const valueEntry = this.numbers.buildValueEntry(group, valueElement, options.textures);
          if (valueEntry !== undefined) this.entries.push(valueEntry);
          continue;
        }
        const floatValueElement = floatValueById.get(group.id);
        if (floatValueElement !== undefined) {
          const floatValueEntry = this.numbers.buildFloatValueEntry(group, floatValueElement, options.textures);
          if (floatValueEntry !== undefined) this.entries.push(floatValueEntry);
          continue;
        }
        const textElement = textById.get(group.id);
        if (textElement !== undefined) {
          this.entries.push(this.texts.buildTextEntry(group, textElement));
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
          this.entries.push(this.chartGraphs.buildBPMGraphEntry(group, bpmGraphElement));
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
          this.entries.push(this.images.buildPmCharaEntry(group, pmcharaElement, options.textures));
          continue;
        }
        // Gauge id matching uses string-coerced equality. Upstream's `JSONSkin.Gauge.id` is
        // declared as `String` (`JSONSkin.java:217`), so when the JSON authoring uses a numeric
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

  /**
   * Re-sample every destination at `context.nowMs` and update the matching `Sprite` / `Text`. Call once per frame.
   */
  update(context: BeatorajaRenderContext): void {
    if (this.disposed) return;
    const luaContext = this.lua.buildLuaRuntimeContext(context);
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
          this.images.updateImageEntry(entry, renderContext, props);
          break;
        case 'value':
          this.numbers.updateValueEntry(entry, props, luaContext, context.resolveOffset, context.nowMs);
          break;
        case 'floatvalue':
          this.numbers.updateFloatValueEntry(entry, props, luaContext, context.resolveOffset, context.nowMs);
          break;
        case 'text':
          this.texts.updateTextEntry(entry, props, luaContext);
          break;
        case 'graph':
          this.graphs.updateGraphEntry(entry, props, luaContext);
          break;
        case 'polyline-graph':
          this.graphs.updatePolylineGraphEntry(entry, props);
          break;
        case 'bpmgraph':
          this.chartGraphs.updateBPMGraphEntry(entry, props);
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
          this.images.updateImagesetEntry(entry, renderContext, props, luaContext);
          break;
        case 'gauge':
          this.gauges.updateGaugeEntry(entry, props, renderContext);
          break;
        case 'pmchara':
          this.images.updatePmCharaEntry(entry, props);
          break;
      }
    }
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
