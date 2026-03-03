import { clamp } from '@be-music/utils';
import type { PlayerSummary } from '../index.ts';
import { formatSeconds } from '../player-utils.ts';
import {
  normalizeHighSpeed,
  resolveAnimatedHighSpeedValue,
  resolveVisibleBeatsForTuiGrid,
} from './high-speed.ts';
export { resolveAnimatedHighSpeedValue, resolveVisibleBeatsForTuiGrid } from './high-speed.ts';

interface TuiLane {
  channel: string;
  key: string;
  isScratch?: boolean;
}

interface TuiOptions {
  mode: 'AUTO' | 'MANUAL' | 'AUTO SCRATCH';
  laneDisplayMode: string;
  title: string;
  artist?: string;
  player?: number;
  rank?: number;
  playLevel?: number;
  lanes: TuiLane[];
  speed: number;
  highSpeed: number;
  judgeWindowMs: number;
  bpmTimeline?: ReadonlyArray<BpmTimelinePoint>;
  scrollTimeline?: ReadonlyArray<ScrollTimelinePoint>;
  stopWindows?: ReadonlyArray<StopWindowPoint>;
  measureTimeline?: ReadonlyArray<MeasureTimelinePoint>;
  measureLengths?: ReadonlyMap<number, number>;
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
  mine?: boolean;
  invisible?: boolean;
}

interface TuiFrame {
  currentBeat: number;
  currentSeconds: number;
  totalSeconds: number;
  summary: PlayerSummary;
  notes: TuiNote[];
  audioBackend?: string;
  activeAudioFiles?: string[];
  activeAudioVoiceCount?: number;
  bgaAnsiLines?: string[];
}

interface MeasureTimelinePoint {
  measure: number;
  seconds: number;
}

interface BpmTimelinePoint {
  bpm: number;
  seconds: number;
}

interface ScrollTimelinePoint {
  beat: number;
  speed: number;
}

interface StopWindowPoint {
  startSeconds: number;
  endSeconds: number;
}

interface ScrollSegment {
  startBeat: number;
  speed: number;
  startDistance: number;
}

const IIDX_MEASURE_BEATS = 4;
const MAX_SCROLL_LOOKAHEAD_BEATS = IIDX_MEASURE_BEATS * 64;
const MAX_NOTES_PER_RENDER_WINDOW = 2048;
const BEAT_EPSILON = 1e-9;
const FLASH_DURATION_MS = 120;
const DEFAULT_LANE_WIDTH = 3;
const DEFAULT_GRID_ROWS = 14;
const MIN_GRID_ROWS = 4;
const STATIC_TUI_LINES = 16;
const MEASURE_LINE_SYMBOL = '┄';
const LANE_FILL_SYMBOL = '│';
const LANE_DIVIDER_SYMBOL = '│';
const LANE_OUTER_BORDER_SYMBOL = '┃';
const SPLIT_PANEL_INNER_WIDTH = 5;
const JUDGE_LINE_SYMBOL = '█';
const HIGHLIGHT_BG_STEPS = [249, 248, 247, 246, 245, 244, 243, 242, 241, 240, 239];
const HIGHLIGHT_DECAY_POWER = 0.72;
const RED_NOTE_CHANNELS = new Set(['16', '26']);
const WHITE_NOTE_CHANNELS = new Set(['11', '13', '15', '19', '21', '23', '25', '29']);
const BLUE_NOTE_CHANNELS = new Set(['12', '14', '17', '18', '22', '24', '27', '28']);
const NOTE_HEAD_SYMBOL = '●';
const LONG_NOTE_BODY_SYMBOL = '■';
const LONG_NOTE_TAIL_SYMBOL = '◆';
const MINE_NOTE_SYMBOL = '✕';
const INVISIBLE_NOTE_HEAD_SYMBOL = '◯';
const INVISIBLE_LONG_NOTE_BODY_SYMBOL = '□';
const INVISIBLE_LONG_NOTE_TAIL_SYMBOL = '◇';
const ANSI_RESET = '\u001b[0m';
const SCORE_COUNTUP_MIN_PER_SEC = 4000;
const SCORE_COUNTUP_DISTANCE_FACTOR = 6;
const HIGH_SPEED_TRANSITION_MS = 180;
const MEASURE_SIGNATURE_MAX_DENOMINATOR = 32;
const MEASURE_SIGNATURE_TOLERANCE = 1e-8;

export class PlayerTui {
  private readonly options: TuiOptions;

  private readonly laneIndex = new Map<string, number>();

  private readonly laneChannels: string[];

  private readonly freeZoneChannelToScratchChannel = new Map<string, string>();

  private readonly freeZoneSourceChannels = new Set<string>();

  private readonly laneFlashUntil = new Map<string, number>();

  private readonly laneHoldUntilBeat = new Map<string, number>();

  private readonly laneWidths: number[] = [];

  private readonly laneBlockVisibleWidth: number;

  private readonly scrollDistanceMapper: ScrollDistanceMapper;

  private readonly supported: boolean;

  private active = false;

  private latestJudge = '-';

  private combo = 0;

  private paused = false;

  private displayedScore = 0;

  private lastScoreAnimationMs = 0;

  private previousFrameLineCount = 0;

  private noteWindowSource?: TuiNote[];

  private noteWindowStartIndex = 0;

  private noteWindowEndIndex = 0;

  private noteWindowBeat = Number.NEGATIVE_INFINITY;

  private visibleNoteIndices = new Set<number>();

  private displayedHighSpeed: number;

  private targetHighSpeed: number;

  private highSpeedTransitionFrom: number;

  private highSpeedTransitionStartMs = 0;

