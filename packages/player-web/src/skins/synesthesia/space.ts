import { hash01 } from '@be-music/skin-sdk';

/**
 * Pure 3D helpers for the Synesthesia skin: a pinhole projection, deterministic particle bursts, a looping starfield,
 * point-cloud shapes (pyramids), orbiting particles for the audio orb, particle rivers, and ember / hue-based colour. Everything is a
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

/** A camera's yaw / pitch sines and cosines, worked out once per frame for {@link projectViewInto}. */
export interface CameraBasis {
  camera: CameraPose;
  cosYaw: number;
  sinYaw: number;
  cosPitch: number;
  sinPitch: number;
}

/** The basis for `camera`, written into `out` (a fresh object when omitted). */
export function cameraBasis(camera: CameraPose, out?: CameraBasis): CameraBasis {
  const basis = out ?? { camera, cosYaw: 1, sinYaw: 0, cosPitch: 1, sinPitch: 0 };
  basis.camera = camera;
  basis.cosYaw = Math.cos(camera.yaw);
  basis.sinYaw = Math.sin(camera.yaw);
  basis.cosPitch = Math.cos(camera.pitch);
  basis.sinPitch = Math.sin(camera.pitch);
  return basis;
}

/**
 * `projectPoint(viewPoint({ x, y, z }, camera, orbit), cx, cy, focal)` without allocating: the result is written into
 * `out`. For the hot loops that project thousands of points a frame.
 */
export function projectViewInto(
  out: Projected,
  x: number,
  y: number,
  z: number,
  basis: CameraBasis,
  cx: number,
  cy: number,
  focal: number,
  orbit = 0,
): Projected {
  const camera = basis.camera;
  const lx = x - camera.x;
  const ly = y - camera.y;
  const lz = z - camera.z - orbit;
  // rotateY by -yaw, then rotateX by pitch (see `viewPoint`).
  const x1 = lx * basis.cosYaw - lz * basis.sinYaw;
  const z1 = lx * basis.sinYaw + lz * basis.cosYaw;
  const y2 = ly * basis.cosPitch - z1 * basis.sinPitch;
  const z2 = ly * basis.sinPitch + z1 * basis.cosPitch + orbit;
  const depth = focal + z2;
  if (depth <= 1e-3) {
    out.x = cx;
    out.y = cy;
    out.scale = 0;
    out.visible = false;
    return out;
  }
  const scale = focal / depth;
  out.x = cx + x1 * scale;
  out.y = cy + y2 * scale;
  out.scale = scale;
  out.visible = true;
  return out;
}

/** A blank {@link Projected} to reuse with {@link projectViewInto}. */
export function scratchProjected(): Projected {
  return { x: 0, y: 0, scale: 0, visible: false };
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
/** {@link starfieldPoint} written into `out` instead of a fresh object. */
export function starfieldInto(
  out: Vec3,
  index: number,
  seconds: number,
  options: { spread: number; near: number; far: number; speed: number },
): Vec3 {
  const span = options.far - options.near;
  const phase = hash01(index * 7 + 3) * span;
  out.x = (hash01(index * 7 + 1) * 2 - 1) * options.spread;
  out.y = (hash01(index * 7 + 2) * 2 - 1) * options.spread * 0.62;
  out.z = options.far - ((seconds * options.speed + phase) % span);
  return out;
}

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
  // Allocation-free sector switch: this runs for thousands of particles per frame.
  let r: number;
  let g: number;
  let b: number;
  switch (sector % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/** One point of a point-cloud shape: a position plus a per-point size / brightness weight in [0.3, 1]. */
export interface CloudPoint extends Vec3 {
  weight: number;
}

/** {@link emberColor}'s ramp: `[t, r, g, b]` stops, hoisted so the hot path allocates nothing. */
const EMBER_STOPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0xb8, 0x2c, 0x08],
  [0.35, 0xff, 0x66, 0x12],
  [0.65, 0xff, 0xaa, 0x30],
  [0.85, 0xff, 0xd8, 0x86],
  [1, 0xff, 0xf6, 0xe2],
];

/**
 * Ember → gold → white-hot ramp for `t` in 0..1 (clamped) — the warm light that dominates a cosmic particle
 * worlds. Low `t` is a deep red-orange ember, high `t` a pale gold flare.
 */
