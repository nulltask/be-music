// Static-paint view for a beatoraja skin: each `image[]` / `value[]` / `text[]` declaration referenced by a
// `destination[]` becomes a Pixi `Sprite` or `Text` on a single `Container`, and `update(context)` resamples
// every destination keyframe per frame. Engine-driven dynamics (notes, judge flashes, key-on, BGA, lamps) are
// owned by the gameplay scene that drives this view from outside.

import { BitmapText, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  centerToAnchor,
  composeBeatorajaValueCells,
  expandBeatorajaJudgeDestinations,
  imageFrameAt,
  imageFrameRect,
  imageRefFrame,
  normalizeBeatorajaDestinations,
  normalizeBeatorajaGauge,
  normalizeBeatorajaGraphs,
  normalizeBeatorajaImages,
  normalizeBeatorajaImagesets,
  normalizeBeatorajaJudges,
  normalizeBeatorajaSliders,
  normalizeBeatorajaTexts,
  normalizeBeatorajaValues,
  pickBeatorajaGaugeNode,
  type BeatorajaDestinationGroup,
  type BeatorajaGaugeElement,
  type BeatorajaGraphElement,
  type BeatorajaImageElement,
  type BeatorajaImageId,
  type BeatorajaImagesetElement,
  type BeatorajaSkin,
  type BeatorajaSliderElement,
  type BeatorajaTextElement,
  type BeatorajaValueElement,
} from '@be-music/beatoraja-skin';
import {
  createCroppedBeatorajaTexture,
  destinationToSpriteProps,
  type BeatorajaRenderContext,
} from './beatoraja-render.ts';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';

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
  resolveFontFamily?: (fontId: number) => string | undefined;
  /**
   * Lookup `text[].font` slot id → which Pixi text pipe to instantiate. `'bitmap'` picks
   * `BitmapText` (consumes a registered `BitmapFont` keyed by `family`); anything else picks the
   * default `Text` (CSS-font pipe). Skins that ship AngelCode `.fnt` fonts (e.g. GroundbreakinG)
   * MUST go through the bitmap pipe — `Text` can't render glyphs the browser's `FontFace` registry
   * couldn't accept. Returning `undefined` is treated as `'css'`.
   */
  resolveFontKind?: (fontId: number) => 'css' | 'bitmap' | undefined;
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

type ViewEntry =
  | SpriteEntry
  | ValueEntry
  | TextEntry
  | GraphEntry
  | PolylineGraphEntry
  | SliderEntry
  | ImagesetEntry
  | GaugeEntry;

export class BeatorajaPlaySkinView {
  readonly container = new Container();
  readonly width: number;
  readonly height: number;
  private readonly entries: ViewEntry[] = [];
  private readonly resolveRefValue: (refOp: number) => number;
  private readonly resolveTextContent: (refOp: number) => string | undefined;
  private readonly resolveNumberValue: (refOp: number) => number | undefined;
  private readonly resolveFontFamily: (fontId: number) => string | undefined;
  private readonly resolveFontKind: (fontId: number) => 'css' | 'bitmap' | undefined;
  private readonly resolveGraphValue: (type: number) => number | undefined;
  private readonly resolveGraphPolyline: (type: number) => ReadonlyArray<{ x: number; y: number }> | undefined;
  private readonly resolveSliderValue: (type: number) => number | undefined;
  private readonly resolveGaugePercent: () => number | undefined;
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

