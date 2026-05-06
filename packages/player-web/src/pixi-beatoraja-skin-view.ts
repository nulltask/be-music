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

import { Container, Sprite } from 'pixi.js';
import {
  imageFrameAt,
  imageFrameRect,
  imageRefFrame,
  normalizeBeatorajaDestinations,
  normalizeBeatorajaImages,
  type BeatorajaDestinationGroup,
  type BeatorajaImageElement,
  type BeatorajaImageId,
  type BeatorajaSkin,
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
}

interface SpriteEntry {
  group: BeatorajaDestinationGroup;
  image: BeatorajaImageElement;
  /** Base texture (whole source). Sprite's texture is a cropped view of this. */
  baseTexture: ReturnType<BeatorajaTextureCache['get']>;
  sprite: Sprite;
  /** Frame index currently uploaded to `sprite.texture`. -1 means "no texture set yet". */
  currentFrame: number;
}

export class BeatorajaPlaySkinView {
  readonly container = new Container();
  readonly width: number;
  readonly height: number;
  private readonly entries: SpriteEntry[] = [];
  private readonly resolveRefValue: (refOp: number) => number;
  private disposed = false;

  constructor(options: BeatorajaPlaySkinViewOptions) {
    this.width = options.skin.w;
    this.height = options.skin.h;
    this.resolveRefValue = options.resolveRefValue ?? (() => 0);

    const imageById = new Map<BeatorajaImageId, BeatorajaImageElement>();
    for (const image of normalizeBeatorajaImages(options.skin.image)) {
      imageById.set(image.id, image);
    }
    const groups = normalizeBeatorajaDestinations(options.skin.destination);

    // Render order: lower `offset` (back layer) draws first, then by author declaration order. Matches beatoraja's
    // own back-to-front layering.
    groups.sort((a, b) => a.offset - b.offset || a.declarationOrder - b.declarationOrder);

    for (const group of groups) {
      const image = imageById.get(group.id);
      if (image === undefined) continue;
      const baseTexture = options.textures.get(image.src);
      // Build the sprite even when the texture is missing — the runtime might still want to compute layout. Sprite
      // stays invisible (no texture / hidden) and the renderer just skips it on update.
      const sprite = new Sprite({ visible: false });
      this.container.addChild(sprite);
      this.entries.push({ group, image, baseTexture, sprite, currentFrame: -1 });
    }
  }

  /**
   * Re-sample every destination at `context.nowMs` and update the matching `Sprite`. Call once per frame.
   */
  update(context: BeatorajaRenderContext): void {
    if (this.disposed) return;
    for (const entry of this.entries) {
      const props = destinationToSpriteProps(entry.group, context);
      const sprite = entry.sprite;
      sprite.visible = props.visible;
      if (!props.visible) continue;

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
  }

  /**
   * Tear down sprites and the container. Textures themselves are owned by the {@link BeatorajaTextureCache} and are
   * NOT destroyed here — the host calls `textures.dispose()` once it's done with the bundle.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries) {
      entry.sprite.destroy({ children: false, texture: false, textureSource: false });
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
