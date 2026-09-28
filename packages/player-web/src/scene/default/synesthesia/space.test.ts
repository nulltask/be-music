import { describe, expect, it } from 'vite-plus/test';
import {
  burstParticlePosition,
  burstParticles,
  emberColor,
  hsvToHex,
  mixCamera,
  particleRiverPoint,
  pointCloudHumanoid,
  pointCloudPyramid,
  projectPoint,
  randomShot,
  REST_CAMERA,
  roamingCamera,
  rotateX,
  rotateY,
  starfieldPoint,
  vanishingPoint,
  viewPoint,
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

describe('pointCloudHumanoid', () => {
  it('stands about two units tall, head up', () => {
    const points = pointCloudHumanoid(1, 600);
    expect(points).toHaveLength(600);
    const ys = points.map((point) => point.y);
    expect(Math.min(...ys)).toBeGreaterThan(-1.05);
    expect(Math.min(...ys)).toBeLessThan(-0.9);
    expect(Math.max(...ys)).toBeLessThan(1.05);
    expect(Math.max(...ys)).toBeGreaterThan(0.85);
    // Arms spread wider than the torso.
    const xs = points.map((point) => Math.abs(point.x));
    expect(Math.max(...xs)).toBeGreaterThan(0.6);
  });

  it('is deterministic for a seed', () => {
    expect(pointCloudHumanoid(4, 30)).toEqual(pointCloudHumanoid(4, 30));
  });
});

describe('particleRiverPoint', () => {
  const options = { length: 800, speed: 100, amplitude: 30, width: 10 };

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
