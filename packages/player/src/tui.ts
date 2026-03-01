import { clamp } from '@be-music/utils';
import type { PlayerSummary } from './index.ts';

interface TuiLane {
  channel: string;
  key: string;
}

interface TuiOptions {
  mode: 'AUTO' | 'MANUAL';
  title: string;
  artist?: string;
  player?: number;
  rank?: number;
  playLevel?: number;
  lanes: TuiLane[];
  speed: number;
  judgeWindowMs: number;
  bpmTimeline?: ReadonlyArray<BpmTimelinePoint>;
  measureTimeline?: ReadonlyArray<MeasureTimelinePoint>;
  measureBoundariesBeats?: number[];
  splitAfterIndex?: number;
}

interface TuiNote {
  channel: string;
  beat: number;
  endBeat?: number;
  visibleUntilBeat?: number;
  seconds: number;
  judged: boolean;
}

interface TuiFrame {
  currentBeat: number;
  currentSeconds: number;
  totalSeconds: number;
  summary: PlayerSummary;
  notes: TuiNote[];
  bgaAnsiLines?: string[];
  bgaSixel?: string;
}

interface MeasureTimelinePoint {
  measure: number;
  seconds: number;
}

interface BpmTimelinePoint {
  bpm: number;
  seconds: number;
}

const NOTE_WINDOW_BEATS = 4;
const FLASH_DURATION_MS = 120;
const DEFAULT_LANE_WIDTH = 3;
const DEFAULT_GRID_ROWS = 14;
const MIN_GRID_ROWS = 4;
const STATIC_TUI_LINES = 16;
const MEASURE_LINE_SYMBOL = '┄';
const LANE_BOTTOM_SYMBOL = '▔';
const HIGHLIGHT_BG_STEPS = [249, 248, 247, 246, 245, 244, 243, 242, 241, 240, 239];
const HIGHLIGHT_DECAY_POWER = 0.72;
const RED_NOTE_CHANNELS = new Set(['16', '26']);
const WHITE_NOTE_CHANNELS = new Set(['11', '13', '15', '19', '21', '23', '25', '29']);
const BLUE_NOTE_CHANNELS = new Set(['12', '14', '18', '22', '24', '28']);
const NOTE_HEAD_SYMBOL = '●';
const LONG_NOTE_BODY_SYMBOL = '■';
const LONG_NOTE_TAIL_SYMBOL = '◆';
const ANSI_RESET = '\u001b[0m';

export class PlayerTui {
  private readonly options: TuiOptions;

  private readonly laneIndex = new Map<string, number>();

  private readonly laneChannels: string[];

  private readonly laneFlashUntil = new Map<string, number>();

  private readonly laneHoldUntilBeat = new Map<string, number>();

  private readonly laneWidths: number[] = [];

  private readonly laneBlockVisibleWidth: number;

  private readonly supported: boolean;

  private readonly sixelEnabled: boolean;

  private active = false;

  private latestJudge = '-';

  private combo = 0;

  private previousFrameLineCount = 0;

  private lastSixel?: string;

  private lastSixelRow = -1;

  private lastSixelColumn = -1;

  private noteWindowSource?: TuiNote[];

  private noteWindowStartIndex = 0;

  private noteWindowEndIndex = 0;

  private noteWindowBeat = Number.NEGATIVE_INFINITY;

  constructor(options: TuiOptions) {
    this.options = options;
    this.laneChannels = options.lanes.map((lane) => lane.channel);
    this.supported = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    this.sixelEnabled = this.supported && detectSixelSupport();
    options.lanes.forEach((lane, index) => {
      this.laneIndex.set(lane.channel, index);
      this.laneWidths[index] =
        lane.channel === '16' || lane.channel === '26' ? DEFAULT_LANE_WIDTH * 2 : DEFAULT_LANE_WIDTH;
    });
    this.laneBlockVisibleWidth = calculateLaneBlockVisibleWidth(this.laneWidths, options.splitAfterIndex ?? -1);
  }

  isSupported(): boolean {
    return this.supported;
  }

  isSixelEnabled(): boolean {
    return this.sixelEnabled;
  }

  start(): void {
    if (!this.supported || this.active) {
      return;
    }
    this.active = true;
    process.stdout.write('\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l');
  }

