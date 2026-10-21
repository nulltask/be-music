import { clamp } from '@be-music/shared-utils/core';
import { Graphics, Sprite, Texture, type Container } from 'pixi.js';
import {
  centerToAnchor,
  type BeatorajaDestinationGroup,
  type BeatorajaFloatPropertyRef,
  type BeatorajaGaugeGraphElement,
  type BeatorajaGraphElement,
  type BeatorajaLuaRuntimeContext,
  type BeatorajaSliderElement,
} from '@be-music/skin-beatoraja';
import { createCroppedBeatorajaTexture, type destinationToSpriteProps } from '../../../skin/beatoraja/render.ts';
import type { BeatorajaTextureCache } from '../../../skin/beatoraja/textures.ts';
import { applyTextureFilterMode, updateDynamicCropTexture } from './common.ts';
import type { BeatorajaPlaySkinViewOptions } from './options.ts';

export interface GraphEntry {
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
  /** Reused for runtime-dependent crop rects so graph ratios do not allocate one cached Texture per frame. */
  dynamicCropTexture: Texture | undefined;
}

export interface PolylineGraphEntry {
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

export interface GaugeGraphEntry {
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

export interface SliderEntry {
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

/** Resolves a `graph[]` / `slider[]` float property (a ref id or a Lua function). */
type ResolveFloatProperty = (
  property: BeatorajaFloatPropertyRef,
  luaContext: BeatorajaLuaRuntimeContext,
  kind: 'graph' | 'slider',
) => number | undefined;

/**
 * Builds and updates the `graph[]` (bar fill and polyline), `slider[]` and `gaugegraph[]` entries of a
 * {@link BeatorajaPlaySkinView}.
 */
export class BeatorajaGraphRenderer {
  private readonly container: Container;
  private readonly resolveGraphValue: (type: number) => number | undefined;
  private readonly resolveGraphPolyline: (type: number) => ReadonlyArray<{ x: number; y: number }> | undefined;
  private readonly resolveSliderValue: (type: number) => number | undefined;
  private readonly resolveGaugeGraphPoints: () => ReadonlyArray<{ x: number; y: number }> | undefined;
  private readonly resolveFloatProperty: ResolveFloatProperty;

  constructor(container: Container, options: BeatorajaPlaySkinViewOptions, resolveFloatProperty: ResolveFloatProperty) {
    this.container = container;
    this.resolveGraphValue = options.resolveGraphValue ?? (() => undefined);
    this.resolveGraphPolyline = options.resolveGraphPolyline ?? (() => undefined);
    this.resolveSliderValue = options.resolveSliderValue ?? (() => undefined);
    this.resolveGaugeGraphPoints = options.resolveGaugeGraphPoints ?? (() => undefined);
    this.resolveFloatProperty = resolveFloatProperty;
  }

  /**
   * Build a graph entry. Polyline-style graphs (whose `type` the host's `resolveGraphPolyline`
   * answers) get a `PolylineGraphEntry` with a Pixi `Graphics` for line strokes. Everything else
   * falls through to the bar-fill `GraphEntry` path. The polyline check uses `resolveGraphPolyline`
   * — if it returns `undefined` for the type at build time, the renderer assumes that type will
   * never produce polyline data and goes straight to the bar entry.
   */
  buildGraphEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaGraphElement,
    textures: BeatorajaTextureCache,
  ): GraphEntry | PolylineGraphEntry | undefined {
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
    return { kind: 'graph', group, element, baseTexture, sprite, dynamicCropTexture: undefined };
  }

