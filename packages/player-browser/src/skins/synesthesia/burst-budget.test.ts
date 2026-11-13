import { describe, expect, it } from 'vite-plus/test';
import {
  BURST_FRAME_BUDGET,
  BURST_SKIRT_FRAME_BUDGET,
  burstGrainCount,
  judgmentParticleMultiplier,
} from './burst-budget.ts';

describe('burstGrainCount', () => {
  it('draws the full tier-scaled burst while few bombs overlap', () => {
    expect(burstGrainCount(170, 24, 0, 1, 1)).toBe(170);
    expect(burstGrainCount(170, 24, 4, 1, 2)).toBe(266);
    expect(burstGrainCount(170, 24, 2, 0.5, 1)).toBe(109);
  });

  it('shares the frame budget once many bombs overlap', () => {
    expect(burstGrainCount(170, 24, 4, 1, 8)).toBe(BURST_FRAME_BUDGET / 8);
    expect(burstGrainCount(170, 24, 4, 1, 16) * 16).toBeLessThanOrEqual(BURST_FRAME_BUDGET);
  });

  it('shares a separate budget when one is given', () => {
    expect(burstGrainCount(140, 16, 4, 1, 1, BURST_SKIRT_FRAME_BUDGET)).toBe(204);
    expect(burstGrainCount(140, 16, 4, 1, 8, BURST_SKIRT_FRAME_BUDGET)).toBe(BURST_SKIRT_FRAME_BUDGET / 8);
  });

  it('never goes negative', () => {
    expect(burstGrainCount(170, 24, 0, 0, 3)).toBe(0);
    expect(burstGrainCount(170, 24, 0, 1, 0)).toBe(170);
  });
});

describe('judgmentParticleMultiplier', () => {
  it.each([
    [undefined, 2],
    [{ judgmentParticles: 'normal' }, 2],
    [{ judgmentParticles: 'more' }, 5],
    [{ judgmentParticles: 'most' }, 10],
    [{ judgmentParticles: 'unknown' }, 2],
  ] as const)('resolves the density for %j', (settings, multiplier) => {
    expect(judgmentParticleMultiplier(settings)).toBe(multiplier);
  });

  it.each([2, 5, 10])('scales individual hits and dense passages by %s', (multiplier) => {
    expect(burstGrainCount(170, 24, 4, multiplier, 1, BURST_FRAME_BUDGET * multiplier)).toBe(266 * multiplier);
    expect(burstGrainCount(170, 24, 4, multiplier, 8, BURST_FRAME_BUDGET * multiplier)).toBe(120 * multiplier);
    expect(burstGrainCount(140, 16, 4, multiplier, 8, BURST_SKIRT_FRAME_BUDGET * multiplier)).toBe(90 * multiplier);
  });
});
