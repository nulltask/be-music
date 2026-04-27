import { Texture } from 'pixi.js';
import { resolveLr2AssetBytes, type Lr2Skin } from './lr2-skin.ts';

export interface LoadTextureOptions {
  /** Skin-declared `#TRANSCOLOR` chroma key (rare on BGA assets, common on UI sprites). */
  transparentColor?: { r: number; g: number; b: number };
  /**
   * Treat pure-black pixels as transparent. Mirrors the BMS BGA "layer"
   * convention (`packages/player/src/bga.ts`'s `isOpaquePixel` for `mode
   * === 'layer'`): the foreground BGA layer is composited over the base
   * with `(0, 0, 0)` acting as a chroma-key. Only enabled for layer-track
   * decodes — base / POOR retain their black pixels because they're the
   * bottommost BGA layer (nothing visible behind them).
   */
  keyOutBlack?: boolean;
}

/**
 * Loads any LR2 / BGA asset (TGA, PNG, BMP, JPG, …) into a PixiJS
 * `Texture`. Branches by file extension because TGA isn't decoded by
 * `createImageBitmap` in any browser.
 *
 * The legacy positional `transparentColor` argument is supported for
 * backward compatibility — pass an `LoadTextureOptions` object for the
 * full feature set (`keyOutBlack`, future flags).
 */
export async function loadTextureFromBytes(
  path: string,
  bytes: Uint8Array,
  transparentColorOrOptions?: { r: number; g: number; b: number } | LoadTextureOptions,
): Promise<Texture | undefined> {
  const options = normalizeLoadTextureOptions(transparentColorOrOptions);
  if (path.toLowerCase().endsWith('.tga')) {
    return decodeTgaTexture(bytes, options, path);
  }
  const blob = new Blob([new Uint8Array(bytes)]);
  return loadTextureFromBlob(blob, path, options);
}

/**
 * Resolves an LR2 skin asset (image, font sheet, etc.) to a Pixi
 * texture using the skin's bundled file map. Honours the skin's
 * `#TRANSCOLOR` chroma key.
 */
export async function loadSkinAssetTexture(skin: Lr2Skin, path: string): Promise<Texture | undefined> {
  const bytes = resolveLr2AssetBytes(skin, path);
  if (!bytes) {
    return undefined;
  }
  return loadTextureFromBytes(path, bytes, skin.transparentColor);
}

function normalizeLoadTextureOptions(
  input: { r: number; g: number; b: number } | LoadTextureOptions | undefined,
): LoadTextureOptions {
  if (!input) {
    return {};
  }
  // The legacy positional `transparentColor` shape has flat `r/g/b`
  // numbers; the new options shape has a nested `transparentColor` /
  // `keyOutBlack`. Discriminate on `r` so call sites that still pass
  // the bare color triple keep working without a typed cast.
  if (typeof (input as { r?: unknown }).r === 'number') {
    return { transparentColor: input as { r: number; g: number; b: number } };
  }
  return input as LoadTextureOptions;
}

async function loadTextureFromBlob(
  blob: Blob,
  label?: string,
  options: LoadTextureOptions = {},
): Promise<Texture | undefined> {
  try {
    const imageBitmap = await createImageBitmap(blob);
    const finalBitmap =
      options.transparentColor || options.keyOutBlack
        ? ((await applyChromaKeyToBitmap(imageBitmap, options)) ?? imageBitmap)
        : imageBitmap;
    const texture = Texture.from(finalBitmap);
    // Force nearest-neighbour sampling on every loaded texture. LR2
    // skin / BGA assets are pixel-art; bilinear filtering blurs them
    // when the design space is scaled up to the canvas. Mirrors the
    // user-requested "disable all interpolation / AA" policy.
    texture.source.scaleMode = 'nearest';
    if (label) {
      texture.label = label;
      texture.source.label = label;
    }
    return texture;
  } catch {
    return undefined;
  }
}

