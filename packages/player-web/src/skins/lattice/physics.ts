/**
 * Tiny physics for the Lattice skin: a Verlet chain (beads joined by rigid links, pinned at the top — a pendulum or a
 * hanging string that can be kicked), and an analytic bouncing drop with restitution. The chain is stepped in place;
 * the bounce is a pure function of time.
 */

export interface Chain {
  count: number;
  x: Float32Array;
  y: Float32Array;
  /** Previous positions (Verlet velocity is `x - px`). */
  px: Float32Array;
  py: Float32Array;
  /** Rest length of each link. */
  spacing: number;
}

/** A chain of `count` beads hanging straight down from `(anchorX, anchorY)`, `spacing` apart, at rest. */
export function createChain(anchorX: number, anchorY: number, count: number, spacing: number): Chain {
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    x[index] = anchorX;
    y[index] = anchorY + index * spacing;
  }
  return { count, x, y, px: x.slice(), py: y.slice(), spacing };
}

export interface ChainStep {
  anchorX: number;
  anchorY: number;
  /** px / s² downward. */
  gravity: number;
  /** Fraction of velocity kept per 1/60 s (air drag). */
  damping?: number;
  /** Constraint relaxation passes. */
  iterations?: number;
}

/** Advances the chain by `dt` seconds (clamped to 1/30 s): Verlet integration, then link constraints; bead 0 pinned. */
export function stepChain(chain: Chain, dt: number, options: ChainStep): void {
  const step = Math.max(0, Math.min(1 / 30, Number.isFinite(dt) ? dt : 0));
  if (step === 0) return;
  const keep = (options.damping ?? 0.995) ** (step * 60);
  const { x, y, px, py, count, spacing } = chain;
  for (let index = 1; index < count; index += 1) {
    const vx = (x[index]! - px[index]!) * keep;
    const vy = (y[index]! - py[index]!) * keep;
    px[index] = x[index]!;
    py[index] = y[index]!;
    x[index] = x[index]! + vx;
    y[index] = y[index]! + vy + options.gravity * step * step;
  }
  x[0] = options.anchorX;
  y[0] = options.anchorY;
  px[0] = options.anchorX;
  py[0] = options.anchorY;
  const iterations = options.iterations ?? 8;
  for (let pass = 0; pass < iterations; pass += 1) {
    for (let index = 1; index < count; index += 1) {
      const dx = x[index]! - x[index - 1]!;
      const dy = y[index]! - y[index - 1]!;
      const distance = Math.hypot(dx, dy) || 1e-6;
      const correction = (distance - spacing) / distance;
      // The upper bead is pinned (index 0) or shares the correction.
      const upper = index - 1 === 0 ? 0 : 0.5;
      const lower = 1 - upper;
      x[index - 1] = x[index - 1]! + dx * correction * upper;
      y[index - 1] = y[index - 1]! + dy * correction * upper;
      x[index] = x[index]! - dx * correction * lower;
      y[index] = y[index]! - dy * correction * lower;
    }
  }
}

/** Kicks bead `index` with a velocity of (`vx`, `vy`) px/s — e.g. a key press striking the pendulum. */
export function kickChain(chain: Chain, index: number, vx: number, vy: number, dt = 1 / 60): void {
  const bead = Math.max(1, Math.min(chain.count - 1, index));
  chain.px[bead] = chain.px[bead]! - vx * dt;
  chain.py[bead] = chain.py[bead]! - vy * dt;
}

/**
 * Height above the floor (≥ 0) of a ball dropped from `height` at `t` seconds, bouncing with `restitution` (0..1) of
 * its speed kept each impact, under `gravity` px/s². Settles at 0 once the bounces die out.
 */
export function bounceHeight(t: number, height: number, gravity: number, restitution: number): number {
  if (!(t > 0)) return Math.max(0, height);
  if (height <= 0 || gravity <= 0) return 0;
  const fall = Math.sqrt((2 * height) / gravity);
  if (t < fall) return height - 0.5 * gravity * t * t;
  let elapsed = t - fall;
  let speed = gravity * fall * Math.max(0, Math.min(1, restitution));
  for (let bounce = 0; bounce < 12 && speed > 1; bounce += 1) {
    const flight = (2 * speed) / gravity;
    if (elapsed < flight) return Math.max(0, speed * elapsed - 0.5 * gravity * elapsed * elapsed);
    elapsed -= flight;
    speed *= restitution;
  }
  return 0;
}
