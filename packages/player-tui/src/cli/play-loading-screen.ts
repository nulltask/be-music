import type { PlayerLoadComponentStatus } from '@be-music/player';
import type { StageFileANSIImage } from '../bga.ts';
import { buildKittyGraphicsDeleteImageSequence, buildKittyGraphicsRenderSequence } from '../tui/kitty-graphics.ts';
import { truncateForDisplay } from './selection-format.ts';

export interface PlayLoadingProgress {
  ratio: number;
  message: string;
  detail?: string;
  audioStatus?: PlayerLoadComponentStatus;
  graphicsStatus?: PlayerLoadComponentStatus;
}

export interface PlayLoadingScreenRenderState {
  initialized: boolean;
  stageFileDrawn: boolean;
  stageFileKittyVisible: boolean;
  stageFileRenderLogged?: boolean;
  lastOutput?: string;
}

const PLAY_LOADING_STAGEFILE_KITTY_IMAGE_ID = 7_331;

export function resolvePlayLoadingStageFileDisplaySize(
  columns?: number,
  rows?: number,
): {
  width: number;
  height: number;
} {
  const safeColumns = Math.max(16, Math.floor(columns ?? 80));
  const safeRows = Math.max(8, Math.floor(rows ?? 24));
  return {
    width: safeColumns,
    height: safeRows,
  };
}

