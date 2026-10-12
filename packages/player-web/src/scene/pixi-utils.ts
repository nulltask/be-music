import { type Container, type Texture } from 'pixi.js';
import { destroyTextureAndRevokeBlobUrl } from '../media/textures.ts';

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

export { ChildPool, LaggedDisposer } from '../skins/pixi-kit/pools.ts';

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

export interface StaggerDestroyTexturesHandle {
  count: number;
  drain: () => void;
  cancel: () => void;
}

/**
 * Drop-in {@link destroyUniqueTextures} replacement that spreads the destroy + blob-revoke calls across multiple
 * frames via the supplied scheduler (typically `Application.ticker.add` / `requestAnimationFrame`). Returns a small
 * handle with the unique texture count plus `drain()` for callers that must finish the queue synchronously before the
 * scheduler can tick again (for example when the owning Pixi Application is being destroyed).
 *
 * Why this exists: the synchronous `destroyUniqueTextures` destroys every texture in one pass, which on a scene
 * transition (gameplay → result) means several hundred `texture.destroy(true)` calls landing in the same frame.
 * Pixi's GL backend issues a `gl.deleteTexture` per call; the driver-side flush adds up to a visible 30–80 ms freeze
 * on the transition, observed as the result splash being late by one or two frames. Spreading the work over ~10
 * frames keeps each frame's destroy pass under the per-frame budget while still releasing the GPU memory within
 * 100–200 ms of dispose() returning. Mirrors the staggered teardown pattern in PixiJS's own `pixijs-performance`
 * guidance.
 *
 * The scheduler signature is the lowest-common-denominator subset of `app.ticker.add` and `requestAnimationFrame`:
 * pass a callback, get a stop function. Callers that don't have a host ticker handy can wrap `requestAnimationFrame`
 * directly. The callback is fired once per frame and receives no arguments.
 *
 * Errors thrown by `destroyTextureAndRevokeBlobUrl` are swallowed so that one corrupted texture doesn't strand the
 * remaining queue; the underlying call already runs the URL revoke before the texture destroy, so a half-finished
 * destroy still releases the blob.
 */
export function staggerDestroyTextures(
  textures: Iterable<Texture | undefined>,
  scheduler: (callback: () => void) => () => void,
  options: { perFrame?: number; destroySource?: boolean } = {},
): StaggerDestroyTexturesHandle {
  const perFrame = Math.max(1, options.perFrame ?? 8);
  const destroySource = options.destroySource ?? true;
  // Flatten + dedupe up-front so the iterable can't generate fresh references between frames (a `Map.values()` view
  // of a Map that's still being mutated would otherwise give us shifting work). Filtering `undefined` here also
  // simplifies the per-frame loop.
  const queue: Texture[] = [];
  const seen = new Set<Texture>();
  for (const texture of textures) {
    if (texture === undefined || seen.has(texture)) continue;
    seen.add(texture);
    queue.push(texture);
  }
  if (queue.length === 0) {
    return { count: 0, drain: () => undefined, cancel: () => undefined };
  }
  let cursor = 0;
  let stopImpl: (() => void) | undefined;
  let stopRequested = false;
  let stopped = false;
  const stopScheduler = (): void => {
    if (stopped) return;
    if (stopImpl === undefined) {
      stopRequested = true;
      return;
    }
    stopped = true;
    stopImpl();
  };
  const destroyBatch = (): void => {
    const end = Math.min(cursor + perFrame, queue.length);
    for (let i = cursor; i < end; i += 1) {
      try {
        destroyTextureAndRevokeBlobUrl(queue[i]!, destroySource);
      } catch {
        // Already destroyed / detached — keep walking the queue so a single corrupted entry doesn't strand the rest.
      }
    }
    cursor = end;
    if (cursor >= queue.length) {
      stopScheduler();
    }
  };
  stopImpl = scheduler(destroyBatch);
  if (stopRequested) {
    stopScheduler();
  }
  return {
    count: queue.length,
    drain: () => {
      while (cursor < queue.length) {
        destroyBatch();
      }
      stopScheduler();
    },
    cancel: stopScheduler,
  };
}
