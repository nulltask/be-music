import { describe, expect, it } from 'vite-plus/test';
import { createMantaShape, mantaShapeInto } from './manta.ts';

const origin = { x: 0, y: 0, z: 0 };

describe('mantaShapeInto', () => {
  it('points the nose along the heading and trails the tail behind', () => {
    const shape = mantaShapeInto(createMantaShape(), origin, { x: 100, y: 0, z: 0 }, 0, 0);
    expect(shape.nose.x).toBeGreaterThan(0);
    expect(shape.tailRoot.x).toBeLessThan(0);
    expect(shape.tailEnd.x).toBeLessThan(shape.tailRoot.x);
    expect(shape.nose.y).toBeCloseTo(0, 9);
    expect(shape.nose.z).toBeCloseTo(0, 9);
  });

  it('spreads the wings across the heading, mirrored', () => {
    const shape = mantaShapeInto(createMantaShape(), origin, { x: 100, y: 0, z: 0 }, 0, 0);
    expect(shape.leftTip.z).toBeCloseTo(-shape.rightTip.z, 9);
    expect(Math.abs(shape.leftTip.z - shape.rightTip.z)).toBeCloseTo(30, 6);
  });

  it('beats the wings up and down over time, out of step by phase', () => {
    const up = mantaShapeInto(createMantaShape(), origin, { x: 0, y: 0, z: 100 }, 0, Math.PI / 2);
    const down = mantaShapeInto(createMantaShape(), origin, { x: 0, y: 0, z: 100 }, 0, -Math.PI / 2);
    // y points down, so a raised wing has a smaller y.
    expect(up.leftTip.y).toBeLessThan(0);
    expect(down.leftTip.y).toBeGreaterThan(0);
    expect(up.leftTip.y).toBeCloseTo(up.rightTip.y, 9);
  });

  it('opens the wings wider on a kick', () => {
    const rest = mantaShapeInto(createMantaShape(), origin, { x: 0, y: 0, z: 100 }, 0, 0);
    const kicked = mantaShapeInto(createMantaShape(), origin, { x: 0, y: 0, z: 100 }, 0, 0, 1);
    expect(Math.abs(kicked.rightTip.x - kicked.leftTip.x)).toBeGreaterThan(Math.abs(rest.rightTip.x - rest.leftTip.x));
  });

  it('stays well-formed when still or heading straight down', () => {
    for (const velocity of [origin, { x: 0, y: 120, z: 0 }]) {
      const shape = mantaShapeInto(createMantaShape(), origin, velocity, 1.3, 0.4);
      for (const point of Object.values(shape)) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)).toBe(true);
      }
      expect(Math.hypot(shape.leftTip.x - shape.rightTip.x, shape.leftTip.z - shape.rightTip.z)).toBeGreaterThan(20);
    }
  });
});
