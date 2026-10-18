import { PLAY_MODE_LAYOUTS } from '@be-music/chart';
import { clamp } from '@be-music/utils/core';
import { DEFAULT_TUI_NOTE_HEIGHT, type TuiNoteHeight } from '@be-music/player/display';
import { findStackableRowIndex } from './lane-stacking.ts';
import {
  calculateLaneBlockVisibleWidth,
  calculateLaneSectionVisibleWidth,
  DEFAULT_LANE_WIDTH,
  SPLIT_PANEL_INNER_WIDTH,
} from './layout.ts';
import { ANSI_RESET, type RgbColor, BLACK_RGB, centerVisible, colorizeText } from './ansi-text.ts';

export interface TuiLane {
  channel: string;
  key: string;
  isScratch?: boolean;
}

export const MEASURE_LINE_SYMBOL = '▔';
const MEASURE_LINE_DIVIDER_SYMBOL = '┬';
export const LANE_FILL_SYMBOL = '│';
const LANE_DIVIDER_SYMBOL = '│';
const LANE_OUTER_BORDER_SYMBOL = '┃';
const HIGHLIGHT_DECAY_POWER = 0.72;
const HIGHLIGHT_R_BOOST = 56;
const HIGHLIGHT_G_BOOST = 62;
const HIGHLIGHT_B_BOOST = 74;
// Lane colours come from the play-mode table, by channel and whatever the mode: the IIDX scratches and the keyboard
// modes' wheel lanes (`1P` / `1Q` / `2P` / `2Q`, which no other mode uses) are red, the 14 KEY layout's white keys
// white, and its black keys plus the FREE ZONE channels (`17` / `27`) blue.
const SCRATCH_LANE_CHANNELS: ReadonlySet<string> = new Set(
  [PLAY_MODE_LAYOUTS['14'], PLAY_MODE_LAYOUTS['48']].flatMap((layout) =>
    layout.lanes.filter((lane) => lane.kind !== 'key').map((lane) => lane.channel),
  ),
);
const RED_NOTE_CHANNELS = SCRATCH_LANE_CHANNELS;
const WHITE_NOTE_CHANNELS: ReadonlySet<string> = new Set(
  PLAY_MODE_LAYOUTS['14'].lanes.filter((lane) => lane.tone === 'white').map((lane) => lane.channel),
);
const BLUE_NOTE_CHANNELS: ReadonlySet<string> = new Set([
  ...PLAY_MODE_LAYOUTS['14'].lanes.filter((lane) => lane.tone === 'black').map((lane) => lane.channel),
  ...PLAY_MODE_LAYOUTS['14'].freeZones.map((zone) => zone.channel),
]);
export const NOTE_HEAD_SYMBOL = '●';
export const LONG_NOTE_HEAD_SYMBOL = '▲';
export const LONG_NOTE_BODY_SYMBOL = '■';
export const LONG_NOTE_TAIL_SYMBOL = '◆';
export const MINE_NOTE_SYMBOL = '✕';
export const INVISIBLE_NOTE_HEAD_SYMBOL = '◯';
export const INVISIBLE_LONG_NOTE_HEAD_SYMBOL = '△';
export const INVISIBLE_LONG_NOTE_BODY_SYMBOL = '□';
export const INVISIBLE_LONG_NOTE_TAIL_SYMBOL = '◇';

interface NoteLikeLaneCell {
  kind: 'head' | 'long-head' | 'body' | 'tail';
  invisible: boolean;
  underline: boolean;
}

type StructuredLaneCellRenderer = (
  value: string,
  laneWidth: number,
  sourceChannel: string,
  noteHeight: TuiNoteHeight,
) => string;

type StructuredLaneSectionRenderer = (cells: string[], noteHeight: TuiNoteHeight) => string;