  stop(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.latestJudge = '-';
    this.combo = 0;
    this.laneHoldUntilBeat.clear();
    this.previousFrameLineCount = 0;
    this.lastSixel = undefined;
    this.lastSixelRow = -1;
    this.lastSixelColumn = -1;
    this.noteWindowSource = undefined;
    this.noteWindowStartIndex = 0;
    this.noteWindowEndIndex = 0;
    this.noteWindowBeat = Number.NEGATIVE_INFINITY;
    process.stdout.write('\u001b[0m\u001b[?25h\u001b[?1049l');
  }

  setLatestJudge(value: string): void {
    this.latestJudge = value;
  }

  setCombo(value: number): void {
    this.combo = Math.max(0, Math.floor(value));
  }

  flashLane(channel: string): void {
    this.laneFlashUntil.set(channel, Date.now() + FLASH_DURATION_MS);
  }

  holdLaneUntilBeat(channel: string, beat: number): void {
    if (!Number.isFinite(beat)) {
      return;
    }
    const previous = this.laneHoldUntilBeat.get(channel);
    if (previous !== undefined && previous >= beat) {
      return;
    }
    this.laneHoldUntilBeat.set(channel, beat);
  }

  render(frame: TuiFrame): void {
    if (!this.active) {
      return;
    }

    const terminalRows = process.stdout.rows ?? DEFAULT_GRID_ROWS + STATIC_TUI_LINES;
    const rowCount = Math.max(MIN_GRID_ROWS, terminalRows - STATIC_TUI_LINES);
    const laneCount = Math.max(1, this.options.lanes.length);
    const now = Date.now();
    const grid = Array.from({ length: rowCount }, () => Array.from({ length: laneCount }, () => '│'));
    const laneHighlightRatios = new Map<number, number>();

    for (const boundaryBeat of this.options.measureBoundariesBeats ?? []) {
      const delta = boundaryBeat - frame.currentBeat;
      if (delta < 0 || delta > NOTE_WINDOW_BEATS) {
        continue;
      }
      const row = rowCount - 1 - Math.floor((delta / NOTE_WINDOW_BEATS) * (rowCount - 1));
      for (let lane = 0; lane < laneCount; lane += 1) {
        if (grid[row][lane] === '│') {
          grid[row][lane] = MEASURE_LINE_SYMBOL;
        }
      }
    }

    const { start: noteStartIndex, end: noteEndIndex } = this.resolveNoteWindow(frame.notes, frame.currentBeat);

    for (let noteIndex = noteStartIndex; noteIndex < noteEndIndex; noteIndex += 1) {
      const note = frame.notes[noteIndex];
      const keepVisible =
        typeof note.visibleUntilBeat === 'number' &&
        Number.isFinite(note.visibleUntilBeat) &&
        note.visibleUntilBeat > frame.currentBeat;
      if (note.judged && !keepVisible) {
        continue;
      }
      const lane = this.laneIndex.get(note.channel);
      if (lane === undefined) {
        continue;
      }

      if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
        const bodyStartBeat = Math.max(note.beat, frame.currentBeat);
        const bodyEndBeat = Math.min(note.endBeat, frame.currentBeat + NOTE_WINDOW_BEATS);
        if (bodyEndBeat >= bodyStartBeat) {
          const startRow = beatToRow(bodyStartBeat, frame.currentBeat, rowCount);
          const endRow = beatToRow(bodyEndBeat, frame.currentBeat, rowCount);
          const from = Math.min(startRow, endRow);
          const to = Math.max(startRow, endRow);
          for (let row = from; row <= to; row += 1) {
            if (row < 0 || row >= rowCount) {
              continue;
            }
            grid[row][lane] = LONG_NOTE_BODY_SYMBOL;
          }
        }

        const tailDelta = note.endBeat - frame.currentBeat;
        if (tailDelta >= 0 && tailDelta <= NOTE_WINDOW_BEATS) {
          const tailRow = beatToRow(note.endBeat, frame.currentBeat, rowCount);
          if (tailRow >= 0 && tailRow < rowCount) {
            grid[tailRow][lane] = LONG_NOTE_TAIL_SYMBOL;
          }
        }
      }

      const delta = note.beat - frame.currentBeat;
      if (delta < 0 || delta > NOTE_WINDOW_BEATS) {
        continue;
      }
      const row = beatToRow(note.beat, frame.currentBeat, rowCount);
      grid[row][lane] = NOTE_HEAD_SYMBOL;
    }

    for (const [channel, until] of this.laneFlashUntil.entries()) {
      if (until <= now) {
        this.laneFlashUntil.delete(channel);
        continue;
      }
      const lane = this.laneIndex.get(channel);
      if (lane === undefined) {
        continue;
      }
      const ratio = clamp((until - now) / FLASH_DURATION_MS, 0, 1);
      laneHighlightRatios.set(lane, ratio);
    }

