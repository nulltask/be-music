import { describe, expect, it } from 'vite-plus/test';
import { setTextResolution, textResolution } from './resolution.ts';

describe('setTextResolution', () => {
  it('follows the surface density, capped at 8 and falling back to 1', () => {
    setTextResolution(2.5);
    expect(textResolution()).toBe(2.5);
    setTextResolution(12);
    expect(textResolution()).toBe(8);
    setTextResolution(0);
    expect(textResolution()).toBe(1);
    setTextResolution(Number.NaN);
    expect(textResolution()).toBe(1);
  });
});
