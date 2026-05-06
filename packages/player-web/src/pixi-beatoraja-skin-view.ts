// Minimal PixiJS view for a beatoraja skin.
//
// This is the static-paint layer: every `image[]` + `destination[]` pair becomes a `Sprite` on a single `Container`,
// and `update(context)` repositions / re-tints / re-blends each sprite from the destination keyframes. Animated
// images (`divx` / `divy` cells, `cycle`-based animation, `ref`/`len` op-driven frame selection) are honored too —
// the cached cropped texture is swapped each tick when the frame index changes.
//
// What this view DOESN'T do (left for follow-up patches):
//
// - Note rendering (the `note` field's playable-note layout).
// - Engine-driven runtime ops (combo / score / lamp updates, judge flashes, key-on flashes, key beams).
// - BGA video / image tracks.
// - Text / value / slider / bargraph elements (only `image[]` + `destination[]` are wired).
//
// Once the gameplay engine signals are available, the same Container is reused — additional per-element children
// (notes, judge sprites, etc.) can be appended without rebuilding the destination list.

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
    // `value[]` declarations share the `id / src / x / y / w / h / divx / divy` shape with `image[]` — the only
    // extras (`digit / padding / align / ref`) are number-formatting hints that the renderer can ignore at this
    // stage. Treating each value declaration as an image-like source lets the destination targeting it pick up the
    // matching texture and paint a placeholder digit (cell 0 of the source sheet — typically '0'). When the engine
    // wiring lands later, the `digit` / `align` / `ref` fields will drive the actual numeric layout.
    //
    // `image[]` wins on id collisions because authors sometimes alias the two — keeping image as the canonical
    // declaration matches beatoraja's own resolver.
    for (const value of normalizeBeatorajaImages(options.skin.value)) {
      if (!imageById.has(value.id)) {
        imageById.set(value.id, value);
      }
    }
    // `text[]` declarations carry no source rect; they pair a font/size/ref with a string the runtime resolves at
    // render time. We don't yet load the skin's TTFs (engine integration will fold those in along with the dynamic
    // string lookups), so the placeholders below render with the browser's default sans-serif font and an empty
    // string — enough to put each text destination on screen at the correct position with the matching size.
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
      // Pre-bind the sprite's texture to the cell-0 cropped frame at construction time. Building the sub-texture
      // here (rather than lazily inside `update()`) ensures the sprite's texture is registered with PixiJS before
      // the first render pass executes.
      //
      // CRITICAL: we mount sprites with `visible = true` (the Pixi default) and `alpha = 0` instead of starting
      // them at `visible = false`. PixiJS v8's WebGPU and WebGL2 batchers BOTH skip texture-binding setup for
      // `visible: false` sprites on the first render pass. The next frame, when our `update()` flips them to
      // `visible: true`, every still-unbound source rushes the bind-group cache in parallel and one of them hits
      // a half-initialized slot — surfacing as `Cannot read properties of null (reading 'textureSource1')` on
      // WebGPU and `(reading 'addressModeU')` on WebGL2.
      //
      // The LR2 renderer dodges this accidentally: `pixi-select.ts` mounts sprites with `new Sprite(cropped)`
      // (default `visible = true`) and the destinations whose `op` codes don't match are simply painted with an
      // already-bound texture but at off-screen positions. The first frame's render pass therefore primes every
      // bind group, and subsequent visibility flips reuse the cached binding.
      //
      // Mirroring that here: keep `visible = true`, force `alpha = 0` so nothing reaches the screen until
      // `update()` overwrites it with the destination keyframe's actual alpha.
      const baseIsBindable =
        baseTexture !== undefined && baseTexture !== Texture.EMPTY;
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

  /**
   * Build a placeholder Pixi `Text` for a text-targeting destination. Uses the browser's default sans-serif at
   * the declared font size; the actual TTF bundled in the skin is honored once the host has registered fonts via
   * `FontFace`. Position and alpha are driven by the destination keyframe in `update()`, same as image sprites.
   */
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

    // Without a base texture (or with `Texture.EMPTY`, whose source has no GPU resource) we have nothing to
    // paint. Keep the sprite hidden so the renderer never tries to bind a sourceless texture for a draw call —
    // WebGPU crashes with `Cannot read properties of null (reading 'textureSource1')` when batching tries to
    // bind a sprite whose texture has no GPU source attached.
    const baseTexture = entry.baseTexture;
    if (baseTexture === undefined || baseTexture === Texture.EMPTY) {
      sprite.visible = false;
      return;
    }

    sprite.visible = props.visible;
    if (!props.visible) return;

    // Pick the source-cell index. `ref` (op-driven frame) takes precedence — that's how lamp / judge-icon
    // textures swap between cells. Otherwise the `cycle`-based animation drives the frame.
    const frameIndex =
      entry.image.ref !== 0
        ? imageRefFrame(entry.image, this.resolveRefValue(entry.image.ref))
        : imageFrameAt(entry.image, computeAnimationElapsed(entry, context));

    if (frameIndex !== entry.currentFrame) {
      const cell = imageFrameRect(entry.image, frameIndex);
      const cropped = createCroppedBeatorajaTexture(entry.baseTexture, cell);
      if (cropped !== undefined) {
        sprite.texture = cropped;
      } else {
        // Cropped rect was empty (e.g. cell width / height resolves to 0). Hide rather than render the EMPTY
        // texture, which would also trigger the WebGPU `textureSource1` crash above.
        sprite.visible = false;
        return;
      }
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

  private updateTextEntry(
    entry: TextEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
  ): void {
    const text = entry.text;
    text.visible = props.visible;
    if (!props.visible) return;

    // Refresh the displayed string via the host-provided resolver. The empty fallback keeps the layout silent
    // when the engine isn't wired in yet. Skipping the assignment when the string hasn't changed lets PixiJS
    // reuse the cached glyph atlas — assigning the same string still triggers a relayout otherwise.
    const next = entry.element.ref !== 0 ? this.resolveTextContent(entry.element.ref) ?? '' : '';
    if (text.text !== next) {
      text.text = next;
    }

    // Position from the destination keyframe. Width/height intentionally NOT applied — Pixi `Text` auto-sizes
    // to its rendered glyphs, and forcing a width via the keyframe rect would scale the type. The destination's
    // `w / h` are bounding-box hints that beatoraja uses for clipping; we'll honor them once the engine plugs
    // real strings in and clipping starts to matter.
    text.x = props.x;
    text.y = props.y;
    text.alpha = props.alpha;
    text.tint = props.tint;
    text.angle = props.angle;
    text.blendMode = props.blendMode;
  }

  /**
   * Tear down sprites and the container. Textures themselves are owned by the {@link BeatorajaTextureCache} and
   * are NOT destroyed here — the cache is intentionally long-lived (no `dispose()` method by design).
   */
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
