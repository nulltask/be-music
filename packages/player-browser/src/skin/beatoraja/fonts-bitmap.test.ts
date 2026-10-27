import { afterEach, expect, it, vi } from 'vite-plus/test';
import { Texture } from 'pixi.js';
import { loadTextureFromBytes } from '../../media/textures.ts';
import { loadBeatorajaFonts } from './fonts.ts';

const { constructFont } = vi.hoisted(() => ({ constructFont: vi.fn() }));
vi.mock('../../media/textures.ts', () => ({ loadTextureFromBytes: vi.fn() }));
vi.mock('pixi.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pixi.js')>();
  return {
    ...actual,
    BitmapFont: class {
      constructor(options: unknown) {
        constructFont(options);
      }
      destroy() {}
    },
  };
});
afterEach(() => vi.clearAllMocks());

it('decodes TGA and PNG bitmap font pages through the shared image loader in page order', async () => {
  const first = new Texture();
  const second = new Texture();
  vi.mocked(loadTextureFromBytes).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const tga = new Uint8Array([1]);
  const png = new Uint8Array([2]);
  const cache = await loadBeatorajaFonts({
    entryPath: 'skin/play.json',
    fonts: [{ id: 0, path: 'font/font.fnt' }],
    files: new Map([
      [
        'skin/font/font.fnt',
        new TextEncoder().encode(`info face="Test" size=16
common lineHeight=16 base=12 scaleW=16 scaleH=16 pages=2 packed=0
page id=0 file="font_00.tga"
page id=1 file="font_01.png"
chars count=2
char id=65 x=0 y=0 width=8 height=8 xoffset=0 yoffset=0 xadvance=8 page=0 chnl=15
char id=66 x=0 y=0 width=8 height=8 xoffset=0 yoffset=0 xadvance=8 page=1 chnl=15`),
      ],
      ['skin/font/font_00.tga', tga],
      ['skin/font/font_01.png', png],
    ]),
  });
  expect(loadTextureFromBytes).toHaveBeenNthCalledWith(1, 'skin/font/font_00.tga', tga);
  expect(loadTextureFromBytes).toHaveBeenNthCalledWith(2, 'skin/font/font_01.png', png);
  expect(constructFont).toHaveBeenCalledWith(expect.objectContaining({ textures: [first, second] }));
  expect(cache.kind(0)).toBe('bitmap');
  cache.dispose();
});
