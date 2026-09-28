import { hash01 } from '../phantom-style.ts';

/**
 * Pure 3D helpers for the Synesthesia skin: a pinhole projection, deterministic particle bursts, a looping starfield,
 * a wireframe icosahedron, and hue-based colour. Everything is a function of (seed, time) so the pooled per-frame
 * redraw needs no particle state and never shimmers.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Perspective scale at this depth (1 at `z = 0`). */
  scale: number;
  /** False when the point is behind the camera. */
  visible: boolean;
}

/**
 * Pinhole projection. The camera sits at `z = -focal` looking down +z, so a point at `z = 0` projects 1:1 around the
 * origin `(cx, cy)`; larger `z` recedes toward the vanishing point and shrinks.
 */
export function projectPoint(point: Vec3, cx: number, cy: number, focal: number): Projected {
  const depth = focal + point.z;
  if (depth <= 1e-3) {
    return { x: cx, y: cy, scale: 0, visible: false };
  }
  const scale = focal / depth;
  return { x: cx + point.x * scale, y: cy + point.y * scale, scale, visible: true };
}

export function rotateY(point: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos + point.z * sin, y: point.y, z: -point.x * sin + point.z * cos };
}

export function rotateX(point: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x, y: point.y * cos - point.z * sin, z: point.y * sin + point.z * cos };
}

export interface BurstParticle {
  /** Unit-ish launch direction (upper hemisphere biased). */
  direction: Vec3;
  /** Launch speed multiplier in [0.35, 1]. */
  speed: number;
  /** Size multiplier in [0.4, 1]. */
  size: number;
  /** Hue offset in [-0.08, 0.08] around the burst's base hue. */
  hueShift: number;
  /** Lifetime fraction in [0.55, 1] — some sparks burn out early. */
  life: number;
}

/**
 * `count` burst particles on a sphere, deterministic for `seed`. Directions are biased upward (screen −y) so a hit
 * reads as sparks thrown off the judgement line rather than a symmetric puff.
 */
export function burstParticles(seed: number, count: number): BurstParticle[] {
  const particles: BurstParticle[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = seed * 97 + index * 13;
    // Uniform sphere sampling via (cos θ, φ), then squash the lower hemisphere.
    const cosTheta = 1 - 2 * hash01(base + 1);
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = Math.PI * 2 * hash01(base + 2);
    const rawY = cosTheta;
    particles.push({
      direction: {
        x: sinTheta * Math.cos(phi),
        y: rawY > 0 ? -rawY : rawY * -0.35,
        z: sinTheta * Math.sin(phi),
      },
      speed: 0.35 + 0.65 * hash01(base + 3),
      size: 0.4 + 0.6 * hash01(base + 4),
      hueShift: (hash01(base + 5) - 0.5) * 0.16,
      life: 0.55 + 0.45 * hash01(base + 6),
    });
  }
  return particles;
}

/**
 * Position of burst particle `particle` at normalized time `t` (0..1): ease-out launch with drag, plus a little
 * gravity pulling sparks back down late in their life.
 */
export function burstParticlePosition(particle: BurstParticle, t: number, radius: number, gravity: number): Vec3 {
  const clamped = Math.max(0, Math.min(1, t));
  const travel = (1 - (1 - clamped) ** 3) * radius * particle.speed;
  return {
    x: particle.direction.x * travel,
    y: particle.direction.y * travel + gravity * clamped * clamped,
    z: particle.direction.z * travel,
  };
}

/**
 * Star `index` of a looping starfield flying toward the camera. Depth cycles over `[near, far]` at `speed` units/s;
 * lateral position is a fixed per-star spread in `[-spread, spread]`.
 */
export function starfieldPoint(
  index: number,
  seconds: number,
  options: { spread: number; near: number; far: number; speed: number },
): Vec3 {
  const span = options.far - options.near;
  const phase = hash01(index * 7 + 3) * span;
  const z = options.far - ((seconds * options.speed + phase) % span);
  return {
    x: (hash01(index * 7 + 1) * 2 - 1) * options.spread,
    y: (hash01(index * 7 + 2) * 2 - 1) * options.spread * 0.62,
    z,
  };
}

/** Unit icosahedron: 12 vertices and its 30 edges (vertex index pairs). */
export function icosahedron(): { vertices: Vec3[]; edges: Array<readonly [number, number]> } {
  const golden = (1 + Math.sqrt(5)) / 2;
  const raw: Array<readonly [number, number, number]> = [
    [-1, golden, 0],
    [1, golden, 0],
    [-1, -golden, 0],
    [1, -golden, 0],
    [0, -1, golden],
    [0, 1, golden],
    [0, -1, -golden],
    [0, 1, -golden],
    [golden, 0, -1],
    [golden, 0, 1],
    [-golden, 0, -1],
    [-golden, 0, 1],
  ];
  const norm = Math.hypot(1, golden);
  const vertices = raw.map(([x, y, z]) => ({ x: x / norm, y: y / norm, z: z / norm }));
  const edges: Array<readonly [number, number]> = [];
  const edgeLength = 2 / norm;
  for (let a = 0; a < vertices.length; a += 1) {
    for (let b = a + 1; b < vertices.length; b += 1) {
      const va = vertices[a]!;
      const vb = vertices[b]!;
      if (Math.abs(Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z) - edgeLength) < 1e-6) {
        edges.push([a, b]);
      }
    }
  }
  return { vertices, edges };
}

/** HSV (all in 0..1, hue wrapping) to a 0xRRGGBB number. */
export function hsvToHex(hue: number, saturation: number, value: number): number {
  const h = (((hue % 1) + 1) % 1) * 6;
  const s = Math.max(0, Math.min(1, saturation));
  const v = Math.max(0, Math.min(1, value));
  const sector = Math.floor(h);
  const fraction = h - sector;
  const p = v * (1 - s);
  const q = v * (1 - s * fraction);
  const t = v * (1 - s * (1 - fraction));
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][sector % 6]!;
  return (Math.round(r! * 255) << 16) | (Math.round(g! * 255) << 8) | Math.round(b! * 255);
}
