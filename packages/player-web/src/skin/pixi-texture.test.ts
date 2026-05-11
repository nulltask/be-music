import { Rectangle, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createCachedCroppedTexture } from './pixi-texture.ts';

function texture(width = 64, height = 64): Texture {
  return new Texture({
    source: Texture.EMPTY.source,
    frame: new Rectangle(0, 0, width, height),
  });
}

describe('createCachedCroppedTexture', () => {
  it('reuses a crop texture for the same base texture and frame', () => {
    const base = texture();
    const rect = { x: 1, y: 2, w: 16, h: 24 };

    const first = createCachedCroppedTexture(base, rect);
    const second = createCachedCroppedTexture(base, rect);

    expect(first).toBe(second);
    expect(first?.source).toBe(base.source);
    expect(first?.frame).toMatchObject({ x: 1, y: 2, width: 16, height: 24 });
  });

  it('keeps separate cache entries for different bases and frames', () => {
    const firstBase = texture();
    const secondBase = texture();

    expect(createCachedCroppedTexture(firstBase, { x: 0, y: 0, w: 16, h: 16 })).not.toBe(
      createCachedCroppedTexture(firstBase, { x: 16, y: 0, w: 16, h: 16 }),
    );
    expect(createCachedCroppedTexture(firstBase, { x: 0, y: 0, w: 16, h: 16 })).not.toBe(
      createCachedCroppedTexture(secondBase, { x: 0, y: 0, w: 16, h: 16 }),
    );
  });

  it('skips missing and empty crops', () => {
    expect(createCachedCroppedTexture(undefined, { x: 0, y: 0, w: 1, h: 1 })).toBeUndefined();
    expect(createCachedCroppedTexture(texture(), { x: 0, y: 0, w: 0, h: 1 })).toBeUndefined();
    expect(createCachedCroppedTexture(texture(), { x: 0, y: 0, w: 1, h: -1 })).toBeUndefined();
  });

  it('optionally rejects non-finite frame values', () => {
    expect(
      createCachedCroppedTexture(texture(), { x: Number.NaN, y: 0, w: 1, h: 1 }, { requireFiniteFrame: true }),
    ).toBeUndefined();
  });
});
