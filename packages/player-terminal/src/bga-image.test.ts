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
    expect(image).toMatchObject({ width: 2, height: 1, format: 'png' });
    expect([...image.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
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

  test('decodes a JPEG', () => {
    const data = Buffer.alloc(4 * 4 * 4, 128);
    const encoded = jpeg.encode({ width: 4, height: 4, data }, 90);
    const image = decodeImageBuffer(Buffer.from(encoded.data), 'image.jpg');
    expect(image).toMatchObject({ width: 4, height: 4, format: 'jpeg' });
    expect(image.data).toHaveLength(4 * 4 * 4);
  });
});
