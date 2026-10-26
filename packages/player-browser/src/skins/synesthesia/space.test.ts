import { describe, expect, it } from 'vite-plus/test';
import {
  burstParticlePosition,
  clipSegmentOutsideRect,
  burstParticles,
  cameraBasis,
  projectYawedInto,
  burstParticlePositionInto,
  cloudBasis,
  projectCloudPointInto,
  emberColor,
  flyPast,
  floorRise,
  hsvToHex,
  mixCamera,
  particleRiverPoint,
  perlin2,
  pointCloudPyramid,
  projectPoint,
  projectViewInto,
  randomShot,
  REST_CAMERA,
  roamingCamera,
  rotateX,
  rotateY,
  scratchProjected,
  starfieldInto,
  starfieldPoint,
  vanishingPoint,
  viewPoint,
  wanderPoint,
} from './space.ts';

describe('projectPoint', () => {
  it('maps z = 0 one-to-one around the origin', () => {
    expect(projectPoint({ x: 10, y: -5, z: 0 }, 100, 50, 200)).toEqual({ x: 110, y: 45, scale: 1, visible: true });
  });

  it('shrinks toward the vanishing point with depth', () => {
    const far = projectPoint({ x: 10, y: 0, z: 200 }, 0, 0, 200);
    expect(far.scale).toBe(0.5);
    expect(far.x).toBe(5);
  });

  it('hides points behind the camera', () => {
    expect(projectPoint({ x: 0, y: 0, z: -250 }, 0, 0, 200).visible).toBe(false);
  });
});

