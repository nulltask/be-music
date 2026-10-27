import { Particle, ParticleContainer, Texture, type Container, type Graphics } from 'pixi.js';

/**
 * Points and short segments drawn as GPU particles instead of `Graphics` geometry.
 *
 * The built-in skins scatter thousands of tiny marks every frame (Synesthesia's floor lattice, dust, and powder). As `Graphics` shapes each one is re-triangulated and re-uploaded per frame, which dominated
 * the skins' frame time and garbage. Here each mark is a {@link Particle} (a 1x1 white texture scaled, rotated, and
 * tinted), kept across frames and only rewritten — no geometry is rebuilt.
 *
 * A layer rides along with an anchor `Graphics` (a pooled graphics the skin acquires in the same order every frame):
 * it sits right after the anchor in the anchor's parent and copies the anchor's blend mode, so its points paint exactly
 * where the anchor's rects would have. Each frame the points written since the last render are shown and the rest are
 * dropped, so a layer whose anchor stops receiving points simply goes empty.
 */
export class PointLayer {
  private readonly container: ParticleContainer;
  private readonly particles: Particle[] = [];
  private cursor = 0;
  private touched = false;
  private shown = 0;

  private readonly anchor: Graphics;
  private readonly texture: Texture;
  /** Position among the anchor's layers; layer `slot` sits `slot + 1` children after the anchor. */
  private readonly slot: number;

  public constructor(anchor: Graphics, texture: Texture = Texture.WHITE, slot = 0) {
    this.anchor = anchor;
    this.texture = texture;
    this.slot = slot;
    this.container = new ParticleContainer({
      dynamicProperties: { position: true, vertex: true, color: true, rotation: true, uvs: false },
    });
    this.container.label = 'particle-layer';
    this.container.onRender = () => this.commit();
  }

  /** Writes one square point (or one copy of the layer's texture) `size` px wide, centred on `(cx, cy)`. */
  public point(cx: number, cy: number, size: number, color: number, alpha: number): void {
    const particle = this.next();
    particle.x = cx;
    particle.y = cy;
    particle.scaleX = size / this.texture.width;
    particle.scaleY = size / this.texture.height;
    particle.rotation = 0;
    this.setColor(particle, color, alpha);
  }

  /** Writes one straight segment from `(x0, y0)` to `(x1, y1)`, `width` px thick (a rotated thin quad). */
  public segment(x0: number, y0: number, x1: number, y1: number, width: number, color: number, alpha: number): void {
    const particle = this.next();
    const dx = x1 - x0;
    const dy = y1 - y0;
    particle.x = (x0 + x1) / 2;
    particle.y = (y0 + y1) / 2;
    particle.scaleX = Math.hypot(dx, dy) / this.texture.width;
    particle.scaleY = width / this.texture.height;
    particle.rotation = Math.atan2(dy, dx);
    this.setColor(particle, color, alpha);
  }

  private setColor(particle: Particle, color: number, alpha: number): void {
    // The renderer reads only `color`; writing it directly skips the `tint` setter's `Color` parse, which ran for every
    // point every frame. The particle's `tint` / `alpha` getters are not kept in step (nothing here reads them).
    const packed = packParticleColor(color, alpha);
    if (particle.color !== packed) particle.color = packed;
  }

  private next(): Particle {
    if (!this.touched) {
      // Once per frame, on its first point: the anchor does not move among its siblings between two points.
      this.attach();
      this.touched = true;
      this.cursor = 0;
    }
    let particle = this.particles[this.cursor];
    if (!particle) {
      particle = new Particle({ texture: this.texture, anchorX: 0.5, anchorY: 0.5 });
      this.particles.push(particle);
    }
    this.cursor += 1;
    return particle;
  }

  /**
   * Keeps the layer right after its anchor (after the anchor's earlier layers), so the anchor's later siblings (HUD
   * panels, text) stay on top.
   */
  private attach(): void {
    const parent: Container | null = this.anchor.parent;
    if (!parent) return;
    if (this.container.parent !== parent) parent.addChild(this.container);
    const target = parent.getChildIndex(this.anchor) + 1 + this.slot;
    if (parent.getChildIndex(this.container) !== target) {
      parent.setChildIndex(this.container, Math.min(target, parent.children.length - 1));
    }
    this.container.blendMode = this.anchor.blendMode;
    this.container.visible = this.anchor.visible;
  }

  /** Runs just before the container renders: shows this frame's points and drops the rest. */
  private commit(): void {
    const count = this.touched ? this.cursor : 0;
    if (count !== this.shown) {
      const children = this.container.particleChildren;
      // The active list is always a prefix of the pool. Preserve its backing storage and unchanged entries.
      const previous = children.length;
      children.length = count;
      for (let index = previous; index < count; index += 1) children[index] = this.particles[index]!;
      this.container.update();
      this.shown = count;
    }
    this.touched = false;
    this.cursor = 0;
  }
}

/**
 * A particle's packed `color` for an `0xRRGGBB` tint and an alpha, as Pixi's `Particle` computes it from `tint` and
 * `alpha` (BGR in the low 24 bits, the alpha byte above, added as Pixi adds them).
 */
export function packParticleColor(rgb: number, alpha: number): number {
  const bgr = ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
  return bgr + (((Math.min(Math.max(alpha, 0), 1) * 255) | 0) << 24);
}

const LAYERS = new WeakMap<Graphics, Map<Texture, PointLayer>>();

/**
 * The particle layer riding along with `anchor` that draws `texture` (Pixi's 1x1 white by default), created on first
 * use. A particle container batches a single texture, so each texture gets its own layer; an anchor's layers stack in
 * the order they were first asked for.
 */
export function pointLayerFor(anchor: Graphics, texture: Texture = Texture.WHITE): PointLayer {
  let layers = LAYERS.get(anchor);
  if (!layers) {
    layers = new Map();
    LAYERS.set(anchor, layers);
  }
  let layer = layers.get(texture);
  if (!layer) {
    layer = new PointLayer(anchor, texture, layers.size);
    layers.set(texture, layer);
  }
  return layer;
}
