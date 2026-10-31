import { getANSIFrameAlpha, setANSIFrameAlpha } from './bga-alpha.ts';
import { isAbortError } from '@be-music/shared-utils/core';
// Worker-spawn helpers live behind the dedicated `/workerize` sub-path so the package root stays browser-safe
// (the implementation file statically imports `node:sea`).
import { invokeWorkerizedFunction, workerize } from '@be-music/shared-utils/workerize';
import { DEFAULT_IMAGE_RESIZE_ALGORITHM, type ImageResizeAlgorithm } from '@be-music/player-engine/display';
import type { ImageFormat, DecodedImage } from './bga-image.ts';

const VIDEO_BLACK_BORDER_THRESHOLD = 8;
const SPEC_BGA_CANVAS_SIZE = 256;
export const TERMINAL_PIXEL_ASPECT_X = 2;
export const TERMINAL_PIXEL_ASPECT_Y = 1;
const lanczosAxisContributionCache = new Map<string, LanczosAxisContribution[]>();
const resizedANSIFrameCache = new WeakMap<ANSIFrame, Map<string, ANSIFrame>>();

/**
 * Composition mode for a BGA frame.
 *
 * - `'exbmp'` — already-keyed RGBA image. Preserve its coverage and unkeyed black on every plane.
 *
 * - `'base'` — bottommost track. Keep pure black; source alpha composites against the black BGA viewport.
 * - `'layer'` — BMS-style overlay (`#xxx07`). Pure-black BMP / video pixels render transparent so the foreground
 *   composites over the base BGA, mirroring the BMS spec's chroma-key convention.
 * - `'bmson-layer'` — bmson 1.0.0 spec overlay. "Unlike BMS Layer Channel `#xxx07`, black pixels will not be made
 *   transparent." Honor the PNG alpha channel but render BMP / video black pixels as black, since bmson layer artwork
 *   ships with a real alpha channel (or pre-multiplied composite intent).
 */
export type FrameMode = 'base' | 'layer' | 'bmson-layer' | 'exbmp';

export interface ANSIFrame {
  width: number;
  height: number;
  rgb: Uint8Array;
  opaqueMask: Uint8Array;
  /** Straight RGB coverage (0..255); omitted means the binary mask alone. */
  alpha?: Uint8Array;
}

interface LanczosAxisContribution {
  sourceIndices: Int32Array;
  weights: Float32Array;
}

type WorkerizedSpecFrameConverter = ((
  image: DecodedImage,
  mode: FrameMode,
  resizeAlgorithm: ImageResizeAlgorithm,
  callback: (error: unknown, result: ANSIFrame) => void,
) => void) & { close: () => void };

let convertImageToSpecFrameWorker: WorkerizedSpecFrameConverter | undefined;

export async function convertImageToSpecFrameOffThread(
  image: DecodedImage,
  mode: FrameMode,
  resizeAlgorithm: ImageResizeAlgorithm,
  signal?: AbortSignal,
): Promise<ANSIFrame> {
  const activeWorker = resolveConvertImageToSpecFrameWorker();
  try {
    const frame = await invokeWorkerizedFunction(activeWorker, [image, mode, resizeAlgorithm], {
      signal,
      onAbort: () => {
        if (convertImageToSpecFrameWorker === activeWorker) {
          convertImageToSpecFrameWorker.close();
          convertImageToSpecFrameWorker = undefined;
        }
      },
    });
    if (!frame || typeof frame.width !== 'number' || typeof frame.height !== 'number') {
      return convertImageToSpecFrame(image, mode, resizeAlgorithm);
    }
    return frame;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    if (convertImageToSpecFrameWorker === activeWorker) {
      convertImageToSpecFrameWorker.close();
      convertImageToSpecFrameWorker = undefined;
    }
    return convertImageToSpecFrame(image, mode, resizeAlgorithm);
  }
}

function resolveConvertImageToSpecFrameWorker(): WorkerizedSpecFrameConverter {
  convertImageToSpecFrameWorker ??= createConvertImageToSpecFrameWorker();
  return convertImageToSpecFrameWorker;
}