const WHITE_KEY_LANE_BG_RGB: RgbColor = { r: 24, g: 36, b: 56 };
const BLACK_KEY_LANE_BG_RGB: RgbColor = { r: 2, g: 4, b: 8 };
const SCRATCH_LANE_BG_RGB: RgbColor = { r: 5, g: 8, b: 12 };
const SPLIT_PANEL_BACKGROUND_RGB: RgbColor = { r: 18, g: 18, b: 18 };
const LANE_DIVIDER_RGB: RgbColor = { r: 148, g: 148, b: 148 };
const LANE_OUTER_BORDER_RGB: RgbColor = { r: 218, g: 218, b: 218 };
const LANE_CEILING_RGB: RgbColor = { r: 88, g: 88, b: 88 };
const JUDGE_LINE_RGB: RgbColor = { r: 255, g: 48, b: 48 };
const LANE_LABEL_RGB: RgbColor = { r: 198, g: 198, b: 198 };
const RED_NOTE_RGB: RgbColor = { r: 255, g: 95, b: 95 };
const BLUE_NOTE_RGB: RgbColor = { r: 95, g: 135, b: 255 };
const WHITE_NOTE_RGB: RgbColor = { r: 255, g: 255, b: 255 };
const INVISIBLE_NOTE_RGB: RgbColor = { r: 102, g: 224, b: 161 };
const MEASURE_LINE_RGB: RgbColor = { r: 158, g: 158, b: 158 };
const MINE_FOREGROUND_RGB: RgbColor = { r: 255, g: 255, b: 255 };
const MINE_BACKGROUND_RGB: RgbColor = { r: 205, g: 64, b: 64 };
const INPUT_KEY_LIGHT_FOREGROUND_RGB: RgbColor = { r: 24, g: 24, b: 24 };
const INPUT_KEY_LIGHT_BACKGROUND_RGB: RgbColor = { r: 238, g: 238, b: 238 };
const INPUT_KEY_DARK_FOREGROUND_RGB: RgbColor = { r: 250, g: 250, b: 250 };
const INPUT_KEY_DARK_BACKGROUND_RGB: RgbColor = { r: 16, g: 16, b: 16 };
const INPUT_KEY_SCRATCH_BACKGROUND_RGB: RgbColor = { r: 138, g: 138, b: 138 };
const INPUT_KEY_ACTIVE_BACKGROUND_RGB: RgbColor = { r: 255, g: 135, b: 0 };

export function renderLaneRow(
  values: string[],
  channels: string[],
  laneWidths: number[],
  splitAfterIndex = -1,
  noteHeight: TuiNoteHeight = DEFAULT_TUI_NOTE_HEIGHT,
  laneHighlightRatios: Map<number, number> = new Map<number, number>(),
  sourceChannels?: string[],
  applyLaneBackground = true,
): string {
  const cells = values.map((value, index) => {
    const laneWidth = laneWidths[index] ?? DEFAULT_LANE_WIDTH;
    const laneChannel = resolveLaneRenderChannel(index, channels, sourceChannels);
    const noteCell = resolveNoteLikeLaneCell(value);
    const isMine = value === MINE_NOTE_SYMBOL;
    const isLaneFill = value === LANE_FILL_SYMBOL;
    const isLaneCeiling = value === '═';
    const isInvisibleNote = noteCell?.invisible ?? false;
    const noteUnderline = noteCell?.underline ?? false;
    const cell = isLaneFill
      ? renderLaneBackdropCell(laneWidth)
      : isLaneCeiling
        ? colorizeLaneCeiling('─'.repeat(Math.max(1, laneWidth)))
        : noteCell
          ? renderNoteCell(laneWidth, noteCell.kind, noteHeight)
          : isMine
            ? center(MINE_NOTE_SYMBOL, laneWidth)
            : center(value, laneWidth);
    const decoratedCell = isMine
      ? colorizeMine(cell)
      : noteCell
        ? colorizeNote(cell, laneChannel, isInvisibleNote, noteUnderline)
        : value === MEASURE_LINE_SYMBOL
          ? colorizeMeasureLine(cell)
          : isLaneFill || isLaneCeiling
            ? cell
            : colorizeLaneLabel(cell);
    const highlightRatio = laneHighlightRatios.get(index);
    if (highlightRatio !== undefined) {
      return highlightCell(decoratedCell, laneChannel, highlightRatio);
    }
    return applyLaneBackground ? colorizeLaneBackground(decoratedCell, laneChannel) : decoratedCell;
  });
  if (splitAfterIndex < 0 || splitAfterIndex >= cells.length - 1) {
    return renderLaneSection(cells);
  }

  const left = renderLaneSection(cells.slice(0, splitAfterIndex + 1));
  const right = renderLaneSection(cells.slice(splitAfterIndex + 1));
  return `${left}${renderLaneSplitPanel()}${right}`;
}

function renderLaneSection(cells: string[]): string {
  const divider = colorizeLaneDivider(LANE_DIVIDER_SYMBOL);
  const body = cells.join(divider);
  return `${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}${body}${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}`;
}

