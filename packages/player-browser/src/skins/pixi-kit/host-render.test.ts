import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vite-plus/test';
import { PIXI_HOST_RENDER, PIXI_HOST_TARGET, pixiHostTarget, rendersOnPixiHost } from './host-render.ts';

describe('rendersOnPixiHost', () => {
  it('is true only for a skin marked with PIXI_HOST_RENDER', () => {
    expect(rendersOnPixiHost({ id: 'plain' })).toBe(false);
    expect(rendersOnPixiHost(Object.defineProperty({ id: 'pixi' }, PIXI_HOST_RENDER, { value: true }))).toBe(true);
  });
});

describe('pixiHostTarget', () => {
  it('reads nothing from a plain surface', () => {
    expect(pixiHostTarget({ width: 1 })).toBeUndefined();
  });

  it('reads the target a host put on a surface', () => {
    const target = { renderer: {} as Renderer, texture: {} as never };
    const surface = Object.defineProperty({ width: 1 }, PIXI_HOST_TARGET, { value: target });
    expect(pixiHostTarget(surface)).toBe(target);
  });
});