function formatPlayLoadingComponentStatus(label: string, status: PlayerLoadComponentStatus | undefined): string {
  if (!status) {
    return `${label}: -`;
  }
  const { message, countLabel } = resolvePlayLoadingComponentStatusDisplay(status);
  if (status.state === 'ready' || status.state === 'disabled') {
    return `${label}: ${message}`;
  }
  const detailParts = [
    countLabel,
    typeof status.detail === 'string' && status.detail.length > 0 ? status.detail : undefined,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  return detailParts.length > 0 ? `${label}: ${message} (${detailParts.join(', ')})` : `${label}: ${message}`;
}

function resolvePlayLoadingComponentStatusDisplay(status: PlayerLoadComponentStatus): {
  message: string;
  countLabel?: string;
} {
  if (status.state !== 'pending') {
    return { message: status.message };
  }
  const countLabel = extractPlayLoadingProgressCountLabel(status.message);
  if (status.message.startsWith('Waiting')) {
    return { message: 'Waiting...', countLabel };
  }
  if (status.message.startsWith('Initializing')) {
    return { message: 'Initializing...', countLabel };
  }
  return { message: 'Loading...', countLabel };
}

function extractPlayLoadingProgressCountLabel(message: string): string | undefined {
  const match = /\((\d+\/\d+)\)\s*$/.exec(message);
  return match?.[1];
}

function resolvePlayLoadingStepLabel(progress: PlayLoadingProgress): string {
  if (progress.audioStatus || progress.graphicsStatus) {
    return 'Loading playback resources...';
  }
  if (
    progress.message === 'Parsing chart file...' ||
    progress.message === 'Loading stage image...' ||
    progress.message === 'Chart parsed.'
  ) {
    return 'Loading chart resources...';
  }
  return progress.message;
}

export function createPlayLoadingProgressScreenLines(
  chartPath: string,
  progress: PlayLoadingProgress,
  options: {
    columns?: number;
    stageFileImage?: StageFileANSIImage;
    useKittyGraphics?: boolean;
  } = {},
): string[] {
  const columns = options.columns ?? 80;
  const lineWidth = Math.max(16, columns);
  const fileLabel = chartPath.replaceAll('\\', '/');
  const ratio = Math.max(0, Math.min(1, progress.ratio));
  const barWidth = Math.max(10, Math.min(48, lineWidth - 8));
  const filled = Math.max(0, Math.min(barWidth, Math.round(barWidth * ratio)));
  const bar = `[${'#'.repeat(filled)}${'-'.repeat(barWidth - filled)}] ${Math.round(ratio * 100)}%`;
  const rawLines = [
    'Loading selected chart...',
    bar,
    `Step: ${resolvePlayLoadingStepLabel(progress)}`,
    formatPlayLoadingComponentStatus('Sound', progress.audioStatus),
    formatPlayLoadingComponentStatus('Visual', progress.graphicsStatus),
    `File: ${fileLabel}`,
  ];
  return rawLines.map((line, index) =>
    options.stageFileImage
      ? options.useKittyGraphics === true && options.stageFileImage.kittyImage
        ? stylePlayLoadingOverlayLineOnKittyImage(line, lineWidth, index, options.stageFileImage)
        : stylePlayLoadingOverlayLineOnImage(line, lineWidth, index, options.stageFileImage)
      : stylePlayLoadingOverlayFallbackLine(line, lineWidth),
  );
}

export function createPlayLoadingProgressScreenOutput(
  chartPath: string,
  progress: PlayLoadingProgress,
  options: {
    columns?: number;
    stageFileImage?: StageFileANSIImage;
    useKittyGraphics?: boolean;
    resetScreen?: boolean;
    includeStageFileImage?: boolean;
  } = {},
): string {
  const overlayLines = createPlayLoadingProgressScreenLines(chartPath, progress, {
    columns: options.columns,
    stageFileImage: options.stageFileImage,
    useKittyGraphics: options.useKittyGraphics,
  });
  const imageBlock = resolvePlayLoadingStageFileBlock(options.stageFileImage, {
    includeStageFileImage: options.includeStageFileImage,
    useKittyGraphics: options.useKittyGraphics,
  });
  const prefix = options.resetScreen === false ? '\u001b[H' : '\u001b[2J\u001b[H';
  return `${prefix}${imageBlock}${overlayLines.join('\n')}`;
}

function resolvePlayLoadingStageFileBlock(
  stageFileImage: StageFileANSIImage | undefined,
  options: {
    includeStageFileImage?: boolean;
    useKittyGraphics?: boolean;
  },
): string {
  if (options.includeStageFileImage === false || !stageFileImage) {
    return '';
  }
  if (options.useKittyGraphics === true && stageFileImage.kittyImage) {
    return (
      buildKittyGraphicsRenderSequence({
        imageId: PLAY_LOADING_STAGEFILE_KITTY_IMAGE_ID,
        placementId: 1,
        row: 1,
        column: 1,
        image: stageFileImage.kittyImage,
        zIndex: -1,
        doNotMoveCursor: true,
      }) + '\u001b[H'
    );
  }
  return stageFileImage.lines.length > 0 ? `${stageFileImage.lines.join('\n')}\u001b[H` : '';
}

export function clearPlayLoadingScreen(state: PlayLoadingScreenRenderState): void {
  clearPlayLoadingStageFileImage(state);
  if (state.initialized) {
    process.stdout.write('\u001b[2J\u001b[H');
    state.initialized = false;
  }
  state.stageFileRenderLogged = false;
}

export function clearPlayLoadingStageFileImage(state: PlayLoadingScreenRenderState): void {
  state.lastOutput = undefined;
  if (!state.stageFileKittyVisible) {
    return;
  }
  process.stdout.write(buildKittyGraphicsDeleteImageSequence(PLAY_LOADING_STAGEFILE_KITTY_IMAGE_ID));
  state.stageFileKittyVisible = false;
}

function stylePlayLoadingOverlayFallbackLine(text: string, lineWidth: number): string {
  return `\u001b[38;2;255;255;255;48;2;0;0;0m${truncateForDisplay(text, lineWidth).padEnd(lineWidth, ' ')}\u001b[0m`;
}

function stylePlayLoadingOverlayLineOnImage(
  text: string,
  lineWidth: number,
  rowIndex: number,
  stageFileImage: StageFileANSIImage,
): string {
  const content = truncateForDisplay(text, lineWidth).padEnd(lineWidth, ' ');
  if (rowIndex >= stageFileImage.height) {
    return stylePlayLoadingOverlayFallbackLine(content, lineWidth);
  }

  let line = '';
  let currentStyle = '';
  for (let index = 0; index < content.length; index += 1) {
    const bg = getStageFilePixel(stageFileImage, rowIndex, index);
    const fg = resolveOverlayTextColor(bg.r, bg.g, bg.b);
    const nextStyle = `\u001b[38;2;${fg.r};${fg.g};${fg.b};48;2;${bg.r};${bg.g};${bg.b}m`;
    if (nextStyle !== currentStyle) {
      line += nextStyle;
      currentStyle = nextStyle;
    }
    line += content[index];
  }
  if (currentStyle.length > 0) {
    line += '\u001b[0m';
  }
  return line;
}

function stylePlayLoadingOverlayLineOnKittyImage(
  text: string,
  lineWidth: number,
  rowIndex: number,
  stageFileImage: StageFileANSIImage,
): string {
  const content = truncateForDisplay(text, lineWidth).padEnd(lineWidth, ' ');
  if (rowIndex >= stageFileImage.height) {
    return truncateForDisplay(text, lineWidth);
  }

  let line = '';
  let currentStyle = '';
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? ' ';
    if (character === ' ') {
      if (currentStyle.length > 0) {
        line += '\u001b[0m';
        currentStyle = '';
      }
      line += character;
      continue;
    }

    const bg = getStageFilePixel(stageFileImage, rowIndex, index);
    const fg = resolveOverlayTextColor(bg.r, bg.g, bg.b);
    const nextStyle = `\u001b[38;2;${fg.r};${fg.g};${fg.b}m`;
    if (nextStyle !== currentStyle) {
      line += nextStyle;
      currentStyle = nextStyle;
    }
    line += character;
  }
  if (currentStyle.length > 0) {
    line += '\u001b[0m';
  }
  return line;
}

