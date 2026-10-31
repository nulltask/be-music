import { Texture, TextureSource } from 'pixi.js';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { loadTextureFromBytes, registerImageDecoder } from './textures.ts';

class Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray | number, width: number, height?: number) {
    this.width = typeof data === 'number' ? data : width;
    this.height = typeof data === 'number' ? width : height!;
    this.data = typeof data === 'number' ? new Uint8ClampedArray(data * width * 4) : data;
  }
}

let nativePixels: Pixels;
let uploaded: Pixels[];
beforeEach(() => {
  uploaded = [];
  nativePixels = new Pixels(new Uint8ClampedArray([127, 127, 127, 255, 0, 0, 0, 255]), 2, 1);
  vi.stubGlobal('ImageData', Pixels);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (input: Pixels | Blob) => {
      const pixels = input instanceof Blob ? nativePixels : input;
      const bitmap = { width: pixels.width, height: pixels.height, data: pixels.data.slice(), close: vi.fn() };
      return bitmap;
    }),
  );
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = new Pixels(1, 1);
      return Object.assign(canvas, {
        getContext: () => ({
          drawImage: (image: Pixels) => {
            canvas.data = image.data.slice();
          },
          getImageData: () => new Pixels(canvas.data.slice(), canvas.width, canvas.height),
          putImageData: (image: Pixels) => {
            canvas.data = image.data.slice();
          },
        }),
      });
    },
  });
  vi.spyOn(Texture, 'from').mockImplementation((input) => {
    const pixels = input as unknown as Pixels;
    uploaded.push(pixels);
    return new Texture({ source: new TextureSource({ resource: pixels, width: pixels.width, height: pixels.height }) });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('keys exact low-alpha PNG pixels before any ImageBitmap/Canvas premultiplication', async () => {
  const bytes = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEElEQVR4nGP4/2QtIxAzAQAaVAUktbc+swAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  );
  const original = bytes.slice();
  const texture = await loadTextureFromBytes('alpha.png', bytes, { bmsColorKey: { a: 1, r: 255, g: 228, b: 173 } });
  expect(texture).toBeDefined();
  expect([...uploaded[0]!.data]).toEqual([255, 228, 173, 0, 255, 228, 173, 2]);
  expect(bytes).toEqual(original);
  texture!.destroy(true);
});

test('uses encoded PNG alpha metadata instead of inserted RGBA alpha', async () => {
  const bytes = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAMAAAAoyzS7AAAAA1BMVEV/f3+QyhsjAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
    ),
    (c) => c.charCodeAt(0),
  );
  const texture = await loadTextureFromBytes('palette.png', bytes, {
    keyOutBlack: true,
    bmsColorKey: { a: 0, r: 127, g: 127, b: 127 },
  });
  expect([...uploaded[0]!.data]).toEqual([127, 127, 127, 0]);
  texture!.destroy(true);
});

test.each(['bmp', 'jpg'])(
  'replaces ordinary black keying and uses alpha zero for native %s pixels',
  async (extension) => {
    const bytes = extension === 'bmp' ? new Uint8Array(70) : new Uint8Array([255, 216, 255, 224]);
    if (extension === 'bmp') {
      bytes.set([66, 77]);
      const view = new DataView(bytes.buffer);
      view.setUint32(14, 40, true);
      view.setUint16(28, 24, true);
    }
    let texture = await loadTextureFromBytes(`colors.${extension}`, bytes, {
      keyOutBlack: true,
      bmsColorKey: { a: 0, r: 127, g: 127, b: 127 },
    });
    expect([...uploaded[0]!.data]).toEqual([127, 127, 127, 0, 0, 0, 0, 255]);
    texture!.destroy(true);
    texture = await loadTextureFromBytes(`colors.${extension}`, bytes, {
      keyOutBlack: true,
      bmsColorKey: { a: 0, r: 0, g: 0, b: 0 },
    });
    expect([...uploaded[1]!.data]).toEqual([...nativePixels.data]);
    texture!.destroy(true);
  },
);

test('keys TGA source alpha before conversion while keeping the adjacent alpha value', async () => {
  const bytes = new Uint8Array(26);
  bytes[2] = 2;
  bytes[12] = 2;
  bytes[14] = 1;
  bytes[16] = 32;
  bytes[17] = 0x28;
  bytes.set([173, 228, 255, 1, 173, 228, 255, 2], 18);
  const texture = await loadTextureFromBytes('alpha.tga', bytes, { bmsColorKey: { a: 1, r: 255, g: 228, b: 173 } });
  expect([...uploaded[0]!.data]).toEqual([255, 228, 173, 0, 255, 228, 173, 2]);
  texture!.destroy(true);
});

test.each([false, true])(
  'keys registered DDS RGBA buffers without mutating decoder-owned pixels (alpha=%s)',
  async (alpha) => {
    const bytes = new Uint8Array(128);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x20534444, true);
    view.setUint32(80, alpha ? 0x41 : 0x40, true);
    view.setUint32(104, alpha ? 0xff000000 : 0, true);
    const rgba = new Uint8ClampedArray([127, 127, 127, alpha ? 1 : 255, 0, 0, 0, 255]);
    const original = rgba.slice();
    registerImageDecoder('.keydds', () => ({ rgba, width: 2, height: 1 }));
    const texture = await loadTextureFromBytes('colors.keydds', bytes, {
      bmsColorKey: { a: alpha ? 1 : 0, r: 127, g: 127, b: 127 },
    });
    expect([...uploaded[0]!.data]).toEqual([127, 127, 127, 0, 0, 0, 0, 255]);
    expect(rgba).toEqual(original);
    texture!.destroy(true);
  },
);

test('SWBGA keys decoded opaque alpha, keeps black and distinguishes adjacent source alpha before Canvas', async () => {
  const bytes = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAYAAAAb4BS0AAAAEUlEQVR4nGP4DwH/GBgY/gMARMMI9xN1CmIAAAAASUVORK5CYII='),
    (c) => c.charCodeAt(0),
  );
  const texture = await loadTextureFromBytes('sw.png', bytes, {
    keyOutBlack: true,
    swBGAColorKey: { a: 255, r: 255, g: 255, b: 255 },
  });
  expect([...uploaded[0]!.data]).toEqual([255, 255, 255, 0, 255, 255, 255, 254, 0, 0, 0, 255]);
  texture!.destroy(true);
});

test('SWBGA composes its key with EXBMP on an alpha-less source without restoring keyed pixels', async () => {
  const bytes = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAIAAACUgoPjAAAAEklEQVR4nGP4////W3FvBgYGAB8fBE1J2Gx0AAAAAElFTkSuQmCC'),
    (c) => c.charCodeAt(0),
  );
  const texture = await loadTextureFromBytes('sw.png', bytes, {
    bmsColorKey: { a: 0, r: 237, g: 23, b: 75 },
    swBGAColorKey: { a: 255, r: 255, g: 255, b: 255 },
  });
  expect([...uploaded[0]!.data]).toEqual([255, 255, 255, 0, 237, 23, 75, 0, 0, 0, 0, 255]);
  texture!.destroy(true);
});
