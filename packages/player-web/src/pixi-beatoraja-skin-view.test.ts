import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { BeatorajaSkin } from '@be-music/beatoraja-skin';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';
import { BeatorajaPlaySkinView } from './pixi-beatoraja-skin-view.ts';

function fakeTextureCache(idsWithTextures: ReadonlyArray<number>): BeatorajaTextureCache {
  // The view explicitly skips any sprite whose texture is `Texture.EMPTY` (the renderer crashes on WebGPU when a
  // sub-texture is built off an empty source — see the `BindGroupSystem._createBindGroup` null-deref). For the
  // tests we synthesize a tiny non-empty `TextureSource` so the view treats the entry as a real texture; we
  // never actually paint these to a GPU, so the bytes are irrelevant.
  const fakeSource = new TextureSource({ resource: new Uint8Array(4), width: 1, height: 1 });
  const map = new Map<number, Texture>();
  for (const id of idsWithTextures) {
    map.set(id, new Texture({ source: fakeSource }));
  }
  return {
    get: (id) => map.get(id),
    values: () => map.values(),
    pathOf: () => undefined,
  };
}

function makeSkin(extra: Partial<BeatorajaSkin> = {}): BeatorajaSkin {
  return {
    type: 0,
    w: 1280,
    h: 720,
    image: [{ id: 1, src: 0, x: 0, y: 0, w: 100, h: 100 }],
    destination: [
      {
        id: 1,
        timer: 0,
        loop: -1,
        offset: 0,
        dst: [{ time: 0, x: 10, y: 20, w: 100, h: 100, a: 255, r: 255, g: 255, b: 255 }],
      },
    ],
    ...extra,
  };
}

describe('BeatorajaPlaySkinView', () => {
  it('builds a sprite per `(image, destination)` pair', () => {
    const view = new BeatorajaPlaySkinView({ skin: makeSkin(), textures: fakeTextureCache([0]) });
    expect(view.container.children).toHaveLength(1);
    expect(view.width).toBe(1280);
    expect(view.height).toBe(720);
    view.dispose();
  });

  it('orders children by destination offset, breaking ties by declaration order', () => {
    const skin = makeSkin({
      image: [
        { id: 1, src: 0, x: 0, y: 0, w: 1, h: 1 },
        { id: 2, src: 0, x: 0, y: 0, w: 1, h: 1 },
        { id: 3, src: 0, x: 0, y: 0, w: 1, h: 1 },
      ],
      destination: [
        { id: 1, offset: 5, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
        { id: 2, offset: 0, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
        { id: 3, offset: 5, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
      ],
    });
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    // Offset 0 (id=2) renders first, then offset-5 entries in source order (id=1, id=3).
    const children = view.container.children;
    expect(children).toHaveLength(3);
    view.dispose();
  });

  it('skips entries when the image lookup fails', () => {
    const skin = makeSkin({
      image: [{ id: 1, src: 0, x: 0, y: 0, w: 1, h: 1 }],
      destination: [
        { id: 1, dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
        { id: 'unknown', dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] },
      ],
    });
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    expect(view.container.children).toHaveLength(1);
    view.dispose();
  });

  it('updates sprite props from the keyframe sample', () => {
    const view = new BeatorajaPlaySkinView({ skin: makeSkin(), textures: fakeTextureCache([0]) });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    const sprite = view.container.children[0] as { x: number; y: number; visible: boolean; alpha: number };
    expect(sprite.visible).toBe(true);
    expect(sprite.x).toBe(10);
    expect(sprite.y).toBe(20);
    expect(sprite.alpha).toBe(1);
    view.dispose();
  });

  it('hides sprites past the last keyframe with loop=-1', () => {
    const skin = makeSkin({
      destination: [
        {
          id: 1,
          timer: 0,
          loop: -1,
          dst: [
            { time: 0, x: 0, y: 0, w: 100, h: 100, a: 255 },
            { time: 1000, a: 0 },
          ],
        },
      ],
    });
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 2000 });
    const sprite = view.container.children[0] as { visible: boolean };
    expect(sprite.visible).toBe(false);
    view.dispose();
  });

  it('honors `op` visibility gating against the active op set', () => {
    const skin = makeSkin({
      destination: [
        {
          id: 1,
          timer: 0,
          op: [920],
          dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }],
        },
      ],
    });
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]) });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    expect((view.container.children[0] as { visible: boolean }).visible).toBe(false);
    view.update({ activeOps: new Set([920]), getTimerStart: () => 0, nowMs: 0 });
    expect((view.container.children[0] as { visible: boolean }).visible).toBe(true);
    view.dispose();
  });

  it('calls resolveRefValue when the image has a `ref` op', () => {
    const skin = makeSkin({
      image: [{ id: 1, src: 0, x: 0, y: 0, w: 100, h: 110, divy: 11, ref: 370, len: 11 }],
      destination: [{ id: 1, timer: 0, dst: [{ time: 0, x: 0, y: 0, w: 100, h: 110 }] }],
    });
    const resolveRefValue = vi.fn().mockReturnValue(3);
    const view = new BeatorajaPlaySkinView({ skin, textures: fakeTextureCache([0]), resolveRefValue });
    view.update({ activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 });
    expect(resolveRefValue).toHaveBeenCalledWith(370);
    view.dispose();
  });

  it('dispose() detaches sprites from the container without throwing', () => {
    const view = new BeatorajaPlaySkinView({ skin: makeSkin(), textures: fakeTextureCache([0]) });
    expect(() => view.dispose()).not.toThrow();
    expect(view.container.destroyed).toBe(true);
  });
});