  constructor(options: TuiOptions) {
    const initialHighSpeed = normalizeHighSpeed(options.highSpeed);
    options.highSpeed = initialHighSpeed;
    this.options = options;
    this.displayedHighSpeed = initialHighSpeed;
    this.targetHighSpeed = initialHighSpeed;
    this.highSpeedTransitionFrom = initialHighSpeed;
    this.laneChannels = options.lanes.map((lane) => lane.channel);
    this.scrollDistanceMapper = new ScrollDistanceMapper(options.scrollTimeline);
    this.supported = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    options.lanes.forEach((lane, index) => {
      this.laneIndex.set(lane.channel, index);
      this.laneWidths[index] = lane.isScratch ? DEFAULT_LANE_WIDTH * 2 : DEFAULT_LANE_WIDTH;
    });
    if (!this.laneIndex.has('17') && this.laneIndex.has('16')) {
      this.freeZoneChannelToScratchChannel.set('17', '16');
      this.freeZoneSourceChannels.add('17');
    }
    if (!this.laneIndex.has('27') && this.laneIndex.has('26')) {
      this.freeZoneChannelToScratchChannel.set('27', '26');
      this.freeZoneSourceChannels.add('27');
    }
    this.laneBlockVisibleWidth = calculateLaneBlockVisibleWidth(this.laneWidths, options.splitAfterIndex ?? -1);
  }

  isSupported(): boolean {
    return this.supported;
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
    this.paused = false;
    this.displayedScore = 0;
    this.lastScoreAnimationMs = 0;
    this.laneHoldUntilBeat.clear();
    this.previousFrameLineCount = 0;
    this.noteWindowSource = undefined;
    this.noteWindowStartIndex = 0;
    this.noteWindowEndIndex = 0;
    this.noteWindowBeat = Number.NEGATIVE_INFINITY;
    this.visibleNoteIndices.clear();
    this.displayedHighSpeed = normalizeHighSpeed(this.options.highSpeed);
    this.targetHighSpeed = this.displayedHighSpeed;
    this.highSpeedTransitionFrom = this.displayedHighSpeed;
    this.highSpeedTransitionStartMs = 0;
    process.stdout.write('\u001b[0m\u001b[?25h\u001b[?1049l');
  }

  setLatestJudge(value: string): void {
    this.latestJudge = value;
  }

  setCombo(value: number): void {
    this.combo = Math.max(0, Math.floor(value));
  }

  setPaused(value: boolean): void {
    this.paused = value;
  }

  setHighSpeed(value: number): void {
    const next = normalizeHighSpeed(value);
    if (Math.abs(next - this.targetHighSpeed) < 1e-9) {
      return;
    }
    const nowMs = Date.now();
    const current = this.resolveDisplayHighSpeed(nowMs);
    this.options.highSpeed = next;
    this.highSpeedTransitionFrom = current;
    this.displayedHighSpeed = current;
    this.targetHighSpeed = next;
    this.highSpeedTransitionStartMs = nowMs;
  }

  flashLane(channel: string): void {
    this.laneFlashUntil.set(this.resolveRenderLaneChannel(channel), Date.now() + FLASH_DURATION_MS);
  }

  holdLaneUntilBeat(channel: string, beat: number): void {
    if (!Number.isFinite(beat)) {
      return;
    }
    const targetChannel = this.resolveRenderLaneChannel(channel);
    const previous = this.laneHoldUntilBeat.get(targetChannel);
    if (previous !== undefined && previous >= beat) {
      return;
    }
    this.laneHoldUntilBeat.set(targetChannel, beat);
  }

