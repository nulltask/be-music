import { describe, expect, it } from 'vite-plus/test';
import type { WebGLRenderer } from 'pixi.js';
import { queueGPUPass, runGPUPasses } from './gpu-pass.ts';

const renderer = {} as WebGLRenderer;

describe('queueGPUPass / runGPUPasses', () => {
  it('runs queued passes once, in order, on the given renderer', () => {
    const seen: string[] = [];
    queueGPUPass((target) => seen.push(target === renderer ? 'a' : 'wrong'));
    queueGPUPass(() => seen.push('b'));
    runGPUPasses(renderer);
    runGPUPasses(renderer);
    expect(seen).toEqual(['a', 'b']);
  });

  it('keeps going after a failing pass and reports it', () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    queueGPUPass(() => {
      throw new Error('boom');
    });
    queueGPUPass(() => seen.push('after'));
    runGPUPasses(renderer, (error) => errors.push(error));
    expect(seen).toEqual(['after']);
    expect(errors).toHaveLength(1);
  });
});
