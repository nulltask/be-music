import { hash01 } from '../phantom-style.ts';

/**
 * Pure 3D helpers for the Synesthesia skin: a pinhole projection, deterministic particle bursts, a looping starfield,
 * point-cloud shapes (pyramids, a human figure), particle rivers, and ember / hue-based colour. Everything is a
 * function of (seed, time) so the pooled per-frame redraw needs no particle state and never shimmers.
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

/** One point of a point-cloud shape: a position plus a per-point size / brightness weight in [0.3, 1]. */
export interface CloudPoint extends Vec3 {
  weight: number;
}

/**
 * Ember → gold → white-hot ramp for `t` in 0..1 (clamped) — the warm light that dominates Rez Infinite's particle
 * worlds. Low `t` is a deep red-orange ember, high `t` a pale gold flare.
 */
export function emberColor(t: number): number {
  const stops: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 0xb8, 0x2c, 0x08],
    [0.35, 0xff, 0x66, 0x12],
    [0.65, 0xff, 0xaa, 0x30],
    [0.85, 0xff, 0xd8, 0x86],
    [1, 0xff, 0xf6, 0xe2],
  ];
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  let index = 1;
  while (index < stops.length - 1 && clamped > stops[index]![0]) index += 1;
  const [t0, r0, g0, b0] = stops[index - 1]!;
  const [t1, r1, g1, b1] = stops[index]!;
  const f = (clamped - t0) / (t1 - t0);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
  return (mix(r0, r1) << 16) | (mix(g0, g1) << 8) | mix(b0, b1);
}

/**
 * Square pyramid as a point cloud: base half-width 1 on `y = 0`, apex at `y = -1.3` (screen up). Four in ten points
 * sit on the edges so the silhouette reads crisply; the rest scatter over the four faces. Deterministic for `seed`.
 */
export function pointCloudPyramid(seed: number, count: number): CloudPoint[] {
  const apex: Vec3 = { x: 0, y: -1.3, z: 0 };
  const corners: Vec3[] = [
    { x: -1, y: 0, z: -1 },
    { x: 1, y: 0, z: -1 },
    { x: 1, y: 0, z: 1 },
    { x: -1, y: 0, z: 1 },
  ];
  const points: CloudPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = seed * 131 + index * 17;
    const face = Math.floor(hash01(base + 1) * 4) % 4;
    const a = corners[face]!;
    const b = corners[(face + 1) % 4]!;
    const weight = 0.3 + 0.7 * hash01(base + 4);
    if (hash01(base + 2) < 0.4) {
      // Edge point: either a side edge (corner → apex) or a base edge.
      const along = hash01(base + 3);
      const from = hash01(base + 5) < 0.7 ? apex : b;
      points.push({ ...lerp3(a, from, along), weight: Math.min(1, weight + 0.25) });
      continue;
    }
    // Face point via uniform barycentric sampling of the triangle (a, b, apex).
    let u = hash01(base + 3);
    let v = hash01(base + 5);
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    points.push({
      x: a.x + (b.x - a.x) * u + (apex.x - a.x) * v,
      y: a.y + (b.y - a.y) * u + (apex.y - a.y) * v,
      z: a.z + (b.z - a.z) * u + (apex.z - a.z) * v,
      weight,
    });
  }
  return points;
}

/**
 * A floating human figure as a point cloud — Rez's particle avatar. Roughly 2 units tall (head top at `y ≈ -1`,
 * feet at `y ≈ 1`), arms spread slightly down and out, legs trailing as if drifting. Points scatter inside capsules
 * along each limb, weighted by limb volume. Deterministic for `seed`.
 */
export function pointCloudHumanoid(seed: number, count: number): CloudPoint[] {
  const points: CloudPoint[] = [];
  const totalWeight = HUMANOID_LIMBS.reduce((sum, limb) => sum + limb.volume, 0);
  for (let index = 0; index < count; index += 1) {
    const base = seed * 151 + index * 19;
    let pick = hash01(base + 1) * totalWeight;
    let limb = HUMANOID_LIMBS[HUMANOID_LIMBS.length - 1]!;
    for (const candidate of HUMANOID_LIMBS) {
      pick -= candidate.volume;
      if (pick <= 0) {
        limb = candidate;
        break;
      }
    }
    const centre = lerp3(limb.from, limb.to, hash01(base + 2));
    // Random direction inside the capsule; sqrt biases toward the surface so the body reads as a shell of light.
    const cosTheta = 1 - 2 * hash01(base + 3);
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = Math.PI * 2 * hash01(base + 4);
    const r = limb.radius * Math.sqrt(hash01(base + 5));
    points.push({
      x: centre.x + sinTheta * Math.cos(phi) * r,
      y: centre.y + cosTheta * r,
      z: centre.z + sinTheta * Math.sin(phi) * r,
      weight: 0.3 + 0.7 * hash01(base + 6),
    });
  }
  return points;
}

