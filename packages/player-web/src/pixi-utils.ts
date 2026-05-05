import { Graphics, Sprite, Text, type Container, type Texture } from 'pixi.js';
import { destroyTextureAndRevokeBlobUrl } from './lr2-textures.ts';

/**
 * Removes every child of `container` AND destroys each removed child so its renderer-side state is released.
 *
 * Why this exists: Pixi v8's `Container.removeChildren()` only detaches children from the display tree — it does NOT
 * free their underlying renderer resources. A bare `removeChildren()` called once per frame on a hot render loop
 * accumulates orphaned `Graphics` instances (each with an owned `GraphicsContext`) and `Text` instances (each holding a
 * slot in the dynamic glyph atlas). After a few minutes of gameplay the renderer cache grows large enough that the next
 * reconcile / GC stalls the main thread for several seconds — visible to the user as "browser unresponsive" the moment
 * the chart finishes and the result scene tries to spin up.
 *
 * The destroy options below are deliberate:
 *
 * - `children: true` — recurse into any descendants the orphan may itself own. Most of our hot-loop nodes are leaves,
 *   but skin elements occasionally compose nested sprites.
 * - `context: true` — free the owned `GraphicsContext` for any `Graphics` child. Without this, the polyline / fallback
 *   measure-line `new Graphics()` allocations leak GPU geometry buffers each frame.
 * - `texture` / `textureSource` are deliberately omitted (default `false`). Sprite textures (note atlases, skin sheets)
 *   are long-lived and shared across frames; freeing them here would blank out subsequent renders.
 *
 * Reach for this whenever a render pass calls `someLayer.removeChildren()` on a container whose children were built
 * fresh that frame. Static stage scaffolding (the scene root, persistent layer containers themselves) doesn't need it.
 */
export function disposeChildren(container: Container): void {
  for (const child of container.removeChildren()) {
    child.destroy({ children: true, context: true });
  }
}

/**
 * Per-frame `Sprite` / `Graphics` / `Text` recycler for a single `Container` layer.
 *
 * The render pass calls `begin()` to reset the cursor, then `acquireSprite()` / `acquireGraphics()` /
 * `acquireText()` for each child it wants to draw. The pool returns a previously-allocated, parented child when
 * possible (just toggling it back to `visible = true`); only when the cursor outruns the pool does it allocate a
 * fresh one and parent it. After the pass, `end()` hides every child the pass didn't claim — so the next render's
 * `begin()` starts from a known clean state without paying the GC cost of `disposeChildren`'s destroy + recreate.
 *
 * Three separate sub-cursors are tracked so a single render pass can mix sprite / graphics / text reuse without one
 * starvation type forcing churn on another. A `Graphics` returned from `acquireGraphics()` is `clear()`ed so the
 * caller starts from a blank canvas; a `Sprite` is *not* reset (the caller owns texture / position / size). Text
 * objects keep their previous `style` to avoid the heavy paragraph-rebuild cost; the caller updates `text` (and
 * `style` only if it actually changed).
 *
 * The pool's lifetime is tied to its owning layer — the layer's parent view's `dispose()` should call `destroy()`
 * here too, which destroys every pooled child.
 */
export class ChildPool {
  private readonly sprites: Sprite[] = [];
  private spriteCursor = 0;
  private readonly graphics: Graphics[] = [];
  private graphicsCursor = 0;
  private readonly texts: Text[] = [];
  private textCursor = 0;
  /**
   * Per-bucket count of consecutive frames where the bucket's high-water mark exceeded its actual usage by more than
   * {@link CHILD_POOL_TRIM_SLACK}. When the count crosses {@link CHILD_POOL_TRIM_AFTER_FRAMES} we shrink the bucket
   * back down to `cursor + CHILD_POOL_TRIM_SLACK` and reset the counter. Tracked separately per bucket so a still-hot
   * sprite cursor doesn't keep an unused text tail pinned (and vice-versa).
   */
  private idleFramesSprites = 0;
  private idleFramesGraphics = 0;
  private idleFramesTexts = 0;

  public constructor(private readonly layer: Container) {}

  /** Resets every cursor. Call once at the top of every render pass. */
  public begin(): void {
    this.spriteCursor = 0;
    this.graphicsCursor = 0;
    this.textCursor = 0;
  }

