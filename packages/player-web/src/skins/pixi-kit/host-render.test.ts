import { RendererType, type Renderer } from 'pixi.js';
import { describe, expect, it } from 'vite-plus/test';
import { acceptsHostRenderer, PIXI_HOST_TARGET, pixiHostRender, pixiHostTarget } from './host-render.ts';

const renderer = (type: RendererType) => ({ type }) as Renderer;

describe('acceptsHostRenderer', () => {
  it('takes any renderer for a skin that does not need WebGL', () => {
    expect(acceptsHostRenderer(renderer(RendererType.WEBGL), false)).toBe(true);
    expect(acceptsHostRenderer(renderer(RendererType.WEBGPU), false)).toBe(true);
  });

  it('takes only a WebGL renderer for a skin that needs WebGL', () => {
    expect(acceptsHostRenderer(renderer(RendererType.WEBGL), true)).toBe(true);
    expect(acceptsHostRenderer(renderer(RendererType.WEBGPU), true)).toBe(false);
  });
});

describe('pixiHostRender / pixiHostTarget', () => {
  it('reads nothing from a plain skin or surface', () => {
    expect(pixiHostRender({ id: 'plain' })).toBeUndefined();
    expect(pixiHostTarget({ width: 1 })).toBeUndefined();
  });

  it('reads the target a host put on a surface', () => {
    const target = { renderer: renderer(RendererType.WEBGL), texture: {} };
    const surface = Object.defineProperty({ width: 1 }, PIXI_HOST_TARGET, { value: target });
    expect(pixiHostTarget(surface)).toBe(target);
  });
});
