import { Sprite, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vite-plus/test';
import type { BeatorajaSkin } from '@be-music/beatoraja-skin';
import { BeatorajaBGALayer } from './bga.ts';

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

describe('BeatorajaBGALayer', () => {
  it('hides missing BGA cues without swapping a rendered sprite back to Texture.EMPTY', () => {
    const validTexture = fakeTexture();
    const layer = new BeatorajaBGALayer({
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
    const sprite = layer.container.children[1] as Sprite;

    layer.update(0, { activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 }, false);
    expect(sprite.visible).toBe(true);
    expect(sprite.texture).toBe(validTexture);

    layer.update(1.1, { activeOps: new Set(), getTimerStart: () => 0, nowMs: 1100 }, false);
    expect(sprite.visible).toBe(false);
    expect(sprite.texture).toBe(validTexture);
    expect(sprite.texture).not.toBe(Texture.EMPTY);

    layer.dispose();
  });

  it('centers a small image top-aligned on the 256x256 canvas over a black fill', () => {
    const layer = new BeatorajaBGALayer({
      skin: skin(),
      textures: new Map([['01', fakeTexture()]]),
      cues: { base: [{ seconds: 0, bmpKey: '01' }], layer: [], poor: [] },
    });
    const [canvas, sprite] = layer.container.children as Sprite[];

    layer.update(0, { activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 }, false);
    // The 320x240 destination scales the canvas by 1.25 x 0.9375; a 1x1 image sits at canvas x 127, y 0.
    expect(canvas!.visible).toBe(true);
    expect([canvas!.x, canvas!.width, canvas!.height]).toEqual([100, 320, 240]);
    expect([sprite!.x, sprite!.y, sprite!.width, sprite!.height]).toEqual([258.75, canvas!.y, 1.25, 0.9375]);

    layer.dispose();
  });

  it('cross-fades a stitched NONSTOP chart from one stage to the next at the seam', () => {
    const red = fakeTexture();
    const blue = fakeTexture();
    const layer = new BeatorajaBGALayer({
      skin: skin(),
      textures: new Map([
        ['01', red],
        ['02', blue],
      ]),
      // The stitched chart's latest cue is the second stage's.
      cues: {
        base: [
          { seconds: 0, bmpKey: '01' },
          { seconds: 18, bmpKey: '02' },
        ],
        layer: [],
        poor: [],
      },
      nonstop: {
        stages: [
          { windowStart: 0, windowEnd: 20, bmpKeys: ['01'], bgaFadeOut: { start: 20, end: 23 } },
          { windowStart: 20, windowEnd: Number.POSITIVE_INFINITY, bmpKeys: ['02'], bgaFadeIn: { start: 17, end: 20 } },
        ],
        timelines: [
          { base: [{ seconds: 0, bmpKey: '01' }], layer: [], poor: [] },
          { base: [{ seconds: 18, bmpKey: '02' }], layer: [], poor: [] },
        ],
      },
    });
    const context = { activeOps: new Set<number>(), getTimerStart: () => 0, nowMs: 0 };
    const shown = () =>
      (layer.container.children as Sprite[])
        .filter((sprite) => sprite.label === 'bga/base' && sprite.visible)
        .map((sprite) => ({ texture: sprite.texture, alpha: sprite.alpha }));

    layer.update(10, context, false);
    expect(shown()).toEqual([{ texture: red, alpha: 1 }]);

    // Before the seam the next stage fades in over the first, after it the first fades out under the next.
    layer.update(18.5, context, false);
    const fadingIn = shown();
    expect(fadingIn.map((entry) => entry.texture)).toEqual([red, blue]);
    expect(fadingIn[0]!.alpha).toBe(1);
    expect(fadingIn[1]!.alpha).toBeCloseTo(0.5);
    layer.update(21.5, context, false);
    const fadingOut = shown();
    expect(fadingOut.map((entry) => entry.texture)).toEqual([red, blue]);
    expect(fadingOut[0]!.alpha).toBeCloseTo(0.5);
    expect(fadingOut[1]!.alpha).toBe(1);

    layer.update(24, context, false);
    expect(shown()).toEqual([{ texture: blue, alpha: 1 }]);

    layer.dispose();
  });

  it('draws the layer over the base, and the POOR image in place of both during a miss', () => {
    const base = fakeTexture();
    const layerImage = fakeTexture();
    const poor = fakeTexture();
    const layer = new BeatorajaBGALayer({
      skin: skin(),
      textures: new Map([
        ['01', base],
        ['03', poor],
      ]),
      layerTextures: new Map([['02', layerImage]]),
      cues: {
        base: [{ seconds: 0, bmpKey: '01' }],
        layer: [{ seconds: 0, bmpKey: '02' }],
        poor: [{ seconds: 0, bmpKey: '03' }],
      },
    });
    const context = { activeOps: new Set<number>(), getTimerStart: () => 0, nowMs: 0 };
    const shown = () =>
      (layer.container.children as Sprite[])
        .filter((sprite) => sprite.label !== 'bga/canvas' && sprite.visible)
        .map((sprite) => [sprite.label, sprite.texture]);

    layer.update(1, context, false);
    expect(shown()).toEqual([
      ['bga/base', base],
      ['bga/layer', layerImage],
    ]);

    layer.update(1, context, true);
    expect(shown()).toEqual([['bga/base', poor]]);

    layer.dispose();
  });
});
