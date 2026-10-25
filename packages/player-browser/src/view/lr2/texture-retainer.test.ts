import type { Texture } from 'pixi.js';
import type { LR2Skin } from '@be-music/skin-lr2';
import { describe, expect, it, vi } from 'vite-plus/test';
import { LR2TextureRetainer } from './texture-retainer.ts';

function texture(): Texture {
  return { destroy: vi.fn() } as unknown as Texture;
}

describe('LR2TextureRetainer', () => {
  it('returns the same textures when a skin is parked and adopted again', () => {
    const retainer = new LR2TextureRetainer();
    const skin = {} as LR2Skin;
    const image = texture();
    expect(retainer.keep(skin, new Map([['frame.png', image]])).size).toBe(0);
    expect(retainer.adopt(skin)?.get('frame.png')).toBe(image);
    expect(retainer.adopt(skin)).toBeUndefined();
    expect(image.destroy).not.toHaveBeenCalled();
  });

  it('keeps the first texture for a path and hands the duplicate back', () => {
    const retainer = new LR2TextureRetainer();
    const skin = {} as LR2Skin;
    const first = texture();
    const second = texture();
    retainer.keep(skin, new Map([['frame.png', first]]));
    const dropped = retainer.keep(skin, new Map([['frame.png', second]]));
    expect(dropped.get('frame.png')).toBe(second);
    expect(retainer.adopt(skin)?.get('frame.png')).toBe(first);
  });

  it('forgets parked textures when the play is over', () => {
    const retainer = new LR2TextureRetainer();
    const skin = {} as LR2Skin;
    retainer.keep(skin, new Map([['frame.png', texture()]]));
    retainer.destroyAll(undefined);
    expect(retainer.adopt(skin)).toBeUndefined();
  });
});
