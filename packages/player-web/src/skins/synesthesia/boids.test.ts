import { describe, expect, it } from 'vite-plus/test';
import { createFlock, flockLeader, stepFlock, type Flock } from './boids.ts';

const BOUNDS = { minX: -600, maxX: 600, minY: -250, maxY: 100, minZ: 200, maxZ: 1400 };

function spread(flock: Flock): number {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < flock.count; i += 1) {
    cx += flock.position[i * 3]!;
    cy += flock.position[i * 3 + 1]!;
    cz += flock.position[i * 3 + 2]!;
  }
  cx /= flock.count;
  cy /= flock.count;
  cz /= flock.count;
  let sum = 0;
  for (let i = 0; i < flock.count; i += 1) {
    sum += Math.hypot(flock.position[i * 3]! - cx, flock.position[i * 3 + 1]! - cy, flock.position[i * 3 + 2]! - cz);
  }
  return sum / flock.count;
}

function run(flock: Flock, seconds: number, forces: (t: number) => { gather?: number; scatter?: number } = () => ({})) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) stepFlock(flock, dt, { seconds: t, ...forces(t) });
}

describe('createFlock', () => {
  it('is deterministic for a seed', () => {
    expect(createFlock(3, 20, BOUNDS)).toEqual(createFlock(3, 20, BOUNDS));
    expect(createFlock(3, 20, BOUNDS).position).not.toEqual(createFlock(4, 20, BOUNDS).position);
  });
});

describe('stepFlock', () => {
  it('keeps speeds within the limits', () => {
    const flock = createFlock(1, 40, BOUNDS);
    run(flock, 3);
    for (let i = 0; i < flock.count; i += 1) {
      const speed = Math.hypot(flock.velocity[i * 3]!, flock.velocity[i * 3 + 1]!, flock.velocity[i * 3 + 2]!);
      expect(speed).toBeGreaterThanOrEqual(89);
      expect(speed).toBeLessThanOrEqual(261);
    }
  });

  it('stays near its box over a long swim', () => {
    const flock = createFlock(2, 40, BOUNDS);
    run(flock, 20);
    for (let i = 0; i < flock.count; i += 1) {
      expect(flock.position[i * 3]!).toBeGreaterThanOrEqual(BOUNDS.minX - 200);
      expect(flock.position[i * 3]!).toBeLessThanOrEqual(BOUNDS.maxX + 200);
      expect(flock.position[i * 3 + 2]!).toBeGreaterThanOrEqual(BOUNDS.minZ - 200);
      expect(flock.position[i * 3 + 2]!).toBeLessThanOrEqual(BOUNDS.maxZ + 200);
    }
  });

  it('schools together, and a scatter spreads the school out', () => {
    const calm = createFlock(5, 40, BOUNDS);
    const scattered = createFlock(5, 40, BOUNDS);
    run(calm, 4);
    run(scattered, 4, () => ({ scatter: 1 }));
    expect(spread(calm)).toBeLessThan(260);
    expect(spread(scattered)).toBeGreaterThan(spread(calm));
  });

  it('ignores zero and invalid time steps', () => {
    const flock = createFlock(6, 10, BOUNDS);
    const before = flock.position.slice();
    stepFlock(flock, 0, { seconds: 0 });
    stepFlock(flock, Number.NaN, { seconds: 0 });
    expect(flock.position).toEqual(before);
  });
});

describe('flockLeader', () => {
  it('wanders inside the box', () => {
    for (let t = 0; t < 120; t += 1.7) {
      const leader = flockLeader(BOUNDS, t);
      expect(leader.x).toBeGreaterThan(BOUNDS.minX);
      expect(leader.x).toBeLessThan(BOUNDS.maxX);
      expect(leader.y).toBeGreaterThan(BOUNDS.minY);
      expect(leader.y).toBeLessThan(BOUNDS.maxY);
      expect(leader.z).toBeGreaterThan(BOUNDS.minZ);
      expect(leader.z).toBeLessThan(BOUNDS.maxZ);
    }
  });
});
