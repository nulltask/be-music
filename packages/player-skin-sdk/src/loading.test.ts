import { describe, expect, it } from 'vite-plus/test';
import { LOADING_DOT_MS, loadingDots } from './loading.ts';

describe('loadingDots', () => {
  it('grows to three dots and starts over', () => {
    expect(loadingDots(0)).toBe('');
    expect(loadingDots(LOADING_DOT_MS)).toBe('.');
    expect(loadingDots(LOADING_DOT_MS * 2 + 1)).toBe('..');
    expect(loadingDots(LOADING_DOT_MS * 3)).toBe('...');
    expect(loadingDots(LOADING_DOT_MS * 4)).toBe('');
  });

  it('treats a missing clock as the start', () => {
    expect(loadingDots(Number.NaN)).toBe('');
    expect(loadingDots(-50)).toBe('');
  });
});