function createConvertImageToSpecFrameWorker(): WorkerizedSpecFrameConverter {
  return workerize(
    (image: DecodedImage, mode: FrameMode, resizeAlgorithm: ImageResizeAlgorithm) =>
      convertImageToSpecFrame(image, mode, resizeAlgorithm),
    () => [
      convertImageToSpecFrame,
      createSolidANSIFrame,
      fitSizeWithinSpecCanvas,
      resolveImagePixelAlpha,
      getANSIFrameAlpha,
      setANSIFrameAlpha,
      resolveNearestImageSampleOffset,
      resampleDecodedImageRGBALanczos,
      createLanczosAxisContributions,
      clampToByte,
      lanczosKernel,
      sinc,
      DEFAULT_IMAGE_RESIZE_ALGORITHM,
      SPEC_BGA_CANVAS_SIZE,
    ],
    // Plain image/frame records need only structured cloning. isoworker's argument serializer transfers their
    // buffers, leaving fallback conversion with detached pixel data when worker startup or execution fails.
    false,
  ) as WorkerizedSpecFrameConverter;
}

export function createMissingSourceFrame(mode: FrameMode): ANSIFrame {
  const specMaskFill = mode === 'base' ? 1 : 0;
  return createSolidANSIFrame(SPEC_BGA_CANVAS_SIZE, SPEC_BGA_CANVAS_SIZE, 0, 0, 0, specMaskFill);
}

export function createSolidANSIFrame(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  maskFill: 0 | 1,
): ANSIFrame {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const rgb = new Uint8Array(safeWidth * safeHeight * 3);
  const opaqueMask = new Uint8Array(safeWidth * safeHeight);
  if (maskFill === 0) {
    return {
      width: safeWidth,
      height: safeHeight,
      rgb,
      opaqueMask,
    };
  }

  for (let pixelOffset = 0; pixelOffset < safeWidth * safeHeight; pixelOffset += 1) {
    const rgbOffset = pixelOffset * 3;
    rgb[rgbOffset] = r;
    rgb[rgbOffset + 1] = g;
    rgb[rgbOffset + 2] = b;
    opaqueMask[pixelOffset] = 1;
  }

  return {
    width: safeWidth,
    height: safeHeight,
    rgb,
    opaqueMask,
  };
}

function convertImageToSpecFrame(
  image: DecodedImage,
  mode: FrameMode,
  resizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
): ANSIFrame {
  const specFrame = createSolidANSIFrame(SPEC_BGA_CANVAS_SIZE, SPEC_BGA_CANVAS_SIZE, 0, 0, 0, 0);
  const fittedSize =
    image.format === 'video'
      ? {
          width: SPEC_BGA_CANVAS_SIZE,
          height: SPEC_BGA_CANVAS_SIZE,
        }
      : fitSizeWithinSpecCanvas(image.width, image.height);
  const offsetX = image.format === 'video' ? 0 : Math.floor((SPEC_BGA_CANVAS_SIZE - fittedSize.width) / 2);
  const offsetY = 0;
  const resizedRGBA =
    resizeAlgorithm === 'lanczos'
      ? resampleDecodedImageRGBALanczos(image, fittedSize.width, fittedSize.height, mode)
      : undefined;

  for (let targetYWithinImage = 0; targetYWithinImage < fittedSize.height; targetYWithinImage += 1) {
    const targetY = targetYWithinImage + offsetY;
    if (targetY < 0 || targetY >= SPEC_BGA_CANVAS_SIZE) {
      continue;
    }

    for (let targetXWithinImage = 0; targetXWithinImage < fittedSize.width; targetXWithinImage += 1) {
      const targetX = targetXWithinImage + offsetX;
      if (targetX < 0 || targetX >= SPEC_BGA_CANVAS_SIZE) {
        continue;
      }

      const sampleOffset =
        resizedRGBA !== undefined
          ? (targetYWithinImage * fittedSize.width + targetXWithinImage) * 4
          : resolveNearestImageSampleOffset(
              image.width,
              image.height,
              targetXWithinImage,
              targetYWithinImage,
              fittedSize.width,
              fittedSize.height,
            );
      const r = (resizedRGBA ?? image.data)[sampleOffset] ?? 0;
      const g = (resizedRGBA ?? image.data)[sampleOffset + 1] ?? 0;
      const b = (resizedRGBA ?? image.data)[sampleOffset + 2] ?? 0;
      const a = (resizedRGBA ?? image.data)[sampleOffset + 3] ?? 255;
      const alpha = resizedRGBA ? a : resolveImagePixelAlpha(r, g, b, a, image.format, mode, image.hasAlphaChannel);
      if (alpha === 0) {
        continue;
      }

      const targetPixelOffset = targetY * SPEC_BGA_CANVAS_SIZE + targetX;
      const targetRGBOffset = targetPixelOffset * 3;
      specFrame.rgb[targetRGBOffset] = r;
      specFrame.rgb[targetRGBOffset + 1] = g;
      specFrame.rgb[targetRGBOffset + 2] = b;
      setANSIFrameAlpha(specFrame, targetPixelOffset, alpha);
    }
  }

  return specFrame;
}

