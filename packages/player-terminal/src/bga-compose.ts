import { type ANSIFrame, createSolidANSIFrame } from './bga-frame.ts';

const ANSI_RESET = '\u001b[0m';

export interface CompositeFrame {
  width: number;
  height: number;
  rgb: Uint8Array;
  opaqueMask: Uint8Array;
}

export function cropANSIFrameToOpaqueBounds(source: ANSIFrame): ANSIFrame {
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (source.opaqueMask[y * source.width + x] === 0) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0 || maxY < 0) {
    return createSolidANSIFrame(1, 1, 0, 0, 0, 0);
  }
  if (minX === 0 && minY === 0 && maxX === source.width - 1 && maxY === source.height - 1) {
    return source;
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cropped = createSolidANSIFrame(width, height, 0, 0, 0, 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourcePixelOffset = (minY + y) * source.width + (minX + x);
      if (source.opaqueMask[sourcePixelOffset] === 0) {
        continue;
      }
      const targetPixelOffset = y * width + x;
      const sourceRGBOffset = sourcePixelOffset * 3;
      const targetRGBOffset = targetPixelOffset * 3;
      cropped.rgb[targetRGBOffset] = source.rgb[sourceRGBOffset] ?? 0;
      cropped.rgb[targetRGBOffset + 1] = source.rgb[sourceRGBOffset + 1] ?? 0;
      cropped.rgb[targetRGBOffset + 2] = source.rgb[sourceRGBOffset + 2] ?? 0;
      cropped.opaqueMask[targetPixelOffset] = 1;
    }
  }

  return cropped;
}

export function mergeCompositeFrames(...sourceFrames: Array<ANSIFrame | undefined>): CompositeFrame | undefined {
  const frames = sourceFrames.filter((frame): frame is ANSIFrame => frame !== undefined);
  if (frames.length === 0) {
    return undefined;
  }
  if (frames.length === 1) {
    return frames[0];
  }

  let canvasWidth = 0;
  let canvasHeight = 0;
  for (const frame of frames) {
    canvasWidth = Math.max(canvasWidth, frame.width);
    canvasHeight = Math.max(canvasHeight, frame.height);
  }
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return undefined;
  }

  const rgb = new Uint8Array(canvasWidth * canvasHeight * 3);
  const opaqueMask = new Uint8Array(canvasWidth * canvasHeight);

  for (const frame of frames) {
    paintFrame(rgb, opaqueMask, canvasWidth, canvasHeight, frame);
  }

  return {
    width: canvasWidth,
    height: canvasHeight,
    rgb,
    opaqueMask,
  };
}

/** Composite chart opacity over the terminal BGA's black canvas. Source masks still leave lower layers visible. */
export function mergeCompositeLayers(
  layers: readonly { frame?: ANSIFrame; opacity: number; tint?: number }[],
): CompositeFrame | undefined {
  if (
    layers.every(
      (layer) => !layer.frame || (layer.opacity === 1 && (layer.tint === undefined || layer.tint === 0xffffff)),
    )
  )
    return mergeCompositeFrames(...layers.map((layer) => layer.frame));
  const visible = layers.filter(
    (layer): layer is { frame: ANSIFrame; opacity: number; tint?: number } => layer.frame !== undefined,
  );
  if (visible.length === 0) return undefined;
  const width = Math.max(...visible.map((layer) => layer.frame.width));
  const height = Math.max(...visible.map((layer) => layer.frame.height));
  const result = createSolidANSIFrame(width, height, 0, 0, 0, 1);
  for (const layer of visible)
    paintFrame(result.rgb, result.opaqueMask, width, height, layer.frame, layer.opacity, layer.tint);
  return result;
}

export function fillANSIFrameBackground(source: ANSIFrame, r: number, g: number, b: number): ANSIFrame {
  const frame = createSolidANSIFrame(source.width, source.height, r, g, b, 1);
  for (let pixelOffset = 0; pixelOffset < source.width * source.height; pixelOffset += 1) {
    if (source.opaqueMask[pixelOffset] === 0) {
      continue;
    }
    const rgbOffset = pixelOffset * 3;
    frame.rgb[rgbOffset] = source.rgb[rgbOffset] ?? 0;
    frame.rgb[rgbOffset + 1] = source.rgb[rgbOffset + 1] ?? 0;
    frame.rgb[rgbOffset + 2] = source.rgb[rgbOffset + 2] ?? 0;
  }
  return frame;
}

function paintFrame(
  canvasRGB: Uint8Array,
  canvasMask: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  frame: ANSIFrame,
  opacity = 1,
  tint = 0xffffff,
): void {
  const alpha = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
  if (alpha === 0) return;
  const offsetX = Math.floor((canvasWidth - frame.width) / 2);
  const offsetY = Math.floor((canvasHeight - frame.height) / 2);

  for (let y = 0; y < frame.height; y += 1) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= canvasHeight) {
      continue;
    }

    for (let x = 0; x < frame.width; x += 1) {
      const sourcePixelOffset = y * frame.width + x;
      if (frame.opaqueMask[sourcePixelOffset] === 0) {
        continue;
      }
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= canvasWidth) {
        continue;
      }
      const sourceRGBOffset = sourcePixelOffset * 3;
      const targetPixelOffset = targetY * canvasWidth + targetX;
      const targetRGBOffset = targetPixelOffset * 3;
      for (let component = 0; component < 3; component += 1) {
        const foreground =
          ((frame.rgb[sourceRGBOffset + component] ?? 0) * ((tint >>> ((2 - component) * 8)) & 255)) / 255;
        canvasRGB[targetRGBOffset + component] =
          alpha === 1
            ? Math.round(foreground)
            : Math.round(foreground * alpha + (canvasRGB[targetRGBOffset + component] ?? 0) * (1 - alpha));
      }
      canvasMask[targetPixelOffset] = 1;
    }
  }
}

export function composeANSILines(rgb: Uint8Array, opaqueMask: Uint8Array, width: number, height: number): string[] {
  const lines: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let line = '';
    let active = false;
    let currentR = -1;
    let currentG = -1;
    let currentB = -1;

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = y * width + x;
      if (opaqueMask[pixelOffset] === 0) {
        if (active) {
          line += ANSI_RESET;
          active = false;
        }
        line += ' ';
        continue;
      }

      const rgbOffset = pixelOffset * 3;
      const r = rgb[rgbOffset] ?? 0;
      const g = rgb[rgbOffset + 1] ?? 0;
      const b = rgb[rgbOffset + 2] ?? 0;
      if (!active || r !== currentR || g !== currentG || b !== currentB) {
        line += `\u001b[48;2;${r};${g};${b}m`;
        currentR = r;
        currentG = g;
        currentB = b;
        active = true;
      }
      line += ' ';
    }

    if (active) {
      line += ANSI_RESET;
    }
    lines.push(line);
  }

  return lines;
}

export function createBlackBackgroundANSILines(width: number, height: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const opaqueMask = new Uint8Array(safeWidth * safeHeight).fill(1);
  const rgb = new Uint8Array(safeWidth * safeHeight * 3);
  return composeANSILines(rgb, opaqueMask, safeWidth, safeHeight);
}
