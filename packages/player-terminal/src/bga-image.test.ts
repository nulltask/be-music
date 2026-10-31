import { encode as encodeBmp } from 'fast-bmp';
import { encode as encodePng } from 'fast-png';
import jpeg from 'jpeg-js';
import { describe, expect, test } from 'vite-plus/test';
import { decodeImageBuffer } from './bga-image.ts';

describe('decodeImageBuffer', () => {
  test('decodes a PNG into RGBA, adding opaque alpha to RGB data', () => {
    const png = Buffer.from(
      encodePng({ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 0, 0, 255]), depth: 8, channels: 3 }),
    );
    const image = decodeImageBuffer(png, 'image.png');
    expect(image).toMatchObject({ width: 2, height: 1, format: 'png', hasAlphaChannel: false });
    expect([...image.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });

  test('distinguishes an encoded opaque alpha channel from inserted RGBA alpha', () => {
    const data = new Uint8Array([127, 127, 127, 255, 255, 228, 173, 64]);
    const image = decodeImageBuffer(
      Buffer.from(encodePng({ width: 2, height: 1, data, depth: 8, channels: 4 })),
      'alpha.png',
    );
    expect(image.hasAlphaChannel).toBe(true);
    expect([...image.data]).toEqual([...data]);
  });

  test.each([
    [
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAMAAAAoyzS7AAAAA1BMVEV/f3+QyhsjAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
      false,
      255,
    ],
    [
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAMAAAAoyzS7AAAAA1BMVEV/f3+QyhsjAAAAAXRSTlOArV5bRgAAAApJREFUeJxjYAAAAAIAAUivpHEAAAAASUVORK5CYII=',
      true,
      128,
    ],
  ] as const)('detects encoded palette transparency instead of expanded RGBA (%s)', (base64, hasAlpha, alpha) => {
    // Owned one-pixel indexed PNGs with the same gray palette; only the second has a tRNS chunk.
    const image = decodeImageBuffer(Buffer.from(base64, 'base64'), 'palette.png');
    expect(image.hasAlphaChannel).toBe(hasAlpha);
    expect([...image.data]).toEqual([127, 127, 127, alpha]);
  });

  test.each([
    [
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAABnRSTlMAfwB/AH+KMzNPAAAAD0lEQVR4nGOor69n+M8AAAl2An3QNTIfAAAAAElFTkSuQmCC',
      [127, 127, 127, 0, 0, 255, 0, 255],
    ],
    [
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAgAAAACb+Tj3AAAAAnRSTlMAAQGU/a4AAAAKSURBVHicY0gAAABiAGGxmHnyAAAAAElFTkSuQmCC',
      [85, 85, 85, 0, 170, 170, 170, 255],
    ],
  ] as const)('expands native RGB/grayscale tRNS before color matching (%s)', (base64, rgba) => {
    const image = decodeImageBuffer(Buffer.from(base64, 'base64'), 'transparent.png');
    expect(image.hasAlphaChannel).toBe(true);
    expect([...image.data]).toEqual([...rgba]);
  });

  test('detects the format from the file header before the extension', () => {
    const png = Buffer.from(
      encodePng({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 4]), depth: 8, channels: 4 }),
    );
    expect(decodeImageBuffer(png, 'image.bmp').format).toBe('png');
  });

  test('decodes a BMP', () => {
    const bmp = Buffer.from(
      encodeBmp({
        width: 2,
        height: 1,
        data: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]),
        channels: 4,
        components: 3,
        bitsPerPixel: 32,
      }),
    );
    const image = decodeImageBuffer(bmp, 'image.bmp');
    expect(image).toMatchObject({ width: 2, height: 1, format: 'bmp' });
    expect(Array.from(image.data.subarray(0, 3))).toEqual([10, 20, 30]);
    expect(Array.from(image.data.subarray(4, 7))).toEqual([40, 50, 60]);
  });

  test.each([
    [[0, 0], false],
    [[128, 0], true],
  ] as const)('treats a 32-bit BMP alpha mask with alpha bytes %j as alpha=%s', (alphas, hasAlpha) => {
    const bmp = Buffer.from(
      encodeBmp({
        width: 2,
        height: 1,
        data: new Uint8Array([10, 20, 30, alphas[0], 40, 50, 60, alphas[1]]),
        channels: 4,
        components: 3,
        bitsPerPixel: 32,
      }),
    );
    expect(bmp.readUInt32LE(14)).toBeGreaterThanOrEqual(56);
    expect(bmp.readUInt32LE(66)).not.toBe(0);
    expect(decodeImageBuffer(bmp, 'image.bmp').hasAlphaChannel).toBe(hasAlpha);
  });

  test('decodes a JPEG', () => {
    const data = Buffer.alloc(4 * 4 * 4, 128);
    const encoded = jpeg.encode({ width: 4, height: 4, data }, 90);
    const image = decodeImageBuffer(Buffer.from(encoded.data), 'image.jpg');
    expect(image).toMatchObject({ width: 4, height: 4, format: 'jpeg' });
    expect(image.data).toHaveLength(4 * 4 * 4);
  });
});