function renderLaneSplitPanel(): string {
  const fill = `\u001b[48;2;${SPLIT_PANEL_BACKGROUND_RGB.r};${SPLIT_PANEL_BACKGROUND_RGB.g};${SPLIT_PANEL_BACKGROUND_RGB.b}m${' '.repeat(SPLIT_PANEL_INNER_WIDTH)}${ANSI_RESET}`;
  return `${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}${fill}${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}`;
}

export function renderInputKeyRows(
  lanes: ReadonlyArray<TuiLane>,
  laneWidths: number[],
  splitAfterIndex = -1,
  activeChannels: Set<string> = new Set<string>(),
  useOddEvenRows = false,
): [blackKeyRow: string, whiteAndScratchRow: string] {
  const upperRowCells: string[] = [];
  const lowerRowCells: string[] = [];

  for (let index = 0; index < lanes.length; index += 1) {
    const lane = lanes[index]!;
    const laneWidth = laneWidths[index] ?? DEFAULT_LANE_WIDTH;
    const laneNumber = useOddEvenRows ? resolveLaneNumberForInputRows(lane.channel) : -1;
    const isUpperRowLane = useOddEvenRows
      ? laneNumber > 0 && laneNumber % 2 === 0
      : resolveInputKeyLaneGroup(lane) === 'black';
    const laneChannel = lane.channel.toUpperCase();
    const labelStyle = useOddEvenRows ? (isUpperRowLane ? 'black' : 'white') : resolveInputKeyLaneStyle(lane);
    const styledLabel = activeChannels.has(laneChannel)
      ? colorizeActiveInputKeyLabel(center(lane.key, laneWidth))
      : colorizeInputKeyLabel(center(lane.key, laneWidth), labelStyle);
    const emptyCell = ' '.repeat(Math.max(1, laneWidth));
    upperRowCells.push(isUpperRowLane ? styledLabel : emptyCell);
    lowerRowCells.push(isUpperRowLane ? emptyCell : styledLabel);
  }

  return [
    renderLaneSectionWithSplitPanel(upperRowCells, splitAfterIndex),
    renderLaneSectionWithSplitPanel(lowerRowCells, splitAfterIndex),
  ];
}

export function renderJudgeComboLine(
  labels: { single: string; left: string; right: string },
  laneWidths: number[],
  splitAfterIndex: number | undefined,
): string {
  const safeSplitIndex = Number.isInteger(splitAfterIndex) ? (splitAfterIndex as number) : -1;
  if (!hasLaneSplit(safeSplitIndex, laneWidths.length)) {
    return centerVisible(labels.single, calculateLaneBlockVisibleWidth(laneWidths, safeSplitIndex));
  }

  const leftWidth = calculateLaneSectionVisibleWidth(laneWidths.slice(0, safeSplitIndex + 1));
  const rightWidth = calculateLaneSectionVisibleWidth(laneWidths.slice(safeSplitIndex + 1));
  const splitPanelWidth = SPLIT_PANEL_INNER_WIDTH + 2;
  return `${centerVisible(labels.left, leftWidth)}${' '.repeat(splitPanelWidth)}${centerVisible(labels.right, rightWidth)}`;
}

function renderLaneSectionWithSplitPanel(cells: string[], splitAfterIndex: number): string {
  if (splitAfterIndex < 0 || splitAfterIndex >= cells.length - 1) {
    return renderLaneSection(cells);
  }
  const left = renderLaneSection(cells.slice(0, splitAfterIndex + 1));
  const right = renderLaneSection(cells.slice(splitAfterIndex + 1));
  return `${left}${renderLaneSplitPanel()}${right}`;
}

function resolveLaneRenderChannel(index: number, channels: string[], sourceChannels?: string[]): string {
  const source = sourceChannels?.[index];
  if (typeof source === 'string' && source.length > 0) {
    return source;
  }
  return channels[index] ?? '';
}

export function renderMeasureRow(
  values: string[],
  channels: string[],
  laneWidths: number[],
  splitAfterIndex = -1,
  noteHeight: TuiNoteHeight = DEFAULT_TUI_NOTE_HEIGHT,
  laneHighlightRatios: Map<number, number> = new Map<number, number>(),
  sourceChannels?: string[],
): string {
  return renderStructuredLaneRow(
    values,
    channels,
    laneWidths,
    splitAfterIndex,
    noteHeight,
    laneHighlightRatios,
    sourceChannels,
    renderMeasureLaneCell,
    (cells) => renderMeasureSection(cells),
  );
}

