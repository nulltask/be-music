import type { Application } from 'pixi.js';

const MAX_RENDERER_RESOLUTION = 2;

export function resolvePixiRendererResolution(): number {
  if (typeof window !== 'object') {
    return 1;
  }
  const dpr = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  return Math.min(MAX_RENDERER_RESOLUTION, Math.max(1, dpr));
}

export function syncPixiRendererDensity(app: Application, container: HTMLElement): number {
  const resolution = resolvePixiRendererResolution();
  if (Math.abs(app.renderer.resolution - resolution) <= 1e-6) {
    return resolution;
  }
  app.renderer.resolution = resolution;
  app.resize();
  return resolution;
}