describe('rotations', () => {
  it('rotate a point a quarter turn', () => {
    const y = rotateY({ x: 1, y: 0, z: 0 }, Math.PI / 2);
    expect(y.x).toBeCloseTo(0, 12);
    expect(y.z).toBeCloseTo(-1, 12);
    const x = rotateX({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    expect(x.y).toBeCloseTo(0, 12);
    expect(x.z).toBeCloseTo(1, 12);
  });
});

describe('burstParticles', () => {
  it('is deterministic per seed and differs across seeds', () => {
    expect(burstParticles(4, 8)).toEqual(burstParticles(4, 8));
    expect(burstParticles(4, 8)).not.toEqual(burstParticles(5, 8));
  });

  it('keeps every attribute in range and biases sparks upward', () => {
    const particles = burstParticles(11, 200);
    for (const particle of particles) {
      expect(particle.speed).toBeGreaterThanOrEqual(0.35);
      expect(particle.speed).toBeLessThanOrEqual(1);
      expect(particle.life).toBeGreaterThanOrEqual(0.55);
      expect(Math.abs(particle.hueShift)).toBeLessThanOrEqual(0.08);
    }
    const upward = particles.filter((particle) => particle.direction.y < 0).length;
    expect(upward).toBeGreaterThan(particles.length / 2);
  });

  it('launches from the origin and travels outward over time', () => {
    const [particle] = burstParticles(2, 1);
    const start = burstParticlePosition(particle!, 0, 40, 10);
    expect(Math.hypot(start.x, start.y, start.z)).toBe(0);
    const end = burstParticlePosition(particle!, 1, 40, 0);
    expect(Math.hypot(end.x, end.y, end.z)).toBeGreaterThan(0);
  });
});

describe('starfieldPoint', () => {
  const options = { spread: 300, near: 0, far: 600, speed: 120 };

  it('keeps depth inside the loop range', () => {
    for (let index = 0; index < 50; index += 1) {
      const point = starfieldPoint(index, 17.3, options);
      expect(point.z).toBeGreaterThan(options.near);
      expect(point.z).toBeLessThanOrEqual(options.far);
      expect(Math.abs(point.x)).toBeLessThanOrEqual(options.spread);
    }
  });

  it('moves stars toward the camera as time advances', () => {
    const before = starfieldPoint(3, 1, options);
    const after = starfieldPoint(3, 1.1, options);
    expect(after.z === before.z - 12 || after.z > before.z).toBe(true);
  });
});

describe('hsvToHex', () => {
  it('converts primaries and wraps hue', () => {
    expect(hsvToHex(0, 1, 1)).toBe(0xff0000);
    expect(hsvToHex(1 / 3, 1, 1)).toBe(0x00ff00);
    expect(hsvToHex(2 / 3, 1, 1)).toBe(0x0000ff);
    expect(hsvToHex(1.5, 0, 1)).toBe(0xffffff);
    expect(hsvToHex(-1 / 3, 1, 1)).toBe(0x0000ff);
  });
});

describe('emberColor', () => {
  it('runs from a red ember to a white-hot flare', () => {
    expect(emberColor(0)).toBe(0xb82c08);
    expect(emberColor(1)).toBe(0xfff6e2);
    expect(emberColor(0.65)).toBe(0xffaa30);
  });

  it('clamps out-of-range and non-finite input', () => {
    expect(emberColor(-1)).toBe(emberColor(0));
    expect(emberColor(4)).toBe(emberColor(1));
    expect(emberColor(Number.NaN)).toBe(emberColor(0));
  });

  it('warms monotonically in green as it brightens', () => {
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const green = (emberColor(step / 20) >> 8) & 0xff;
      expect(green).toBeGreaterThanOrEqual(previous);
      previous = green;
    }
  });
});

describe('pointCloudPyramid', () => {
  it('keeps every point inside the pyramid volume', () => {
    const points = pointCloudPyramid(3, 400);
    expect(points).toHaveLength(400);
    for (const point of points) {
      expect(point.y).toBeLessThanOrEqual(1e-9);
      expect(point.y).toBeGreaterThanOrEqual(-1.3 - 1e-9);
      // The cross-section shrinks linearly toward the apex.
      const halfWidth = 1 + point.y / 1.3;
      expect(Math.abs(point.x)).toBeLessThanOrEqual(halfWidth + 1e-9);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(halfWidth + 1e-9);
      expect(point.weight).toBeGreaterThanOrEqual(0.3);
      expect(point.weight).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for a seed', () => {
    expect(pointCloudPyramid(9, 20)).toEqual(pointCloudPyramid(9, 20));
    expect(pointCloudPyramid(9, 20)).not.toEqual(pointCloudPyramid(10, 20));
  });
});

describe('particleRiverPoint', () => {
  const options = { length: 800, speed: 100, amplitude: 30, width: 10 };

  it('places a particle by the distance travelled when one is given', () => {
    // Same distance, different speeds: the particle is in the same place along the river.
    expect(particleRiverPoint(4, 2, options, 300).x).toBeCloseTo(
      particleRiverPoint(4, 2, { ...options, speed: 500 }, 300).x,
      9,
    );
    // Without a distance it falls back to seconds × speed.
    expect(particleRiverPoint(4, 3, options).x).toBeCloseTo(particleRiverPoint(4, 3, options, 300).x, 9);
  });

  it('stays within the river bounds', () => {
    for (let index = 0; index < 200; index += 1) {
      const point = particleRiverPoint(index, 3.7, options);
      expect(Math.abs(point.x)).toBeLessThanOrEqual(400);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(40);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(10);
    }
  });

  it('flows forward along x over time', () => {
    const a = particleRiverPoint(5, 0, options);
    const b = particleRiverPoint(5, 0.1, options);
    expect(b.x - a.x).toBeCloseTo(10, 6);
  });
});

describe('mixCamera', () => {
  it('scales a pose toward rest', () => {
    const half = mixCamera(REST_CAMERA, { x: 10, y: 20, z: 30, yaw: 0.4, pitch: -0.2 }, 0.5);
    expect(half).toEqual({ x: 5, y: 10, z: 15, yaw: 0.2, pitch: -0.1 });
  });
});

describe('viewPoint', () => {
  it('is the identity at rest', () => {
    expect(viewPoint({ x: 3, y: 4, z: 5 }, REST_CAMERA)).toEqual({ x: 3, y: 4, z: 5 });
  });

  it('moves the world opposite to the eye', () => {
    const point = viewPoint({ x: 0, y: 0, z: 100 }, { ...REST_CAMERA, x: 20, y: -10 });
    expect(point).toEqual({ x: -20, y: 10, z: 100 });
  });

  it('turning right swings points ahead to the left', () => {
    const point = viewPoint({ x: 0, y: 0, z: 100 }, { ...REST_CAMERA, yaw: 0.3 });
    expect(point.x).toBeLessThan(0);
  });

  it('keeps the orbit pivot fixed', () => {
    const pivot = viewPoint({ x: 0, y: 0, z: 200 }, { ...REST_CAMERA, yaw: 0.8, pitch: 0.2 }, 200);
    expect(pivot.x).toBeCloseTo(0, 9);
    expect(pivot.y).toBeCloseTo(0, 9);
    expect(pivot.z).toBeCloseTo(200, 9);
  });
});

describe('vanishingPoint', () => {
  it('sits at the view centre at rest', () => {
    expect(vanishingPoint(REST_CAMERA, 320, 240, 200)).toEqual({ x: 320, y: 240 });
  });

  it('shifts against the turn and rises when looking down', () => {
    const point = vanishingPoint({ ...REST_CAMERA, yaw: 0.3, pitch: 0.1 }, 320, 240, 200);
    expect(point.x).toBeLessThan(320);
    expect(point.y).toBeLessThan(240);
    expect(point.y).toBeCloseTo(240 - 200 * Math.tan(0.1), 6);
  });

  it('agrees with projecting a far point', () => {
    const camera = { ...REST_CAMERA, yaw: -0.25, pitch: 0.12 };
    const far = projectPoint(viewPoint({ x: 0, y: 0, z: 1e7 }, camera), 320, 240, 200);
    const vanish = vanishingPoint(camera, 320, 240, 200);
    expect(far.x).toBeCloseTo(vanish.x, 2);
    expect(far.y).toBeCloseTo(vanish.y, 2);
  });
});

describe('randomShot', () => {
  const range = { x: 200, y: 100, yaw: 0.3, pitch: 0.15 };

  it('opens at rest and stays within range', () => {
    expect(randomShot(0, 4, range)).toEqual(REST_CAMERA);
    for (let index = 1; index < 50; index += 1) {
      const shot = randomShot(index, 4, range);
      expect(Math.abs(shot.x)).toBeLessThanOrEqual(200);
      expect(Math.abs(shot.y)).toBeLessThanOrEqual(100);
      expect(Math.abs(shot.yaw)).toBeLessThanOrEqual(0.3);
      expect(Math.abs(shot.pitch)).toBeLessThanOrEqual(0.15);
    }
  });

  it('varies with index and seed but is deterministic', () => {
    expect(randomShot(3, 4, range)).toEqual(randomShot(3, 4, range));
    expect(randomShot(3, 4, range)).not.toEqual(randomShot(4, 4, range));
    expect(randomShot(3, 4, range)).not.toEqual(randomShot(3, 5, range));
  });
});

describe('roamingCamera', () => {
  const range = { x: 200, y: 100, yaw: 0.3, pitch: 0.15 };

  it('starts near rest and never strays far outside the range', () => {
    const start = roamingCamera(0, 9, range, 8);
    expect(Math.abs(start.x)).toBeLessThan(range.x * 0.1);
    for (let t = 0; t < 200; t += 0.37) {
      const pose = roamingCamera(t, 9, range, 8);
      expect(Math.abs(pose.x)).toBeLessThanOrEqual(range.x * 1.09);
      expect(Math.abs(pose.yaw)).toBeLessThanOrEqual(range.yaw * 1.09);
    }
  });

  it('moves continuously within a cycle (no jumps outside a cut)', () => {
    const dt = 1 / 60;
    let largest = 0;
    for (let t = 0; t < 8; t += dt) {
      largest = Math.max(
        largest,
        Math.abs(roamingCamera(t + dt, 2, range, 8, 0).x - roamingCamera(t, 2, range, 8, 0).x),
      );
    }
    // Fastest legal fly: the whole range in a one-second smoothstep ≈ 1.5 × span / s.
    expect(largest).toBeLessThan(range.x * 2 * 1.5 * dt * 12);
  });
});

describe('wanderPoint', () => {
  const bounds = { minX: -500, maxX: 500, minY: -140, maxY: 60, minZ: 250, maxZ: 1400 };

  it('stays inside its box and moves continuously', () => {
    let previous = wanderPoint(0, 3, bounds);
    for (let t = 1 / 60; t < 300; t += 1 / 60) {
      const point = wanderPoint(t, 3, bounds);
      expect(point.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(point.x).toBeLessThanOrEqual(bounds.maxX);
      expect(point.y).toBeGreaterThanOrEqual(bounds.minY);
      expect(point.y).toBeLessThanOrEqual(bounds.maxY);
      expect(point.z).toBeGreaterThanOrEqual(bounds.minZ);
      expect(point.z).toBeLessThanOrEqual(bounds.maxZ);
      expect(Math.hypot(point.x - previous.x, point.z - previous.z)).toBeLessThan(10);
      previous = point;
    }
  });

  it('roams across most of the box', () => {
    const xs: number[] = [];
    for (let t = 0; t < 600; t += 0.5) xs.push(wanderPoint(t, 3, bounds).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(700);
  });

  it('differs by seed', () => {
    expect(wanderPoint(10, 1, bounds)).not.toEqual(wanderPoint(10, 2, bounds));
  });
});

describe('clipSegmentOutsideRect', () => {
  const rect = { x: 10, y: 10, w: 20, h: 20 };

  it('keeps a segment that misses the rect whole', () => {
    const out: number[] = [];
    expect(clipSegmentOutsideRect(0, 0, 40, 0, rect, out)).toBe(1);
    expect(out).toEqual([0, 0, 40, 0]);
  });

  it('splits a segment crossing the rect into the two outside pieces', () => {
    const out: number[] = [];
    expect(clipSegmentOutsideRect(0, 20, 40, 20, rect, out)).toBe(2);
    expect(out).toEqual([0, 20, 10, 20, 30, 20, 40, 20]);
  });

  it('keeps only the outside part of a segment ending inside', () => {
    const out: number[] = [];
    expect(clipSegmentOutsideRect(0, 20, 20, 20, rect, out)).toBe(1);
    expect(out).toEqual([0, 20, 10, 20]);
  });

  it('drops a segment lying inside', () => {
    const out: number[] = [];
    expect(clipSegmentOutsideRect(12, 12, 28, 28, rect, out)).toBe(0);
    expect(out).toEqual([]);
  });

  it('handles diagonal crossings', () => {
    const out: number[] = [];
    expect(clipSegmentOutsideRect(0, 0, 40, 40, rect, out)).toBe(2);
    expect(out).toEqual([0, 0, 10, 10, 30, 30, 40, 40]);
  });
});

describe('projectViewInto', () => {
  it('matches projectPoint(viewPoint(...)) without allocating', () => {
    const camera = { x: 12, y: -30, z: 40, yaw: 0.3, pitch: -0.2 };
    const basis = cameraBasis(camera);
    const out = scratchProjected();
    for (const [x, y, z, orbit] of [
      [0, 0, 0, 0],
      [120, 80, 500, 0],
      [-300, 150, 900, 220],
      [10, 10, -400, 0],
    ] as const) {
      const expected = projectPoint(viewPoint({ x, y, z }, camera, orbit), 400, 240, 200);
      const actual = projectViewInto(out, x, y, z, basis, 400, 240, 200, orbit);
      expect(actual).toBe(out);
      expect(actual.visible).toBe(expected.visible);
      expect(actual.x).toBeCloseTo(expected.x, 9);
      expect(actual.y).toBeCloseTo(expected.y, 9);
      expect(actual.scale).toBeCloseTo(expected.scale, 9);
    }
  });
});

describe('starfieldInto', () => {
  it('matches starfieldPoint', () => {
    const options = { spread: 560, near: 10, far: 1000, speed: 1 };
    const out = { x: 0, y: 0, z: 0 };
    for (const index of [0, 7, 319]) {
      expect(starfieldInto(out, index, 123.4, options)).toEqual(starfieldPoint(index, 123.4, options));
    }
  });
});

describe('perlin2', () => {
  it('is zero on lattice points and stays within -1..1', () => {
    expect(perlin2(3, 7)).toBe(0);
    for (let index = 0; index < 500; index += 1) {
      const value = perlin2(index * 0.37 + 0.11, index * 0.53 - 4.2);
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous', () => {
    expect(Math.abs(perlin2(1.5, 2.5) - perlin2(1.5001, 2.5))).toBeLessThan(0.001);
  });
});

describe('floorRise', () => {
  it('is flat with no amplitude', () => {
    expect(floorRise(120, 800, 3, 0)).toBe(0);
  });

  it('never dips below the floor or above the amplitude', () => {
    let peak = 0;
    for (let x = -1500; x <= 1500; x += 50) {
      for (let z = 0; z < 3000; z += 90) {
        const rise = floorRise(x, z, 2, 100);
        expect(rise).toBeGreaterThanOrEqual(0);
        expect(rise).toBeLessThanOrEqual(100);
        peak = Math.max(peak, rise);
      }
    }
    // Some of the floor actually rises.
    expect(peak).toBeGreaterThan(30);
  });

  it('scales with the amplitude', () => {
    const small = floorRise(-300, 1200, 1, 10);
    const large = floorRise(-300, 1200, 1, 100);
    expect(large).toBeCloseTo(small * 10, 6);
  });
});

describe('flyPast', () => {
  it('leaves the object alone before the warp', () => {
    expect(flyPast(300, 200, 50, 320, 240, 0)).toEqual({ x: 300, y: 200, scale: 50, alpha: 1 });
  });

  it('streams the object out from the vanishing point, growing and speeding up', () => {
    const early = flyPast(400, 240, 50, 320, 240, 0.3);
    const late = flyPast(400, 240, 50, 320, 240, 0.9);
    expect(early.x).toBeGreaterThan(400);
    expect(late.x).toBeGreaterThan(early.x);
    expect(late.x - early.x).toBeGreaterThan(early.x - 400);
    expect(late.scale).toBeGreaterThan(early.scale);
    expect(early.y).toBe(240);
  });

  it('fades out over the last quarter of the warp', () => {
    expect(flyPast(400, 240, 50, 320, 240, 0.7).alpha).toBe(1);
    expect(flyPast(400, 240, 50, 320, 240, 1).alpha).toBe(0);
  });

  it('pushes an object sitting on the vanishing point off it', () => {
    const passed = flyPast(320, 240, 50, 320, 240, 0.5);
    expect(Math.hypot(passed.x - 320, passed.y - 240)).toBeGreaterThan(40);
  });
});

describe('projectCloudPointInto', () => {
  it('places and projects a cloud point exactly as the composed helpers do', () => {
    let seed = 99;
    const next = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
    for (let round = 0; round < 200; round += 1) {
      const transform = {
        scale: 1 + next() * 0.9,
        x: next() * 300,
        y: next() * 200,
        z: 400 + next() * 380,
        yaw: next() * Math.PI,
        ...(round % 3 === 0 ? {} : { pitch: next() * 0.6 }),
      };
      const camera =
        round % 2 === 0
          ? undefined
          : { x: next() * 40, y: next() * 20, z: next() * 30, yaw: next() * 0.3, pitch: next() * 0.2 };
      const orbit = round % 4 === 1 ? 500 : 0;
      const point = { x: next() * 100, y: next() * 100, z: next() * 100 };
      let world = { x: point.x * transform.scale, y: point.y * transform.scale, z: point.z * transform.scale };
      world = rotateY(world, transform.yaw);
      if (transform.pitch) world = rotateX(world, transform.pitch);
      const placed = { x: world.x + transform.x, y: world.y + transform.y, z: world.z + transform.z };
      const expected = projectPoint(camera ? viewPoint(placed, camera, orbit) : placed, 400, 300, 600);
      const actual = projectCloudPointInto(
        scratchProjected(),
        point.x,
        point.y,
        point.z,
        cloudBasis(transform),
        camera ? cameraBasis(camera) : undefined,
        400,
        300,
        600,
        orbit,
      );
      expect(actual).toEqual(expected);
    }
  });

  it('reports a point behind the camera as not visible', () => {
    const behind = projectCloudPointInto(
      scratchProjected(),
      0,
      0,
      -10,
      cloudBasis({ scale: 100, x: 0, y: 0, z: 0, yaw: 0 }),
      undefined,
      1,
      2,
      600,
    );
    expect(behind).toEqual({ x: 1, y: 2, scale: 0, visible: false });
  });
});

describe('allocation-free burst projection', () => {
  it('matches burstParticlePosition and projectPoint(rotateY(…)) exactly', () => {
    const particles = burstParticles(4242, 64);
    const out = { x: 0, y: 0, z: 0 };
    const projected = scratchProjected();
    for (const [index, particle] of particles.entries()) {
      const life = (index % 13) / 12 - 0.05;
      const spin = (index % 7) * 0.13 - 0.4;
      expect(burstParticlePositionInto(out, particle, life, 80, 40)).toEqual(
        burstParticlePosition(particle, life, 80, 40),
      );
      const point = { x: out.x * 0.55, y: out.y * 1.1 - 12, z: out.z * 0.8 };
      expect(
        projectYawedInto(projected, point.x, point.y, point.z, Math.cos(spin), Math.sin(spin), 200, 500, 600),
      ).toEqual(projectPoint(rotateY(point, spin), 200, 500, 600));
    }
    expect(projectYawedInto(scratchProjected(), 0, 0, -700, 1, 0, 3, 4, 600)).toEqual({
      x: 3,
      y: 4,
      scale: 0,
      visible: false,
    });
  });
});
