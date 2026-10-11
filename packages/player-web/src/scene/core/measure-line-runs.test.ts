import { describe, expect, it } from 'vite-plus/test';
import { resolveSideLaneRuns } from './measure-line-runs.ts';

describe('resolveSideLaneRuns', () => {
  it('merges edge-to-edge lanes into one run on the side of its leftmost lane', () => {
    const lanes = new Map([
      ['11', { x: 40, w: 20 }],
      ['16', { x: 0, w: 40 }],
      ['12', { x: 60, w: 20 }],
    ]);
    expect(resolveSideLaneRuns(lanes)).toEqual([{ side: '1P', x: 0, w: 80 }]);
  });

  it('splits double play into one run per side across the gap', () => {
    const lanes = new Map([
      ['16', { x: 0, w: 40 }],
      ['11', { x: 40, w: 20 }],
      ['21', { x: 200, w: 20 }],
      ['26', { x: 220, w: 40 }],
    ]);
    expect(resolveSideLaneRuns(lanes)).toEqual([
      { side: '1P', x: 0, w: 60 },
      { side: '2P', x: 200, w: 60 },
    ]);
  });

  it("keeps 9-key's 1x and 2x lanes in one 1P run", () => {
    const lanes = new Map([
      ['11', { x: 0, w: 30 }],
      ['15', { x: 30, w: 30 }],
      ['22', { x: 60, w: 30 }],
    ]);
    expect(resolveSideLaneRuns(lanes)).toEqual([{ side: '1P', x: 0, w: 90 }]);
  });

  it('tolerates sub-pixel seams and reports nothing for no lanes', () => {
    expect(resolveSideLaneRuns([['11', { x: 0, w: 20 }] as const, ['12', { x: 20.4, w: 20 }] as const])).toEqual([
      { side: '1P', x: 0, w: 40.4 },
    ]);
    expect(resolveSideLaneRuns(new Map())).toEqual([]);
  });
});
