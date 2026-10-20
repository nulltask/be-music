import { clamp } from '@be-music/shared-utils/core';
import { PLAY_PROGRESS_INDICATOR_SIDE_WIDTH } from './layout.ts';
import {
  ANSI_RESET,
  type RGBColor,
  BLACK_RGB,
  colorizeText,
  blendRGB,
  padVisibleWidth,
  clampColorByte,
  isSameRGB,
  visibleWidth,
  getCharacterDisplayWidth,
  findAnsiSGRSequenceEnd,
} from './ansi-text.ts';

const PLAY_PROGRESS_GROOVE_RGB: RGBColor = { r: 18, g: 18, b: 18 };
const PLAY_PROGRESS_HEAD_RGB: RGBColor = { r: 255, g: 186, b: 54 };

export function renderLaneBlockWithBGA(laneLines: string[], bgaANSILines?: string[]): string[] {
  if (!bgaANSILines || bgaANSILines.length === 0) {
    return laneLines;
  }

  const bgaWidth = Math.max(1, ...bgaANSILines.map((line) => visibleWidth(line)));
  const normalizedBGALines = fitLinesToHeight(bgaANSILines, laneLines.length, bgaWidth).map((line) =>
    renderBGALineWithScopedBlackBackground(line, bgaWidth),
  );
  const emptyBGALine = renderBGALineWithScopedBlackBackground(' '.repeat(bgaWidth), bgaWidth);
  return laneLines.map((laneLine, index) => `${laneLine}   ${normalizedBGALines[index] ?? emptyBGALine}`);
}

export function renderLaneBlockWithKittyPadding(
  laneLines: string[],
  bgaWidth: number,
): {
  lines: string[];
  column: number;
} {
  const safeBGAWidth = Math.max(1, Math.floor(bgaWidth));
  const laneBlockWidth = calculateRenderedLineBlockWidth(laneLines);
  const emptyBGALine = renderBGALineWithScopedBlackBackground(' '.repeat(safeBGAWidth), safeBGAWidth);
  return {
    lines: laneLines.map((laneLine) => `${padVisibleWidth(laneLine, laneBlockWidth)}   ${emptyBGALine}`),
    column: laneBlockWidth + 4,
  };
}

function calculateRenderedLineBlockWidth(lines: string[]): number {
  return Math.max(1, ...lines.map((line) => visibleWidth(line)));
}

export function resolveGrooveGaugeLeftPadding(laneCount: number): number {
  if (laneCount <= 0) {
    return 0;
  }
  return PLAY_PROGRESS_INDICATOR_SIDE_WIDTH;
}

export function renderLaneLinesWithProgressIndicators(
  laneLines: string[],
  currentSeconds: number,
  totalSeconds: number,
  startRowIndex: number,
  endRowIndex: number,
  renderRightIndicator: boolean,
): string[] {
  if (laneLines.length <= 0) {
    return laneLines;
  }
  const markerPosition = resolveProgressIndicatorMarkerPosition(
    startRowIndex,
    endRowIndex,
    currentSeconds,
    totalSeconds,
  );
  return laneLines.map((line, index) => {
    if (index < startRowIndex || index > endRowIndex) {
      const emptySide = renderProgressIndicatorPadding();
      return renderRightIndicator ? `${emptySide}${line}${emptySide}` : `${emptySide}${line}`;
    }
    const left = renderProgressIndicatorSide(index, markerPosition);
    if (!renderRightIndicator) {
      return `${left}${line}`;
    }
    return `${left}${line}${renderProgressIndicatorSide(index, markerPosition, 'right')}`;
  });
}

function resolveProgressIndicatorMarkerPosition(
  startRowIndex: number,
  endRowIndex: number,
  currentSeconds: number,
  totalSeconds: number,
): number {
  const safeStart = Math.max(0, Math.floor(startRowIndex));
  const safeEnd = Math.max(safeStart, Math.floor(endRowIndex));
  const safeLineCount = Math.max(1, safeEnd - safeStart + 1);
  const safeTotal = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 1;
  const safeCurrent = Number.isFinite(currentSeconds) ? currentSeconds : 0;
  const ratio = clamp(safeCurrent / safeTotal, 0, 1);
  return safeStart + (safeLineCount - 1) * ratio;
}

function renderProgressIndicatorSide(
  rowIndex: number,
  markerPosition: number,
  side: 'left' | 'right' = 'left',
): string {
  const glow = clamp(1 - Math.abs(markerPosition - rowIndex), 0, 1);
  const color = blendRGB(PLAY_PROGRESS_GROOVE_RGB, PLAY_PROGRESS_HEAD_RGB, glow);
  const groove = colorizeText('┃', color);
  if (side === 'right') {
    return groove;
  }
  return groove;
}

