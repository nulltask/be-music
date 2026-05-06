// Static-paint view for a beatoraja skin: each `image[]` / `value[]` / `text[]` declaration referenced by a
// `destination[]` becomes a Pixi `Sprite` or `Text` on a single `Container`, and `update(context)` resamples
// every destination keyframe per frame. Engine-driven dynamics (notes, judge flashes, key-on, BGA, lamps) are
// owned by the gameplay scene that drives this view from outside.

import { Container, Sprite, Text, Texture } from 'pixi.js';
import {
  imageFrameAt,
  imageFrameRect,
  imageRefFrame,
  normalizeBeatorajaDestinations,
  normalizeBeatorajaImages,
  normalizeBeatorajaTexts,
  type BeatorajaDestinationGroup,
  type BeatorajaImageElement,
  type BeatorajaImageId,
  type BeatorajaSkin,
  type BeatorajaTextElement,
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

interface TextEntry {
  kind: 'text';
  group: BeatorajaDestinationGroup;
  element: BeatorajaTextElement;
  text: Text;
}

type ViewEntry = SpriteEntry | TextEntry;

export class BeatorajaPlaySkinView {
  readonly container = new Container();
  readonly width: number;
  readonly height: number;
  private readonly entries: ViewEntry[] = [];
  private readonly resolveRefValue: (refOp: number) => number;
  private readonly resolveTextContent: (refOp: number) => string | undefined;
  private disposed = false;

  constructor(options: BeatorajaPlaySkinViewOptions) {
    this.width = options.skin.w;
    this.height = options.skin.h;
    this.resolveRefValue = options.resolveRefValue ?? (() => 0);
    this.resolveTextContent = options.resolveTextContent ?? (() => undefined);

    const imageById = new Map<BeatorajaImageId, BeatorajaImageElement>();
    for (const image of normalizeBeatorajaImages(options.skin.image)) {
      imageById.set(image.id, image);
    }
    // `value[]` shares the `id / src / x / y / w / h / divx / divy` shape with `image[]`; the formatting hints
    // (`digit / padding / align`) are ignored until engine integration plugs in the dynamic numeric layout. The
    // placeholder paints cell 0 of the source sheet ('0' on a number strip). `image[]` wins on id collision —
    // matches beatoraja's own resolver.
    for (const value of normalizeBeatorajaImages(options.skin.value)) {
      if (!imageById.has(value.id)) {
        imageById.set(value.id, value);
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
  }

  private buildTextEntry(group: BeatorajaDestinationGroup, element: BeatorajaTextElement): TextEntry {
    const text = new Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fontSize: element.size,
        fill: 0xffffff,
        align: element.align,
      },
      alpha: 0,
    });
    if (element.align === 'center') text.anchor.set(0.5, 0);
    else if (element.align === 'right') text.anchor.set(1, 0);
    this.container.addChild(text);
    return { kind: 'text', group, element, text };
  }

  /**
   * Re-sample every destination at `context.nowMs` and update the matching `Sprite` / `Text`. Call once per frame.
   */
  update(context: BeatorajaRenderContext): void {
    if (this.disposed) return;
    for (const entry of this.entries) {
      const props = destinationToSpriteProps(entry.group, context);
      if (entry.kind === 'image') {
        this.updateImageEntry(entry, context, props);
      } else {
        this.updateTextEntry(entry, props);
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

  private updateTextEntry(entry: TextEntry, props: ReturnType<typeof destinationToSpriteProps>): void {
    const text = entry.text;
    text.visible = props.visible;
    if (!props.visible) return;

    // Skip the assignment when the string hasn't changed — assigning the same string still triggers a Pixi
    // glyph relayout.
    const next = entry.element.ref !== 0 ? (this.resolveTextContent(entry.element.ref) ?? '') : '';
    if (text.text !== next) {
      text.text = next;
    }

    // The destination's `x` is the bounding box's left edge. With `align: center` / `right` the Pixi anchor is
    // 0.5 / 1.0 (set in `buildTextEntry`), so we must add half / full width of the destination box to land on
    // the box's center / right edge respectively. Width / height themselves are intentionally NOT applied —
    // Pixi `Text` auto-sizes to its glyphs and forcing a width via the keyframe rect would scale the type.
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
      if (entry.kind === 'image') {
        entry.sprite.destroy({ children: false, texture: false, textureSource: false });
      } else {
        // Pixi `Text` owns an internal canvas-rendered texture that the cache doesn't track, so we destroy it
        // along with the text container.
        entry.text.destroy({ children: false, texture: true, textureSource: true });
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