async function applyChromaKeyToBitmap(
  imageBitmap: ImageBitmap,
  options: LoadTextureOptions,
): Promise<ImageBitmap | undefined> {
  const canvas = document.createElement('canvas');
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }
  context.drawImage(imageBitmap, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const transparent = options.transparentColor;
  const keyOutBlack = options.keyOutBlack === true;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index] ?? 0;
    const g = data[index + 1] ?? 0;
    const b = data[index + 2] ?? 0;
    if (transparent && r === transparent.r && g === transparent.g && b === transparent.b) {
      data[index + 3] = 0;
      continue;
    }
    if (keyOutBlack && r === 0 && g === 0 && b === 0) {
      data[index + 3] = 0;
    }
  }
  context.putImageData(imageData, 0, 0);
  return createImageBitmap(canvas);
}

async function decodeTgaTexture(
  bytes: Uint8Array,
  options: LoadTextureOptions = {},
  label?: string,
): Promise<Texture | undefined> {
  const transparentColor = options.transparentColor;
  const keyOutBlack = options.keyOutBlack === true;
  if (bytes.length < 18) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLength = bytes[0] ?? 0;
  const colorMapType = bytes[1] ?? 0;
  const imageType = bytes[2] ?? 0;
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const bitsPerPixel = bytes[16] ?? 0;
  const descriptor = bytes[17] ?? 0;
  const bytesPerPixel = bitsPerPixel / 8;
  const isRle = imageType === 10 || imageType === 11;
  const isTrueColor = imageType === 2 || imageType === 10;
  const isGrayscale = imageType === 3 || imageType === 11;

  if (
    colorMapType !== 0 ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(bytesPerPixel) ||
    !((isTrueColor && (bitsPerPixel === 24 || bitsPerPixel === 32)) || (isGrayscale && bitsPerPixel === 8))
  ) {
    return undefined;
  }

  const pixelCount = width * height;
  const imageData = new ImageData(width, height);
  const topOrigin = (descriptor & 0x20) !== 0;
  const rightOrigin = (descriptor & 0x10) !== 0;
  let sourceOffset = 18 + idLength;
  let written = 0;

  const writePixel = (source: number): boolean => {
    if (source + bytesPerPixel > bytes.length || written >= pixelCount) {
      return false;
    }
    const sourceX = written % width;
    const sourceY = Math.floor(written / width);
    const x = rightOrigin ? width - 1 - sourceX : sourceX;
    const y = topOrigin ? sourceY : height - 1 - sourceY;
    const target = (y * width + x) * 4;
    if (isGrayscale) {
      const value = bytes[source] ?? 0;
      imageData.data[target] = value;
      imageData.data[target + 1] = value;
      imageData.data[target + 2] = value;
      imageData.data[target + 3] = 255;
    } else {
      const r = bytes[source + 2] ?? 0;
      const g = bytes[source + 1] ?? 0;
      const b = bytes[source] ?? 0;
      let a = bitsPerPixel === 32 ? (bytes[source + 3] ?? 255) : 255;
      if (transparentColor && r === transparentColor.r && g === transparentColor.g && b === transparentColor.b) {
        a = 0;
      } else if (keyOutBlack && r === 0 && g === 0 && b === 0) {
        a = 0;
      }
      imageData.data[target] = r;
      imageData.data[target + 1] = g;
      imageData.data[target + 2] = b;
      imageData.data[target + 3] = a;
    }
    written += 1;
    return true;
  };

  if (isRle) {
    while (written < pixelCount && sourceOffset < bytes.length) {
      const packet = bytes[sourceOffset++] ?? 0;
      const count = (packet & 0x7f) + 1;
      if ((packet & 0x80) !== 0) {
        const pixelOffset = sourceOffset;
        sourceOffset += bytesPerPixel;
        for (let index = 0; index < count; index += 1) {
          if (!writePixel(pixelOffset)) {
            return undefined;
          }
        }
      } else {
        for (let index = 0; index < count; index += 1) {
          if (!writePixel(sourceOffset)) {
            return undefined;
          }
          sourceOffset += bytesPerPixel;
        }
      }
    }
  } else {
    while (written < pixelCount) {
      if (!writePixel(sourceOffset)) {
        return undefined;
      }
      sourceOffset += bytesPerPixel;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }
  context.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    return undefined;
  }
  return loadTextureFromBlob(blob, label);
}