  render(frame: TuiFrame): void {
    if (!this.active) {
      return;
    }

    const terminalRows = process.stdout.rows ?? DEFAULT_GRID_ROWS + STATIC_TUI_LINES;
    const debugLineCount = frame.activeAudioFiles === undefined && frame.activeAudioVoiceCount === undefined ? 0 : 1;
    const rowCount = Math.max(MIN_GRID_ROWS, terminalRows - STATIC_TUI_LINES - debugLineCount);
    const laneCount = Math.max(1, this.options.lanes.length);
    const now = Date.now();
    const displayHighSpeed = this.resolveDisplayHighSpeed(now);
    const scrollWindowBeats = resolveVisibleBeatsForTuiGrid(rowCount, displayHighSpeed);
    const grid = Array.from({ length: rowCount }, () => Array.from({ length: laneCount }, () => LANE_FILL_SYMBOL));
    const gridSourceChannels = Array.from({ length: rowCount }, () => Array.from({ length: laneCount }, () => ''));
    const measureLineRows = new Set<number>();
    const laneHighlightRatios = new Map<number, number>();

    for (const boundaryBeat of this.options.measureBoundariesBeats ?? []) {
      if (!isUpcomingBeat(frame.currentBeat, boundaryBeat)) {
        continue;
      }
      const distance = this.scrollDistanceMapper.distanceBetween(frame.currentBeat, boundaryBeat);
      if (!isDistanceWithinWindow(distance, scrollWindowBeats)) {
        continue;
      }
      const row = distanceToRow(distance, rowCount, scrollWindowBeats);
      measureLineRows.add(row);
      for (let lane = 0; lane < laneCount; lane += 1) {
        if (grid[row][lane] === LANE_FILL_SYMBOL) {
          grid[row][lane] = MEASURE_LINE_SYMBOL;
        }
      }
    }

    const { start: noteStartIndex, end: noteEndIndex } = this.resolveNoteWindow(
      frame.notes,
      frame.currentBeat,
      scrollWindowBeats,
    );
    const visibleNoteIndices = new Set<number>();

    for (let noteIndex = noteStartIndex; noteIndex < noteEndIndex; noteIndex += 1) {
      const note = frame.notes[noteIndex];
      const wasVisible = this.visibleNoteIndices.has(noteIndex);
      let visibleThisFrame = false;
      const keepVisible =
        typeof note.visibleUntilBeat === 'number' &&
        Number.isFinite(note.visibleUntilBeat) &&
        note.visibleUntilBeat > frame.currentBeat;
      if (note.judged && !keepVisible) {
        continue;
      }
      const lane = this.laneIndex.get(this.resolveRenderLaneChannel(note.channel));
      if (lane === undefined) {
        continue;
      }

      if (note.mine === true) {
        const distance = this.scrollDistanceMapper.distanceBetween(frame.currentBeat, note.beat);
        const visibleDistance = normalizeNoteApproachDistance(distance, frame.currentBeat, note.beat);
        if (!isDistanceWithinWindow(visibleDistance, scrollWindowBeats)) {
          continue;
        }
        const row = wasVisible ? distanceToNoteRow(visibleDistance, rowCount, scrollWindowBeats) : 0;
        setLaneCell(grid, gridSourceChannels, row, lane, MINE_NOTE_SYMBOL, note.channel, this.freeZoneSourceChannels);
        visibleNoteIndices.add(noteIndex);
        continue;
      }

      if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
        const longBodySymbol = note.invisible ? INVISIBLE_LONG_NOTE_BODY_SYMBOL : LONG_NOTE_BODY_SYMBOL;
        const longTailSymbol = note.invisible ? INVISIBLE_LONG_NOTE_TAIL_SYMBOL : LONG_NOTE_TAIL_SYMBOL;
        const bodyStartBeat = Math.max(note.beat, frame.currentBeat);
        const bodyEndBeat = note.endBeat;
        const bodyStartDistance = this.scrollDistanceMapper.distanceBetween(frame.currentBeat, bodyStartBeat);
        const bodyEndDistance = this.scrollDistanceMapper.distanceBetween(frame.currentBeat, bodyEndBeat);
        const bodyVisibleFrom = clamp(
          normalizeNoteApproachDistance(bodyStartDistance, frame.currentBeat, bodyStartBeat),
          0,
          scrollWindowBeats,
        );
        const bodyVisibleTo = clamp(
          normalizeNoteApproachDistance(bodyEndDistance, frame.currentBeat, bodyEndBeat),
          0,
          scrollWindowBeats,
        );
        if (bodyVisibleTo >= bodyVisibleFrom) {
          const startRow = distanceToNoteRow(bodyVisibleFrom, rowCount, scrollWindowBeats);
          const endRow = distanceToNoteRow(bodyVisibleTo, rowCount, scrollWindowBeats);
          const from = wasVisible ? Math.min(startRow, endRow) : 0;
          const to = Math.max(startRow, endRow);
          for (let row = from; row <= to; row += 1) {
            if (row < 0 || row >= rowCount) {
              continue;
            }
            setLaneCell(
              grid,
              gridSourceChannels,
              row,
              lane,
              longBodySymbol,
              note.channel,
              this.freeZoneSourceChannels,
            );
          }
          visibleThisFrame = true;
        }

        const tailDistance = this.scrollDistanceMapper.distanceBetween(frame.currentBeat, note.endBeat);
        const tailVisibleDistance = normalizeNoteApproachDistance(tailDistance, frame.currentBeat, note.endBeat);
        if (isDistanceWithinWindow(tailVisibleDistance, scrollWindowBeats)) {
          const tailRow = wasVisible ? distanceToNoteRow(tailVisibleDistance, rowCount, scrollWindowBeats) : 0;
          if (tailRow >= 0 && tailRow < rowCount) {
            setLaneCell(
              grid,
              gridSourceChannels,
              tailRow,
              lane,
              longTailSymbol,
              note.channel,
              this.freeZoneSourceChannels,
            );
            visibleThisFrame = true;
          }
        }
      }

      const headDistance = this.scrollDistanceMapper.distanceBetween(frame.currentBeat, note.beat);
      const headVisibleDistance = normalizeNoteApproachDistance(headDistance, frame.currentBeat, note.beat);
      if (!isDistanceWithinWindow(headVisibleDistance, scrollWindowBeats)) {
        if (visibleThisFrame) {
          visibleNoteIndices.add(noteIndex);
        }
        continue;
      }
      const row = wasVisible ? distanceToNoteRow(headVisibleDistance, rowCount, scrollWindowBeats) : 0;
      setLaneCell(
        grid,
        gridSourceChannels,
        row,
        lane,
        note.invisible ? INVISIBLE_NOTE_HEAD_SYMBOL : NOTE_HEAD_SYMBOL,
        note.channel,
        this.freeZoneSourceChannels,
      );
      visibleThisFrame = true;
      visibleNoteIndices.add(noteIndex);
    }
    this.visibleNoteIndices = visibleNoteIndices;

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
      `${renderProgress(frame.currentSeconds, frame.totalSeconds)}  ${formatSeconds(frame.currentSeconds)} / ${formatSeconds(frame.totalSeconds)}`,
    );
    const currentBpm = findCurrentBpm(this.options.bpmTimeline, frame.currentSeconds);
    const currentScroll = findCurrentScroll(this.options.scrollTimeline, frame.currentBeat);
    const remainingStopSeconds = findRemainingStopSeconds(this.options.stopWindows, frame.currentSeconds);
    const stopLabel = remainingStopSeconds > 0 ? `${formatStopSeconds(remainingStopSeconds)}s` : '-';
    const audioBackendLabel = formatAudioBackendLabel(frame.audioBackend);
    lines.push(
      `SPEED x${this.options.speed.toFixed(2)}  HS x${formatHighSpeed(displayHighSpeed)}  BAD ±${formatJudgeWindowMs(this.options.judgeWindowMs)}ms  BPM ${formatBpm(currentBpm)}  SCROLL ${formatScroll(currentScroll)}  STOP ${stopLabel}  AUDIO ${audioBackendLabel}`,
    );
    const currentMeasure = findCurrentMeasure(this.options.measureTimeline, frame.currentSeconds) + 1;
    const totalMeasures = findTotalMeasures(this.options.measureTimeline);
    const displayMeasure = clamp(currentMeasure, 1, totalMeasures);
    const measureLength = resolveMeasureLength(this.options.measureLengths, displayMeasure - 1);
    const measureSignature = formatMeasureSignature(measureLength);
    lines.push(`MEASURE ${displayMeasure}/${totalMeasures}  METER ${measureSignature}`);
    lines.push(
      `LANE ${this.options.laneDisplayMode}  PLAYER ${formatPlayerLabel(this.options.player)}  RANK ${formatRankLabel(this.options.rank)}  PLAYLEVEL ${formatPlayLevelLabel(this.options.playLevel)}`,
    );
    const animatedScore = this.resolveAnimatedScore(frame.summary.score, now);
    const maxExScore = Math.max(0, frame.summary.total * 2);
    lines.push(
      `NOTES ${formatNotesProgress(frame.summary)}  EX ${frame.summary.exScore}/${maxExScore}  SCORE ${animatedScore}/200000`,
    );
    lines.push(
      `PERFECT ${frame.summary.perfect}  FAST ${frame.summary.fast}  SLOW ${frame.summary.slow}  GREAT ${frame.summary.great}  GOOD ${frame.summary.good}  BAD ${frame.summary.bad}  POOR ${frame.summary.poor}`,
    );
    if (frame.activeAudioFiles !== undefined || frame.activeAudioVoiceCount !== undefined) {
      const voiceCount =
        typeof frame.activeAudioVoiceCount === 'number' && Number.isFinite(frame.activeAudioVoiceCount)
          ? Math.max(0, Math.floor(frame.activeAudioVoiceCount))
          : (frame.activeAudioFiles?.length ?? 0);
      lines.push(`AUDIO VOICES ${voiceCount}  FILES ${formatActiveAudioFiles(frame.activeAudioFiles ?? [])}`);
    }
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

    const judgeRowIndex = Math.max(0, grid.length - 1);
    for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
      const row = grid[rowIndex]!;
      if (rowIndex === judgeRowIndex) {
        laneLines.push(
          renderJudgeRow(
            row,
            this.laneChannels,
            this.laneWidths,
            this.options.splitAfterIndex,
            laneHighlightRatios,
            gridSourceChannels[rowIndex],
          ),
        );
        continue;
      }
      if (measureLineRows.has(rowIndex)) {
        laneLines.push(
          renderMeasureRow(
            row,
            this.laneChannels,
            this.laneWidths,
            this.options.splitAfterIndex,
            laneHighlightRatios,
            gridSourceChannels[rowIndex],
          ),
        );
        continue;
      }
      laneLines.push(
        renderLaneRow(
          row,
          this.laneChannels,
          this.laneWidths,
          this.options.splitAfterIndex,
          laneHighlightRatios,
          gridSourceChannels[rowIndex],
        ),
      );
    }

    laneLines.push(
      centerVisible(
        formatJudgeComboDisplay(this.latestJudge, this.combo, now, this.paused),
        this.laneBlockVisibleWidth,
      ),
    );

    laneLines.push(
      renderLaneRow(
        this.options.lanes.map((lane) => lane.key),
        this.laneChannels,
        this.laneWidths,
        this.options.splitAfterIndex,
      ),
    );

    lines.push(...renderLaneBlockWithBga(laneLines, frame.bgaAnsiLines));
    lines.push('');
    lines.push('Space: pause/resume  W/E: HS +/-  Ctrl+C/Esc: quit');

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
  }

  private resolveNoteWindow(notes: TuiNote[], currentBeat: number, scrollWindowBeats: number): { start: number; end: number } {
    if (this.noteWindowSource !== notes || currentBeat < this.noteWindowBeat) {
      this.noteWindowSource = notes;
      this.noteWindowStartIndex = 0;
      this.noteWindowEndIndex = 0;
    }
    this.noteWindowBeat = currentBeat;

    let start = this.noteWindowStartIndex;
    while (start < notes.length && canDropNoteFromRenderWindow(notes[start], currentBeat, scrollWindowBeats)) {
      start += 1;
    }

    let end = Math.max(this.noteWindowEndIndex, start);
    const maxBeat = this.scrollDistanceMapper.maxBeatWithinDistance(currentBeat, scrollWindowBeats);
    if (!Number.isFinite(maxBeat)) {
      end = notes.length;
    } else {
      while (end < notes.length && notes[end].beat <= maxBeat && end - start < MAX_NOTES_PER_RENDER_WINDOW) {
        end += 1;
      }
    }

    this.noteWindowStartIndex = start;
    this.noteWindowEndIndex = end;
    return { start, end };
  }

  private resolveAnimatedScore(targetScore: number, nowMs: number): number {
    const safeTarget = Math.max(0, Math.floor(targetScore));
    if (this.lastScoreAnimationMs <= 0) {
      this.lastScoreAnimationMs = nowMs;
    }

    if (this.displayedScore > safeTarget) {
      this.displayedScore = safeTarget;
      this.lastScoreAnimationMs = nowMs;
      return this.displayedScore;
    }

    if (this.displayedScore === safeTarget) {
      this.lastScoreAnimationMs = nowMs;
      return this.displayedScore;
    }

    const elapsedMs = Math.max(0, nowMs - this.lastScoreAnimationMs);
    this.lastScoreAnimationMs = nowMs;
    const remaining = safeTarget - this.displayedScore;
    const countupPerSec = Math.max(SCORE_COUNTUP_MIN_PER_SEC, remaining * SCORE_COUNTUP_DISTANCE_FACTOR);
    const step = Math.max(1, Math.floor((countupPerSec * elapsedMs) / 1000));
    this.displayedScore = Math.min(safeTarget, this.displayedScore + step);
    return this.displayedScore;
  }

  private resolveDisplayHighSpeed(nowMs: number): number {
    if (Math.abs(this.displayedHighSpeed - this.targetHighSpeed) < 1e-9) {
      return this.targetHighSpeed;
    }
    if (this.highSpeedTransitionStartMs <= 0) {
      this.displayedHighSpeed = this.targetHighSpeed;
      return this.displayedHighSpeed;
    }
    const elapsedMs = Math.max(0, nowMs - this.highSpeedTransitionStartMs);
    const next = resolveAnimatedHighSpeedValue(
      this.highSpeedTransitionFrom,
      this.targetHighSpeed,
      elapsedMs,
      HIGH_SPEED_TRANSITION_MS,
    );
    this.displayedHighSpeed = next;
    if (elapsedMs >= HIGH_SPEED_TRANSITION_MS || Math.abs(next - this.targetHighSpeed) <= 1e-3) {
      this.displayedHighSpeed = this.targetHighSpeed;
      this.highSpeedTransitionStartMs = 0;
    }
    return this.displayedHighSpeed;
  }

  private resolveRenderLaneChannel(channel: string): string {
    const normalized = channel.toUpperCase();
    return this.freeZoneChannelToScratchChannel.get(normalized) ?? normalized;
  }
}

