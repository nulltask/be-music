import { describe, expect, it } from 'vite-plus/test';
import { capCenterOffset, capCenterOffsetEm, fontShorthand } from './text-metrics.ts';

describe('capCenterOffset', () => {
  it('is zero when the capitals are centred in the line box', () => {
    // Box from -80 (ascent) to +20 (descent): centre at -30 above the baseline; caps 60 tall centre at -30 too.
    expect(capCenterOffset(80, 20, 60)).toBe(0);
  });

  it('is positive for a top-heavy box (tall accent, shallow descender)', () => {
    // Anton-like metrics: the capitals sit 12 units below the box centre.
    expect(capCenterOffset(122.9, 12.2, 86.7)).toBeCloseTo(12, 6);
  });

  it('is zero for non-finite input', () => {
    expect(capCenterOffset(Number.NaN, 10, 10)).toBe(0);
  });
});

describe('fontShorthand', () => {
  it('quotes named families and leaves generic ones bare', () => {
    expect(fontShorthand('400', 100, 'Dela Gothic One, M PLUS 1p, sans-serif')).toBe(
      '400 100px "Dela Gothic One", "M PLUS 1p", sans-serif',
    );
  });

  it('does not double-quote pre-quoted names', () => {
    expect(fontShorthand('800', 12, '"Azeret Mono", monospace')).toBe('800 12px "Azeret Mono", monospace');
  });
});

describe('capCenterOffsetEm', () => {
  it('falls back to no correction without a DOM', () => {
    expect(capCenterOffsetEm('Anton', '400')).toBe(0);
  });
});
