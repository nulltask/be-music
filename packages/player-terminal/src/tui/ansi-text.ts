import { clamp } from '@be-music/shared-utils/core';

export const ANSI_RESET = '\u001b[0m';

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export const BLACK_RGB: RGBColor = { r: 0, g: 0, b: 0 };

export function centerVisible(value: string, width: number): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const clipped = visibleWidth(value) > safeWidth ? truncateVisibleWidth(value, safeWidth) : value;
  const clippedWidth = visibleWidth(clipped);
  if (clippedWidth >= safeWidth) {
    return clipped;
  }
  const totalPadding = safeWidth - clippedWidth;
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return `${' '.repeat(leftPadding)}${clipped}${' '.repeat(rightPadding)}`;
}

export function colorizeText(value: string, foreground: RGBColor, background?: RGBColor, underline = false): string {
  const sgr = [`38;2;${foreground.r};${foreground.g};${foreground.b}`];
  if (background) {
    sgr.push(`48;2;${background.r};${background.g};${background.b}`);
  }
  if (underline) {
    sgr.push('4');
  }
  return `\u001b[${sgr.join(';')}m${value}${ANSI_RESET}`;
}

export function dimRGB(color: RGBColor, factor: number): RGBColor {
  const safeFactor = clamp(factor, 0, 1);
  return {
    r: clampColorByte(color.r * safeFactor),
    g: clampColorByte(color.g * safeFactor),
    b: clampColorByte(color.b * safeFactor),
  };
}

export function blendRGB(from: RGBColor, to: RGBColor, ratio: number): RGBColor {
  const safeRatio = clamp(ratio, 0, 1);
  return {
    r: clampColorByte(from.r + (to.r - from.r) * safeRatio),
    g: clampColorByte(from.g + (to.g - from.g) * safeRatio),
    b: clampColorByte(from.b + (to.b - from.b) * safeRatio),
  };
}

export function padVisibleWidth(line: string, width: number): string {
  const clipped = truncateVisibleWidth(line, width);
  const currentWidth = visibleWidth(clipped);
  if (currentWidth >= width) {
    return clipped;
  }
  return `${clipped}${' '.repeat(width - currentWidth)}`;
}

export function clampColorByte(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return clamp(Math.floor(value), 0, 255);
}

export function isSameRGB(left: RGBColor | undefined, right: RGBColor | undefined): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.r === right.r && left.g === right.g && left.b === right.b;
}

export function visibleWidth(value: string): number {
  let width = 0;
  let index = 0;
  while (index < value.length) {
    if (value.charCodeAt(index) !== 0x1b || index + 1 >= value.length || value[index + 1] !== '[') {
      const codePoint = value.codePointAt(index);
      if (typeof codePoint !== 'number') {
        index += 1;
        continue;
      }
      width += getCharacterDisplayWidth(codePoint);
      index += codePoint > 0xffff ? 2 : 1;
      continue;
    }

    const sequenceEnd = findAnsiSGRSequenceEnd(value, index + 2);
    if (sequenceEnd < 0) {
      width += 1;
      index += 1;
      continue;
    }
    index = sequenceEnd + 1;
  }
  return width;
}

function truncateVisibleWidth(value: string, width: number): string {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth <= 0) {
    return '';
  }

  let visible = 0;
  let index = 0;
  let output = '';

  while (index < value.length) {
    if (value.charCodeAt(index) === 0x1b && index + 1 < value.length && value[index + 1] === '[') {
      const sequenceEnd = findAnsiSGRSequenceEnd(value, index + 2);
      if (sequenceEnd < 0) {
        break;
      }
      const sequence = value.slice(index, sequenceEnd + 1);
      output += sequence;
      index = sequenceEnd + 1;
      continue;
    }

    const codePoint = value.codePointAt(index);
    if (typeof codePoint !== 'number') {
      index += 1;
      continue;
    }
    const charWidth = getCharacterDisplayWidth(codePoint);
    if (visible + charWidth > safeWidth) {
      break;
    }
    output += String.fromCodePoint(codePoint);
    visible += charWidth;
    index += codePoint > 0xffff ? 2 : 1;
  }

  if (output.endsWith(ANSI_RESET)) {
    return output;
  }
  return `${output}${ANSI_RESET}`;
}

export function getCharacterDisplayWidth(codePoint: number): number {
  if (isCombiningCharacter(codePoint)) {
    return 0;
  }
  if (isWideCharacter(codePoint)) {
    return 2;
  }
  return 1;
}

function isCombiningCharacter(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isWideCharacter(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  );
}

export function findAnsiSGRSequenceEnd(value: string, start: number): number {
  let index = start;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === 0x6d) {
      return index;
    }
    const isDigit = code >= 0x30 && code <= 0x39;
    const isSemicolon = code === 0x3b;
    if (!isDigit && !isSemicolon) {
      return -1;
    }
    index += 1;
  }
  return -1;
}
