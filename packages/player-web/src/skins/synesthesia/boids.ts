import { hash01 } from '@be-music/skin-sdk';

/**
 * A 3D school of boids (Reynolds' separation / alignment / cohesion) for the Synesthesia backdrop: fish of light that
 * swim after a slowly wandering lead point inside a box, tighten on the beat, and scatter on a key press. State lives
 * in flat typed arrays and is advanced in place by {@link stepFlock}; everything else is deterministic for the seed.
 */

export interface FlockBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface Flock {
  count: number;
  /** x, y, z per boid. */
  position: Float32Array;
  /** vx, vy, vz per boid (units / s). */
  velocity: Float32Array;
  bounds: FlockBounds;
}

export interface FlockForces {
  /** Seconds on the scene clock — drives the wandering lead point. */
  seconds: number;
  /** 0..1 extra cohesion (the beat pulls the school tight). */
  gather?: number;
  /** 0..1 burst of separation and speed (a key press scatters the school). */
  scatter?: number;
}

const SEPARATION_RADIUS = 58;
const NEIGHBOUR_RADIUS = 150;
const MIN_SPEED = 90;
const MAX_SPEED = 260;

export function createFlock(seed: number, count: number, bounds: FlockBounds): Flock {
  const position = new Float32Array(count * 3);
  const velocity = new Float32Array(count * 3);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  for (let index = 0; index < count; index += 1) {
    const base = seed * 173 + index * 11;
    // Start as one loose school near the centre, heading roughly the same way.
    position[index * 3] = cx + (hash01(base + 1) - 0.5) * 240;
    position[index * 3 + 1] = cy + (hash01(base + 2) - 0.5) * 120;
    position[index * 3 + 2] = cz + (hash01(base + 3) - 0.5) * 240;
    velocity[index * 3] = 120 + (hash01(base + 4) - 0.5) * 60;
    velocity[index * 3 + 1] = (hash01(base + 5) - 0.5) * 40;
    velocity[index * 3 + 2] = (hash01(base + 6) - 0.5) * 60;
  }
  return { count, position, velocity, bounds };
}

/** The point the school chases at `seconds`: a slow Lissajous loop through the middle of the box. */
export function flockLeader(bounds: FlockBounds, seconds: number): { x: number; y: number; z: number } {
  const hx = (bounds.maxX - bounds.minX) / 2;
  const hy = (bounds.maxY - bounds.minY) / 2;
  const hz = (bounds.maxZ - bounds.minZ) / 2;
  return {
    x: bounds.minX + hx + Math.sin(seconds * 0.23) * hx * 0.75,
    y: bounds.minY + hy + Math.sin(seconds * 0.37 + 1.1) * hy * 0.6,
    z: bounds.minZ + hz + Math.cos(seconds * 0.17) * hz * 0.7,
  };
}

/** Advances `flock` by `dt` seconds (clamped to 1/15 s). */
export function stepFlock(flock: Flock, dt: number, forces: FlockForces): void {
  const step = Math.max(0, Math.min(1 / 15, Number.isFinite(dt) ? dt : 0));
  if (step === 0) return;
  const { count, position: p, velocity: v, bounds } = flock;
  const leader = flockLeader(bounds, forces.seconds);
  const gather = forces.gather ?? 0;
  const scatter = forces.scatter ?? 0;
  const separationRadius = SEPARATION_RADIUS * (1 + 1.5 * scatter);
  const maxSpeed = MAX_SPEED * (1 + 0.8 * scatter);
  const accel = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const ix = p[i * 3]!;
    const iy = p[i * 3 + 1]!;
    const iz = p[i * 3 + 2]!;
    let sepX = 0;
    let sepY = 0;
    let sepZ = 0;
    let aliX = 0;
    let aliY = 0;
    let aliZ = 0;
    let cohX = 0;
    let cohY = 0;
    let cohZ = 0;
    let neighbours = 0;
    for (let j = 0; j < count; j += 1) {
      if (j === i) continue;
      const dx = p[j * 3]! - ix;
      const dy = p[j * 3 + 1]! - iy;
      const dz = p[j * 3 + 2]! - iz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > NEIGHBOUR_RADIUS * NEIGHBOUR_RADIUS) continue;
      neighbours += 1;
      aliX += v[j * 3]!;
      aliY += v[j * 3 + 1]!;
      aliZ += v[j * 3 + 2]!;
      cohX += dx;
      cohY += dy;
      cohZ += dz;
      if (d2 < separationRadius * separationRadius && d2 > 1e-6) {
        const push = 1 / d2;
        sepX -= dx * push;
        sepY -= dy * push;
        sepZ -= dz * push;
      }
    }
    let ax = 0;
    let ay = 0;
    let az = 0;
    if (neighbours > 0) {
      // Strong alignment and light cohesion: the school streams in ribbons rather than balling up.
      const cohesion = 0.3 * (1 + 2 * gather) * (1 - scatter);
      ax += (aliX / neighbours - v[i * 3]!) * 2.2 + (cohX / neighbours) * cohesion;
      ay += (aliY / neighbours - v[i * 3 + 1]!) * 2.2 + (cohY / neighbours) * cohesion;
      az += (aliZ / neighbours - v[i * 3 + 2]!) * 2.2 + (cohZ / neighbours) * cohesion;
    }
    const separation = 16000 * (1 + 4 * scatter);
    ax += sepX * separation;
    ay += sepY * separation;
    az += sepZ * separation;
    // Chase the leader.
    ax += (leader.x - ix) * 0.16;
    ay += (leader.y - iy) * 0.16;
    az += (leader.z - iz) * 0.16;
    // Soft walls.
    ax += wall(ix, bounds.minX, bounds.maxX);
    ay += wall(iy, bounds.minY, bounds.maxY);
    az += wall(iz, bounds.minZ, bounds.maxZ);
    accel[i * 3] = ax;
    accel[i * 3 + 1] = ay;
    accel[i * 3 + 2] = az;
  }
  for (let i = 0; i < count; i += 1) {
    let vx = v[i * 3]! + accel[i * 3]! * step;
    let vy = v[i * 3 + 1]! + accel[i * 3 + 1]! * step;
    let vz = v[i * 3 + 2]! + accel[i * 3 + 2]! * step;
    const speed = Math.hypot(vx, vy, vz);
    const clamped = Math.max(MIN_SPEED, Math.min(maxSpeed, speed));
    if (speed > 1e-6) {
      vx = (vx / speed) * clamped;
      vy = (vy / speed) * clamped;
      vz = (vz / speed) * clamped;
    } else {
      vx = clamped;
    }
    v[i * 3] = vx;
    v[i * 3 + 1] = vy;
    v[i * 3 + 2] = vz;
    p[i * 3] = clampTo(p[i * 3]! + vx * step, bounds.minX - 200, bounds.maxX + 200);
    p[i * 3 + 1] = clampTo(p[i * 3 + 1]! + vy * step, bounds.minY - 200, bounds.maxY + 200);
    p[i * 3 + 2] = clampTo(p[i * 3 + 2]! + vz * step, bounds.minZ - 200, bounds.maxZ + 200);
  }
}

/** Steering back into `[min, max]`, growing with how far outside a margin the boid has strayed. */
function wall(value: number, min: number, max: number): number {
  const margin = (max - min) * 0.12;
  if (value < min + margin) return (min + margin - value) * 6;
  if (value > max - margin) return (max - margin - value) * 6;
  return 0;
}

function clampTo(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
