import { inflateSync } from 'node:zlib';
import { describe, expect, test } from 'vite-plus/test';
import { adler32, crc32, encodeIndexedPng, fillRect, storedZlib, type IndexedImage } from './png.ts';

const ascii = (text: string) => new TextEncoder().encode(text);

describe('palette PNG', () => {
  test('crc32 and adler32 match their check values', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(ascii('6789'), crc32(ascii('12345')))).toBe(0xcbf43926);
    expect(adler32(ascii('Wikipedia'))).toBe(0x11e60398);
    expect(adler32(new Uint8Array(0))).toBe(1);
  });

  test('storedZlib round-trips through zlib, across several stored blocks', () => {
    const data = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 7) & 255);
    expect(new Uint8Array(inflateSync(storedZlib(data)))).toEqual(data);
    expect(new Uint8Array(inflateSync(storedZlib(new Uint8Array(0))))).toEqual(new Uint8Array(0));
  });

  test('fillRect clips to the image', () => {
    const image: IndexedImage = { width: 4, height: 3, palette: new Uint8Array(6), pixels: new Uint8Array(12) };
    fillRect(image, -2, 1, 4, 10, 1);
    expect([...image.pixels]).toEqual([0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0]);
  });

  test('encodeIndexedPng writes the header, the palette and every row', () => {
    const image: IndexedImage = {
      width: 3,
      height: 2,
      palette: new Uint8Array([0, 0, 0, 255, 0, 0]),
      pixels: new Uint8Array([0, 1, 0, 1, 1, 0]),
    };
    const png = encodeIndexedPng(image);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer);
    const chunks = new Map<string, Uint8Array>();
    for (let at = 8; at < png.length;) {
      const length = view.getUint32(at);
      const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
      const data = png.subarray(at + 8, at + 8 + length);
      expect(view.getUint32(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
      chunks.set(type, data);
      at += 12 + length;
    }
    expect([...chunks.keys()]).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND']);
    expect([...(chunks.get('IHDR') ?? [])]).toEqual([0, 0, 0, 3, 0, 0, 0, 2, 8, 3, 0, 0, 0]);
    expect([...(chunks.get('PLTE') ?? [])]).toEqual([0, 0, 0, 255, 0, 0]);
    expect([...inflateSync(chunks.get('IDAT') ?? new Uint8Array(0))]).toEqual([0, 0, 1, 0, 0, 1, 1, 0]);
  });
});