function renderMeasureSection(cells: string[]): string {
  const divider = colorizeMeasureLine(MEASURE_LINE_DIVIDER_SYMBOL);
  const body = cells.join(divider);
  return `${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}${body}${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}`;
}

function renderMeasureLaneCell(
  value: string,
  laneWidth: number,
  sourceChannel: string,
  noteHeight: TuiNoteHeight = DEFAULT_TUI_NOTE_HEIGHT,
): string {
  const safeWidth = Math.max(1, laneWidth);
  const noteCell = resolveNoteLikeLaneCell(value);
  if (noteCell) {
    return colorizeNote(
      renderNoteCell(safeWidth, noteCell.kind, noteHeight),
      sourceChannel,
      noteCell.invisible,
      noteCell.underline,
    );
  }
  if (value === MINE_NOTE_SYMBOL) {
    return colorizeMine(center(MINE_NOTE_SYMBOL, safeWidth));
  }
  return colorizeMeasureLine(MEASURE_LINE_SYMBOL.repeat(safeWidth));
}

export function renderJudgeRow(
  values: string[],
  channels: string[],
  laneWidths: number[],
  splitAfterIndex = -1,
  noteHeight: TuiNoteHeight = DEFAULT_TUI_NOTE_HEIGHT,
  laneHighlightRatios: Map<number, number> = new Map<number, number>(),
  sourceChannels?: string[],
): string {
  return renderStructuredLaneRow(
    values,
    channels,
    laneWidths,
    splitAfterIndex,
    noteHeight,
    laneHighlightRatios,
    sourceChannels,
    renderJudgeLaneCell,
    renderJudgeSection,
  );
}

function renderStructuredLaneRow(
  values: string[],
  channels: string[],
  laneWidths: number[],
  splitAfterIndex: number,
  noteHeight: TuiNoteHeight,
  laneHighlightRatios: ReadonlyMap<number, number>,
  sourceChannels: string[] | undefined,
  renderCell: StructuredLaneCellRenderer,
  renderSectionCells: StructuredLaneSectionRenderer,
): string {
  const renderSlice = (startIndex: number, endIndex: number): string => {
    const cells: string[] = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      const laneWidth = laneWidths[index] ?? DEFAULT_LANE_WIDTH;
      const channel = resolveLaneRenderChannel(index, channels, sourceChannels);
      let cell = renderCell(values[index] ?? LANE_FILL_SYMBOL, laneWidth, channel, noteHeight);
      const highlightRatio = laneHighlightRatios.get(index);
      if (highlightRatio !== undefined) {
        cell = highlightCell(cell, channel, highlightRatio);
      } else {
        cell = colorizeLaneBackground(cell, channel);
      }
      cells.push(cell);
    }
    return renderSectionCells(cells, noteHeight);
  };

  if (splitAfterIndex < 0 || splitAfterIndex >= values.length - 1) {
    return renderSlice(0, values.length);
  }

  const left = renderSlice(0, splitAfterIndex + 1);
  const right = renderSlice(splitAfterIndex + 1, values.length);
  return `${left}${renderLaneSplitPanel()}${right}`;
}

function renderJudgeSection(cells: string[], noteHeight: TuiNoteHeight = DEFAULT_TUI_NOTE_HEIGHT): string {
  const divider = colorizeJudgeLine(resolveJudgeLineSymbol(noteHeight));
  const body = cells.join(divider);
  return `${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}${body}${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}`;
}

function renderJudgeLaneCell(
  value: string,
  laneWidth: number,
  sourceChannel: string,
  noteHeight: TuiNoteHeight = DEFAULT_TUI_NOTE_HEIGHT,
): string {
  const safeWidth = Math.max(1, laneWidth);
  const noteCell = resolveNoteLikeLaneCell(value);
  if (noteCell) {
    return colorizeNote(
      renderNoteCell(safeWidth, noteCell.kind, noteHeight),
      sourceChannel,
      noteCell.invisible,
      noteCell.underline,
    );
  }
  if (value === MINE_NOTE_SYMBOL) {
    return colorizeMine(center(MINE_NOTE_SYMBOL, safeWidth));
  }
  return colorizeJudgeLine(resolveJudgeLineSymbol(noteHeight).repeat(safeWidth));
}