export function emberColor(t: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  let index = 1;
  while (index < EMBER_STOPS.length - 1 && clamped > EMBER_STOPS[index]![0]) index += 1;
  const from = EMBER_STOPS[index - 1]!;
  const to = EMBER_STOPS[index]!;
  const f = (clamped - from[0]) / (to[0] - from[0]);
  const r = Math.round(from[1] + (to[1] - from[1]) * f);
  const g = Math.round(from[2] + (to[2] - from[2]) * f);
  const b = Math.round(from[3] + (to[3] - from[3]) * f);
  return (r << 16) | (g << 8) | b;
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

/** Per-axis extents a roaming camera may wander within (each axis spans `[-range, range]`). */
export interface CameraRange {
  x: number;
  y: number;
  yaw: number;
  pitch: number;
}

/** Shot `index` of a seeded random sequence: a pose inside `range`, deterministic for (`index`, `seed`). */
export function randomShot(index: number, seed: number, range: CameraRange): CameraPose {
  const roll = (offset: number) => hash01(seed * 977 + index * 31 + offset) * 2 - 1;
  // Shot 0 opens at rest so every scene starts on the composed default view.
  if (index === 0) return REST_CAMERA;
  return { x: roll(1) * range.x, y: roll(2) * range.y, z: 0, yaw: roll(3) * range.yaw, pitch: roll(4) * range.pitch };
}

/**
 * A roaming camera: every `cycleSeconds` a new random shot (see {@link randomShot}). Within each cycle the camera holds,
 * then flies to the next shot over a random 1–3.5 s — or, one cycle in five, hard-cuts to it — and a slow handheld
 * drift (incommensurate sines, `drift` × the range) keeps it breathing between moves.
 */
export function roamingCamera(
  seconds: number,
  seed: number,
  range: CameraRange,
  cycleSeconds: number,
  drift = 0.08,
): CameraPose {
  const time = Number.isFinite(seconds) ? seconds : 0;
  const step = Math.floor(time / cycleSeconds);
  const local = time - step * cycleSeconds;
  const from = randomShot(step, seed, range);
  const to = randomShot(step + 1, seed, range);
  const cut = hash01(seed * 53 + step * 7) < 0.2;
  const move = cut ? 0.18 : 1 + 2.5 * hash01(seed * 61 + step * 11);
  const hold = cycleSeconds - move;
  const raw = local <= hold ? 0 : Math.min(1, (local - hold) / move);
  const pose = mixCamera(from, to, raw * raw * (3 - 2 * raw));
  const wobble = (a: number, b: number, c: number) =>
    (Math.sin(time * a) + Math.sin(time * b + 1.3) * 0.6 + Math.sin(time * c + 2.1) * 0.3) / 1.9;
  return {
    x: pose.x + wobble(0.31, 0.53, 1.07) * range.x * drift,
    y: pose.y + wobble(0.27, 0.61, 0.97) * range.y * drift,
    z: pose.z,
    yaw: pose.yaw + wobble(0.23, 0.47, 1.13) * range.yaw * drift,
    pitch: pose.pitch + wobble(0.29, 0.43, 0.89) * range.pitch * drift,
  };
}

/** An axis-aligned box in world space. */
export interface Box3 {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * A free-roaming position inside `bounds` at `seconds`: each axis sums two incommensurate sines (phases from `seed`),
 * so the path wanders smoothly and never visibly repeats. Always inside the box.
 */
export function wanderPoint(seconds: number, seed: number, bounds: Box3): Vec3 {
  const t = Number.isFinite(seconds) ? seconds : 0;
  const axis = (a: number, b: number, offset: number) =>
    (Math.sin(t * a + hash01(seed * 31 + offset) * 6.283) * 0.62 +
      Math.sin(t * b + hash01(seed * 37 + offset) * 6.283) * 0.38) *
      0.5 +
    0.5;
  const mix = (min: number, max: number, u: number) => min + (max - min) * u;
  return {
    x: mix(bounds.minX, bounds.maxX, axis(0.137, 0.311, 1)),
    y: mix(bounds.minY, bounds.maxY, axis(0.193, 0.427, 2)),
    z: mix(bounds.minZ, bounds.maxZ, axis(0.101, 0.263, 3)),
  };
}

/** Axis-aligned rectangle (x / y / w / h) for {@link clipSegmentOutsideRect}. */
export interface ClipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The parts of the segment (x0, y0) → (x1, y1) that lie outside `rect`, appended to `out` as `x0, y0, x1, y1` quads:
 * the whole segment when it misses the rect, one or two pieces when it crosses it, nothing when it lies inside. Lets
 * the space's floor lines run up to a live BGA without being drawn over it. Returns the number of pieces appended.
 */
export function clipSegmentOutsideRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rect: ClipRect,
  out: number[],
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  // Liang–Barsky: narrow [enter, exit] to the part of the segment inside the rect.
  let enter = 0;
  let exit = 1;
  const edges: ReadonlyArray<readonly [number, number]> = [
    [-dx, x0 - rect.x],
    [dx, rect.x + rect.w - x0],
    [-dy, y0 - rect.y],
    [dy, rect.y + rect.h - y0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) {
        enter = 1;
        exit = 0;
        break;
      }
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
  }
  if (enter >= exit) {
    out.push(x0, y0, x1, y1);
    return 1;
  }
  let pieces = 0;
  if (enter > 0) {
    out.push(x0, y0, x0 + dx * enter, y0 + dy * enter);
    pieces += 1;
  }
  if (exit < 1) {
    out.push(x0 + dx * exit, y0 + dy * exit, x1, y1);
    pieces += 1;
  }
  return pieces;
}