function resolveNearestImageSampleOffset(
  sourceWidth: number,
  sourceHeight: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
): number {
  const sourceX = Math.min(sourceWidth - 1, Math.max(0, Math.floor(((targetX + 0.5) * sourceWidth) / targetWidth)));
  const sourceY = Math.min(sourceHeight - 1, Math.max(0, Math.floor(((targetY + 0.5) * sourceHeight) / targetHeight)));
  return (sourceY * sourceWidth + sourceX) * 4;
}

function resampleDecodedImageRGBALanczos(
  image: DecodedImage,
  targetWidth: number,
  targetHeight: number,
  mode: FrameMode,
): Uint8Array {
  const horizontalPlan = createLanczosAxisContributions(image.width, targetWidth);
  const verticalPlan = createLanczosAxisContributions(image.height, targetHeight);
  const horizontal = new Float32Array(targetWidth * image.height * 4);

  for (let sourceY = 0; sourceY < image.height; sourceY += 1) {
    const sourceRowOffset = sourceY * image.width * 4;
    const horizontalRowOffset = sourceY * targetWidth * 4;
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const contribution = horizontalPlan[targetX]!;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let index = 0; index < contribution.sourceIndices.length; index += 1) {
        const sourceOffset = sourceRowOffset + contribution.sourceIndices[index]! * 4;
        const weight = contribution.weights[index] ?? 0;
        const red = image.data[sourceOffset] ?? 0;
        const green = image.data[sourceOffset + 1] ?? 0;
        const blue = image.data[sourceOffset + 2] ?? 0;
        const alpha = resolveImagePixelAlpha(
          red,
          green,
          blue,
          image.data[sourceOffset + 3] ?? 255,
          image.format,
          mode,
          image.hasAlphaChannel,
        );
        r += red * (alpha / 255) * weight;
        g += green * (alpha / 255) * weight;
        b += blue * (alpha / 255) * weight;
        a += alpha * weight;
      }
      const horizontalOffset = horizontalRowOffset + targetX * 4;
      horizontal[horizontalOffset] = r;
      horizontal[horizontalOffset + 1] = g;
      horizontal[horizontalOffset + 2] = b;
      horizontal[horizontalOffset + 3] = a;
    }
  }

  const output = new Uint8Array(targetWidth * targetHeight * 4);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const contribution = verticalPlan[targetY]!;
    const outputRowOffset = targetY * targetWidth * 4;
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let index = 0; index < contribution.sourceIndices.length; index += 1) {
        const sourceOffset = (contribution.sourceIndices[index]! * targetWidth + targetX) * 4;
        const weight = contribution.weights[index] ?? 0;
        r += horizontal[sourceOffset] * weight;
        g += horizontal[sourceOffset + 1] * weight;
        b += horizontal[sourceOffset + 2] * weight;
        a += horizontal[sourceOffset + 3] * weight;
      }
      const outputOffset = outputRowOffset + targetX * 4;
      output[outputOffset] = a > 0 ? clampToByte((r * 255) / a) : 0;
      output[outputOffset + 1] = a > 0 ? clampToByte((g * 255) / a) : 0;
      output[outputOffset + 2] = a > 0 ? clampToByte((b * 255) / a) : 0;
      output[outputOffset + 3] = clampToByte(a);
    }
  }

  return output;
}

