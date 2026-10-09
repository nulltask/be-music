import { describe, expect, it } from 'vite-plus/test';
import { BURST_FRAME_BUDGET, burstGrainCount } from './burst-budget.ts';

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

  it('never goes negative', () => {
    expect(burstGrainCount(170, 24, 0, 0, 3)).toBe(0);
    expect(burstGrainCount(170, 24, 0, 1, 0)).toBe(170);
  });
});
