import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import {
  canDrawBGAPixelsOnGPU,
  drawBGAPixelsOnGPU,
  resetBGAPixelProcessorForTest,
  resolveBGAPixelUniforms,
} from './bga-gpu-pixels.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  resetBGAPixelProcessorForTest();
});

describe('resolveBGAPixelUniforms', () => {
  test("folds applyBMSColorKey's rules into the shader's keys", () => {
    expect(resolveBGAPixelUniforms({ bmsColorKey: { a: 0, r: 1, g: 2, b: 3 } }).bmsKey).toEqual([1, 2, 3, 0]);
    // A source without its own alpha compares against 0, so an EXBMP key with alpha keys nothing.
    expect(resolveBGAPixelUniforms({ bmsColorKey: { a: 255, r: 1, g: 2, b: 3 } }).bmsKey).toBeUndefined();
    // The all-zero tuple and out-of-range values disable a key.
    expect(resolveBGAPixelUniforms({ bmsColorKey: { a: 0, r: 0, g: 0, b: 0 } }).bmsKey).toBeUndefined();
    expect(resolveBGAPixelUniforms({ swBGAColorKey: { a: 255, r: 256, g: 0, b: 0 } }).swKey).toBeUndefined();
    expect(resolveBGAPixelUniforms({ swBGAColorKey: { a: 255, r: 9, g: 8, b: 7 } }).swKey).toEqual([9, 8, 7, 255]);
  });

  test('turns a tint into per-channel factors, white when there is none', () => {
    expect(resolveBGAPixelUniforms({}).tint).toEqual([1, 1, 1]);
    expect(resolveBGAPixelUniforms({ tint: 0xff8000 }).tint).toEqual([1, 128 / 255, 0]);
  });
});

describe('drawBGAPixelsOnGPU', () => {
  test('falls back, and stays fallen back, where WebGL2 is missing or throws while setting up', () => {
    const createElement = vi.fn(() => ({ getContext: () => null }));
    vi.stubGlobal('document', { createElement });
    expect(canDrawBGAPixelsOnGPU()).toBe(false);
    expect(drawBGAPixelsOnGPU({} as TexImageSource, 4, 4, {}, {} as CanvasRenderingContext2D)).toBe(false);
    expect(createElement).toHaveBeenCalledOnce();
    resetBGAPixelProcessorForTest();
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => {
          throw new Error('driver');
        },
      }),
    });
    expect(canDrawBGAPixelsOnGPU()).toBe(false);
  });
});