function renderProgressIndicatorPadding(): string {
  return ' '.repeat(Math.max(1, PLAY_PROGRESS_INDICATOR_SIDE_WIDTH));
}

function fitLinesToHeight(lines: string[], targetHeight: number, width: number): string[] {
  const normalized = lines.map((line) => padVisibleWidth(line, width));
  if (normalized.length === targetHeight) {
    return normalized;
  }
  if (normalized.length > targetHeight) {
    const offset = Math.floor((normalized.length - targetHeight) / 2);
    return normalized.slice(offset, offset + targetHeight);
  }

  const paddingTop = Math.floor((targetHeight - normalized.length) / 2);
  const paddingBottom = targetHeight - normalized.length - paddingTop;
  return [
    ...Array.from({ length: paddingTop }, () => ' '.repeat(width)),
    ...normalized,
    ...Array.from({ length: paddingBottom }, () => ' '.repeat(width)),
  ];
}

function renderBGALineWithScopedBlackBackground(line: string, width: number): string {
  const padded = padVisibleWidth(line, width);
  const backgrounds = decodeBackgroundColorsPerColumn(padded, width);
  return composeBackgroundRow(backgrounds, 0, backgrounds.length);
}

function decodeBackgroundColorsPerColumn(value: string, width: number): Array<RGBColor | undefined> {
  const safeWidth = Math.max(1, Math.floor(width));
  const colors: Array<RGBColor | undefined> = Array.from({ length: safeWidth }, () => undefined);
  let index = 0;
  let column = 0;
  let activeBackground: RGBColor | undefined;

  while (index < value.length && column < safeWidth) {
    if (value.charCodeAt(index) === 0x1b && index + 1 < value.length && value[index + 1] === '[') {
      const sequenceEnd = findAnsiSGRSequenceEnd(value, index + 2);
      if (sequenceEnd < 0) {
        index += 1;
        continue;
      }
      const params = parseAnsiSGRParams(value, index + 2, sequenceEnd);
      activeBackground = resolveANSIBackgroundColor(params, activeBackground);
      index = sequenceEnd + 1;
      continue;
    }

    const codePoint = value.codePointAt(index);
    if (typeof codePoint !== 'number') {
      index += 1;
      continue;
    }
    const charWidth = Math.max(1, getCharacterDisplayWidth(codePoint));
    for (let cell = 0; cell < charWidth && column < safeWidth; cell += 1) {
      colors[column] = activeBackground;
      column += 1;
    }
    index += codePoint > 0xffff ? 2 : 1;
  }

  return colors;
}

function parseAnsiSGRParams(value: string, start: number, end: number): number[] {
  if (end <= start) {
    return [0];
  }
  const payload = value.slice(start, end);
  if (payload.length === 0) {
    return [0];
  }
  const parts = payload.split(';');
  if (parts.length === 0) {
    return [0];
  }
  const params = parts.map((part) => Number.parseInt(part, 10)).filter((param) => Number.isFinite(param));
  return params.length > 0 ? params : [0];
}

function resolveANSIBackgroundColor(params: number[], current: RGBColor | undefined): RGBColor | undefined {
  let next = current;
  for (let index = 0; index < params.length; index += 1) {
    const code = params[index] ?? 0;
    if (code === 0 || code === 49) {
      next = undefined;
      continue;
    }
    if (code === 48) {
      const mode = params[index + 1];
      if (mode === 2 && index + 4 < params.length) {
        const r = clampColorByte(params[index + 2]);
        const g = clampColorByte(params[index + 3]);
        const b = clampColorByte(params[index + 4]);
        next = { r, g, b };
        index += 4;
        continue;
      }
      if (mode === 5 && index + 2 < params.length) {
        next = undefined;
        index += 2;
        continue;
      }
    }
  }
  return next;
}

function composeBackgroundRow(
  backgrounds: Array<RGBColor | undefined>,
  blackStartColumn: number,
  blackEndColumn: number,
): string {
  let output = '';
  let activeBackground: RGBColor | undefined;
  const start = Math.max(0, Math.floor(blackStartColumn));
  const end = Math.max(start, Math.floor(blackEndColumn));

  for (let column = 0; column < backgrounds.length; column += 1) {
    const color = backgrounds[column];
    const nextBackground = color ?? (column >= start && column < end ? BLACK_RGB : undefined);
    if (!isSameRGB(activeBackground, nextBackground)) {
      if (nextBackground) {
        output += `\u001b[48;2;${nextBackground.r};${nextBackground.g};${nextBackground.b}m`;
      } else {
        output += ANSI_RESET;
      }
      activeBackground = nextBackground;
    }
    output += ' ';
  }
  if (activeBackground) {
    output += ANSI_RESET;
  }
  return output;
}