    for (const [channel, untilBeat] of this.laneHoldUntilBeat.entries()) {
      if (untilBeat <= frame.currentBeat) {
        this.laneHoldUntilBeat.delete(channel);
        continue;
      }
      const lane = this.laneIndex.get(channel);
      if (lane === undefined) {
        continue;
      }
      laneHighlightRatios.set(lane, 1);
    }

    const lines: string[] = [];
    lines.push(`BMS PLAYER TUI [${this.options.mode}]`);
    lines.push(`${this.options.title}${this.options.artist ? ` / ${this.options.artist}` : ''}`);
    lines.push(
      `${renderProgress(frame.currentSeconds, frame.totalSeconds)}  ${formatSeconds(frame.currentSeconds)} / ${formatSeconds(frame.totalSeconds)} sec`,
    );
    lines.push(
      `SPEED x${this.options.speed.toFixed(2)}  BAD ±${this.options.judgeWindowMs}ms  BPM ${formatBpm(findCurrentBpm(this.options.bpmTimeline, frame.currentSeconds))}`,
    );
    const currentMeasure = findCurrentMeasure(this.options.measureTimeline, frame.currentSeconds) + 1;
    const totalMeasures = findTotalMeasures(this.options.measureTimeline);
    lines.push(`MEASURE ${clamp(currentMeasure, 1, totalMeasures)}/${totalMeasures}`);
    lines.push(
      `PLAYER ${formatPlayerLabel(this.options.player)}  RANK ${formatRankLabel(this.options.rank)}  PLAYLEVEL ${formatPlayLevelLabel(this.options.playLevel)}`,
    );
    lines.push(`NOTES ${formatNotesProgress(frame.summary)}`);
    lines.push(
      `PERFECT ${frame.summary.perfect}  GREAT ${frame.summary.great}  GOOD ${frame.summary.good}  BAD ${frame.summary.bad}  MISS ${frame.summary.miss}`,
    );
    lines.push('');
    const laneLines: string[] = [];
    laneLines.push(
      renderLaneRow(
        this.options.lanes.map((lane) => lane.channel),
        this.laneChannels,
        this.laneWidths,
        this.options.splitAfterIndex,
      ),
    );
    laneLines.push(
      renderLaneRow(
        this.options.lanes.map(() => '═'),
        this.laneChannels,
        this.laneWidths,
        this.options.splitAfterIndex,
      ),
    );

    for (const row of grid) {
      laneLines.push(
        renderLaneRow(row, this.laneChannels, this.laneWidths, this.options.splitAfterIndex, laneHighlightRatios),
      );
    }

    laneLines.push(
      renderLaneRow(
        this.options.lanes.map(() => LANE_BOTTOM_SYMBOL),
        this.laneChannels,
        this.laneWidths,
        this.options.splitAfterIndex,
      ),
    );

    laneLines.push(
      centerVisible(formatJudgeComboDisplay(this.latestJudge, this.combo, now), this.laneBlockVisibleWidth),
    );

    laneLines.push(
      renderLaneRow(
        this.options.lanes.map((lane) => lane.key),
        this.laneChannels,
        this.laneWidths,
        this.options.splitAfterIndex,
      ),
    );

    const laneBlockStartRow = lines.length + 1;
    const laneBlockWidth = this.laneBlockVisibleWidth;
    const useSixel = this.sixelEnabled && typeof frame.bgaSixel === 'string';
    if (useSixel) {
      lines.push(...laneLines);
    } else {
      lines.push(...renderLaneBlockWithBga(laneLines, frame.bgaAnsiLines));
    }
    lines.push('');
    lines.push('Ctrl+C/Esc: quit');

    const columns = process.stdout.columns ?? 120;
    const paddedLines = lines.map((line) => padVisibleWidth(line, columns));
    if (this.previousFrameLineCount > paddedLines.length) {
      const diff = this.previousFrameLineCount - paddedLines.length;
      for (let index = 0; index < diff; index += 1) {
        paddedLines.push(' '.repeat(columns));
      }
    }
    process.stdout.write(`\u001b[H${paddedLines.join('\n')}`);
    this.previousFrameLineCount = lines.length;