function createLanczosAxisContributions(sourceSize: number, targetSize: number): LanczosAxisContribution[] {
  const safeSourceSize = Math.max(1, Math.floor(sourceSize));
  const safeTargetSize = Math.max(1, Math.floor(targetSize));
  const contributions: LanczosAxisContribution[] = [];
  const scale = Math.max(1, safeSourceSize / safeTargetSize);
  const support = 3 * scale;

  for (let targetIndex = 0; targetIndex < safeTargetSize; targetIndex += 1) {
    const center = ((targetIndex + 0.5) * safeSourceSize) / safeTargetSize - 0.5;
    const start = Math.max(0, Math.floor(center - support + 1));
    const end = Math.min(safeSourceSize - 1, Math.ceil(center + support - 1));
    const sourceIndices: number[] = [];
    const weights: number[] = [];
    let totalWeight = 0;

    for (let sourceIndex = start; sourceIndex <= end; sourceIndex += 1) {
      const weight = lanczosKernel((sourceIndex - center) / scale) / scale;
      if (weight === 0) {
        continue;
      }
      sourceIndices.push(sourceIndex);
      weights.push(weight);
      totalWeight += weight;
    }

    if (!Number.isFinite(totalWeight) || totalWeight === 0 || sourceIndices.length === 0) {
      const nearestIndex = Math.min(
        safeSourceSize - 1,
        Math.max(0, Math.floor(((targetIndex + 0.5) * safeSourceSize) / safeTargetSize)),
      );
      contributions.push({
        sourceIndices: Int32Array.of(nearestIndex),
        weights: Float32Array.of(1),
      });
      continue;
    }

    const normalizedWeights = new Float32Array(weights.length);
    for (let index = 0; index < weights.length; index += 1) {
      normalizedWeights[index] = weights[index]! / totalWeight;
    }
    contributions.push({
      sourceIndices: Int32Array.from(sourceIndices),
      weights: normalizedWeights,
    });
  }

  return contributions;
}

function getCachedLanczosAxisContributions(sourceSize: number, targetSize: number): LanczosAxisContribution[] {
  const safeSourceSize = Math.max(1, Math.floor(sourceSize));
  const safeTargetSize = Math.max(1, Math.floor(targetSize));
  const cacheKey = `${safeSourceSize}:${safeTargetSize}`;
  const cached = lanczosAxisContributionCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const contributions = createLanczosAxisContributions(safeSourceSize, safeTargetSize);
  lanczosAxisContributionCache.set(cacheKey, contributions);
  return contributions;
}

function clampToByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

function getCachedResizedANSIFrame(source: ANSIFrame, cacheKey: string): ANSIFrame | undefined {
  return resizedANSIFrameCache.get(source)?.get(cacheKey);
}

function setCachedResizedANSIFrame(source: ANSIFrame, cacheKey: string, resized: ANSIFrame): void {
  let cache = resizedANSIFrameCache.get(source);
  if (!cache) {
    cache = new Map();
    resizedANSIFrameCache.set(source, cache);
  }
  cache.set(cacheKey, resized);
}

function sinc(value: number): number {
  if (value === 0) {
    return 1;
  }
  const scaled = Math.PI * value;
  return Math.sin(scaled) / scaled;
}

function lanczosKernel(value: number): number {
  const distance = Math.abs(value);
  if (distance >= 3) {
    return 0;
  }
  return sinc(distance) * sinc(distance / 3);
}

