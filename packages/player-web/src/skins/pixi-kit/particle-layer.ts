import { Particle, ParticleContainer, Texture, type Container, type Graphics } from 'pixi.js';

/**
 * Points and short segments drawn as GPU particles instead of `Graphics` geometry.
 *
 * The built-in skins scatter thousands of tiny marks every frame (Synesthesia's floor lattice, dust, and powder;
 * Lattice's needle field). As `Graphics` shapes each one is re-triangulated and re-uploaded per frame, which dominated
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

  public constructor(anchor: Graphics) {
    this.anchor = anchor;
    this.container = new ParticleContainer({
      dynamicProperties: { position: true, vertex: true, color: true, rotation: true, uvs: false },
    });
    this.container.label = 'particle-layer';
    this.container.onRender = () => this.commit();
  }

  /** Writes one square point centred on `(cx, cy)`. */
  public point(cx: number, cy: number, size: number, color: number, alpha: number): void {
    const particle = this.next();
    particle.x = cx;
    particle.y = cy;
    particle.scaleX = size;
    particle.scaleY = size;
    particle.rotation = 0;
    particle.tint = color;
    particle.alpha = alpha;
  }

  /** Writes one straight segment from `(x0, y0)` to `(x1, y1)`, `width` px thick (a rotated thin quad). */
  public segment(x0: number, y0: number, x1: number, y1: number, width: number, color: number, alpha: number): void {
    const particle = this.next();
    const dx = x1 - x0;
    const dy = y1 - y0;
    particle.x = (x0 + x1) / 2;
    particle.y = (y0 + y1) / 2;
    particle.scaleX = Math.hypot(dx, dy);
    particle.scaleY = width;
    particle.rotation = Math.atan2(dy, dx);
    particle.tint = color;
    particle.alpha = alpha;
  }

  private next(): Particle {
    this.attach();
    if (!this.touched) {
      this.touched = true;
      this.cursor = 0;
    }
    let particle = this.particles[this.cursor];
    if (!particle) {
      particle = new Particle({ texture: Texture.WHITE, anchorX: 0.5, anchorY: 0.5 });
      this.particles.push(particle);
    }
    this.cursor += 1;
    return particle;
  }

  /** Keeps the layer right after its anchor, so the anchor's later siblings (HUD panels, text) stay on top. */
  private attach(): void {
    const parent: Container | null = this.anchor.parent;
    if (!parent) return;
    if (this.container.parent !== parent) parent.addChild(this.container);
    const target = parent.getChildIndex(this.anchor) + 1;
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
      children.length = 0;
      for (let index = 0; index < count; index += 1) children.push(this.particles[index]!);
      this.container.update();
      this.shown = count;
    }
    this.touched = false;
    this.cursor = 0;
  }
}

const LAYERS = new WeakMap<Graphics, PointLayer>();

/** The particle layer riding along with `anchor` (created on first use). */
export function pointLayerFor(anchor: Graphics): PointLayer {
  let layer = LAYERS.get(anchor);
  if (!layer) {
    layer = new PointLayer(anchor);
    LAYERS.set(anchor, layer);
  }
  return layer;
}