    if (useSixel) {
      const bgaColumn = laneBlockWidth + 4;
      const sixelChanged =
        this.lastSixel !== frame.bgaSixel ||
        this.lastSixelRow !== laneBlockStartRow ||
        this.lastSixelColumn !== bgaColumn;
      if (sixelChanged) {
        process.stdout.write(`\u001b[s\u001b[${laneBlockStartRow};${bgaColumn}H${frame.bgaSixel}\u001b[u`);
        this.lastSixel = frame.bgaSixel;
        this.lastSixelRow = laneBlockStartRow;
        this.lastSixelColumn = bgaColumn;
      }
    } else {
      this.lastSixel = undefined;
      this.lastSixelRow = -1;
      this.lastSixelColumn = -1;
    }
  }

  private resolveNoteWindow(notes: TuiNote[], currentBeat: number): { start: number; end: number } {
    if (this.noteWindowSource !== notes || currentBeat < this.noteWindowBeat) {
      this.noteWindowSource = notes;
      this.noteWindowStartIndex = 0;
      this.noteWindowEndIndex = 0;
    }
    this.noteWindowBeat = currentBeat;

    let start = this.noteWindowStartIndex;
    while (start < notes.length && canDropNoteFromRenderWindow(notes[start], currentBeat)) {
      start += 1;
    }

    let end = Math.max(this.noteWindowEndIndex, start);
    const maxBeat = currentBeat + NOTE_WINDOW_BEATS;
    while (end < notes.length && notes[end].beat <= maxBeat) {
      end += 1;
    }

    this.noteWindowStartIndex = start;
    this.noteWindowEndIndex = end;
    return { start, end };
  }
}

function renderProgress(currentSeconds: number, totalSeconds: number): string {
  const barLength = 28;
  const safeTotal = Math.max(1, totalSeconds);
  const ratio = clamp(currentSeconds / safeTotal, 0, 1);
  const filled = Math.round(barLength * ratio);
  return `[${'#'.repeat(filled)}${'-'.repeat(barLength - filled)}] ${Math.round(ratio * 100)}%`;
}

function beatToRow(beat: number, currentBeat: number, rowCount: number): number {
  const delta = beat - currentBeat;
  const normalized = clamp(delta / NOTE_WINDOW_BEATS, 0, 1);
  return rowCount - 1 - Math.floor(normalized * (rowCount - 1));
}