export function setLaneCell(
  grid: string[][],
  sourceChannels: string[][],
  row: number,
  lane: number,
  symbol: string,
  sourceChannel: string,
  freeZoneSourceChannels: ReadonlySet<string>,
  stackWhenOccupied = false,
): number {
  const safeRow = clamp(Math.floor(row), 0, Math.max(0, grid.length - 1));
  const rowCells = grid[safeRow];
  const rowSources = sourceChannels[safeRow];
  if (!rowCells || !rowSources || lane < 0 || lane >= rowCells.length || lane >= rowSources.length) {
    return safeRow;
  }

  const normalizedSourceChannel = sourceChannel.toUpperCase();
  const nextPriority = resolveLaneCellPriority(symbol, freeZoneSourceChannels.has(normalizedSourceChannel));

  const canPlaceAt = (targetRow: number, allowEqualPriorityOverwrite: boolean): boolean => {
    const targetCells = grid[targetRow];
    const targetSources = sourceChannels[targetRow];
    if (!targetCells || !targetSources || lane < 0 || lane >= targetCells.length || lane >= targetSources.length) {
      return false;
    }
    const previousSymbol = targetCells[lane] ?? LANE_FILL_SYMBOL;
    const previousSourceChannel = targetSources[lane] ?? '';
    const previousPriority = resolveLaneCellPriority(
      previousSymbol,
      freeZoneSourceChannels.has(previousSourceChannel.toUpperCase()),
    );
    if (nextPriority < previousPriority) {
      return false;
    }
    if (!allowEqualPriorityOverwrite && nextPriority === previousPriority) {
      return false;
    }
    return true;
  };

  const placeAt = (targetRow: number): void => {
    const targetCells = grid[targetRow]!;
    const targetSources = sourceChannels[targetRow]!;
    targetCells[lane] = symbol;
    targetSources[lane] = normalizedSourceChannel;
  };

  if (canPlaceAt(safeRow, !stackWhenOccupied)) {
    placeAt(safeRow);
    return safeRow;
  }

  if (stackWhenOccupied && isStackableLaneSymbol(symbol)) {
    const stackedRow = findStackableRow(grid, sourceChannels, safeRow, canPlaceAt);
    if (stackedRow !== undefined) {
      placeAt(stackedRow);
      return stackedRow;
    }
  }

  if (canPlaceAt(safeRow, true)) {
    placeAt(safeRow);
  }

  return safeRow;
}

function isStackableLaneSymbol(symbol: string): boolean {
  return (
    symbol === NOTE_HEAD_SYMBOL ||
    symbol === LONG_NOTE_HEAD_SYMBOL ||
    symbol === LONG_NOTE_TAIL_SYMBOL ||
    symbol === INVISIBLE_NOTE_HEAD_SYMBOL ||
    symbol === INVISIBLE_LONG_NOTE_HEAD_SYMBOL ||
    symbol === INVISIBLE_LONG_NOTE_TAIL_SYMBOL ||
    symbol === MINE_NOTE_SYMBOL
  );
}

function findStackableRow(
  grid: string[][],
  sourceChannels: string[][],
  preferredRow: number,
  canPlaceAt: (targetRow: number, allowEqualPriorityOverwrite: boolean) => boolean,
): number | undefined {
  const rowCount = Math.min(grid.length, sourceChannels.length);
  return findStackableRowIndex(rowCount, preferredRow, (targetRow) => canPlaceAt(targetRow, false));
}

function resolveLaneCellPriority(symbol: string, isFreeZoneSourceChannel: boolean): number {
  if (symbol === NOTE_HEAD_SYMBOL || symbol === LONG_NOTE_HEAD_SYMBOL || symbol === LONG_NOTE_TAIL_SYMBOL) {
    return isFreeZoneSourceChannel ? 5 : 6;
  }
  if (symbol === LONG_NOTE_BODY_SYMBOL) {
    return isFreeZoneSourceChannel ? 4 : 5;
  }
  if (symbol === MINE_NOTE_SYMBOL) {
    return 3;
  }
  if (
    symbol === INVISIBLE_NOTE_HEAD_SYMBOL ||
    symbol === INVISIBLE_LONG_NOTE_HEAD_SYMBOL ||
    symbol === INVISIBLE_LONG_NOTE_TAIL_SYMBOL
  ) {
    return 2;
  }
  if (symbol === INVISIBLE_LONG_NOTE_BODY_SYMBOL) {
    return 1;
  }
  if (symbol === MEASURE_LINE_SYMBOL) {
    return 1;
  }
  if (symbol === LANE_FILL_SYMBOL) {
    return 0;
  }
  return 1;
}