  /**
   * Returns a parented `Sprite` ready to receive `texture` / `position` / `width` / `height` / `tint` / `alpha`
   * updates. Reuses an existing pooled sprite when possible; allocates and parents a fresh one when the pool is
   * exhausted. **The caller must overwrite every property they care about** — values left over from a previous
   * pass are not cleared (and resetting them all would defeat the perf win pooling exists for).
   */
  public acquireSprite(): Sprite {
    let sprite = this.sprites[this.spriteCursor];
    if (!sprite) {
      sprite = new Sprite();
      this.layer.addChild(sprite);
      this.sprites.push(sprite);
    }
    // Keep `tint` / `alpha` reset so a previous pass's coloured / faded sprite doesn't leak into a fresh draw.
    sprite.visible = true;
    sprite.tint = 0xffffff;
    sprite.alpha = 1;
    sprite.rotation = 0;
    sprite.skew.set(0, 0);
    sprite.anchor.set(0, 0);
    sprite.label = '';
    this.spriteCursor += 1;
    return sprite;
  }

  /**
   * Returns a parented, *cleared* `Graphics` ready for the caller's draw commands. Same recycle rules as
   * `acquireSprite`; the only auto-reset is `clear()` (so the previous pass's geometry is gone) plus
   * `tint / alpha / position / scale` so a moved / coloured graphic from a prior pass doesn't carry over.
   */
  public acquireGraphics(): Graphics {
    let graphics = this.graphics[this.graphicsCursor];
    if (!graphics) {
      graphics = new Graphics();
      this.layer.addChild(graphics);
      this.graphics.push(graphics);
    }
    graphics.clear();
    graphics.visible = true;
    graphics.tint = 0xffffff;
    graphics.alpha = 1;
    graphics.position.set(0, 0);
    graphics.scale.set(1, 1);
    graphics.rotation = 0;
    graphics.label = '';
    this.graphicsCursor += 1;
    return graphics;
  }

  /**
   * Returns a parented `Text` ready to receive `text` (and optionally `style`) updates. Text objects are reused
   * verbatim — re-assigning the same `style` triggers Pixi's paragraph rebuild, so callers should update `style`
   * only when something actually changed.
   */
  public acquireText(): Text {
    let text = this.texts[this.textCursor];
    if (!text) {
      text = new Text();
      this.layer.addChild(text);
      this.texts.push(text);
    }
    text.visible = true;
    text.tint = 0xffffff;
    text.alpha = 1;
    text.rotation = 0;
    text.anchor.set(0, 0);
    text.label = '';
    this.textCursor += 1;
    return text;
  }

  /**
   * Hides every pooled child the current pass didn't acquire, and idle-decay-shrinks each bucket whose high-water
   * mark hasn't been touched recently. Call once at the bottom of every render pass.
   *
   * Without the shrink, a single peak frame (e.g. a transition where dozens of skin sprites are visible at once) would
   * pin the bucket's allocation for the rest of the scene's lifetime; downstream sections of the chart that draw far
   * fewer children would still pay the memory cost. The decay is intentionally gentle — the bucket has to underflow by
   * more than {@link CHILD_POOL_TRIM_SLACK} for {@link CHILD_POOL_TRIM_AFTER_FRAMES} consecutive frames before any
   * children are destroyed — so a noisy frame-to-frame range (e.g. between bombs and no-bombs) never triggers the
   * shrink. When it does fire, the bucket is trimmed back to `cursor + slack`; subsequent peaks just allocate fresh
   * children, paying a one-frame allocation cost in exchange for the steady-state memory saving.
   */
  public end(): void {
    for (let i = this.spriteCursor; i < this.sprites.length; i++) {
      this.sprites[i]!.visible = false;
    }
    for (let i = this.graphicsCursor; i < this.graphics.length; i++) {
      this.graphics[i]!.visible = false;
    }
    for (let i = this.textCursor; i < this.texts.length; i++) {
      this.texts[i]!.visible = false;
    }
    this.idleFramesSprites = trimIdleBucket(this.sprites, this.spriteCursor, this.idleFramesSprites);
    this.idleFramesGraphics = trimIdleBucket(this.graphics, this.graphicsCursor, this.idleFramesGraphics);
    this.idleFramesTexts = trimIdleBucket(this.texts, this.textCursor, this.idleFramesTexts);
  }