class ScrollDistanceMapper {
  private readonly segments: ScrollSegment[];

  constructor(timeline?: ReadonlyArray<ScrollTimelinePoint>) {
    this.segments = buildScrollSegments(timeline);
  }

  distanceBetween(fromBeat: number, toBeat: number): number {
    if (!Number.isFinite(fromBeat) || !Number.isFinite(toBeat)) {
      return Number.NaN;
    }
    return this.distanceAt(toBeat) - this.distanceAt(fromBeat);
  }

  maxBeatWithinDistance(fromBeat: number, distance: number): number {
    const safeFromBeat = Number.isFinite(fromBeat) ? Math.max(0, fromBeat) : 0;
    const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
    if (safeDistance <= 0) {
      return safeFromBeat;
    }

    const capBeat = safeFromBeat + MAX_SCROLL_LOOKAHEAD_BEATS;
    let beat = safeFromBeat;
    let remainingDistance = safeDistance;
    let index = findLastSegmentIndexByBeat(this.segments, beat);

    while (index < this.segments.length && beat < capBeat && remainingDistance > 1e-9) {
      const segment = this.segments[index]!;
      const nextStartBeat = this.segments[index + 1]?.startBeat ?? Number.POSITIVE_INFINITY;
      const segmentEndBeat = Math.min(capBeat, nextStartBeat);
      const span = Math.max(0, segmentEndBeat - beat);
      if (span <= 0) {
        index += 1;
        continue;
      }

      const speed = Math.abs(segment.speed);
      if (speed <= 1e-9) {
        beat = segmentEndBeat;
        index += 1;
        continue;
      }

      const traversableDistance = span * speed;
      if (traversableDistance >= remainingDistance) {
        return Math.min(capBeat, beat + remainingDistance / speed);
      }

      remainingDistance -= traversableDistance;
      beat = segmentEndBeat;
      index += 1;
    }

    return capBeat;
  }