function center(value: string, width: number): string {
  if (value.length >= width) {
    return value.slice(0, width);
  }
  const totalPadding = width - value.length;
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return `${' '.repeat(leftPadding)}${value}${' '.repeat(rightPadding)}`;
}

function resolveRegularNoteSymbol(noteHeight: TuiNoteHeight): string {
  const symbols: Record<TuiNoteHeight, string> = {
    1: '▁',
    2: '▂',
    3: '▃',
    4: '▄',
    5: '▅',
    6: '▆',
    7: '▇',
    8: '█',
  };
  return symbols[noteHeight];
}

function resolveNoteLikeLaneCell(value: string): NoteLikeLaneCell | undefined {
  switch (value) {
    case NOTE_HEAD_SYMBOL:
      return { kind: 'head', invisible: false, underline: true };
    case LONG_NOTE_HEAD_SYMBOL:
      return { kind: 'long-head', invisible: false, underline: true };
    case LONG_NOTE_BODY_SYMBOL:
      return { kind: 'body', invisible: false, underline: false };
    case LONG_NOTE_TAIL_SYMBOL:
      return { kind: 'tail', invisible: false, underline: true };
    case INVISIBLE_NOTE_HEAD_SYMBOL:
      return { kind: 'head', invisible: true, underline: true };
    case INVISIBLE_LONG_NOTE_HEAD_SYMBOL:
      return { kind: 'long-head', invisible: true, underline: true };
    case INVISIBLE_LONG_NOTE_BODY_SYMBOL:
      return { kind: 'body', invisible: true, underline: false };
    case INVISIBLE_LONG_NOTE_TAIL_SYMBOL:
      return { kind: 'tail', invisible: true, underline: true };
    default:
      return undefined;
  }
}

function resolveJudgeLineSymbol(noteHeight: TuiNoteHeight): string {
  return resolveRegularNoteSymbol(noteHeight);
}

function renderNoteCell(
  width: number,
  kind: 'head' | 'long-head' | 'body' | 'tail',
  noteHeight: TuiNoteHeight = DEFAULT_TUI_NOTE_HEIGHT,
): string {
  const safeWidth = Math.max(1, width);
  if (kind === 'head') {
    return resolveRegularNoteSymbol(noteHeight).repeat(safeWidth);
  }
  if (kind === 'long-head') {
    return '█'.repeat(safeWidth);
  }
  if (kind === 'body') {
    return '▓'.repeat(safeWidth);
  }
  if (kind === 'tail') {
    return '▒'.repeat(safeWidth);
  }
  return resolveRegularNoteSymbol(noteHeight).repeat(safeWidth);
}

function highlightCell(value: string, channel: string, ratio: number): string {
  const background = resolveLaneHighlightBackgroundColor(channel, ratio);
  return `\u001b[48;2;${background.r};${background.g};${background.b}m${value}\u001b[0m`;
}

function renderLaneBackdropCell(width: number): string {
  const safeWidth = Math.max(1, width);
  return ' '.repeat(safeWidth);
}

function colorizeLaneDivider(symbol: string): string {
  return colorizeText(symbol, LANE_DIVIDER_RGB);
}

export function colorizeLaneOuterBorder(symbol: string): string {
  return colorizeText(symbol, LANE_OUTER_BORDER_RGB);
}

function colorizeLaneCeiling(symbol: string): string {
  return colorizeText(symbol, LANE_CEILING_RGB);
}

function colorizeJudgeLine(symbol: string): string {
  return colorizeText(symbol, JUDGE_LINE_RGB);
}

function colorizeLaneLabel(symbol: string): string {
  return colorizeText(symbol, LANE_LABEL_RGB);
}

