import { describe, expect, it } from 'vitest';
import { resultRankPunch } from './result-render.ts';

describe('resultRankPunch', () => {
  it('stays hidden at t=0, overshoots, then settles', () => {
    expect(resultRankPunch(0).alpha).toBe(0);
    expect(resultRankPunch(40).scale).toBeGreaterThan(1.2);
    expect(resultRankPunch(40).alpha).toBeGreaterThan(0);
    expect(resultRankPunch(300).scale).toBe(1);
    expect(resultRankPunch(300).alpha).toBe(1);
  });
});
