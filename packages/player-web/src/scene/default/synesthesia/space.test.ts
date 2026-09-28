import { describe, expect, it } from 'vite-plus/test';
import {
  burstParticlePosition,
  burstParticles,
  hsvToHex,
  icosahedron,
  projectPoint,
  rotateX,
  rotateY,
  starfieldPoint,
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

describe('icosahedron', () => {
  it('has 12 unit vertices and 30 edges', () => {
    const { vertices, edges } = icosahedron();
    expect(vertices).toHaveLength(12);
    expect(edges).toHaveLength(30);
    for (const vertex of vertices) {
      expect(Math.hypot(vertex.x, vertex.y, vertex.z)).toBeCloseTo(1, 12);
    }
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
