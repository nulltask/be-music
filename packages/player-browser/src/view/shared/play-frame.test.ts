import { describe, expect, test } from 'vite-plus/test';
import { playEndingFadeAlpha } from './play-frame.ts';

describe('playEndingFadeAlpha', () => {
  test('fades from 1 to 0 over the fade-out, and stays at 1 without one', () => {
    expect(playEndingFadeAlpha(0, 1000)).toBe(1);
    expect(playEndingFadeAlpha(250, 1000)).toBe(0.75);
    expect(playEndingFadeAlpha(2000, 1000)).toBe(0);
    expect(playEndingFadeAlpha(500, 0)).toBe(1);
  });
});
