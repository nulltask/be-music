import { describe, expect, it } from 'vite-plus/test';
import type { WebGLRenderer } from 'pixi.js';
import { queueGpuPass, runGpuPasses } from './gpu-pass.ts';

const renderer = {} as WebGLRenderer;

describe('queueGpuPass / runGpuPasses', () => {
  it('runs queued passes once, in order, on the given renderer', () => {
    const seen: string[] = [];
    queueGpuPass((target) => seen.push(target === renderer ? 'a' : 'wrong'));
    queueGpuPass(() => seen.push('b'));
    runGpuPasses(renderer);
    runGpuPasses(renderer);
    expect(seen).toEqual(['a', 'b']);
  });

  it('keeps going after a failing pass and reports it', () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    queueGpuPass(() => {
      throw new Error('boom');
    });
    queueGpuPass(() => seen.push('after'));
    runGpuPasses(renderer, (error) => errors.push(error));
    expect(seen).toEqual(['after']);
    expect(errors).toHaveLength(1);
  });
});
