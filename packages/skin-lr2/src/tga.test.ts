import { expect, test } from 'vite-plus/test';
import { decodeTGA, isTGAImage } from './tga.ts';

// Truevision TGA 2.0 image header. Byte 17 stores origin and the number of attribute bits.
function image(
  spec: { type: number; bits: number; width: number; height: number; descriptor: number; id?: string },
  pixels: readonly number[],
): Uint8Array {
  const id = new TextEncoder().encode(spec.id ?? '');
  const header = new Uint8Array(18);
  const view = new DataView(header.buffer);
  header[0] = id.length;
  header[2] = spec.type;
  view.setUint16(12, spec.width, true);
  view.setUint16(14, spec.height, true);
  header[16] = spec.bits;
  header[17] = spec.descriptor;
  return Uint8Array.of(...header, ...id, ...pixels);
}

test('24-bit font pixels skip the image ID and turn bottom-up BGR into top-down opaque RGBA', () => {
  const encoded = image({ type: 2, bits: 24, width: 2, height: 2, descriptor: 0, id: 'atlas' }, [
    255,
    0,
    0,
    0,
    255,
    255, // Bottom: blue, yellow.
    0,
    0,
    255,
    0,
    255,
    0, // Top: red, green.
  ]);
  expect(isTGAImage(encoded)).toBe(true);
  expect(decodeTGA(encoded)).toEqual({
    width: 2,
    height: 2,
    data: Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255),
  });
});

test('32-bit RLE preserves alpha in both consecutive and repeated pixels', () => {
  const encoded = image({ type: 10, bits: 32, width: 4, height: 1, descriptor: 0x28 }, [
    0x01,
    3,
    2,
    1,
    32,
    6,
    5,
    4,
    128, // Two literal pixels.
    0x81,
    9,
    8,
    7,
    240, // Two copies of one pixel.
  ]);
  expect(decodeTGA(encoded)).toEqual({
    width: 4,
    height: 1,
    data: Uint8ClampedArray.of(1, 2, 3, 32, 4, 5, 6, 128, 7, 8, 9, 240, 7, 8, 9, 240),
  });
});

test.each([
  { type: 3, bits: 8, descriptor: 0x20, bytes: [9, 208], rgba: [9, 9, 9, 255, 208, 208, 208, 255] },
  { type: 11, bits: 16, descriptor: 0x28, bytes: [0, 48, 16, 0, 200, 128], rgba: [48, 48, 48, 16, 200, 200, 200, 128] },
  { type: 2, bits: 16, descriptor: 0x21, bytes: [0, 0xfc, 0x1f, 0], rgba: [255, 0, 0, 255, 0, 0, 255, 0] },
])('decodes image type $type at $bits bits', ({ type, bits, descriptor, bytes, rgba }) => {
  const encoded = image({ type, bits, width: 2, height: 1, descriptor }, bytes);
  expect(decodeTGA(encoded)?.data).toEqual(Uint8ClampedArray.from(rgba));
});

test.each([
  ['no packet', []],
  ['truncated repeated pixel', [0x81, 1, 2]],
  ['truncated literal packet', [0x01, 1, 2, 3]],
] as const)('rejects a truncated RLE atlas with %s', (_, bytes) => {
  expect(decodeTGA(image({ type: 10, bits: 24, width: 2, height: 1, descriptor: 0x20 }, bytes))).toBeUndefined();
});

test('rejects unsupported atlases and does not mistake a partial header for a TGA', () => {
  const base = { type: 2, bits: 24, width: 1, height: 1, descriptor: 0 };
  const indexed = image({ ...base, type: 1 }, [0]);
  indexed[1] = 1;
  const incompleteID = image(base, []);
  incompleteID[0] = 5;
  for (const encoded of [
    indexed,
    incompleteID,
    image({ ...base, width: 0 }, []),
    image({ ...base, bits: 40 }, []),
    image({ ...base, type: 0 }, []),
  ]) {
    expect(decodeTGA(encoded)).toBeUndefined();
  }
  const partial = Uint8Array.of(0, 0, 2);
  expect(isTGAImage(partial)).toBe(false);
  expect(decodeTGA(partial)).toBeUndefined();
});