  private distanceAt(beat: number): number {
    const safeBeat = Number.isFinite(beat) ? Math.max(0, beat) : 0;
    const segment = this.segments[findLastSegmentIndexByBeat(this.segments, safeBeat)]!;
    return segment.startDistance + (safeBeat - segment.startBeat) * segment.speed;
  }
}

function buildScrollSegments(timeline?: ReadonlyArray<ScrollTimelinePoint>): ScrollSegment[] {
  const points: ScrollTimelinePoint[] = [{ beat: 0, speed: 1 }];
  for (const point of timeline ?? []) {
    if (!Number.isFinite(point.beat) || !Number.isFinite(point.speed) || point.beat < 0) {
      continue;
    }
    points.push({
      beat: point.beat,
      speed: point.speed,
    });
  }
  points.sort((left, right) => left.beat - right.beat);

  const merged: ScrollTimelinePoint[] = [];
  for (const point of points) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push({ ...point });
      continue;
    }
    if (Math.abs(point.beat - previous.beat) < 1e-9) {
      previous.speed = point.speed;
      continue;
    }
    if (Math.abs(point.speed - previous.speed) < 1e-9) {
      continue;
    }
    merged.push({ ...point });
  }

  const segments: ScrollSegment[] = [];
  let distance = 0;
  for (const point of merged) {
    const previous = segments.at(-1);
    if (previous) {
      distance = previous.startDistance + (point.beat - previous.startBeat) * previous.speed;
    }
    segments.push({
      startBeat: point.beat,
      speed: point.speed,
      startDistance: distance,
    });
  }
  return segments.length > 0 ? segments : [{ startBeat: 0, speed: 1, startDistance: 0 }];
}

function findLastSegmentIndexByBeat(segments: ScrollSegment[], beat: number): number {
  let low = 0;
  let high = segments.length - 1;
  let index = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = segments[mid]!;
    if (candidate.startBeat <= beat) {
      index = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }
  return index;
}

function renderProgress(currentSeconds: number, totalSeconds: number): string {
  const barLength = 28;
  const safeTotal = Math.max(1, totalSeconds);
  const ratio = clamp(currentSeconds / safeTotal, 0, 1);
  const filled = Math.round(barLength * ratio);
  return `[${'#'.repeat(filled)}${'-'.repeat(barLength - filled)}] ${Math.round(ratio * 100)}%`;
}

function isDistanceWithinWindow(distance: number, scrollWindowBeats: number): boolean {
  return Number.isFinite(distance) && Math.abs(distance) <= scrollWindowBeats;
}

function normalizeNoteApproachDistance(distance: number, currentBeat: number, targetBeat: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(currentBeat) || !Number.isFinite(targetBeat)) {
    return Number.NaN;
  }
  if (targetBeat + BEAT_EPSILON < currentBeat) {
    return Number.NaN;
  }
  return Math.abs(distance);
}

function isUpcomingBeat(currentBeat: number, targetBeat: number): boolean {
  if (!Number.isFinite(currentBeat) || !Number.isFinite(targetBeat)) {
    return false;
  }
  return targetBeat + BEAT_EPSILON >= currentBeat;
}

function distanceToRow(distance: number, rowCount: number, scrollWindowBeats: number): number {
  const normalized = clamp(Math.abs(distance) / scrollWindowBeats, 0, 1);
  return rowCount - 1 - Math.floor(normalized * (rowCount - 1));
}

function distanceToNoteRow(distance: number, rowCount: number, scrollWindowBeats: number): number {
  const safeDistance = Math.abs(distance);
  const rowSpan = Math.max(1, rowCount - 1);
  const rowStepDistance = scrollWindowBeats / rowSpan;
  if (safeDistance <= Math.max(BEAT_EPSILON, rowStepDistance * 0.5)) {
    return rowCount - 1;
  }
  const shiftedDistance = Math.min(scrollWindowBeats, safeDistance + rowStepDistance);
  return distanceToRow(shiftedDistance, rowCount, scrollWindowBeats);
}

