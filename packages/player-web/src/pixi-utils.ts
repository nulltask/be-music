import type { Container } from 'pixi.js';

/**
 * Removes every child of `container` AND destroys each removed
 * child so its renderer-side state is released.
 *
 * Why this exists: Pixi v8's `Container.removeChildren()` only
 * detaches children from the display tree — it does NOT free
 * their underlying renderer resources. A bare `removeChildren()`
 * called once per frame on a hot render loop accumulates orphaned
 * `Graphics` instances (each with an owned `GraphicsContext`) and
 * `Text` instances (each holding a slot in the dynamic glyph
 * atlas). After a few minutes of gameplay the renderer cache
 * grows large enough that the next reconcile / GC stalls the main
 * thread for several seconds — visible to the user as "browser
 * unresponsive" the moment the chart finishes and the result
 * scene tries to spin up.
 *
 * The destroy options below are deliberate:
 *
 * - `children: true` — recurse into any descendants the orphan
 *   may itself own. Most of our hot-loop nodes are leaves, but
 *   skin elements occasionally compose nested sprites.
 * - `context: true` — free the owned `GraphicsContext` for any
 *   `Graphics` child. Without this, the polyline / fallback
 *   measure-line `new Graphics()` allocations leak GPU geometry
 *   buffers each frame.
 * - `texture` / `textureSource` are deliberately omitted (default
 *   `false`). Sprite textures (note atlases, skin sheets) are
 *   long-lived and shared across frames; freeing them here would
 *   blank out subsequent renders.
 *
 * Reach for this whenever a render pass calls
 * `someLayer.removeChildren()` on a container whose children were
 * built fresh that frame. Static stage scaffolding (the scene
 * root, persistent layer containers themselves) doesn't need it.
 */
export function disposeChildren(container: Container): void {
  for (const child of container.removeChildren()) {
    child.destroy({ children: true, context: true });
  }
}
