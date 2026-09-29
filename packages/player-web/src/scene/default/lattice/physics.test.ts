import { describe, expect, it } from 'vite-plus/test';
import { bounceHeight, createChain, kickChain, stepChain } from './physics.ts';

describe('chain', () => {
  const options = { anchorX: 100, anchorY: 0, gravity: 900 };

  it('hangs straight down at rest and keeps its link lengths within 2 %', () => {
    const chain = createChain(100, 0, 8, 20);
    for (let frame = 0; frame < 120; frame += 1) stepChain(chain, 1 / 60, options);
    for (let index = 0; index < chain.count; index += 1) {
      expect(chain.x[index]!).toBeCloseTo(100, 3);
    }
    for (let index = 1; index < chain.count; index += 1) {
      const link = Math.hypot(chain.x[index]! - chain.x[index - 1]!, chain.y[index]! - chain.y[index - 1]!);
      expect(Math.abs(link - 20)).toBeLessThan(0.4);
    }
  });

  it('swings when kicked and settles back under damping', () => {
    const chain = createChain(100, 0, 6, 20);
    kickChain(chain, 5, 400, 0);
    let widest = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      stepChain(chain, 1 / 60, options);
      widest = Math.max(widest, Math.abs(chain.x[5]! - 100));
    }
    expect(widest).toBeGreaterThan(10);
    for (let frame = 0; frame < 1800; frame += 1) stepChain(chain, 1 / 60, { ...options, damping: 0.97 });
    expect(Math.abs(chain.x[5]! - 100)).toBeLessThan(1);
  });

  it('keeps the top bead pinned to a moving anchor', () => {
    const chain = createChain(0, 0, 4, 10);
    stepChain(chain, 1 / 60, { ...options, anchorX: 30, anchorY: 5 });
    expect(chain.x[0]).toBe(30);
    expect(chain.y[0]).toBe(5);
  });

  it('ignores zero and invalid time steps', () => {
    const chain = createChain(0, 0, 4, 10);
    const before = chain.y.slice();
    stepChain(chain, 0, options);
    stepChain(chain, Number.NaN, options);
    expect(chain.y).toEqual(before);
  });
});

describe('bounceHeight', () => {
  it('drops from its height to the floor', () => {
    expect(bounceHeight(0, 100, 1000, 0.5)).toBe(100);
    const fall = Math.sqrt(0.2);
    expect(bounceHeight(fall, 100, 1000, 0.5)).toBeCloseTo(0, 6);
  });

  it('bounces lower each time and settles', () => {
    const fall = Math.sqrt(0.2);
    const speed = 1000 * fall * 0.5;
    const firstPeak = bounceHeight(fall + speed / 1000, 100, 1000, 0.5);
    expect(firstPeak).toBeCloseTo(25, 4);
    expect(bounceHeight(10, 100, 1000, 0.5)).toBe(0);
  });

  it('never goes below the floor', () => {
    for (let t = 0; t < 3; t += 0.013) {
      expect(bounceHeight(t, 60, 1200, 0.6)).toBeGreaterThanOrEqual(0);
    }
  });
});