  /**
   * Returns the bucket's currently-allocated child count for debugging / telemetry. The cursor is omitted on purpose;
   * call sites only need the underlying capacity.
   */
  public size(): { sprites: number; graphics: number; texts: number } {
    return { sprites: this.sprites.length, graphics: this.graphics.length, texts: this.texts.length };
  }

  /** Destroys every pooled child (and `clear()`s every Graphics' context). Call from the owner's `dispose()`. */
  public destroy(): void {
    for (const sprite of this.sprites) {
      try {
        sprite.destroy();
      } catch {
        // Already destroyed / detached — both terminal states.
      }
    }
    for (const graphics of this.graphics) {
      try {
        graphics.destroy({ context: true });
      } catch {
        // ditto
      }
    }
    for (const text of this.texts) {
      try {
        text.destroy();
      } catch {
        // ditto
      }
    }
    this.sprites.length = 0;
    this.graphics.length = 0;
    this.texts.length = 0;
    this.spriteCursor = 0;
    this.graphicsCursor = 0;
    this.textCursor = 0;
    this.idleFramesSprites = 0;
    this.idleFramesGraphics = 0;
    this.idleFramesTexts = 0;
  }
}

/**
 * Number of consecutive underutilized frames before the {@link ChildPool} shrinks the affected bucket. ~5 s at 60 fps —
 * long enough that frame-to-frame noise never fires the shrink, short enough that a section of the chart that stops
 * spawning bombs / particles releases its peak allocation while it's still paused.
 */
const CHILD_POOL_TRIM_AFTER_FRAMES = 300;
/**
 * Slack kept above the cursor when the {@link ChildPool} shrinks a bucket. Avoids re-allocating a child the very next
 * frame after a one-frame valley between two peaks; also amortises the shrink/grow cycle if the chart keeps the cursor
 * within a small band around its trim target.
 */
const CHILD_POOL_TRIM_SLACK = 8;

/**
 * Per-bucket helper for {@link ChildPool.end}: increments the idle-frame counter when the bucket is over-allocated by
 * more than {@link CHILD_POOL_TRIM_SLACK}, fires the destroy + tail-pop when the counter crosses
 * {@link CHILD_POOL_TRIM_AFTER_FRAMES}, and resets the counter as soon as utilization comes back up. Returns the new
 * counter value so the caller can persist it on the pool.
 */
function trimIdleBucket<T extends Sprite | Graphics | Text>(bucket: T[], cursor: number, idleFrames: number): number {
  if (bucket.length <= cursor + CHILD_POOL_TRIM_SLACK) {
    return 0;
  }
  const next = idleFrames + 1;
  if (next < CHILD_POOL_TRIM_AFTER_FRAMES) {
    return next;
  }
  const target = cursor + CHILD_POOL_TRIM_SLACK;
  while (bucket.length > target) {
    const child = bucket.pop()!;
    try {
      // `Graphics` needs `context: true` to free its owned `GraphicsContext` (matches the destroy options used by
      // {@link ChildPool.destroy}). For Sprite / Text the default options are correct.
      if (child instanceof Graphics) {
        child.destroy({ context: true });
      } else {
        child.destroy();
      }
    } catch {
      // Already destroyed / detached — both terminal states; nothing to do.
    }
  }
  return 0;
}

export function destroyUniqueTextures(textures: Iterable<Texture | undefined>, destroySource = true): number {
  const destroyed = new Set<Texture>();
  for (const texture of textures) {
    if (texture === undefined || destroyed.has(texture)) continue;
    destroyed.add(texture);
    // `destroyTextureAndRevokeBlobUrl` is `texture.destroy(destroySource)` plus a revoke of any blob URL the texture
    // was decoded from. The LR2 skin asset loader stamps the URL onto the texture via `attachBlobUrlToTexture`, so
    // disposing through this helper releases both the GPU resource AND the in-memory blob the URL was holding open.
    destroyTextureAndRevokeBlobUrl(texture, destroySource);
  }
  return destroyed.size;
}
