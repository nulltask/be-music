import { type AnsiFrame, createSolidAnsiFrame } from './bga-frame.ts';

const ANSI_RESET = '\u001b[0m';

export interface CompositeFrame {
  width: number;
  height: number;
  rgb: Uint8Array;
  opaqueMask: Uint8Array;
}

export function cropAnsiFrameToOpaqueBounds(source: AnsiFrame): AnsiFrame {
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
    return createSolidAnsiFrame(1, 1, 0, 0, 0, 0);
  }
  if (minX === 0 && minY === 0 && maxX === source.width - 1 && maxY === source.height - 1) {
    return source;
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cropped = createSolidAnsiFrame(width, height, 0, 0, 0, 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourcePixelOffset = (minY + y) * source.width + (minX + x);
      if (source.opaqueMask[sourcePixelOffset] === 0) {
        continue;
      }
      const targetPixelOffset = y * width + x;
      const sourceRgbOffset = sourcePixelOffset * 3;
      const targetRgbOffset = targetPixelOffset * 3;
      cropped.rgb[targetRgbOffset] = source.rgb[sourceRgbOffset] ?? 0;
      cropped.rgb[targetRgbOffset + 1] = source.rgb[sourceRgbOffset + 1] ?? 0;
      cropped.rgb[targetRgbOffset + 2] = source.rgb[sourceRgbOffset + 2] ?? 0;
      cropped.opaqueMask[targetPixelOffset] = 1;
    }
  }

  return cropped;
}

export function mergeCompositeFrames(...sourceFrames: Array<AnsiFrame | undefined>): CompositeFrame | undefined {
  const frames = sourceFrames.filter((frame): frame is AnsiFrame => frame !== undefined);
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

export function fillAnsiFrameBackground(source: AnsiFrame, r: number, g: number, b: number): AnsiFrame {
  const frame = createSolidAnsiFrame(source.width, source.height, r, g, b, 1);
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
  canvasRgb: Uint8Array,
  canvasMask: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  frame: AnsiFrame,
): void {
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
      const sourceRgbOffset = sourcePixelOffset * 3;
      const targetPixelOffset = targetY * canvasWidth + targetX;
      const targetRgbOffset = targetPixelOffset * 3;
      canvasRgb[targetRgbOffset] = frame.rgb[sourceRgbOffset] ?? 0;
      canvasRgb[targetRgbOffset + 1] = frame.rgb[sourceRgbOffset + 1] ?? 0;
      canvasRgb[targetRgbOffset + 2] = frame.rgb[sourceRgbOffset + 2] ?? 0;
      canvasMask[targetPixelOffset] = 1;
    }
  }
}

export function composeAnsiLines(rgb: Uint8Array, opaqueMask: Uint8Array, width: number, height: number): string[] {
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

export function createBlackBackgroundAnsiLines(width: number, height: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const opaqueMask = new Uint8Array(safeWidth * safeHeight).fill(1);
  const rgb = new Uint8Array(safeWidth * safeHeight * 3);
  return composeAnsiLines(rgb, opaqueMask, safeWidth, safeHeight);
}