function renderLaneRow(
  values: string[],
  channels: string[],
  laneWidths: number[],
  splitAfterIndex = -1,
  laneHighlightRatios = new Map<number, number>(),
  sourceChannels?: string[],
): string {
  const cells = values.map((value, index) => {
    const laneWidth = laneWidths[index] ?? DEFAULT_LANE_WIDTH;
    const isHead = value === NOTE_HEAD_SYMBOL;
    const isBody = value === LONG_NOTE_BODY_SYMBOL;
    const isTail = value === LONG_NOTE_TAIL_SYMBOL;
    const isInvisibleHead = value === INVISIBLE_NOTE_HEAD_SYMBOL;
    const isInvisibleBody = value === INVISIBLE_LONG_NOTE_BODY_SYMBOL;
    const isInvisibleTail = value === INVISIBLE_LONG_NOTE_TAIL_SYMBOL;
    const isMine = value === MINE_NOTE_SYMBOL;
    const isLaneFill = value === LANE_FILL_SYMBOL;
    const isLaneCeiling = value === '═';
    const isInvisibleNote = isInvisibleHead || isInvisibleBody || isInvisibleTail;
    const isNote = isHead || isBody || isTail || isInvisibleNote || isMine;
    const noteUnderline = isHead || isTail || isInvisibleHead || isInvisibleTail;
    const cell = isLaneFill
      ? renderLaneBackdropCell(laneWidth)
      : isLaneCeiling
        ? colorizeLaneCeiling('─'.repeat(Math.max(1, laneWidth)))
        : isHead
          ? renderNoteCell(laneWidth, 'head')
          : isBody
            ? renderNoteCell(laneWidth, 'body')
            : isTail
              ? renderNoteCell(laneWidth, 'tail')
              : isInvisibleHead
                ? renderNoteCell(laneWidth, 'head')
                : isInvisibleBody
                  ? renderNoteCell(laneWidth, 'body')
                  : isInvisibleTail
                    ? renderNoteCell(laneWidth, 'tail')
                    : isMine
                      ? center(MINE_NOTE_SYMBOL, laneWidth)
                      : center(value, laneWidth);
    const decoratedCell = isMine
      ? colorizeMine(cell)
      : isNote
        ? colorizeNote(cell, sourceChannels?.[index] ?? channels[index] ?? '', isInvisibleNote, noteUnderline)
        : value === MEASURE_LINE_SYMBOL
          ? colorizeMeasureLine(cell)
          : isLaneFill || isLaneCeiling
            ? cell
            : colorizeLaneLabel(cell);
    const highlightRatio = laneHighlightRatios.get(index);
    if (highlightRatio !== undefined) {
      return highlightCell(decoratedCell, highlightRatio);
    }
    return decoratedCell;
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
  const fill = `\u001b[48;5;233m${' '.repeat(SPLIT_PANEL_INNER_WIDTH)}${ANSI_RESET}`;
  return `${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}${fill}${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}`;
}

function renderMeasureRow(
  values: string[],
  channels: string[],
  laneWidths: number[],
  splitAfterIndex = -1,
  laneHighlightRatios = new Map<number, number>(),
  sourceChannels?: string[],
): string {
  const renderSection = (startIndex: number, endIndex: number): string => {
    const cells: string[] = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      const laneWidth = laneWidths[index] ?? DEFAULT_LANE_WIDTH;
      const channel = sourceChannels?.[index] ?? channels[index] ?? '';
      let cell = renderMeasureLaneCell(values[index] ?? LANE_FILL_SYMBOL, laneWidth, channel);
      const highlightRatio = laneHighlightRatios.get(index);
      if (highlightRatio !== undefined) {
        cell = highlightCell(cell, highlightRatio);
      }
      cells.push(cell);
    }
    return renderMeasureSection(cells);
  };

  if (splitAfterIndex < 0 || splitAfterIndex >= values.length - 1) {
    return renderSection(0, values.length);
  }

  const left = renderSection(0, splitAfterIndex + 1);
  const right = renderSection(splitAfterIndex + 1, values.length);
  return `${left}${renderLaneSplitPanel()}${right}`;
}

function renderMeasureSection(cells: string[]): string {
  const divider = colorizeMeasureLine(MEASURE_LINE_SYMBOL);
  const body = cells.join(divider);
  return `${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}${body}${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}`;
}

function renderMeasureLaneCell(value: string, laneWidth: number, sourceChannel: string): string {
  const safeWidth = Math.max(1, laneWidth);
  if (value === NOTE_HEAD_SYMBOL) {
    return colorizeNote(renderNoteCell(safeWidth, 'head'), sourceChannel, false, true);
  }
  if (value === LONG_NOTE_BODY_SYMBOL) {
    return colorizeNote(renderNoteCell(safeWidth, 'body'), sourceChannel, false, false);
  }
  if (value === LONG_NOTE_TAIL_SYMBOL) {
    return colorizeNote(renderNoteCell(safeWidth, 'tail'), sourceChannel, false, true);
  }
  if (value === INVISIBLE_NOTE_HEAD_SYMBOL) {
    return colorizeNote(renderNoteCell(safeWidth, 'head'), sourceChannel, true, true);
  }
  if (value === INVISIBLE_LONG_NOTE_BODY_SYMBOL) {
    return colorizeNote(renderNoteCell(safeWidth, 'body'), sourceChannel, true, false);
  }
  if (value === INVISIBLE_LONG_NOTE_TAIL_SYMBOL) {
    return colorizeNote(renderNoteCell(safeWidth, 'tail'), sourceChannel, true, true);
  }
  if (value === MINE_NOTE_SYMBOL) {
    return colorizeMine(center(MINE_NOTE_SYMBOL, safeWidth));
  }
  return colorizeMeasureLine(MEASURE_LINE_SYMBOL.repeat(safeWidth));
}

function renderJudgeRow(
  values: string[],
  channels: string[],
  laneWidths: number[],
  splitAfterIndex = -1,
  laneHighlightRatios = new Map<number, number>(),
  sourceChannels?: string[],
): string {
  const renderSection = (startIndex: number, endIndex: number): string => {
    const cells: string[] = [];
    for (let index = startIndex; index < endIndex; index += 1) {
      const laneWidth = laneWidths[index] ?? DEFAULT_LANE_WIDTH;
      const channel = sourceChannels?.[index] ?? channels[index] ?? '';
      let cell = renderJudgeLaneCell(values[index] ?? LANE_FILL_SYMBOL, laneWidth, channel);
      const highlightRatio = laneHighlightRatios.get(index);
      if (highlightRatio !== undefined) {
        cell = highlightCell(cell, highlightRatio);
      }
      cells.push(cell);
    }
    return renderJudgeSection(cells);
  };

  if (splitAfterIndex < 0 || splitAfterIndex >= values.length - 1) {
    return renderSection(0, values.length);
  }

  const left = renderSection(0, splitAfterIndex + 1);
  const right = renderSection(splitAfterIndex + 1, values.length);
  return `${left}${renderLaneSplitPanel()}${right}`;
}

function renderJudgeSection(cells: string[]): string {
  const divider = colorizeJudgeLine(JUDGE_LINE_SYMBOL);
  const body = cells.join(divider);
  return `${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}${body}${colorizeLaneOuterBorder(LANE_OUTER_BORDER_SYMBOL)}`;
}

function renderJudgeLaneCell(value: string, laneWidth: number, sourceChannel: string): string {
  const safeWidth = Math.max(1, laneWidth);
  if (value === NOTE_HEAD_SYMBOL) {
    return colorizeNote(renderNoteCell(safeWidth, 'head'), sourceChannel, false, true);
  }
  if (value === LONG_NOTE_BODY_SYMBOL) {
    return colorizeNote(renderNoteCell(safeWidth, 'body'), sourceChannel, false, false);
  }
  if (value === LONG_NOTE_TAIL_SYMBOL) {
    return colorizeNote(renderNoteCell(safeWidth, 'tail'), sourceChannel, false, true);
  }
  if (value === INVISIBLE_NOTE_HEAD_SYMBOL) {
    return colorizeNote(renderNoteCell(safeWidth, 'head'), sourceChannel, true, true);
  }
  if (value === INVISIBLE_LONG_NOTE_BODY_SYMBOL) {
    return colorizeNote(renderNoteCell(safeWidth, 'body'), sourceChannel, true, false);
  }
  if (value === INVISIBLE_LONG_NOTE_TAIL_SYMBOL) {
    return colorizeNote(renderNoteCell(safeWidth, 'tail'), sourceChannel, true, true);
  }
  if (value === MINE_NOTE_SYMBOL) {
    return colorizeMine(center(MINE_NOTE_SYMBOL, safeWidth));
  }
  return colorizeJudgeLine(JUDGE_LINE_SYMBOL.repeat(safeWidth));
}

function setLaneCell(
  grid: string[][],
  sourceChannels: string[][],
  row: number,
  lane: number,
  symbol: string,
  sourceChannel: string,
  freeZoneSourceChannels: ReadonlySet<string>,
): void {
  const rowCells = grid[row];
  const rowSources = sourceChannels[row];
  if (!rowCells || !rowSources || lane < 0 || lane >= rowCells.length || lane >= rowSources.length) {
    return;
  }

  const normalizedSourceChannel = sourceChannel.toUpperCase();
  const previousSymbol = rowCells[lane] ?? LANE_FILL_SYMBOL;
  const previousSourceChannel = rowSources[lane] ?? '';
  const nextPriority = resolveLaneCellPriority(symbol, freeZoneSourceChannels.has(normalizedSourceChannel));
  const previousPriority = resolveLaneCellPriority(
    previousSymbol,
    freeZoneSourceChannels.has(previousSourceChannel.toUpperCase()),
  );
  if (nextPriority < previousPriority) {
    return;
  }

  rowCells[lane] = symbol;
  rowSources[lane] = normalizedSourceChannel;
}

function resolveLaneCellPriority(symbol: string, isFreeZoneSourceChannel: boolean): number {
  if (symbol === MINE_NOTE_SYMBOL) {
    return 5;
  }
  if (
    symbol === NOTE_HEAD_SYMBOL ||
    symbol === LONG_NOTE_BODY_SYMBOL ||
    symbol === LONG_NOTE_TAIL_SYMBOL ||
    symbol === INVISIBLE_NOTE_HEAD_SYMBOL ||
    symbol === INVISIBLE_LONG_NOTE_BODY_SYMBOL ||
    symbol === INVISIBLE_LONG_NOTE_TAIL_SYMBOL
  ) {
    return isFreeZoneSourceChannel ? 3 : 4;
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

function renderLaneBackdropCell(width: number): string {
  const safeWidth = Math.max(1, width);
  return ' '.repeat(safeWidth);
}

function colorizeLaneDivider(symbol: string): string {
  return `\u001b[38;5;246m${symbol}${ANSI_RESET}`;
}

function colorizeLaneOuterBorder(symbol: string): string {
  return `\u001b[1;38;5;253m${symbol}${ANSI_RESET}`;
}

function colorizeLaneCeiling(symbol: string): string {
  return `\u001b[38;5;240m${symbol}${ANSI_RESET}`;
}

function colorizeJudgeLine(symbol: string): string {
  return `\u001b[1;38;5;196m${symbol}${ANSI_RESET}`;
}

function colorizeLaneLabel(symbol: string): string {
  return `\u001b[1;38;5;251m${symbol}${ANSI_RESET}`;
}

function colorizeNote(symbol: string, channel: string, invisible = false, underline = false): string {
  const suffix = underline ? ';4' : '';
  if (invisible) {
    return `\u001b[32${suffix}m${symbol}\u001b[0m`;
  }
  if (RED_NOTE_CHANNELS.has(channel)) {
    return `\u001b[31${suffix}m${symbol}\u001b[0m`;
  }
  if (BLUE_NOTE_CHANNELS.has(channel)) {
    return `\u001b[34${suffix}m${symbol}\u001b[0m`;
  }
  if (WHITE_NOTE_CHANNELS.has(channel)) {
    return `\u001b[1;97${suffix}m${symbol}\u001b[0m`;
  }
  return symbol;
}

function colorizeMeasureLine(symbol: string): string {
  return `\u001b[38;5;247m${symbol}\u001b[0m`;
}

function colorizeMine(symbol: string): string {
  return `\u001b[1;97;41m${symbol}\u001b[0m`;
}

function formatJudgeComboDisplay(latestJudge: string, combo: number, nowMs: number, paused: boolean): string {
  if (paused) {
    return colorizeText('PAUSE', '1;97;41');
  }
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
  if (latestJudge === 'POOR') {
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

function canDropNoteFromRenderWindow(note: TuiNote, currentBeat: number, scrollWindowBeats: number): boolean {
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

  return note.beat < currentBeat - Math.max(IIDX_MEASURE_BEATS, scrollWindowBeats);
}

function calculateLaneBlockVisibleWidth(laneWidths: number[], splitAfterIndex: number): number {
  if (laneWidths.length <= 0) {
    return calculateLaneSectionVisibleWidth([DEFAULT_LANE_WIDTH]);
  }

  if (splitAfterIndex < 0 || splitAfterIndex >= laneWidths.length - 1) {
    return calculateLaneSectionVisibleWidth(laneWidths);
  }

  const left = laneWidths.slice(0, splitAfterIndex + 1);
  const right = laneWidths.slice(splitAfterIndex + 1);
  const splitPanelWidth = SPLIT_PANEL_INNER_WIDTH + 2; // split borders
  return Math.max(
    1,
    calculateLaneSectionVisibleWidth(left) + splitPanelWidth + calculateLaneSectionVisibleWidth(right),
  );
}

function calculateLaneSectionVisibleWidth(sectionLaneWidths: number[]): number {
  const innerWidth = calculateLaneSectionInnerVisibleWidth(sectionLaneWidths);
  if (innerWidth <= 0) {
    return 0;
  }
  return innerWidth + 2; // outer borders
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
  width += Math.max(0, laneCount - 1); // lane dividers
  return width;
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
  return String(normalized);
}

function formatNotesProgress(summary: PlayerSummary): string {
  const total = Math.max(0, summary.total);
  const judged = Math.max(0, summary.perfect + summary.great + summary.good + summary.bad + summary.poor);
  return `${Math.min(total, judged)}/${total}`;
}

function formatActiveAudioFiles(files: string[]): string {
  if (files.length === 0) {
    return '-';
  }

  const labels = files.map((file) => {
    const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
    return slash >= 0 ? file.slice(slash + 1) : file;
  });
  const uniqueLabels = [...new Set(labels)];
  const visible = uniqueLabels.slice(0, 4);
  const extra = uniqueLabels.length - visible.length;
  const suffix = extra > 0 ? ` ... +${extra}` : '';
  return `${visible.join(', ')}${suffix}`;
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

function resolveMeasureLength(measureLengths: ReadonlyMap<number, number> | undefined, measure: number): number {
  const safeMeasure = Math.max(0, Math.floor(measure));
  const length = measureLengths?.get(safeMeasure);
  if (typeof length !== 'number' || !Number.isFinite(length) || length <= 0) {
    return 1;
  }
  return length;
}

export function formatMeasureSignature(length: number | undefined): string {
  const safeLength = typeof length === 'number' && Number.isFinite(length) && length > 0 ? length : 1;
  const quarterBeats = safeLength * IIDX_MEASURE_BEATS;
  const fraction = approximateFraction(
    quarterBeats,
    MEASURE_SIGNATURE_MAX_DENOMINATOR,
    MEASURE_SIGNATURE_TOLERANCE,
  );
  if (fraction) {
    return `${fraction.numerator}/${fraction.denominator * IIDX_MEASURE_BEATS}`;
  }
  return `${formatMeterDecimal(quarterBeats)}/${IIDX_MEASURE_BEATS}`;
}

function approximateFraction(
  value: number,
  maxDenominator: number,
  tolerance: number,
): { numerator: number; denominator: number } | undefined {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maxDenominator) || maxDenominator < 1) {
    return undefined;
  }

  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Number.POSITIVE_INFINITY;
  for (let denominator = 1; denominator <= Math.floor(maxDenominator); denominator += 1) {
    const numerator = Math.round(value * denominator);
    if (numerator <= 0) {
      continue;
    }
    const error = Math.abs(value - numerator / denominator);
    if (error < bestError) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
    }
  }

  if (bestNumerator <= 0 || bestError > tolerance) {
    return undefined;
  }

  const divisor = greatestCommonDivisor(bestNumerator, bestDenominator);
  return {
    numerator: Math.floor(bestNumerator / divisor),
    denominator: Math.floor(bestDenominator / divisor),
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.floor(left));
  let b = Math.abs(Math.floor(right));
  while (b !== 0) {
    const rest = a % b;
    a = b;
    b = rest;
  }
  return Math.max(1, a);
}

function formatMeterDecimal(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const fixed = safe.toFixed(6);
  return fixed.replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
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

function findCurrentScroll(timeline: ReadonlyArray<ScrollTimelinePoint> | undefined, currentBeat: number): number {
  if (!timeline || timeline.length === 0) {
    return 1;
  }

  let low = 0;
  let high = timeline.length - 1;
  let best = 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = timeline[mid];
    if (point.beat <= currentBeat) {
      best = point.speed;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return Number.isFinite(best) ? best : 1;
}

function findRemainingStopSeconds(
  stopWindows: ReadonlyArray<StopWindowPoint> | undefined,
  currentSeconds: number,
): number {
  if (!stopWindows || stopWindows.length === 0 || !Number.isFinite(currentSeconds)) {
    return 0;
  }

  let low = 0;
  let high = stopWindows.length - 1;
  let index = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = stopWindows[mid];
    if (point.startSeconds <= currentSeconds) {
      index = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  if (index < 0) {
    return 0;
  }
  const window = stopWindows[index];
  if (currentSeconds >= window.endSeconds) {
    return 0;
  }
  return Math.max(0, window.endSeconds - currentSeconds);
}

function formatBpm(bpm: number): string {
  const safe = Number.isFinite(bpm) ? Math.max(0, bpm) : 0;
  return safe % 1 === 0 ? `${safe.toFixed(0)}` : safe.toFixed(2);
}

function formatHighSpeed(highSpeed: number): string {
  const safe = normalizeHighSpeed(highSpeed);
  return safe.toFixed(1);
}

function formatScroll(speed: number): string {
  if (!Number.isFinite(speed)) {
    return '1';
  }
  return speed % 1 === 0 ? speed.toFixed(0) : speed.toFixed(2);
}

function formatStopSeconds(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return safe.toFixed(2);
}

function formatJudgeWindowMs(milliseconds: number): string {
  const safe = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  const truncated = Math.floor(safe * 100) / 100;
  return truncated.toFixed(2);
}

function formatAudioBackendLabel(value: string | undefined): string {
  if (typeof value !== 'string') {
    return '-';
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : '-';
}
