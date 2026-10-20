import { Graphics, Texture } from 'pixi.js';
import { describe, expect, test } from 'vite-plus/test';
import { pointLayerFor } from './particle-layer.ts';

describe('pointLayerFor', () => {
  test('keeps one layer per anchor and texture', () => {
    const anchor = new Graphics();
    const glow = Texture.EMPTY;
    const white = pointLayerFor(anchor);
    expect(pointLayerFor(anchor)).toBe(white);
    expect(pointLayerFor(anchor, Texture.WHITE)).toBe(white);
    const textured = pointLayerFor(anchor, glow);
    expect(textured).not.toBe(white);
    expect(pointLayerFor(anchor, glow)).toBe(textured);
    expect(pointLayerFor(new Graphics())).not.toBe(white);
  });
});
