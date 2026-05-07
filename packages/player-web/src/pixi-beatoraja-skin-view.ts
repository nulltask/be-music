// Static-paint view for a beatoraja skin: each `image[]` / `value[]` / `text[]` declaration referenced by a
// `destination[]` becomes a Pixi `Sprite` or `Text` on a single `Container`, and `update(context)` resamples
// every destination keyframe per frame. Engine-driven dynamics (notes, judge flashes, key-on, BGA, lamps) are
// owned by the gameplay scene that drives this view from outside.

import { BitmapText, Container, Sprite, Text, Texture } from 'pixi.js';
import {
  composeBeatorajaValueCells,
  imageFrameAt,
  imageFrameRect,
  imageRefFrame,
  normalizeBeatorajaDestinations,
  normalizeBeatorajaImages,
  normalizeBeatorajaTexts,
  normalizeBeatorajaValues,
  type BeatorajaDestinationGroup,
  type BeatorajaImageElement,
  type BeatorajaImageId,
  type BeatorajaSkin,
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

type ViewEntry = SpriteEntry | ValueEntry | TextEntry;

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

    const imageById = new Map<BeatorajaImageId, BeatorajaImageElement>();
    for (const image of normalizeBeatorajaImages(options.skin.image)) {
      imageById.set(image.id, image);
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

    const groups = normalizeBeatorajaDestinations(options.skin.destination);

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

    sprite.x = props.x;
    sprite.y = props.y;
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
    for (let i = 0; i < entry.digitSprites.length; i += 1) {
      const sprite = entry.digitSprites[i]!;
      const cell = cells[i];
      if (cell !== undefined && cell.hidden) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;
      sprite.x = props.x + i * slotWidth;
      sprite.y = props.y;
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
      }
    }
    this.entries.length = 0;
    this.container.destroy({ children: false });
  }
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
