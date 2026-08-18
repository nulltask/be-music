import { describe, expect, it } from 'vitest';
import { resultRankPunch } from './result-render.ts';

describe('resultRankPunch', () => {
  it('stays hidden at t=0, slams oversized, then settles', () => {
    expect(resultRankPunch(0).alpha).toBe(0);
    expect(resultRankPunch(40).scale).toBeGreaterThan(1.2);
    expect(resultRankPunch(40).alpha).toBeGreaterThan(0);
    expect(resultRankPunch(40).offsetX).toBeLessThan(0);
    expect(resultRankPunch(500).scale).toBeCloseTo(1, 5);
    expect(resultRankPunch(500).alpha).toBe(1);
    expect(resultRankPunch(500).offsetX).toBeCloseTo(0, 5);
  });
});
