import { describe, expect, it } from 'vite-plus/test';
import { keyBeamEdgeWidth } from './key-beam.ts';

describe('keyBeamEdgeWidth', () => {
  it('uses 2 px rails on lanes wide enough to keep a clear middle', () => {
    expect(keyBeamEdgeWidth(18)).toBe(2);
    expect(keyBeamEdgeWidth(41)).toBe(2);
  });

  it('falls back to 1 px rails on narrow lanes', () => {
    expect(keyBeamEdgeWidth(17)).toBe(1);
    expect(keyBeamEdgeWidth(10.5)).toBe(1);
  });
});