export function convertImageToSourceFrame(
  image: DecodedImage,
  mode: FrameMode,
  preserveVideoBorders = false,
): ANSIFrame {
  const safeWidth = Math.max(1, Math.floor(image.width));
  const safeHeight = Math.max(1, Math.floor(image.height));
  const sourceFrame = createSolidANSIFrame(safeWidth, safeHeight, 0, 0, 0, 0);

  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const sourceOffset = (y * safeWidth + x) * 4;
      const r = image.data[sourceOffset] ?? 0;
      const g = image.data[sourceOffset + 1] ?? 0;
      const b = image.data[sourceOffset + 2] ?? 0;
      const a = image.data[sourceOffset + 3] ?? 255;
      const alpha = resolveImagePixelAlpha(r, g, b, a, image.format, mode, image.hasAlphaChannel);
      if (alpha === 0) {
        continue;
      }

      const targetPixelOffset = y * safeWidth + x;
      const targetRGBOffset = targetPixelOffset * 3;
      sourceFrame.rgb[targetRGBOffset] = r;
      sourceFrame.rgb[targetRGBOffset + 1] = g;
      sourceFrame.rgb[targetRGBOffset + 2] = b;
      setANSIFrameAlpha(sourceFrame, targetPixelOffset, alpha);
    }
  }

  return image.format === 'video' && !preserveVideoBorders ? trimBlackVideoFrameBorders(sourceFrame) : sourceFrame;
}

function trimBlackVideoFrameBorders(source: ANSIFrame): ANSIFrame {
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const pixelOffset = y * source.width + x;
      if (source.opaqueMask[pixelOffset] === 0) {
        continue;
      }
      const rgbOffset = pixelOffset * 3;
      const r = source.rgb[rgbOffset] ?? 0;
      const g = source.rgb[rgbOffset + 1] ?? 0;
      const b = source.rgb[rgbOffset + 2] ?? 0;
      if (r <= VIDEO_BLACK_BORDER_THRESHOLD && g <= VIDEO_BLACK_BORDER_THRESHOLD && b <= VIDEO_BLACK_BORDER_THRESHOLD) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0 || maxY < 0) {
    return source;
  }
  if (minX === 0 && minY === 0 && maxX === source.width - 1 && maxY === source.height - 1) {
    return source;
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const trimmed = createSolidANSIFrame(width, height, 0, 0, 0, 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = minX + x;
      const sourceY = minY + y;
      const sourcePixelOffset = sourceY * source.width + sourceX;
      if (source.opaqueMask[sourcePixelOffset] === 0) {
        continue;
      }
      const targetPixelOffset = y * width + x;
      const sourceRGBOffset = sourcePixelOffset * 3;
      const targetRGBOffset = targetPixelOffset * 3;
      trimmed.rgb[targetRGBOffset] = source.rgb[sourceRGBOffset] ?? 0;
      trimmed.rgb[targetRGBOffset + 1] = source.rgb[sourceRGBOffset + 1] ?? 0;
      trimmed.rgb[targetRGBOffset + 2] = source.rgb[sourceRGBOffset + 2] ?? 0;
      setANSIFrameAlpha(trimmed, targetPixelOffset, getANSIFrameAlpha(source, sourcePixelOffset));
    }
  }

  return trimmed;
}

function fitSizeWithinSpecCanvas(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const safeSourceWidth = Math.max(1, Math.floor(sourceWidth));
  const safeSourceHeight = Math.max(1, Math.floor(sourceHeight));
  const widthScale = SPEC_BGA_CANVAS_SIZE / safeSourceWidth;
  const heightScale = SPEC_BGA_CANVAS_SIZE / safeSourceHeight;
  const scale = Math.min(1, widthScale, heightScale);
  return {
    width: Math.max(1, Math.floor(safeSourceWidth * scale)),
    height: Math.max(1, Math.floor(safeSourceHeight * scale)),
  };
}

export function resizeANSIFrame(
  source: ANSIFrame,
  maxWidth: number,
  maxHeight: number,
  resizeAlgorithm: ImageResizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
): ANSIFrame {
  return resizeANSIFrameWithAspect(
    source,
    maxWidth,
    maxHeight,
    TERMINAL_PIXEL_ASPECT_X,
    TERMINAL_PIXEL_ASPECT_Y,
    resizeAlgorithm,
  );
}

function resizeANSIFrameWithAspect(
  source: ANSIFrame,
  maxWidth: number,
  maxHeight: number,
  aspectX: number,
  aspectY: number,
  resizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
): ANSIFrame {
  return resizeANSIFrameWithAspectMode(source, maxWidth, maxHeight, aspectX, aspectY, 'contain', resizeAlgorithm);
}