    const imageById = new Map<BeatorajaImageId, BeatorajaImageElement>();
    for (const image of normalizeBeatorajaImages(options.skin.image)) {
      imageById.set(image.id, image);
    }
    // `hiddenCover[]` shares the (id, src, x, y, w, h) shape with `image[]` plus extra
    // `disapearLine` / `isDisapearLineLinkLift` fields tied to the lift / lanecover slider. Until
    // those are surfaced through the resolver, the cover renders as a regular image at its
    // authored dst rect — fold the array into `imageById` so destinations referencing
    // `"hidden-cover"` etc. resolve and paint.
    for (const cover of normalizeBeatorajaImages(options.skin.hiddenCover)) {
      if (!imageById.has(cover.id)) imageById.set(cover.id, cover);
    }
    // `value[]` declarations carry numeric formatting metadata (`digit` / `padding` / `divx`) that
    // `image[]` doesn't, so they're tracked in their own map and rendered through a dedicated
    // multi-sprite digit composer (`composeBeatorajaValueCells`). `image[]` wins on id collision —
    // matches beatoraja's own resolver.
    const valueById = new Map<BeatorajaImageId, BeatorajaValueElement>();
    for (const value of normalizeBeatorajaValues(options.skin.value)) {
      if (!imageById.has(value.id)) {
        valueById.set(value.id, value);
      }
    }
    // `text[]` declarations carry no source rect — font / size / ref pairs the runtime resolves into strings.
    // Skin TTFs aren't loaded yet (engine integration handles that); the placeholders below use the browser's
    // default sans-serif so positions and sizes are visible.
    const textById = new Map<BeatorajaImageId, BeatorajaTextElement>();
    for (const text of normalizeBeatorajaTexts(options.skin.text)) {
      textById.set(text.id, text);
    }
    // `graph[]` declarations describe scaling-bar overlays — gauge fills, chart-progress bars, etc.
    // Same id namespace as image / value / text; same "first wins" precedence with image / value /
    // text taking priority on collisions (matches beatoraja's resolver order).
    const graphById = new Map<BeatorajaImageId, BeatorajaGraphElement>();
    for (const graph of normalizeBeatorajaGraphs(options.skin.graph)) {
      if (!imageById.has(graph.id) && !valueById.has(graph.id) && !textById.has(graph.id)) {
        graphById.set(graph.id, graph);
      }
    }
    // `slider[]` declarations — translatable sprites driven by a runtime value (lanecover line,
    // hispeed lift, volume sliders). Same precedence semantics as `graph[]` — image / value /
    // text / graph win on id collision.
    const sliderById = new Map<BeatorajaImageId, BeatorajaSliderElement>();
    for (const slider of normalizeBeatorajaSliders((options.skin as { slider?: unknown }).slider)) {
      if (
        !imageById.has(slider.id) &&
        !valueById.has(slider.id) &&
        !textById.has(slider.id) &&
        !graphById.has(slider.id)
      ) {
        sliderById.set(slider.id, slider);
      }
    }
    // `imageset[]` declarations — multi-state images (lane keybeams, bomb cycles) that flip between
    // sub-images based on a runtime ref op. Lowest precedence after every other element kind: a
    // direct `image[]` / `value[]` / `text[]` / `graph[]` / `slider[]` with the same id wins.
    const imagesetById = new Map<BeatorajaImageId, BeatorajaImagesetElement>();
    for (const imageset of normalizeBeatorajaImagesets(options.skin.imageset)) {
      if (
        !imageById.has(imageset.id) &&
        !valueById.has(imageset.id) &&
        !textById.has(imageset.id) &&
        !graphById.has(imageset.id) &&
        !sliderById.has(imageset.id)
      ) {
        imagesetById.set(imageset.id, imageset);
      }
    }
    // `gauge` element (singular — beatoraja's reference theme authors at most one gauge per
    // skin). Same id-namespace contention rule as the others.
    const gauge = normalizeBeatorajaGauge(options.skin.gauge);
    let gaugeElement: BeatorajaGaugeElement | undefined;
    if (
      gauge !== undefined &&
      !imageById.has(gauge.id) &&
      !valueById.has(gauge.id) &&
      !textById.has(gauge.id) &&
      !graphById.has(gauge.id) &&
      !sliderById.has(gauge.id) &&
      !imagesetById.has(gauge.id)
    ) {
      gaugeElement = gauge;
    }

    // Expand `judge[]` entries into synthetic destinations gated on the matching judge ops
    // (`P1_JUDGE_PERFECT = 241` etc.). The expansion adds one destination per (judge entry ×
    // image / number sub-entry × judge kind), each with the per-judge op appended to the gate.
    // Concatenated with `skin.destination` so the standard destination pipeline handles them.
    const judges = normalizeBeatorajaJudges(options.skin.judge);
    const expandedJudgeDestinations = expandBeatorajaJudgeDestinations(judges);
    const allDestinations: ReadonlyArray<unknown> = Array.isArray(options.skin.destination)
      ? [...options.skin.destination, ...expandedJudgeDestinations]
      : expandedJudgeDestinations;
    const groups = normalizeBeatorajaDestinations(allDestinations);

    // Render order: lower `offset` (back layer) draws first, then by author declaration order. Matches beatoraja's
    // own back-to-front layering.
    groups.sort((a, b) => a.offset - b.offset || a.declarationOrder - b.declarationOrder);