  /**
   * Build a slider entry — a `Sprite` with a fixed source-rect crop that translates within its
   * destination box per frame. The base texture is captured once at build time; per-frame updates
   * only adjust position (no re-cropping needed since the slider's crop is constant).
   */
  buildSliderEntry(
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

  /** Build a gaugegraph entry — same Graphics-node + rebuild-on-change pattern as bpmgraph. */
  buildGaugeGraphEntry(group: BeatorajaDestinationGroup, element: BeatorajaGaugeGraphElement): GaugeGraphEntry {
    const graphics = new Graphics();
    graphics.alpha = 0;
    this.container.addChild(graphics);
    return { kind: 'gaugegraph', group, element, graphics, lastPointCount: -1 };
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
  updateGraphEntry(
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
    // Mirror upstream `SkinGraph.java:99-106`. Two cases only:
    //
    //   if (direction == 1) {
    //       // vertical: take the BOTTOM `ratio*h` portion of the source, paint into the
    //       // BOTTOM `ratio*h` of the dst rect (libGDX Y-UP — bar grows UPWARD visually).
    //       current.setRegion(currentImage, 0, h - ratio*h, w, ratio*h);
    //       draw(sprite, current, region.x, region.y, region.width, region.height * ratio);
    //   } else {
    //       // horizontal: take the LEFT `ratio*w` portion, paint into the LEFT `ratio*w` of
    //       // the dst rect — bar grows RIGHTWARD visually.
    //       current.setRegion(currentImage, 0, 0, ratio*w, h);
    //       draw(sprite, current, region.x, region.y, region.width * ratio, region.height);
    //   }
    //
    // For 'vertical' in Pixi Y-DOWN: the libGDX bar's bottom edge stays at the dst rect's
    // bottom. Pixi's bottom-y of the dst = `props.y + props.height`. The bar's height is
    // `props.height * ratio` and its TOP-y = bottom-y - bar.height = `props.y + props.height
    // * (1 - ratio)`. Source crop's BOTTOM is at `el.y + el.h` in skin coords; we crop the
    // BOTTOM `el.h * ratio` portion → cropY = `el.y + el.h * (1 - ratio)`, cropH = `el.h * ratio`.
    let cropX = el.x;
    let cropY = el.y;
    let cropW = el.w;
    let cropH = el.h;
    let destX = props.x;
    let destY = props.y;
    let destW = props.width;
    let destH = props.height;
    if (el.angle === 'vertical') {
      cropY = el.y + el.h * (1 - ratio);
      cropH = el.h * ratio;
      destY = props.y + props.height * (1 - ratio);
      destH = props.height * ratio;
    } else {
      // 'horizontal' — fill from left edge.
      cropW = el.w * ratio;
      destW = props.width * ratio;
    }
    entry.dynamicCropTexture = updateDynamicCropTexture(entry.dynamicCropTexture, baseTexture, {
      x: cropX,
      y: cropY,
      w: cropW,
      h: cropH,
    });
    const cropped = entry.dynamicCropTexture;
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
  updatePolylineGraphEntry(entry: PolylineGraphEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
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
   * Update a gaugegraph entry. Strokes the gauge polyline (`{x ∈ [0, 1], y ∈ [0, 1]}` points,
   * y = `gauge / 100`) across the destination box; y is inverted so a high gauge paints toward
   * the top of the box (matches beatoraja's reference "gauge climbs upward" convention).
   *
   * Hidden when:
   *   - The destination's standard `props` say so (op gate, alpha 0)
   *   - The resolver returned `undefined` or fewer than 2 points (no run history yet)
   */
  updateGaugeGraphEntry(entry: GaugeGraphEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
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
   * Update a slider entry. Translates the sprite within the destination box by
   * `value * range` skin-pixels along its angle axis, leaving width / height at the source-rect
   * crop's natural size (sliders don't scale — they translate).
   *
   * Hidden when the resolver returns `undefined` (the runtime doesn't have data for this slider's
   * `type`) or `props.visible` says so. Defaulting to `value = 0` (slider at home position) when
   * the resolver returns 0 is intentional — that's the "neutral" pose for sliders that map to
   * disabled-by-default user-config knobs (lanecover off → slider at the bottom of its track).
   */
  updateSliderEntry(
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
}

/** Clamp a number to `[0, 1]`. NaN / negative / overshoot all collapse to a safe in-range value. */
function clampUnit01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return clamp(v, 0, 1);
}
