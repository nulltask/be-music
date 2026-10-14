import { describe, expect, it } from 'vite-plus/test';
import {
  DEFAULT_RENDER_RESOLUTION,
  nearestRenderResolution,
  parseStoredRenderResolution,
  renderResolutionLabel,
  renderResolutionSteps,
} from './render-resolution.ts';

describe('renderResolutionSteps', () => {
  it('offers 1× up to the display ratio in 0.5 steps', () => {
    expect(renderResolutionSteps(2)).toEqual([1, 1.5, 2]);
    expect(renderResolutionSteps(3)).toEqual([1, 1.5, 2, 2.5, 3]);
  });

  it('closes with the display ratio when it falls between steps', () => {
    expect(renderResolutionSteps(2.625)).toEqual([1, 1.5, 2, 2.5, 2.625]);
    expect(renderResolutionSteps(1.25)).toEqual([1, 1.25]);
  });

  it('offers only the display ratio at or below 1×', () => {
    expect(renderResolutionSteps(1)).toEqual([1]);
    expect(renderResolutionSteps(0.75)).toEqual([0.75]);
  });

  it('treats a missing ratio as 1×', () => {
    expect(renderResolutionSteps(Number.NaN)).toEqual([1]);
  });
});

describe('nearestRenderResolution', () => {
  it('picks the closest step, the lower one on a tie', () => {
    expect(nearestRenderResolution([1, 1.5, 2], 1.5)).toBe(1.5);
    expect(nearestRenderResolution([1, 1.5, 2], 3)).toBe(2);
    expect(nearestRenderResolution([1, 1.5, 2], 1.25)).toBe(1);
    expect(nearestRenderResolution([1], 1.5)).toBe(1);
  });
});

describe('renderResolutionLabel', () => {
  it('prints the value with a multiplication sign', () => {
    expect(renderResolutionLabel(1)).toBe('1×');
    expect(renderResolutionLabel(1.5)).toBe('1.5×');
    expect(renderResolutionLabel(2.625)).toBe('2.625×');
  });
});

describe('parseStoredRenderResolution', () => {
  it('reads a stored number', () => {
    expect(parseStoredRenderResolution('2')).toBe(2);
    expect(parseStoredRenderResolution('1')).toBe(1);
  });

  it('falls back to 1.5× when nothing usable is stored', () => {
    for (const stored of [null, '', 'abc', '0', '-1']) {
      expect(parseStoredRenderResolution(stored)).toBe(DEFAULT_RENDER_RESOLUTION);
    }
    expect(DEFAULT_RENDER_RESOLUTION).toBe(1.5);
  });
});
