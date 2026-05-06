export const DEFAULT_LANE_WIDTH = 3;
export const WIDE_SCRATCH_LANE_WIDTH: number = DEFAULT_LANE_WIDTH * 2;
export const DEFAULT_GRID_ROWS = 14;
export const MIN_GRID_ROWS = 4;
export const BASE_TUI_RESERVED_LINES = 18;
export const SPLIT_PANEL_INNER_WIDTH = 5;
export const BGA_LANE_GAP = 3;
export const MIN_BGA_ASCII_WIDTH = 8;
export const MIN_BGA_ASCII_HEIGHT = 6;
export const DEFAULT_TERMINAL_COLUMNS = 120;
export const PLAY_PROGRESS_INDICATOR_SIDE_WIDTH = 1;

interface TuiLayoutOptions {
  showLaneChannels?: boolean;
  hasRandomPatternSummary?: boolean;
  hasAudioDebugLine?: boolean;
}

interface TuiBgaDisplaySizeOptions extends TuiLayoutOptions {
  laneWidths: number[];
  splitAfterIndex: number;
  columns?: number;
  rows?: number;
}

export function resolveLaneWidths(lanes: ReadonlyArray<{ isScratch?: boolean }>): number[] {
  return lanes.map((lane) => (lane.isScratch ? WIDE_SCRATCH_LANE_WIDTH : DEFAULT_LANE_WIDTH));
}

export function calculateTuiReservedLineCount(options: TuiLayoutOptions): number {
  return (
    BASE_TUI_RESERVED_LINES +
    (options.showLaneChannels ? 1 : 0) +
    (options.hasRandomPatternSummary ? 1 : 0) +
    (options.hasAudioDebugLine ? 1 : 0)
  );
}

export function calculateTuiGridRowCount(rows: number | undefined, options: TuiLayoutOptions): number {
  const reservedLineCount = calculateTuiReservedLineCount(options);
  const terminalRows = rows ?? DEFAULT_GRID_ROWS + reservedLineCount;
  return Math.max(MIN_GRID_ROWS, terminalRows - reservedLineCount);
}

export function calculateTuiLaneLinesCount(rowCount: number, showLaneChannels = false): number {
  return rowCount + 3 + (showLaneChannels ? 1 : 0);
}

export function calculateLaneBlockVisibleWidth(laneWidths: number[], splitAfterIndex: number): number {
  if (laneWidths.length <= 0) {
    return calculateLaneSectionVisibleWidth([DEFAULT_LANE_WIDTH]);
  }

  if (splitAfterIndex < 0 || splitAfterIndex >= laneWidths.length - 1) {
    return calculateLaneSectionVisibleWidth(laneWidths);
  }

  const left = laneWidths.slice(0, splitAfterIndex + 1);
  const right = laneWidths.slice(splitAfterIndex + 1);
  const splitPanelWidth = SPLIT_PANEL_INNER_WIDTH + 2;
  return Math.max(
    1,
    calculateLaneSectionVisibleWidth(left) + splitPanelWidth + calculateLaneSectionVisibleWidth(right),
  );
}

export function estimateBgaAnsiDisplaySize(options: TuiBgaDisplaySizeOptions): { width: number; height: number } {
  const width = Math.max(
    MIN_BGA_ASCII_WIDTH,
    (options.columns ?? DEFAULT_TERMINAL_COLUMNS) -
      calculateLaneBlockVisibleWidth(options.laneWidths, options.splitAfterIndex) -
      calculateProgressIndicatorVisibleWidth(options.laneWidths, options.splitAfterIndex) -
      BGA_LANE_GAP,
  );
  const rowCount = calculateTuiGridRowCount(options.rows, options);
  const height = Math.max(
    MIN_BGA_ASCII_HEIGHT,
    calculateTuiLaneLinesCount(rowCount, Boolean(options.showLaneChannels)),
  );
  return { width, height };
}

function calculateProgressIndicatorVisibleWidth(laneWidths: number[], splitAfterIndex: number): number {
  if (laneWidths.length <= 0) {
    return 0;
  }
  if (splitAfterIndex < 0 || splitAfterIndex >= laneWidths.length - 1) {
    return PLAY_PROGRESS_INDICATOR_SIDE_WIDTH;
  }
  return PLAY_PROGRESS_INDICATOR_SIDE_WIDTH * 2;
}

export function calculateLaneSectionVisibleWidth(sectionLaneWidths: number[]): number {
  const innerWidth = calculateLaneSectionInnerVisibleWidth(sectionLaneWidths);
  if (innerWidth <= 0) {
    return 0;
  }
  return innerWidth + 2;
}

function calculateLaneSectionInnerVisibleWidth(sectionLaneWidths: number[]): number {
  const laneCount = Math.max(0, sectionLaneWidths.length);
  if (laneCount <= 0) {
    return 0;
  }
  let width = 0;
  for (let index = 0; index < laneCount; index += 1) {
    width += sectionLaneWidths[index] ?? DEFAULT_LANE_WIDTH;
  }
  width += Math.max(0, laneCount - 1);
  return width;
}