const HUMANOID_LIMBS: ReadonlyArray<{ from: Vec3; to: Vec3; radius: number; volume: number }> = (
  [
    // [from, to, radius]
    [{ x: 0, y: -0.86, z: 0 }, { x: 0, y: -0.8, z: 0 }, 0.13], // head
    [{ x: 0, y: -0.66, z: 0 }, { x: 0, y: -0.12, z: 0.02 }, 0.17], // torso
    [{ x: -0.1, y: -0.12, z: 0 }, { x: 0.1, y: -0.12, z: 0 }, 0.13], // hips
    [{ x: -0.2, y: -0.62, z: 0 }, { x: -0.46, y: -0.32, z: 0.05 }, 0.06], // left upper arm
    [{ x: -0.46, y: -0.32, z: 0.05 }, { x: -0.66, y: -0.02, z: 0.12 }, 0.05], // left forearm
    [{ x: 0.2, y: -0.62, z: 0 }, { x: 0.46, y: -0.34, z: -0.04 }, 0.06], // right upper arm
    [{ x: 0.46, y: -0.34, z: -0.04 }, { x: 0.7, y: -0.1, z: -0.1 }, 0.05], // right forearm
    [{ x: -0.1, y: -0.06, z: 0 }, { x: -0.18, y: 0.42, z: 0.1 }, 0.08], // left thigh
    [{ x: -0.18, y: 0.42, z: 0.1 }, { x: -0.22, y: 0.94, z: 0.24 }, 0.06], // left shin
    [{ x: 0.1, y: -0.06, z: 0 }, { x: 0.14, y: 0.4, z: -0.08 }, 0.08], // right thigh
    [{ x: 0.14, y: 0.4, z: -0.08 }, { x: 0.2, y: 0.9, z: 0.06 }, 0.06], // right shin
  ] as const
).map(([from, to, radius]) => {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  return { from, to, radius, volume: (length + radius) * radius * radius };
});

/**
 * Particle `index` of a flowing river of light, in river-local space: it travels along `x` from `-length / 2` to
 * `length / 2` at `speed` units/s (looping), weaving on a slow sine, with a fixed per-particle offset across the
 * stream so the river has body. Deterministic for (`index`, `seconds`).
 */
export function particleRiverPoint(
  index: number,
  seconds: number,
  options: { length: number; speed: number; amplitude: number; width: number; seed?: number },
): Vec3 {
  const base = (options.seed ?? 0) * 211 + index * 23;
  const along = (hash01(base + 1) + (seconds * options.speed) / options.length) % 1;
  const x = (along - 0.5) * options.length;
  // Sum of two uniforms ≈ triangular spread: dense core, feathered edges.
  const across = (hash01(base + 2) + hash01(base + 3) - 1) * options.width;
  const depth = (hash01(base + 4) + hash01(base + 5) - 1) * options.width;
  const wave = Math.sin(along * Math.PI * 2 * 1.5 + seconds * 0.6 + (options.seed ?? 0)) * options.amplitude;
  return { x, y: wave + across, z: depth };
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * A camera pose for the background 3D space: an offset of the eye (`x` right, `y` down, `z` forward) plus `yaw`
 * (positive turns right) and `pitch` (positive looks down), in radians.
 */
export interface CameraPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export const REST_CAMERA: CameraPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

/**
 * The camera at `seconds` for a looping sequence of `shots`: each shot holds for `holdSeconds`, then the camera flies
 * to the next one over `moveSeconds` with a smoothstep ease, wrapping back to the first shot at the end.
 */
export function cameraShot(
  seconds: number,
  shots: readonly CameraPose[],
  holdSeconds: number,
  moveSeconds: number,
): CameraPose {
  if (shots.length === 0) return REST_CAMERA;
  const time = Number.isFinite(seconds) ? seconds : 0;
  const cycle = holdSeconds + moveSeconds;
  const step = Math.floor(time / cycle);
  const local = time - step * cycle;
  const index = ((step % shots.length) + shots.length) % shots.length;
  const from = shots[index]!;
  const to = shots[(index + 1) % shots.length]!;
  const raw = local <= holdSeconds || moveSeconds <= 0 ? 0 : (local - holdSeconds) / moveSeconds;
  return mixCamera(from, to, raw * raw * (3 - 2 * raw));
}

/** Blend between two poses (`t` = 0 → `from`, 1 → `to`); `mixCamera(REST_CAMERA, pose, 0.5)` halves a move. */
export function mixCamera(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    z: mix(from.z, to.z),
    yaw: mix(from.yaw, to.yaw),
    pitch: mix(from.pitch, to.pitch),
  };
}

/**
 * World `point` seen from `camera`: translate by the eye offset, then turn by yaw / pitch about a pivot `orbit` units
 * ahead (0 turns the camera in place; a positive value circles the camera around a subject at that depth).
 */
export function viewPoint(point: Vec3, camera: CameraPose, orbit = 0): Vec3 {
  const local = { x: point.x - camera.x, y: point.y - camera.y, z: point.z - camera.z - orbit };
  const turned = rotateX(rotateY(local, -camera.yaw), camera.pitch);
  return { x: turned.x, y: turned.y, z: turned.z + orbit };
}

/** Screen position of the direction straight ahead in world space (+z) — where the floor's horizon and warp meet. */
export function vanishingPoint(camera: CameraPose, cx: number, cy: number, focal: number): { x: number; y: number } {
  const direction = rotateX(rotateY({ x: 0, y: 0, z: 1 }, -camera.yaw), camera.pitch);
  if (direction.z <= 1e-6) return { x: cx, y: cy };
  return { x: cx + (direction.x / direction.z) * focal, y: cy + (direction.y / direction.z) * focal };
}