function renderLaneRow(
  values: string[],
  channels: string[],
  laneWidths: number[],
  splitAfterIndex = -1,
  laneHighlightRatios = new Map<number, number>(),
): string {
  const cells = values.map((value, index) => {
    const laneWidth = laneWidths[index] ?? DEFAULT_LANE_WIDTH;
    const isHead = value === NOTE_HEAD_SYMBOL;
    const isBody = value === LONG_NOTE_BODY_SYMBOL;
    const isTail = value === LONG_NOTE_TAIL_SYMBOL;
    const isNote = isHead || isBody || isTail;
    const cell = isHead
      ? renderNoteCell(laneWidth, 'head')
      : isBody
        ? renderNoteCell(laneWidth, 'body')
        : isTail
          ? renderNoteCell(laneWidth, 'tail')
          : center(value, laneWidth);
    const decoratedCell = isNote
      ? colorizeNote(cell, channels[index] ?? '')
      : value === MEASURE_LINE_SYMBOL
        ? colorizeMeasureLine(cell)
        : cell;
    const highlightRatio = laneHighlightRatios.get(index);
    if (highlightRatio !== undefined) {
      return highlightCell(decoratedCell, highlightRatio);
    }
    return decoratedCell;
  });
  if (splitAfterIndex < 0 || splitAfterIndex >= cells.length - 1) {
    return cells.join(' ');
  }

  const left = cells.slice(0, splitAfterIndex + 1).join(' ');
  const right = cells.slice(splitAfterIndex + 1).join(' ');
  return `${left}   ${right}`;
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

function centerVisible(value: string, width: number): string {
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

function renderNoteCell(width: number, kind: 'head' | 'body' | 'tail'): string {
  const safeWidth = Math.max(1, width);
  if (kind === 'body') {
    return '▓'.repeat(safeWidth);
  }
  if (kind === 'tail') {
    return '▒'.repeat(safeWidth);
  }
  return '█'.repeat(safeWidth);
}

function highlightCell(value: string, ratio: number): string {
  const decayProgress = Math.pow(1 - clamp(ratio, 0, 1), HIGHLIGHT_DECAY_POWER);
  const index = Math.round(decayProgress * (HIGHLIGHT_BG_STEPS.length - 1));
  const background = HIGHLIGHT_BG_STEPS[index] ?? HIGHLIGHT_BG_STEPS[HIGHLIGHT_BG_STEPS.length - 1];
  return `\u001b[48;5;${background}m${value}\u001b[0m`;
}

function colorizeNote(symbol: string, channel: string): string {
  if (RED_NOTE_CHANNELS.has(channel)) {
    return `\u001b[31m${symbol}\u001b[0m`;
  }
  if (BLUE_NOTE_CHANNELS.has(channel)) {
    return `\u001b[34m${symbol}\u001b[0m`;
  }
  if (WHITE_NOTE_CHANNELS.has(channel)) {
    return `\u001b[97m${symbol}\u001b[0m`;
  }
  return symbol;
}

function colorizeMeasureLine(symbol: string): string {
  return `\u001b[90m${symbol}\u001b[0m`;
}

function formatJudgeComboDisplay(latestJudge: string, combo: number, nowMs: number): string {
  const normalizedJudge = latestJudge === 'PERFECT' ? 'GREAT' : latestJudge;
  const safeCombo = Math.max(0, Math.floor(combo));
  const baseText = `${normalizedJudge}${safeCombo > 0 ? ` ${safeCombo}` : ''}`;

  if (latestJudge === 'PERFECT') {
    // ANSI blink is not consistently supported, so emulate blink with a time-based pulse.
    const blinkOn = Math.floor(nowMs / 130) % 2 === 0;
    return blinkOn ? colorizeRainbow(baseText) : colorizeText(baseText, '2;38;5;245');
  }
  if (latestJudge === 'GREAT') {
    return colorizeText(baseText, '1;38;5;220');
  }
  if (latestJudge === 'GOOD') {
    return colorizeText(baseText, '1;38;5;118');
  }
  if (latestJudge === 'BAD') {
    return colorizeText(baseText, '1;38;5;208');
  }
  if (latestJudge === 'MISS') {
    return colorizeText(baseText, '1;38;5;203');
  }
  if (latestJudge === 'READY') {
    return colorizeText(baseText, '1;38;5;81');
  }
  if (latestJudge === '-') {
    return colorizeText(baseText, '2;37');
  }
  return baseText;
}

function colorizeText(value: string, sgr: string): string {
  return `\u001b[${sgr}m${value}${ANSI_RESET}`;
}

function colorizeRainbow(value: string): string {
  const steps = [196, 208, 226, 118, 51, 39, 201];
  const characters = [...value];
  return characters
    .map((character, index) => `\u001b[1;38;5;${steps[index % steps.length]}m${character}${ANSI_RESET}`)
    .join('');
}

function renderLaneBlockWithBga(laneLines: string[], bgaAnsiLines?: string[]): string[] {
  if (!bgaAnsiLines || bgaAnsiLines.length === 0) {
    return laneLines;
  }

  const bgaWidth = Math.max(1, ...bgaAnsiLines.map((line) => visibleWidth(line)));
  const normalizedBgaLines = fitLinesToHeight(bgaAnsiLines, laneLines.length, bgaWidth);
  return laneLines.map((laneLine, index) => `${laneLine}   ${normalizedBgaLines[index] ?? ' '.repeat(bgaWidth)}`);
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

function padVisibleWidth(line: string, width: number): string {
  const clipped = truncateVisibleWidth(line, width);
  const currentWidth = visibleWidth(clipped);
  if (currentWidth >= width) {
    return clipped;
  }
  return `${clipped}${' '.repeat(width - currentWidth)}`;
}

function visibleWidth(value: string): number {
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

    const sequenceEnd = findAnsiSgrSequenceEnd(value, index + 2);
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
  let sgrActive = false;

  while (index < value.length) {
    if (value.charCodeAt(index) === 0x1b && index + 1 < value.length && value[index + 1] === '[') {
      const sequenceEnd = findAnsiSgrSequenceEnd(value, index + 2);
      if (sequenceEnd < 0) {
        break;
      }
      const sequence = value.slice(index, sequenceEnd + 1);
      output += sequence;
      sgrActive = updateSgrActive(sgrActive, sequence);
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

  if (sgrActive) {
    output += ANSI_RESET;
  }
  return output;
}

function updateSgrActive(current: boolean, sequence: string): boolean {
  if (!sequence.endsWith('m')) {
    return current;
  }
  const body = sequence.slice(2, -1);
  if (body.length === 0) {
    return false;
  }
  const params = body.split(';').map((part) => Number.parseInt(part, 10));
  if (params.some((value) => !Number.isNaN(value) && value === 0)) {
    return false;
  }
  return true;
}

function getCharacterDisplayWidth(codePoint: number): number {
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

function canDropNoteFromRenderWindow(note: TuiNote, currentBeat: number): boolean {
  const keepVisible =
    typeof note.visibleUntilBeat === 'number' &&
    Number.isFinite(note.visibleUntilBeat) &&
    note.visibleUntilBeat > currentBeat;
  if (keepVisible) {
    return false;
  }

  if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > currentBeat) {
    return false;
  }

  return note.beat < currentBeat - NOTE_WINDOW_BEATS;
}

function calculateLaneBlockVisibleWidth(laneWidths: number[], splitAfterIndex: number): number {
  const laneCount = Math.max(1, laneWidths.length);
  let width = 0;
  for (let index = 0; index < laneCount; index += 1) {
    width += laneWidths[index] ?? DEFAULT_LANE_WIDTH;
  }
  width += Math.max(0, laneCount - 1);
  if (splitAfterIndex >= 0 && splitAfterIndex < laneCount - 1) {
    width += 2;
  }
  return Math.max(1, width);
}

function findAnsiSgrSequenceEnd(value: string, start: number): number {
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

function detectSixelSupport(): boolean {
  const forced = process.env.BMS_PLAYER_SIXEL?.toLowerCase();
  if (forced === '1' || forced === 'true' || forced === 'yes') {
    return true;
  }
  if (forced === '0' || forced === 'false' || forced === 'no') {
    return false;
  }

  const term = (process.env.TERM ?? '').toLowerCase();
  if (term.includes('sixel') || term.includes('mlterm')) {
    return true;
  }

  if (process.env.WEZTERM_EXECUTABLE || process.env.WEZTERM_PANE) {
    return true;
  }

  return false;
}

function formatPlayerLabel(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  const normalized = Math.floor(value);
  if (normalized === 1) {
    return 'SINGLE';
  }
  if (normalized === 2) {
    return 'COUPLE';
  }
  if (normalized === 3) {
    return 'DOUBLE';
  }
  if (normalized === 4) {
    return 'BATTLE';
  }
  return String(normalized);
}

function formatRankLabel(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  const normalized = Math.floor(value);
  if (normalized === 0) {
    return 'VERY HARD';
  }
  if (normalized === 1) {
    return 'HARD';
  }
  if (normalized === 2) {
    return 'NORMAL';
  }
  if (normalized === 3) {
    return 'EASY';
  }
  if (normalized === 4) {
    return 'VERY EASY';
  }
  return String(normalized);
}

function formatPlayLevelLabel(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return '-';
  }
  return '*'.repeat(Math.min(32, normalized));
}

function formatNotesProgress(summary: PlayerSummary): string {
  const total = Math.max(0, summary.total);
  const judged = Math.max(0, summary.perfect + summary.great + summary.good + summary.bad + summary.miss);
  return `${Math.min(total, judged)}/${total}`;
}

function formatSeconds(seconds: number): string {
  return Math.max(0, seconds).toFixed(2);
}

function findCurrentMeasure(timeline: ReadonlyArray<MeasureTimelinePoint> | undefined, currentSeconds: number): number {
  if (!timeline || timeline.length === 0) {
    return 0;
  }

  let low = 0;
  let high = timeline.length - 1;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = timeline[mid];
    if (point.seconds <= currentSeconds) {
      best = point.measure;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return Math.max(0, best);
}

function findTotalMeasures(timeline: ReadonlyArray<MeasureTimelinePoint> | undefined): number {
  if (!timeline || timeline.length === 0) {
    return 1;
  }
  const last = timeline[timeline.length - 1];
  return Math.max(1, Math.floor(last.measure));
}

function findCurrentBpm(timeline: ReadonlyArray<BpmTimelinePoint> | undefined, currentSeconds: number): number {
  if (!timeline || timeline.length === 0) {
    return 0;
  }

  let low = 0;
  let high = timeline.length - 1;
  let best = timeline[0].bpm;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = timeline[mid];
    if (point.seconds <= currentSeconds) {
      best = point.bpm;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return Math.max(0, best);
}

function formatBpm(bpm: number): string {
  const safe = Number.isFinite(bpm) ? Math.max(0, bpm) : 0;
  return safe % 1 === 0 ? `${safe.toFixed(0)}` : safe.toFixed(2);
}
