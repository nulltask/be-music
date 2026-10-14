import { RendererType, type Renderer } from 'pixi.js';
import { describe, expect, it } from 'vite-plus/test';
import { BUILT_IN_BE_MUSIC_SKINS } from '../../skins/built-in.ts';
import { pixiHostRender } from '../../skins/pixi-kit/host-render.ts';

const renderer = (type: RendererType) => ({ type }) as Renderer;

function accepts(id: string, type: RendererType): boolean | undefined {
  const skin = BUILT_IN_BE_MUSIC_SKINS.find((candidate) => candidate.id === id);
  if (!skin) throw new Error(`no built-in skin "${id}"`);
  return pixiHostRender(skin)?.accepts(renderer(type));
}

describe('built-in skins drawing through the player renderer', () => {
  it('lets Phantom draw through a WebGL or WebGPU player', () => {
    expect(accepts('phantom', RendererType.WEBGL)).toBe(true);
    expect(accepts('phantom', RendererType.WEBGPU)).toBe(true);
  });

  it('keeps Synesthesia, whose GPU passes are GLSL, on its own canvas under WebGPU', () => {
    expect(accepts('synesthesia', RendererType.WEBGL)).toBe(true);
    expect(accepts('synesthesia', RendererType.WEBGPU)).toBe(false);
  });

  it('leaves Plain, a Canvas 2D skin, on its canvas', () => {
    expect(accepts('plain', RendererType.WEBGL)).toBeUndefined();
  });
});