function getStageFilePixel(
  stageFileImage: StageFileANSIImage,
  rowIndex: number,
  columnIndex: number,
): { r: number; g: number; b: number } {
  const x = Math.max(0, Math.min(stageFileImage.width - 1, columnIndex));
  const y = Math.max(0, Math.min(stageFileImage.height - 1, rowIndex));
  const rgbOffset = (y * stageFileImage.width + x) * 3;
  return {
    r: stageFileImage.rgb[rgbOffset] ?? 0,
    g: stageFileImage.rgb[rgbOffset + 1] ?? 0,
    b: stageFileImage.rgb[rgbOffset + 2] ?? 0,
  };
}

function resolveOverlayTextColor(r: number, g: number, b: number): { r: 0 | 255; g: 0 | 255; b: 0 | 255 } {
  const whiteContrast = calculateContrastRatio(r, g, b, 255, 255, 255);
  const blackContrast = calculateContrastRatio(r, g, b, 0, 0, 0);
  return whiteContrast >= blackContrast ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
}

function calculateContrastRatio(
  backgroundR: number,
  backgroundG: number,
  backgroundB: number,
  foregroundR: number,
  foregroundG: number,
  foregroundB: number,
): number {
  const backgroundLuminance = calculateRelativeLuminance(backgroundR, backgroundG, backgroundB);
  const foregroundLuminance = calculateRelativeLuminance(foregroundR, foregroundG, foregroundB);
  const lighter = Math.max(backgroundLuminance, foregroundLuminance);
  const darker = Math.min(backgroundLuminance, foregroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function calculateRelativeLuminance(r: number, g: number, b: number): number {
  const red = sRGBChannelToLinear(r);
  const green = sRGBChannelToLinear(g);
  const blue = sRGBChannelToLinear(b);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function sRGBChannelToLinear(value: number): number {
  const normalized = Math.max(0, Math.min(255, value)) / 255;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
}