export function resizeANSIFrameWithAspectMode(
  source: ANSIFrame,
  maxWidth: number,
  maxHeight: number,
  aspectX: number,
  aspectY: number,
  mode: 'contain' | 'cover',
  resizeAlgorithm: ImageResizeAlgorithm = DEFAULT_IMAGE_RESIZE_ALGORITHM,
): ANSIFrame {
  const canvasWidth = Math.max(1, maxWidth);
  const canvasHeight = Math.max(1, maxHeight);
  if (source.width === canvasWidth && source.height === canvasHeight && aspectX === 1 && aspectY === 1) {
    return source;
  }
  const fitted =
    mode === 'cover'
      ? fitSizeCoveringAspect(
          source.width * Math.max(1, aspectX),
          source.height * Math.max(1, aspectY),
          canvasWidth,
          canvasHeight,
        )
      : fitSizeKeepingAspect(
          source.width * Math.max(1, aspectX),
          source.height * Math.max(1, aspectY),
          canvasWidth,
          canvasHeight,
        );
  const cacheKey =
    `${canvasWidth}x${canvasHeight}:${fitted.width}x${fitted.height}:` +
    `${aspectX}:${aspectY}:${mode}:${resizeAlgorithm}`;
  const cached = getCachedResizedANSIFrame(source, cacheKey);
  if (cached) {
    return cached;
  }
  const offsetX = Math.floor((canvasWidth - fitted.width) / 2);
  const offsetY = Math.floor((canvasHeight - fitted.height) / 2);
  const resizedFrame =
    resizeAlgorithm === 'lanczos' ? resampleANSIFrameLanczos(source, fitted.width, fitted.height) : undefined;
  const rgb = new Uint8Array(canvasWidth * canvasHeight * 3);
  const opaqueMask = new Uint8Array(canvasWidth * canvasHeight);
  const result: ANSIFrame = { width: canvasWidth, height: canvasHeight, rgb, opaqueMask };

  for (let y = 0; y < fitted.height; y += 1) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= canvasHeight) {
      continue;
    }

    for (let x = 0; x < fitted.width; x += 1) {
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= canvasWidth) {
        continue;
      }

      const sourcePixelOffset =
        resizedFrame !== undefined
          ? y * resizedFrame.width + x
          : Math.min(source.height - 1, Math.max(0, Math.floor(((y + 0.5) * source.height) / fitted.height))) *
              source.width +
            Math.min(source.width - 1, Math.max(0, Math.floor(((x + 0.5) * source.width) / fitted.width)));
      const sourceMask = resizedFrame !== undefined ? resizedFrame.opaqueMask : source.opaqueMask;
      if (sourceMask[sourcePixelOffset] === 0) {
        continue;
      }

      const sourceRGB = resizedFrame !== undefined ? resizedFrame.rgb : source.rgb;
      const sourceRGBOffset = sourcePixelOffset * 3;
      const targetPixelOffset = targetY * canvasWidth + targetX;
      const targetRGBOffset = targetPixelOffset * 3;
      rgb[targetRGBOffset] = sourceRGB[sourceRGBOffset] ?? 0;
      rgb[targetRGBOffset + 1] = sourceRGB[sourceRGBOffset + 1] ?? 0;
      rgb[targetRGBOffset + 2] = sourceRGB[sourceRGBOffset + 2] ?? 0;
      setANSIFrameAlpha(result, targetPixelOffset, getANSIFrameAlpha(resizedFrame ?? source, sourcePixelOffset));
    }
  }

  setCachedResizedANSIFrame(source, cacheKey, result);
  return result;
}

