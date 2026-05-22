/**
 * DDS (DirectDraw Surface) decoder — minimal, scoped to what authored LR2 themes ship.
 *
 * Browsers don't natively decode DDS via `createImageBitmap`, so themes that use it (LITONE4 ships ~all of its
 * textures as `.dds`) need an explicit decoder before the texture can reach PixiJS. This module covers the format
 * variant we actually see in the wild — **uncompressed 32-bit BGRA** with `pfFlags = 0x41` (DDPF_ALPHAPIXELS |
 * DDPF_RGB), `rgbBitCount = 32`, no `fourCC`. Every `.dds` in LITONE4 (on-disk and DXA-internal) matches that
 * profile.
 *
 * Out of scope for this initial pass:
 * - DXT1 / DXT3 / DXT5 / BC4 / BC5 / BC7 block-compressed formats
 * - DX10 extended headers (`fourCC === 'DX10'`)
 * - Non-32-bit uncompressed pixel formats (R5G6B5, A1R5G5B5, etc.)
 *
 * Themes using those will return `undefined` from {@link decodeDdsImageData} and the caller falls back to whatever
 * "skin asset missing" path it has. Extending coverage later is straightforward — the header parsing here recovers
 * the fields the decoder would need.
 *
 * Spec reference: <https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header>.
 */

/** Decoded image ready to hand to `createImageBitmap` / `Texture.from`. RGBA byte order; 8 bits per channel. */
export interface DecodedDdsImage {
  width: number;
  height: number;
  /** RGBA8888 pixel data, row-major, top-to-bottom. Length === `width * height * 4`. */
  rgba: Uint8ClampedArray;
}

/**
 * DDS file magic — `'DDS '` (with trailing space). Stored at offset 0 as a 4-byte ASCII literal.
 */
const DDS_MAGIC = 0x20534444;
/** Total bytes from file start to the end of the `DDS_HEADER` (4-byte magic + 124-byte header). */
const DDS_HEADER_SIZE = 128;
/** Bit in `DDS_PIXELFORMAT.dwFlags` indicating the surface carries RGB color channels. */
const DDPF_RGB = 0x40;
/** Bit in `DDS_PIXELFORMAT.dwFlags` indicating the surface has an alpha channel. */
const DDPF_ALPHAPIXELS = 0x01;
/** Bit in `DDS_PIXELFORMAT.dwFlags` indicating the surface uses a `fourCC` (= block-compressed payload). */
const DDPF_FOURCC = 0x04;

/**
 * Decodes a DDS payload into an RGBA8888 buffer. Returns `undefined` for any of:
 *
 * - Input that's too short to contain the magic + header
 * - Wrong magic bytes (`'DDS '`)
 * - Header reports `DDPF_FOURCC` (= block-compressed, not yet supported)
 * - `rgbBitCount !== 32` (= non-32-bit uncompressed, not yet supported)
 * - Pixel data is truncated relative to the declared `width * height`
 *
 * The decoder swizzles BGRA → RGBA on the fly so the returned buffer is directly usable with `createImageBitmap` /
 * `ImageData` constructors.
 */