function colorizeNote(symbol: string, channel: string, invisible = false, underline = false): string {
  if (invisible) {
    return colorizeText(symbol, INVISIBLE_NOTE_RGB, undefined, underline);
  }
  if (RED_NOTE_CHANNELS.has(channel)) {
    return colorizeText(symbol, RED_NOTE_RGB, undefined, underline);
  }
  if (BLUE_NOTE_CHANNELS.has(channel)) {
    return colorizeText(symbol, BLUE_NOTE_RGB, undefined, underline);
  }
  if (WHITE_NOTE_CHANNELS.has(channel)) {
    return colorizeText(symbol, WHITE_NOTE_RGB, undefined, underline);
  }
  return symbol;
}

function colorizeMeasureLine(symbol: string): string {
  return colorizeText(symbol, MEASURE_LINE_RGB);
}

function colorizeMine(symbol: string): string {
  return colorizeText(symbol, MINE_FOREGROUND_RGB, MINE_BACKGROUND_RGB);
}

function colorizeLaneBackground(value: string, channel: string): string {
  const color = resolveLaneBackgroundColor(channel);
  return `\u001b[48;2;${color.r};${color.g};${color.b}m${value}${ANSI_RESET}`;
}

function resolveLaneBackgroundColor(channel: string): RgbColor {
  const normalized = channel.toUpperCase();
  if (SCRATCH_LANE_CHANNELS.has(normalized)) {
    return SCRATCH_LANE_BG_RGB;
  }
  if (WHITE_NOTE_CHANNELS.has(normalized)) {
    return WHITE_KEY_LANE_BG_RGB;
  }
  if (BLUE_NOTE_CHANNELS.has(normalized)) {
    return BLACK_KEY_LANE_BG_RGB;
  }
  return BLACK_RGB;
}

function resolveLaneHighlightBackgroundColor(channel: string, ratio: number): RgbColor {
  const base = resolveLaneBackgroundColor(channel);
  const strength = Math.pow(clamp(ratio, 0, 1), HIGHLIGHT_DECAY_POWER);
  return {
    r: mixColorByte(base.r, base.r + HIGHLIGHT_R_BOOST, strength),
    g: mixColorByte(base.g, base.g + HIGHLIGHT_G_BOOST, strength),
    b: mixColorByte(base.b, base.b + HIGHLIGHT_B_BOOST, strength),
  };
}

function mixColorByte(from: number, to: number, ratio: number): number {
  const safeRatio = clamp(ratio, 0, 1);
  const safeTo = clamp(Math.round(to), 0, 255);
  const mixed = from + (safeTo - from) * safeRatio;
  return clamp(Math.round(mixed), 0, 255);
}

function colorizeInputKeyLabel(value: string, style: 'white' | 'black' | 'scratch'): string {
  if (style === 'white') {
    return colorizeText(value, INPUT_KEY_LIGHT_FOREGROUND_RGB, INPUT_KEY_LIGHT_BACKGROUND_RGB);
  }
  if (style === 'black') {
    return colorizeText(value, INPUT_KEY_DARK_FOREGROUND_RGB, INPUT_KEY_DARK_BACKGROUND_RGB);
  }
  return colorizeText(value, INPUT_KEY_LIGHT_FOREGROUND_RGB, INPUT_KEY_SCRATCH_BACKGROUND_RGB);
}

function colorizeActiveInputKeyLabel(value: string): string {
  return colorizeText(value, INPUT_KEY_LIGHT_FOREGROUND_RGB, INPUT_KEY_ACTIVE_BACKGROUND_RGB);
}

function resolveInputKeyLaneGroup(lane: TuiLane): 'white' | 'black' {
  const normalized = lane.channel.toUpperCase();
  if (BLUE_NOTE_CHANNELS.has(normalized)) {
    return 'black';
  }
  return 'white';
}

function resolveInputKeyLaneStyle(lane: TuiLane): 'white' | 'black' | 'scratch' {
  if (lane.isScratch) {
    return 'scratch';
  }
  return resolveInputKeyLaneGroup(lane) === 'black' ? 'black' : 'white';
}

function resolveLaneNumberForInputRows(channel: string): number {
  const normalized = channel.toUpperCase();
  if (normalized.length !== 2) {
    return -1;
  }
  const code = normalized.charCodeAt(1);
  if (code < 0x31 || code > 0x39) {
    return -1;
  }
  return code - 0x30;
}

export function hasLaneSplit(splitAfterIndex: number | undefined, laneCount: number): boolean {
  const safeSplit = Number.isInteger(splitAfterIndex) ? (splitAfterIndex as number) : -1;
  return safeSplit >= 0 && safeSplit < laneCount - 1;
}