function resampleANSIFrameLanczos(source: ANSIFrame, targetWidth: number, targetHeight: number): ANSIFrame {
  if (source.width === targetWidth && source.height === targetHeight) {
    return source;
  }

  const horizontalPlan = getCachedLanczosAxisContributions(source.width, targetWidth);
  const verticalPlan = getCachedLanczosAxisContributions(source.height, targetHeight);
  const horizontal = new Float32Array(targetWidth * source.height * 4);

  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    const horizontalRowOffset = sourceY * targetWidth * 4;
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const contribution = horizontalPlan[targetX]!;
      let premultipliedR = 0;
      let premultipliedG = 0;
      let premultipliedB = 0;
      let alpha = 0;
      for (let index = 0; index < contribution.sourceIndices.length; index += 1) {
        const sourceX = contribution.sourceIndices[index]!;
        const weight = contribution.weights[index] ?? 0;
        const sourcePixelOffset = sourceY * source.width + sourceX;
        if (source.opaqueMask[sourcePixelOffset] === 0) {
          continue;
        }
        const sourceRGBOffset = sourcePixelOffset * 3;
        const coverage = getANSIFrameAlpha(source, sourcePixelOffset);
        premultipliedR += (source.rgb[sourceRGBOffset] ?? 0) * (coverage / 255) * weight;
        premultipliedG += (source.rgb[sourceRGBOffset + 1] ?? 0) * (coverage / 255) * weight;
        premultipliedB += (source.rgb[sourceRGBOffset + 2] ?? 0) * (coverage / 255) * weight;
        alpha += coverage * weight;
      }
      const horizontalOffset = horizontalRowOffset + targetX * 4;
      horizontal[horizontalOffset] = premultipliedR;
      horizontal[horizontalOffset + 1] = premultipliedG;
      horizontal[horizontalOffset + 2] = premultipliedB;
      horizontal[horizontalOffset + 3] = alpha;
    }
  }

  const resized = createSolidANSIFrame(targetWidth, targetHeight, 0, 0, 0, 0);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const contribution = verticalPlan[targetY]!;
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      let premultipliedR = 0;
      let premultipliedG = 0;
      let premultipliedB = 0;
      let alpha = 0;
      for (let index = 0; index < contribution.sourceIndices.length; index += 1) {
        const sourceOffset = (contribution.sourceIndices[index]! * targetWidth + targetX) * 4;
        const weight = contribution.weights[index] ?? 0;
        premultipliedR += horizontal[sourceOffset] * weight;
        premultipliedG += horizontal[sourceOffset + 1] * weight;
        premultipliedB += horizontal[sourceOffset + 2] * weight;
        alpha += horizontal[sourceOffset + 3] * weight;
      }

      if (alpha <= 0) {
        continue;
      }
      const targetPixelOffset = targetY * targetWidth + targetX;
      const targetRGBOffset = targetPixelOffset * 3;
      resized.rgb[targetRGBOffset] = clampToByte((premultipliedR * 255) / alpha);
      resized.rgb[targetRGBOffset + 1] = clampToByte((premultipliedG * 255) / alpha);
      resized.rgb[targetRGBOffset + 2] = clampToByte((premultipliedB * 255) / alpha);
      setANSIFrameAlpha(resized, targetPixelOffset, alpha);
    }
  }

  return resized;
}

/** PNG and encoded-alpha images keep coverage; alpha-less BMP/video retain the BMS black-key convention. */
function resolveImagePixelAlpha(
  r: number,
  g: number,
  b: number,
  a: number,
  format: ImageFormat,
  mode: FrameMode,
  hasAlphaChannel = false,
): number {
  if (mode === 'exbmp' || format === 'png') return a;
  if (mode === 'layer' && (format === 'bmp' || format === 'video') && r === 0 && g === 0 && b === 0) return 0;
  return hasAlphaChannel ? a : 255;
}

function fitSizeKeepingAspect(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const safeMaxWidth = Math.max(1, maxWidth);
  const safeMaxHeight = Math.max(1, maxHeight);
  const aspect = safeSourceWidth / safeSourceHeight;

  let width = safeMaxWidth;
  let height = Math.max(1, Math.floor(width / aspect));

  if (height > safeMaxHeight) {
    height = safeMaxHeight;
    width = Math.max(1, Math.floor(height * aspect));
  }

  return { width, height };
}

function fitSizeCoveringAspect(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const safeMaxWidth = Math.max(1, maxWidth);
  const safeMaxHeight = Math.max(1, maxHeight);
  const aspect = safeSourceWidth / safeSourceHeight;

  let width = safeMaxWidth;
  let height = Math.max(1, Math.ceil(width / aspect));

  if (height < safeMaxHeight) {
    height = safeMaxHeight;
    width = Math.max(1, Math.ceil(height * aspect));
  }

  return { width, height };
}
