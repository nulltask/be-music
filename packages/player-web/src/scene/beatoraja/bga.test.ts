import { Sprite, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { BeatorajaSkin } from '@be-music/beatoraja-skin';
import { BeatorajaBgaLayer } from './bga.ts';

function fakeTexture(): Texture {
  return new Texture({ source: new TextureSource({ resource: new Uint8Array(4), width: 1, height: 1 }) });
}

function skin(): BeatorajaSkin {
  return {
    type: 0,
    w: 1280,
    h: 720,
    bga: { id: 'bga' },
    destination: [
      {
        id: 'bga',
        timer: 0,
        loop: -1,
        offset: 0,
        dst: [{ time: 0, x: 100, y: 120, w: 320, h: 240, a: 255, r: 255, g: 255, b: 255 }],
      },
    ],
  };
}

describe('BeatorajaBgaLayer', () => {
  it('hides missing BGA cues without swapping a rendered sprite back to Texture.EMPTY', () => {
    const validTexture = fakeTexture();
    const layer = new BeatorajaBgaLayer({
      skin: skin(),
      textures: new Map([['01', validTexture]]),
      cues: {
        base: [
          { seconds: 0, bmpKey: '01' },
          { seconds: 1, bmpKey: '02' },
        ],
        layer: [],
        poor: [],
      },
    });
    const sprite = layer.container.children[0] as Sprite;

    layer.update(0, { activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 }, false);
    expect(sprite.visible).toBe(true);
    expect(sprite.texture).toBe(validTexture);

    layer.update(1.1, { activeOps: new Set(), getTimerStart: () => 0, nowMs: 1100 }, false);
    expect(sprite.visible).toBe(false);
    expect(sprite.texture).toBe(validTexture);
    expect(sprite.texture).not.toBe(Texture.EMPTY);

    layer.dispose();
  });
});