export function decodeDdsImageData(bytes: Uint8Array): DecodedDdsImage | undefined {
  if (bytes.length < DDS_HEADER_SIZE) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== DDS_MAGIC) return undefined;
  // Standard DDS_HEADER offsets, all from the start of the file (the magic counts as part of the leading 128 bytes):
  //   12  → height       (DWORD)
  //   16  → width        (DWORD)
  //   76  → DDS_PIXELFORMAT.dwSize
  //   80  → DDS_PIXELFORMAT.dwFlags
  //   84  → DDS_PIXELFORMAT.dwFourCC  (4 ASCII bytes when DDPF_FOURCC is set)
  //   88  → DDS_PIXELFORMAT.dwRGBBitCount
  //   92  → DDS_PIXELFORMAT.dwRBitMask
  //   96  → DDS_PIXELFORMAT.dwGBitMask
  //   100 → DDS_PIXELFORMAT.dwBBitMask
  //   104 → DDS_PIXELFORMAT.dwABitMask
  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const pfFlags = view.getUint32(80, true);
  const rgbBitCount = view.getUint32(88, true);
  if (width === 0 || height === 0) return undefined;
  if ((pfFlags & DDPF_FOURCC) !== 0) {
    // Block-compressed (DXT1/3/5/BC*) — punt for now. Authored LITONE4 doesn't use them; extending later is a
    // contained change.
    return undefined;
  }
  if ((pfFlags & DDPF_RGB) === 0) {
    // Surface isn't a plain RGB(A) bitmap — could be a luminance-only / alpha-only / palettized variant. None of
    // these appear in any LR2 theme we've inspected, so leave them to the future-extension path.
    return undefined;
  }
  if (rgbBitCount !== 32) {
    // R5G6B5, A1R5G5B5, etc. Same future-extension story.
    return undefined;
  }
  const rBitMask = view.getUint32(92, true);
  const gBitMask = view.getUint32(96, true);
  const bBitMask = view.getUint32(100, true);
  const aBitMask = view.getUint32(104, true);
  // Identify the byte order of each channel inside the 32-bit pixel. Standard masks for the two common 32-bit
  // layouts:
  //   BGRA8 (A8R8G8B8 with little-endian byte order): R=0x00FF0000, G=0x0000FF00, B=0x000000FF, A=0xFF000000
  //                                                   → byte order in memory: B, G, R, A
  //   RGBA8 (A8B8G8R8 with little-endian byte order): R=0x000000FF, G=0x0000FF00, B=0x00FF0000, A=0xFF000000
  //                                                   → byte order in memory: R, G, B, A
  // We compute each channel's byte index by taking log2 of its mask divided by 8. Channels with a zero mask
  // (`DDPF_ALPHAPIXELS` not set) get the constant 0xFF — common for opaque RGB-only `.dds`.
  const rIndex = byteIndexFromMask(rBitMask);
  const gIndex = byteIndexFromMask(gBitMask);
  const bIndex = byteIndexFromMask(bBitMask);
  const aIndex = (pfFlags & DDPF_ALPHAPIXELS) !== 0 ? byteIndexFromMask(aBitMask) : -1;
  if (rIndex === undefined || gIndex === undefined || bIndex === undefined) return undefined;
  if (aIndex !== -1 && aIndex === undefined) return undefined;
  const pixelCount = width * height;
  const expectedDataLength = pixelCount * 4;
  const dataStart = DDS_HEADER_SIZE;
  if (bytes.length < dataStart + expectedDataLength) return undefined;
  const rgba = new Uint8ClampedArray(expectedDataLength);
  // Walk pixel-by-pixel. Each iteration reads 4 bytes from the source, picks the channels using the mask-derived
  // byte indices, and writes them in RGBA order to the destination. The branchless aIndex check (`aIndex < 0` →
  // opaque) keeps the inner loop tight on the common no-alpha-channel surfaces.
  for (let p = 0; p < pixelCount; p += 1) {
    const src = dataStart + p * 4;
    const dst = p * 4;
    rgba[dst] = bytes[src + rIndex]!;
    rgba[dst + 1] = bytes[src + gIndex]!;
    rgba[dst + 2] = bytes[src + bIndex]!;
    rgba[dst + 3] = aIndex < 0 ? 0xff : bytes[src + aIndex]!;
  }
  return { width, height, rgba };
}

/**
 * Turns a single-byte-channel bit mask (`0xFF`, `0xFF00`, `0xFF0000`, `0xFF000000`) into the byte index inside the
 * little-endian 32-bit pixel where that channel lives. Returns `undefined` for any other mask — we only need to
 * support the canonical aligned-byte layouts; non-byte-aligned masks are part of formats we don't decode yet
 * (R5G6B5, etc.).
 */
function byteIndexFromMask(mask: number): number | undefined {
  switch (mask) {
    case 0x000000ff:
      return 0;
    case 0x0000ff00:
      return 1;
    case 0x00ff0000:
      return 2;
    case 0xff000000:
      return 3;
    default:
      return undefined;
  }
}