    for (const group of groups) {
      const image = imageById.get(group.id);
      if (image === undefined) {
        const valueElement = valueById.get(group.id);
        if (valueElement !== undefined) {
          const valueEntry = this.buildValueEntry(group, valueElement, options.textures);
          if (valueEntry !== undefined) this.entries.push(valueEntry);
          continue;
        }
        const textElement = textById.get(group.id);
        if (textElement !== undefined) {
          this.entries.push(this.buildTextEntry(group, textElement));
          continue;
        }
        const graphElement = graphById.get(group.id);
        if (graphElement !== undefined) {
          const graphEntry = this.buildGraphEntry(group, graphElement, options.textures);
          if (graphEntry !== undefined) this.entries.push(graphEntry);
          continue;
        }
        const sliderElement = sliderById.get(group.id);
        if (sliderElement !== undefined) {
          const sliderEntry = this.buildSliderEntry(group, sliderElement, options.textures);
          if (sliderEntry !== undefined) this.entries.push(sliderEntry);
          continue;
        }
        const imagesetElement = imagesetById.get(group.id);
        if (imagesetElement !== undefined) {
          const imagesetEntry = this.buildImagesetEntry(group, imagesetElement, imageById, options.textures);
          if (imagesetEntry !== undefined) this.entries.push(imagesetEntry);
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
        const cell = imageFrameRect(image, 0);
        const cropped = createCroppedBeatorajaTexture(baseTexture, cell);
        if (cropped !== undefined) {
          initialTexture = cropped;
          currentFrame = 0;
        }
      }
      const sprite = new Sprite({ texture: initialTexture, alpha: 0 });
      this.container.addChild(sprite);
      applyTextureFilterMode(baseTexture, group.filter);
      this.entries.push({ kind: 'image', group, image, baseTexture, sprite, currentFrame });
    }

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
    const skipped = groups.length - this.entries.length;
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
      }),
    );
    if (skipped > 0) {
      const unmatchedIds = groups
        .filter((group) => !imageById.has(group.id) && !valueById.has(group.id) && !textById.has(group.id))
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
    // beatoraja `text[].size` is the requested rendered height in skin-pixel units. Default to the
    // destination rect's height when the skin omits it — most authors set `size` explicitly, but
    // unset / non-positive values should fall back to "fit the box" semantics rather than a
    // hard-coded 24.
    const firstFrame = group.dst[0];
    const rectH = firstFrame !== undefined && firstFrame.h > 0 ? firstFrame.h : 24;
    const requestedSize = element.size > 0 ? element.size : rectH;
    // Pick `BitmapText` for BMFonts and `Text` for everything else. Both share the same constructor
    // surface (`text`, `style.fontFamily`, `style.fontSize`, `style.align`, `alpha`, anchors), so
    // downstream update code doesn't branch — see `updateTextEntry`.
    const TextCtor: typeof Text | typeof BitmapText =
      fontKind === 'bitmap' && skinFamily !== undefined ? BitmapText : Text;
    const text = new TextCtor({
      text: '',
      style: {
        fontFamily,
        fontSize: requestedSize,
        fill: 0xffffff,
        align: element.align,
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
    // Filter mode applies to every node texture used by this gauge, but they likely share a
    // single source (the gauge atlas). Apply to the first one and trust that pattern.
    const firstNode = nodeTextures.values().next().value;
    if (firstNode !== undefined) applyTextureFilterMode(firstNode, group.filter);
    return { kind: 'gauge', group, element, cells, nodeTextures };
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
    return { kind: 'imageset', group, element, subImages, sprite, lastSubIndex: -1, lastFrame: -1 };
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
   * Re-sample every destination at `context.nowMs` and update the matching `Sprite` / `Text`. Call once per frame.
   */
  update(context: BeatorajaRenderContext): void {
    if (this.disposed) return;
    for (const entry of this.entries) {
      const props = destinationToSpriteProps(entry.group, context);
      switch (entry.kind) {
        case 'image':
          this.updateImageEntry(entry, context, props);
          break;
        case 'value':
          this.updateValueEntry(entry, props);
          break;
        case 'text':
          this.updateTextEntry(entry, props);
          break;
        case 'graph':
          this.updateGraphEntry(entry, props);
          break;
        case 'polyline-graph':
          this.updatePolylineGraphEntry(entry, props);
          break;
        case 'slider':
          this.updateSliderEntry(entry, props);
          break;
        case 'imageset':
          this.updateImagesetEntry(entry, context, props);
          break;
        case 'gauge':
          this.updateGaugeEntry(entry, props);
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

    if (frameIndex !== entry.currentFrame) {
      const cell = imageFrameRect(entry.image, frameIndex);
      const cropped = createCroppedBeatorajaTexture(entry.baseTexture, cell);
      if (cropped === undefined) {
        // Cell width/height collapsed to 0 — hiding avoids the same null-source bind-group crash above.
        sprite.visible = false;
        return;
      }
      sprite.texture = cropped;
      entry.currentFrame = frameIndex;
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

  private updateValueEntry(entry: ValueEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
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
    const value = (entry.value.ref !== 0 ? this.resolveNumberValue(entry.value.ref) : 0) ?? 0;

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

    // Lay the digit row across the destination rect. Each digit's slot width is `rect.w / digit`,
    // height is the rect's full height. Hidden slots have their sprites collapsed to invisible —
    // beatoraja's reference behavior for `padding=0` + digits-only strips with a small value.
    const slotWidth = props.width / Math.max(1, entry.digitSprites.length);
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
      sprite.x = props.x + i * slotWidth + center.x * slotWidth;
      sprite.y = props.y + center.y * props.height;
      sprite.width = slotWidth;
      sprite.height = props.height;
      sprite.alpha = props.alpha;
      sprite.tint = props.tint;
      sprite.angle = props.angle;
      sprite.blendMode = props.blendMode;
    }
  }

  private updateTextEntry(entry: TextEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const text = entry.text;
    text.visible = props.visible;
    if (!props.visible) return;

    // Skip the assignment when the string hasn't changed — assigning the same string still triggers
    // a Pixi glyph relayout, which is expensive (canvas rasterization).
    const next = entry.element.ref !== 0 ? (this.resolveTextContent(entry.element.ref) ?? '') : '';
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
  private updateGraphEntry(entry: GraphEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const sprite = entry.sprite;
    sprite.visible = props.visible;
    if (!props.visible) return;
    const baseTexture = entry.baseTexture;
    if (baseTexture === undefined || baseTexture === Texture.EMPTY) {
      sprite.visible = false;
      return;
    }
    const rawRatio = this.resolveGraphValue(entry.element.type);
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
   * Update a slider entry. Translates the sprite within the destination box by
   * `value * range` skin-pixels along its angle axis, leaving width / height at the source-rect
   * crop's natural size (sliders don't scale — they translate).
   *
   * Hidden when the resolver returns `undefined` (the runtime doesn't have data for this slider's
   * `type`) or `props.visible` says so. Defaulting to `value = 0` (slider at home position) when
   * the resolver returns 0 is intentional — that's the "neutral" pose for sliders that map to
   * disabled-by-default user-config knobs (lanecover off → slider at the bottom of its track).
   */
  private updateSliderEntry(entry: SliderEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const sprite = entry.sprite;
    sprite.visible = props.visible;
    if (!props.visible) return;
    if (entry.baseTexture === undefined || entry.baseTexture === Texture.EMPTY) {
      sprite.visible = false;
      return;
    }
    const rawValue = this.resolveSliderValue(entry.element.type);
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
  ): void {
    const sprite = entry.sprite;
    sprite.visible = props.visible;
    if (!props.visible) return;
    // Resolve the sub-image index from the ref op. `ref = 0` means "no ref" → always slot 0.
    // Out-of-range values clamp to the available images so a runtime that pushes a 1 into a
    // 1-slot imageset doesn't blank the sprite.
    let subIndex = 0;
    if (entry.element.ref !== 0) {
      const raw = this.resolveRefValue(entry.element.ref);
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
  private updateGaugeEntry(entry: GaugeEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const visible = props.visible;
    if (!visible) {
      for (const cell of entry.cells) cell.visible = false;
      return;
    }
    const gaugePercent = this.resolveGaugePercent() ?? 0;
    const cellWidth = props.width / Math.max(1, entry.element.parts);
    const center = centerToAnchor(entry.group.center);
    for (let i = 0; i < entry.cells.length; i += 1) {
      const cell = entry.cells[i]!;
      const pick = pickBeatorajaGaugeNode(entry.element, i, gaugePercent);
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
          break;
        case 'value':
          for (const sprite of entry.digitSprites) {
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
  if (image.timer === 0) return context.nowMs;
  const start = context.getTimerStart(image.timer);
  if (start === undefined) return 0;
  return Math.max(0, context.nowMs - start);
}

function computeAnimationElapsed(entry: SpriteEntry, context: BeatorajaRenderContext): number {
  // Animation timer defaults to "scene start" when the image's `timer` is 0. Otherwise wait for the named timer to
  // fire before advancing the cycle (mirrors beatoraja's behavior — a key-bomb animation only animates after the
  // matching key-bomb timer started).
  if (entry.image.timer === 0) return context.nowMs;
  const start = context.getTimerStart(entry.image.timer);
  if (start === undefined) return 0;
  return Math.max(0, context.nowMs - start);
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

/** Clamp a number to `[0, 1]`. NaN / negative / overshoot all collapse to a safe in-range value. */
function clampUnit01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}
