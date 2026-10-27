import { describe, expect, it } from 'vite-plus/test';
import { formatEnumLabel } from './labels.ts';

describe('formatEnumLabel', () => {
  it('spaces snake case and camel case and upper-cases the result', () => {
    expect(formatEnumLabel('FULL_COMBO')).toBe('FULL COMBO');
    expect(formatEnumLabel('emptyPoor')).toBe('EMPTY POOR');
    expect(formatEnumLabel('perfect')).toBe('PERFECT');
    expect(formatEnumLabel('BEST_CLEAR')).toBe('BEST CLEAR');
  });
});
