import { describe, expect, it } from 'vitest';
import { decodeDdsImageData } from './dds.ts';

/**
 * Builds the canonical 128-byte DDS header for an uncompressed 32-bit BGRA / RGBA surface. Test cases pass the
 * width/height + channel-byte-order masks; the helper takes care of the boilerplate (magic, flags, header sizes).
 */
function buildBgra32Header(
  width: number,
  height: number,
  masks: { r: number; g: number; b: number; a: number },
): Uint8Array {
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  // Magic 'DDS ' at offset 0.
  view.setUint32(0, 0x20534444, true);
  // dwSize (124) at offset 4.
  view.setUint32(4, 124, true);
  // dwFlags at offset 8 — we don't validate this in the decoder, so any non-zero is fine for the fixture.
  view.setUint32(8, 0x000a1007, true);
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  // DDS_PIXELFORMAT block @ 76.
  view.setUint32(76, 32, true); // dwSize
  view.setUint32(80, 0x41, true); // dwFlags = DDPF_ALPHAPIXELS | DDPF_RGB
  view.setUint32(84, 0, true); // dwFourCC (none)
  view.setUint32(88, 32, true); // dwRGBBitCount
  view.setUint32(92, masks.r, true);
  view.setUint32(96, masks.g, true);
  view.setUint32(100, masks.b, true);
  view.setUint32(104, masks.a, true);
  return header;
}

const BGRA_MASKS = { r: 0x00ff0000, g: 0x0000ff00, b: 0x000000ff, a: 0xff000000 } as const;
const RGBA_MASKS = { r: 0x000000ff, g: 0x0000ff00, b: 0x00ff0000, a: 0xff000000 } as const;

function concat(...chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

describe('decodeDdsImageData', () => {
  it('decodes a 2x1 BGRA32 surface, swizzling channels to RGBA', () => {
    // Two pixels stored in DDS-native order: [B, G, R, A]
    //   Pixel 0: B=0x11 G=0x22 R=0x33 A=0xff → RGBA after swizzle: 0x33 0x22 0x11 0xff
    //   Pixel 1: B=0x44 G=0x55 R=0x66 A=0x80 → RGBA: 0x66 0x55 0x44 0x80
    const header = buildBgra32Header(2, 1, BGRA_MASKS);
    const pixels = new Uint8Array([0x11, 0x22, 0x33, 0xff, 0x44, 0x55, 0x66, 0x80]);
    const result = decodeDdsImageData(concat(header, pixels));
    expect(result).toBeDefined();
    expect(result!.width).toBe(2);
    expect(result!.height).toBe(1);
    expect(Array.from(result!.rgba)).toEqual([0x33, 0x22, 0x11, 0xff, 0x66, 0x55, 0x44, 0x80]);
  });

  it('passes a 1x1 RGBA32 surface through unchanged (masks already encode RGBA byte order)', () => {
    const header = buildBgra32Header(1, 1, RGBA_MASKS);
    const pixels = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const result = decodeDdsImageData(concat(header, pixels));
    expect(result).toBeDefined();
    expect(Array.from(result!.rgba)).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });

  it('forces alpha to 0xff when DDPF_ALPHAPIXELS is not set', () => {
    // RGB-only surface: alpha mask is 0 and the flags bit is cleared. The decoder should ignore the source A byte
    // and emit fully-opaque pixels — matches the "no alpha channel" convention LR2 themes occasionally use for
    // backgrounds.
    const header = buildBgra32Header(1, 1, { ...BGRA_MASKS, a: 0 });
    new DataView(header.buffer).setUint32(80, 0x40, true); // DDPF_RGB only, no DDPF_ALPHAPIXELS
    const pixels = new Uint8Array([0x10, 0x20, 0x30, 0x40]); // B, G, R, (garbage A)
    const result = decodeDdsImageData(concat(header, pixels));
    expect(result).toBeDefined();
    expect(Array.from(result!.rgba)).toEqual([0x30, 0x20, 0x10, 0xff]);
  });

  it('rejects DXT-compressed surfaces (DDPF_FOURCC set)', () => {
    const header = buildBgra32Header(4, 4, BGRA_MASKS);
    // Flip the flags to indicate a fourCC payload.
    new DataView(header.buffer).setUint32(80, 0x04, true);
    new DataView(header.buffer).setUint32(84, 0x31545844, true); // 'DXT1'
    // 4x4 DXT1 block = 8 bytes; doesn't matter for this test, the decoder bails before reading any pixels.
    const block = new Uint8Array(8);
    expect(decodeDdsImageData(concat(header, block))).toBeUndefined();
  });

  it('rejects non-32-bit RGB surfaces (e.g. R5G6B5)', () => {
    const header = buildBgra32Header(2, 1, BGRA_MASKS);
    new DataView(header.buffer).setUint32(88, 16, true); // rgbBitCount = 16
    expect(decodeDdsImageData(concat(header, new Uint8Array(4)))).toBeUndefined();
  });

  it('rejects too-short input (header truncated)', () => {
    expect(decodeDdsImageData(new Uint8Array(64))).toBeUndefined();
  });

  it('rejects wrong magic bytes', () => {
    const header = new Uint8Array(128); // magic is 0x00000000 → not 'DDS '
    expect(decodeDdsImageData(header)).toBeUndefined();
  });

  it('rejects truncated pixel data', () => {
    const header = buildBgra32Header(4, 4, BGRA_MASKS);
    // Should ship 4 * 4 * 4 = 64 bytes of pixel data; provide only 32.
    const pixels = new Uint8Array(32);
    expect(decodeDdsImageData(concat(header, pixels))).toBeUndefined();
  });

  it('rejects exotic non-byte-aligned channel masks', () => {
    // R5G6B5 / A1R5G5B5 style masks (`0x7C00`, `0x03E0`, …) aren't byte-aligned and not in scope for this decoder.
    // The mask resolver returns undefined and decode bails — same outcome as the rgbBitCount rejection above but
    // through a different code path.
    const header = buildBgra32Header(2, 1, { r: 0x7c00, g: 0x03e0, b: 0x001f, a: 0x8000 });
    new DataView(header.buffer).setUint32(88, 32, true); // keep at 32 to exercise the mask branch specifically
    const pixels = new Uint8Array(8);
    expect(decodeDdsImageData(concat(header, pixels))).toBeUndefined();
  });
});
