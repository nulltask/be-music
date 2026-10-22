import { describe, expect, it, vi } from 'vite-plus/test';
import { Texture } from 'pixi.js';
import { loadSkinBitmapFonts } from './font-loader.ts';

const loadImage = vi.hoisted(() => vi.fn());
vi.mock('../../media/textures.ts', () => ({ loadTextureFromBytes: loadImage, attachBlobURLToTexture: vi.fn() }));

describe('LR2 bitmap font sheets', () => {
  it('loads PNG sheets through the image decoder rather than extensionless blob URLs', async () => {
    loadImage.mockResolvedValue(Texture.WHITE);
    const png = new Uint8Array([137, 80, 78, 71]);
    const font = new TextEncoder().encode('#S,84\n#T,0,font_0.png\n#R,82,0,0,0,42,82');
    const loaded = await loadSkinBitmapFonts(
      ['font/title/font.lr2font'],
      new Map([
        ['font/title/font.lr2font', font],
        ['font/title/font_0.png', png],
      ]),
    );
    expect(loadImage).toHaveBeenCalledWith('font_0.png', png);
    expect(loaded.get(0)?.textures.get(0)).toBe(Texture.WHITE);
  });
});
