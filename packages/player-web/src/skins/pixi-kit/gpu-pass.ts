import type { WebGLRenderer } from 'pixi.js';

/** Work a skin wants done on the GPU before the frame is drawn, e.g. stepping a particle simulation in textures. */
export type GpuPass = (renderer: WebGLRenderer) => void;

const pending: GpuPass[] = [];

/**
 * Queues `pass` to run on the renderer that draws the frame being built, right before it is drawn. Call it while
 * building the frame (from `render`, `tick` or a chrome function); passes queued outside a build run before the next
 * frame instead.
 */
export function queueGpuPass(pass: GpuPass): void {
  pending.push(pass);
}

/** Runs and clears every queued pass, in the order they were queued. A failing pass doesn't stop the rest. */
export function runGpuPasses(renderer: WebGLRenderer, onError?: (error: unknown) => void): void {
  const passes = pending.splice(0);
  for (const pass of passes) {
    try {
      pass(renderer);
    } catch (error) {
      onError?.(error);
    }
  }
}
