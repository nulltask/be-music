import { effect, effectScope } from 'alien-signals';
import type { BeMusicPlayLevel } from '@be-music/json';
import { clamp } from '@be-music/utils/core';
import type { BgaKittyImage } from '../bga.ts';
import type { PlayerSummary } from '@be-music/player';
import { formatSeconds, resolveAltModifierLabel } from '@be-music/player/utils';
import type { PlayerStateSignals } from '@be-music/player/state-signals';
import {
  ScrollDistanceMapper,
  type ScrollTimelinePoint,
  type SpeedTimelinePoint,
} from '@be-music/player/core/scroll-distance';
import { DEFAULT_TUI_NOTE_HEIGHT, type TuiNoteHeight } from '@be-music/player/core/ui-options';
import { buildKittyGraphicsDeleteImageSequence, buildKittyGraphicsRenderSequence } from './kitty-graphics.ts';
import { normalizeHighSpeed, resolveAnimatedHighSpeedValue, resolveVisibleBeatsForTuiGrid } from './high-speed.ts';
import {
  calculateLaneBlockVisibleWidth,
  calculateTuiGridRowCount,
  DEFAULT_LANE_WIDTH,
  PLAY_PROGRESS_INDICATOR_SIDE_WIDTH,
  resolveLaneWidths,
} from './layout.ts';
import {
  ANSI_RESET,
  type RgbColor,
  BLACK_RGB,
  colorizeText,
  dimRgb,
  blendRgb,
  padVisibleWidth,
  clampColorByte,
  isSameRgb,
  visibleWidth,
  getCharacterDisplayWidth,
  findAnsiSgrSequenceEnd,
} from './ansi-text.ts';
import {
  type MeasureTimelinePoint,
  type BpmTimelinePoint,
  type StopWindowPoint,
  IIDX_MEASURE_BEATS,
  findCurrentMeasure,
  findTotalMeasures,
  resolveMeasureLength,
  formatMeasureSignature,
  findCurrentBpm,
  findCurrentScroll,
  findRemainingStopSeconds,
} from './timeline.ts';
import {
  type TuiLane,
  MEASURE_LINE_SYMBOL,
  LANE_FILL_SYMBOL,
  NOTE_HEAD_SYMBOL,
  LONG_NOTE_HEAD_SYMBOL,
  LONG_NOTE_BODY_SYMBOL,
  LONG_NOTE_TAIL_SYMBOL,
  MINE_NOTE_SYMBOL,
  INVISIBLE_NOTE_HEAD_SYMBOL,
  INVISIBLE_LONG_NOTE_HEAD_SYMBOL,
  INVISIBLE_LONG_NOTE_BODY_SYMBOL,
  INVISIBLE_LONG_NOTE_TAIL_SYMBOL,
  renderLaneRow,
  renderInputKeyRows,
  renderJudgeComboLine,
  renderMeasureRow,
  renderJudgeRow,
  setLaneCell,
  colorizeLaneOuterBorder,
  hasLaneSplit,
} from './lane-rows.ts';
export { resolveAnimatedHighSpeedValue, resolveVisibleBeatsForTuiGrid } from './high-speed.ts';
export { formatMeasureSignature } from './timeline.ts';

interface TuiOptions {
  mode: 'AUTO' | 'MANUAL' | 'AUTO SCRATCH';
  laneDisplayMode: string;
  title: string;
  artist?: string;
  genre?: string;
  player?: number;
  rank?: number;
  rankLabel?: string;
  playLevel?: BeMusicPlayLevel;
  lanes: TuiLane[];
  speed: number;
  highSpeed: number;
  visibleNotesLimit?: number;
  noteHeight?: TuiNoteHeight;
  judgeWindowMs: number;
  showLaneChannels?: boolean;
  randomPatternSummary?: string;
  bpmTimeline?: ReadonlyArray<BpmTimelinePoint>;
  scrollTimeline?: ReadonlyArray<ScrollTimelinePoint>;
  speedTimeline?: ReadonlyArray<SpeedTimelinePoint>;
  stopWindows?: ReadonlyArray<StopWindowPoint>;
  measureTimeline?: ReadonlyArray<MeasureTimelinePoint>;
  measureLengths?: ReadonlyMap<number, number>;
  measureBoundariesBeats?: number[];
  splitAfterIndex?: number;
  stateSignals?: PlayerStateSignals;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  useAlternateScreen?: boolean;
  terminalImageProtocol?: 'kitty' | 'none';
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
  /** Mirrored display clock past the LR2 negative-BPM reversal (#134) — the lane grid scrolls from it when set. */
  displayBeat?: number;
  /** Chart time of the LR2 reversal, when the chart has one — the BGA and the BPM readout freeze there. */
  reversalSeconds?: number;
  totalSeconds: number;
  summary: PlayerSummary;
  notes: TuiNote[];
  landmineNotes?: TuiNote[];
  invisibleNotes?: TuiNote[];
  audioBackend?: string;
  activeAudioFiles?: string[];
  activeAudioVoiceCount?: number;
  bgaAnsiLines?: string[];
  bgaKittyImage?: BgaKittyImage;
}

interface NoteWindowState {
  source?: TuiNote[];
  startIndex: number;
  endIndex: number;
  beat: number;
}

const MAX_SCROLL_LOOKAHEAD_BEATS = IIDX_MEASURE_BEATS * 64;
const DEFAULT_VISIBLE_NOTES_LIMIT = 8192;
const DEFAULT_LANDMINE_NOTES_PER_CELL = 2;
const DEFAULT_INVISIBLE_NOTES_PER_CELL = 2;
const BEAT_EPSILON = 1e-9;
const FLASH_DURATION_MS = 180;
const NOTE_ROW_HYSTERESIS_CELLS = 0.18;
const KITTY_BGA_IMAGE_IDS = [1_337, 1_338] as const;
const SCORE_COUNTUP_MIN_PER_SEC = 4000;
const SCORE_COUNTUP_DISTANCE_FACTOR = 6;
const HIGH_SPEED_TRANSITION_MS = 180;
const JUDGE_COMBO_VISIBILITY_TIMEOUT_MS = 1000;
const JUDGE_COMBO_BLINK_INTERVAL_MS = 80;
const FPS_SMOOTHING_FACTOR = 0.2;
const HIGH_SPEED_MODIFIER_LABEL = resolveAltModifierLabel();

interface JudgeComboDisplayState {
  latestJudge: string;
  combo: number;
  updatedAtMs: number;
}

const PAUSE_FOREGROUND_RGB: RgbColor = { r: 255, g: 255, b: 255 };
const PAUSE_BACKGROUND_RGB: RgbColor = { r: 200, g: 59, b: 59 };
const GREAT_JUDGE_RGB: RgbColor = { r: 255, g: 215, b: 95 };
const GOOD_JUDGE_RGB: RgbColor = { r: 135, g: 255, b: 118 };
const BAD_JUDGE_RGB: RgbColor = { r: 255, g: 159, b: 74 };
const POOR_JUDGE_RGB: RgbColor = { r: 255, g: 107, b: 107 };
const READY_JUDGE_RGB: RgbColor = { r: 95, g: 215, b: 255 };
const IDLE_JUDGE_RGB: RgbColor = { r: 154, g: 161, b: 170 };
const GROOVE_GAUGE_SAFE_RGB: RgbColor = { r: 72, g: 238, b: 255 };
const GROOVE_GAUGE_SAFE_EMPTY_RGB: RgbColor = { r: 18, g: 74, b: 86 };
const GROOVE_GAUGE_CLEAR_RGB: RgbColor = { r: 255, g: 72, b: 72 };
const GROOVE_GAUGE_CLEAR_EMPTY_RGB: RgbColor = { r: 84, g: 18, b: 18 };
const PLAY_PROGRESS_GROOVE_RGB: RgbColor = { r: 18, g: 18, b: 18 };
const PLAY_PROGRESS_HEAD_RGB: RgbColor = { r: 255, g: 186, b: 54 };
const RAINBOW_RGB_STEPS: RgbColor[] = [
  { r: 255, g: 0, b: 0 },
  { r: 255, g: 135, b: 0 },
  { r: 255, g: 255, b: 0 },
  { r: 135, g: 255, b: 0 },
  { r: 0, g: 255, b: 255 },
  { r: 0, g: 175, b: 255 },
  { r: 255, g: 0, b: 255 },
];

export class PlayerTui {
  private readonly options: TuiOptions;

  private readonly stateSignals?: PlayerStateSignals;

  private readonly terminalImageProtocol: 'kitty' | 'none';

  private readonly useAlternateScreen: boolean;

  private readonly laneIndex = new Map<string, number>();

  private readonly laneChannels: string[];

  private readonly freeZoneChannelToScratchChannel = new Map<string, string>();

  private readonly freeZoneSourceChannels = new Set<string>();

  private readonly laneFlashUntil = new Map<string, number>();

  private readonly laneHoldUntilBeat = new Map<string, number>();

  private readonly pressedLaneChannels = new Set<string>();

  private readonly laneWidths: number[] = [];

  private readonly scrollDistanceMapper: ScrollDistanceMapper;

  private readonly supported: boolean;

  private active = false;

  private terminalColumns?: number;

  private terminalRows?: number;

  private needsFullRefresh = false;

  private readonly leftJudgeComboDisplay = createJudgeComboDisplayState();

  private readonly rightJudgeComboDisplay = createJudgeComboDisplayState();

  private paused = false;

  private displayedScore = 0;

  private lastScoreAnimationMs = 0;

  private previousRenderedLines: string[] = [];

  private readonly primaryNoteWindowState: NoteWindowState = {
    source: undefined,
    startIndex: 0,
    endIndex: 0,
    beat: Number.NEGATIVE_INFINITY,
  };

  private readonly landmineNoteWindowState: NoteWindowState = {
    source: undefined,
    startIndex: 0,
    endIndex: 0,
    beat: Number.NEGATIVE_INFINITY,
  };

  private readonly invisibleNoteWindowState: NoteWindowState = {
    source: undefined,
    startIndex: 0,
    endIndex: 0,
    beat: Number.NEGATIVE_INFINITY,
  };

  private visibleNoteRows = new Map<string, number>();

  private displayedHighSpeed: number;

  private targetHighSpeed: number;

  private highSpeedTransitionFrom: number;

  private highSpeedTransitionStartMs = 0;

  private smoothedFps = Number.NaN;

  private lastFrameRenderedAtMs = 0;

  private lastRenderedBeat = Number.NaN;

  private lastKittyBgaToken = '';

  private lastKittyBgaPlacementToken = '';

  private activeKittyBgaImageIndex = 0;

  private kittyBgaVisible = false;

  constructor(options: TuiOptions) {
    const initialHighSpeed = normalizeHighSpeed(options.highSpeed);
    options.highSpeed = initialHighSpeed;
    options.noteHeight = options.noteHeight ?? DEFAULT_TUI_NOTE_HEIGHT;
    this.options = options;
    this.stateSignals = options.stateSignals;
    this.displayedHighSpeed = initialHighSpeed;
    this.targetHighSpeed = initialHighSpeed;
    this.highSpeedTransitionFrom = initialHighSpeed;
    this.laneChannels = options.lanes.map((lane) => lane.channel);
    this.scrollDistanceMapper = new ScrollDistanceMapper(options.scrollTimeline, options.speedTimeline, {
      lookaheadBeats: MAX_SCROLL_LOOKAHEAD_BEATS,
    });
    this.supported = Boolean(
      (options.stdoutIsTTY ?? process.stdout.isTTY) && (options.stdinIsTTY ?? process.stdin.isTTY),
    );
    this.useAlternateScreen = options.useAlternateScreen ?? true;
    this.terminalImageProtocol = options.terminalImageProtocol ?? 'none';
    const laneWidths = resolveLaneWidths(options.lanes);
    options.lanes.forEach((lane, index) => {
      this.laneIndex.set(lane.channel, index);
      this.laneWidths[index] = laneWidths[index] ?? DEFAULT_LANE_WIDTH;
    });
    if (!this.laneIndex.has('17') && this.laneIndex.has('16')) {
      this.freeZoneChannelToScratchChannel.set('17', '16');
      this.freeZoneSourceChannels.add('17');
    }
    if (!this.laneIndex.has('27') && this.laneIndex.has('26')) {
      this.freeZoneChannelToScratchChannel.set('27', '26');
      this.freeZoneSourceChannels.add('27');
    }
    if (this.stateSignals) {
      effectScope(() => {
        effect(() => {
          this.setPaused(this.stateSignals?.paused() ?? false);
        });
        effect(() => {
          this.setHighSpeed(normalizeHighSpeed(this.stateSignals?.highSpeed() ?? this.targetHighSpeed));
        });
        effect(() => {
          this.stateSignals?.judgeComboTick();
          const judgeComboState = this.stateSignals?.getJudgeCombo();
          if (judgeComboState) {
            this.setJudgeComboState(judgeComboState);
          }
        });
      });
    }
  }

  isSupported(): boolean {
    return this.supported;
  }

  usesKittyGraphicsForBga(): boolean {
    return this.terminalImageProtocol === 'kitty';
  }

  start(): void {
    if (!this.supported || this.active) {
      return;
    }
    this.active = true;
    this.needsFullRefresh = false;
    this.previousRenderedLines = [];
    this.lastKittyBgaToken = '';
    this.lastKittyBgaPlacementToken = '';
    this.activeKittyBgaImageIndex = 0;
    this.kittyBgaVisible = false;
    process.stdout.write(
      this.useAlternateScreen ? '\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l' : '\u001b[2J\u001b[H\u001b[?25l',
    );
  }

  stop(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    resetJudgeComboDisplayState(this.leftJudgeComboDisplay);
    resetJudgeComboDisplayState(this.rightJudgeComboDisplay);
    this.paused = false;
    this.displayedScore = 0;
    this.lastScoreAnimationMs = 0;
    this.laneHoldUntilBeat.clear();
    this.pressedLaneChannels.clear();
    this.previousRenderedLines = [];
    this.primaryNoteWindowState.source = undefined;
    this.primaryNoteWindowState.startIndex = 0;
    this.primaryNoteWindowState.endIndex = 0;
    this.primaryNoteWindowState.beat = Number.NEGATIVE_INFINITY;
    this.landmineNoteWindowState.source = undefined;
    this.landmineNoteWindowState.startIndex = 0;
    this.landmineNoteWindowState.endIndex = 0;
    this.landmineNoteWindowState.beat = Number.NEGATIVE_INFINITY;
    this.invisibleNoteWindowState.source = undefined;
    this.invisibleNoteWindowState.startIndex = 0;
    this.invisibleNoteWindowState.endIndex = 0;
    this.invisibleNoteWindowState.beat = Number.NEGATIVE_INFINITY;
    this.visibleNoteRows.clear();
    this.needsFullRefresh = false;
    this.displayedHighSpeed = normalizeHighSpeed(this.options.highSpeed);
    this.targetHighSpeed = this.displayedHighSpeed;
    this.highSpeedTransitionFrom = this.displayedHighSpeed;
    this.highSpeedTransitionStartMs = 0;
    this.smoothedFps = Number.NaN;
    this.lastFrameRenderedAtMs = 0;
    this.lastRenderedBeat = Number.NaN;
    const clearKittyBga = this.kittyBgaVisible
      ? KITTY_BGA_IMAGE_IDS.map((imageId) => buildKittyGraphicsDeleteImageSequence(imageId)).join('')
      : '';
    this.lastKittyBgaToken = '';
    this.lastKittyBgaPlacementToken = '';
    this.activeKittyBgaImageIndex = 0;
    this.kittyBgaVisible = false;
    process.stdout.write(
      this.useAlternateScreen
        ? `${clearKittyBga}\u001b[0m\u001b[?25h\u001b[?1049l`
        : `${clearKittyBga}\u001b[0m\u001b[?25h\u001b[2J\u001b[H`,
    );
  }

  setLatestJudge(value: string, channel?: string): void {
    const nowMs = Date.now();
    for (const display of this.resolveJudgeComboTargets(channel)) {
      display.latestJudge = value;
      display.updatedAtMs = nowMs;
    }
  }

  setCombo(value: number, channel?: string): void {
    const safeCombo = Math.max(0, Math.floor(value));
    const nowMs = Date.now();
    for (const display of this.resolveJudgeComboTargets(channel)) {
      display.combo = safeCombo;
      display.updatedAtMs = nowMs;
    }
  }

  setJudgeComboState(state: Readonly<{ judge: string; combo: number; channel?: string; updatedAtMs: number }>): void {
    for (const display of this.resolveJudgeComboTargets(state.channel)) {
      display.latestJudge = state.judge;
      display.combo = state.combo;
      display.updatedAtMs = state.updatedAtMs;
    }
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

  pressLane(channel: string): void {
    this.pressedLaneChannels.add(this.resolveRenderLaneChannel(channel));
  }

  releaseLane(channel: string): void {
    this.pressedLaneChannels.delete(this.resolveRenderLaneChannel(channel));
  }

  setTerminalSize(columns: number | undefined, rows: number | undefined): void {
    const nextColumns = normalizeTerminalDimension(columns);
    const nextRows = normalizeTerminalDimension(rows);
    if (this.terminalColumns === nextColumns && this.terminalRows === nextRows) {
      return;
    }
    this.terminalColumns = nextColumns;
    this.terminalRows = nextRows;
    this.previousRenderedLines = [];
    this.needsFullRefresh = true;
  }

  render(frame: TuiFrame): void {
    if (!this.active) {
      return;
    }

    // LR2 negative-BPM reversal (#134): the lane grid scrolls from the mirrored display beat once the run passes
    // the reversal, while the status clock / summary keep the true clock. `resolveNoteWindow` already resets its
    // cursors when the beat moves backwards, so the mirrored beat is safe to feed through the note windows.
    const scrollBeat = frame.displayBeat ?? frame.currentBeat;
    const terminalRows = this.terminalRows ?? process.stdout.rows;
    const debugLineCount = frame.activeAudioFiles === undefined && frame.activeAudioVoiceCount === undefined ? 0 : 1;
    const showLaneChannels = Boolean(this.options.showLaneChannels);
    const randomPatternSummary =
      typeof this.options.randomPatternSummary === 'string' && this.options.randomPatternSummary.length > 0
        ? this.options.randomPatternSummary
        : undefined;
    const rowCount = calculateTuiGridRowCount(terminalRows, {
      showLaneChannels,
      hasRandomPatternSummary: randomPatternSummary !== undefined,
      hasAudioDebugLine: debugLineCount > 0,
    });
    const laneCount = Math.max(1, this.options.lanes.length);
    const now = Date.now();
    const currentFps = this.resolveFps(now);
    const displayHighSpeed = this.resolveDisplayHighSpeed(now);
    const scrollWindowBeats = resolveVisibleBeatsForTuiGrid(rowCount, displayHighSpeed);
    const grid = Array.from({ length: rowCount }, () => Array.from({ length: laneCount }, () => LANE_FILL_SYMBOL));
    const gridSourceChannels = Array.from({ length: rowCount }, () => Array.from({ length: laneCount }, () => ''));
    const measureLineRows = new Set<number>();
    const laneHighlightRatios = new Map<number, number>();

    const lastVisibleBeat = this.scrollDistanceMapper.firstBeatBeyondDistance(scrollBeat, scrollWindowBeats);
    for (const boundaryBeat of this.options.measureBoundariesBeats ?? []) {
      if (!isUpcomingBeat(scrollBeat, boundaryBeat) || boundaryBeat > lastVisibleBeat) {
        continue;
      }
      const distance = this.scrollDistanceMapper.distanceBetween(scrollBeat, boundaryBeat);
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

    const nextVisibleNoteRows = new Map<string, number>();
    const renderNoteCollection = (
      notes: TuiNote[],
      keyPrefix: 'main' | 'landmine' | 'invisible',
      state: NoteWindowState,
      visibleNotesLimit: number,
    ): void => {
      const { start: noteStartIndex, end: noteEndIndex } = this.resolveNoteWindow(
        notes,
        scrollBeat,
        scrollWindowBeats,
        state,
        visibleNotesLimit,
      );

      for (let noteIndex = noteStartIndex; noteIndex < noteEndIndex; noteIndex += 1) {
        const note = notes[noteIndex]!;
        const noteKey = `${keyPrefix}:${noteIndex}`;
        const previousRow = this.visibleNoteRows.get(noteKey);
        const keepVisible =
          typeof note.visibleUntilBeat === 'number' &&
          Number.isFinite(note.visibleUntilBeat) &&
          note.visibleUntilBeat > scrollBeat;
        const crossedJudgeLineSinceLastFrame =
          note.judged &&
          Number.isFinite(this.lastRenderedBeat) &&
          note.beat + BEAT_EPSILON >= this.lastRenderedBeat &&
          note.beat <= scrollBeat + BEAT_EPSILON;
        // "Keep until it crosses the judge line" is a forward-scroll rule: once the LR2 reversal mirrors the
        // scroll, consumed notes must stay hidden (LR2 removes them from its draw list; the web scenes hide them
        // too) instead of re-emerging from the judge line and receding.
        const keepJudgedUntilJudgeLine =
          note.judged &&
          !keepVisible &&
          frame.displayBeat === undefined &&
          Number.isFinite(note.beat) &&
          (note.beat + BEAT_EPSILON >= scrollBeat || crossedJudgeLineSinceLastFrame);
        if (note.judged && !keepVisible && !keepJudgedUntilJudgeLine) {
          continue;
        }
        const lane = this.laneIndex.get(this.resolveRenderLaneChannel(note.channel));
        if (lane === undefined) {
          continue;
        }

        if (note.mine) {
          const distance = this.scrollDistanceMapper.distanceBetween(scrollBeat, note.beat);
          const visibleDistance = normalizeNoteApproachDistance(distance, scrollBeat, note.beat);
          if (!isDistanceWithinWindow(visibleDistance, scrollWindowBeats)) {
            continue;
          }
          const row = distanceToNoteRow(visibleDistance, rowCount, scrollWindowBeats, previousRow);
          const placedRow = setLaneCell(
            grid,
            gridSourceChannels,
            row,
            lane,
            MINE_NOTE_SYMBOL,
            note.channel,
            this.freeZoneSourceChannels,
            true,
          );
          nextVisibleNoteRows.set(noteKey, placedRow);
          continue;
        }

        let headSymbol = note.invisible ? INVISIBLE_NOTE_HEAD_SYMBOL : NOTE_HEAD_SYMBOL;
        if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
          headSymbol = note.invisible ? INVISIBLE_LONG_NOTE_HEAD_SYMBOL : LONG_NOTE_HEAD_SYMBOL;
          const longBodySymbol = note.invisible ? INVISIBLE_LONG_NOTE_BODY_SYMBOL : LONG_NOTE_BODY_SYMBOL;
          const longTailSymbol = note.invisible ? INVISIBLE_LONG_NOTE_TAIL_SYMBOL : LONG_NOTE_TAIL_SYMBOL;
          const bodyStartBeat = Math.max(note.beat, scrollBeat);
          const bodyEndBeat = note.endBeat;
          const bodyStartDistance = this.scrollDistanceMapper.distanceBetween(scrollBeat, bodyStartBeat);
          const bodyEndDistance = this.scrollDistanceMapper.distanceBetween(scrollBeat, bodyEndBeat);
          const normalizedBodyStart = normalizeNoteApproachDistance(bodyStartDistance, scrollBeat, bodyStartBeat);
          const normalizedBodyEnd = normalizeNoteApproachDistance(bodyEndDistance, scrollBeat, bodyEndBeat);
          const hasBodyStart = Number.isFinite(normalizedBodyStart);
          const hasBodyEnd = Number.isFinite(normalizedBodyEnd);

          const bodyStartInWindow = isDistanceWithinWindow(normalizedBodyStart, scrollWindowBeats);
          const bodyEndInWindow = isDistanceWithinWindow(normalizedBodyEnd, scrollWindowBeats);
          if (bodyStartInWindow || bodyEndInWindow) {
            const bodyVisibleFrom = clamp(hasBodyStart ? normalizedBodyStart : normalizedBodyEnd, 0, scrollWindowBeats);
            const bodyVisibleTo = clamp(hasBodyEnd ? normalizedBodyEnd : normalizedBodyStart, 0, scrollWindowBeats);
            const startRow = distanceToNoteRow(bodyVisibleFrom, rowCount, scrollWindowBeats);
            const endRow = distanceToNoteRow(bodyVisibleTo, rowCount, scrollWindowBeats);
            const from = Math.min(startRow, endRow);
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
          }

          const tailDistance = this.scrollDistanceMapper.distanceBetween(scrollBeat, note.endBeat);
          const tailVisibleDistance = normalizeNoteApproachDistance(tailDistance, scrollBeat, note.endBeat);
          if (isDistanceWithinWindow(tailVisibleDistance, scrollWindowBeats)) {
            const tailRow = distanceToNoteRow(tailVisibleDistance, rowCount, scrollWindowBeats);
            if (tailRow >= 0 && tailRow < rowCount) {
              setLaneCell(
                grid,
                gridSourceChannels,
                tailRow,
                lane,
                longTailSymbol,
                note.channel,
                this.freeZoneSourceChannels,
                true,
              );
            }
          }
        }

        const headDistance = this.scrollDistanceMapper.distanceBetween(scrollBeat, note.beat);
        const headVisibleDistance = normalizeNoteApproachDistance(headDistance, scrollBeat, note.beat);
        if (!isDistanceWithinWindow(headVisibleDistance, scrollWindowBeats)) {
          continue;
        }
        const row = distanceToNoteRow(headVisibleDistance, rowCount, scrollWindowBeats, previousRow);
        const placedRow = setLaneCell(
          grid,
          gridSourceChannels,
          row,
          lane,
          headSymbol,
          note.channel,
          this.freeZoneSourceChannels,
          true,
        );
        nextVisibleNoteRows.set(noteKey, placedRow);
      }
    };

    renderNoteCollection(
      frame.landmineNotes ?? [],
      'landmine',
      this.landmineNoteWindowState,
      this.resolveLandmineNotesLimit(rowCount, laneCount),
    );
    renderNoteCollection(
      frame.invisibleNotes ?? [],
      'invisible',
      this.invisibleNoteWindowState,
      this.resolveInvisibleNotesLimit(rowCount, laneCount),
    );
    renderNoteCollection(frame.notes, 'main', this.primaryNoteWindowState, this.resolveVisibleNotesLimit());
    this.visibleNoteRows = nextVisibleNoteRows;

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
      // Expire against the TRUE beat as well: past the LR2 reversal the mirrored scrollBeat only decreases, and a
      // hold whose tail lies behind the reversal would otherwise keep the lane lit for the rest of the run.
      if (untilBeat <= Math.max(scrollBeat, frame.currentBeat)) {
        this.laneHoldUntilBeat.delete(channel);
        const lane = this.laneIndex.get(channel);
        if (lane !== undefined) {
          laneHighlightRatios.set(lane, 1);
        }
        const existingFlashUntil = this.laneFlashUntil.get(channel) ?? Number.NEGATIVE_INFINITY;
        const nextFlashUntil = now + FLASH_DURATION_MS;
        if (nextFlashUntil > existingFlashUntil) {
          this.laneFlashUntil.set(channel, nextFlashUntil);
        }
        continue;
      }
      const lane = this.laneIndex.get(channel);
      if (lane === undefined) {
        continue;
      }
      laneHighlightRatios.set(lane, 1);
    }

    for (const channel of this.pressedLaneChannels) {
      const lane = this.laneIndex.get(channel);
      if (lane === undefined) {
        continue;
      }
      laneHighlightRatios.set(lane, 1);
    }
    const activeInputKeyChannels = new Set(this.pressedLaneChannels);
    for (const [channel, until] of this.laneFlashUntil.entries()) {
      if (until > now) {
        activeInputKeyChannels.add(channel);
      }
    }

    const lines: string[] = [];
    // Tempo events behind the LR2 reversal never fire (the pump is frozen), so the BPM readout holds the value at
    // the reversal instead of stepping through them on the true clock.
    const bpmReadoutSeconds = Math.min(frame.currentSeconds, frame.reversalSeconds ?? Number.POSITIVE_INFINITY);
    const currentBpm = findCurrentBpm(this.options.bpmTimeline, bpmReadoutSeconds);
    const currentScroll = findCurrentScroll(this.options.scrollTimeline, scrollBeat);
    const remainingStopSeconds = findRemainingStopSeconds(this.options.stopWindows, frame.currentSeconds);
    const stopLabel = remainingStopSeconds > 0 ? `${formatStopSeconds(remainingStopSeconds)}s` : '-';
    const audioBackendLabel = formatAudioBackendLabel(frame.audioBackend);
    lines.push(`BMS PLAYER TUI [${this.options.mode}]  AUDIO ${audioBackendLabel}`);
    lines.push(`${this.options.title}${this.options.artist ? ` / ${this.options.artist}` : ''}`);
    lines.push(`GENRE ${formatGenreLabel(this.options.genre)}`);
    lines.push(
      `${renderProgress(frame.currentSeconds, frame.totalSeconds)}  ${formatSeconds(frame.currentSeconds)} / ${formatSeconds(frame.totalSeconds)}`,
    );
    lines.push(
      `TIMING  SPEED x${this.options.speed.toFixed(2)}  HS x${formatHighSpeed(displayHighSpeed)}  BAD ±${formatJudgeWindowMs(this.options.judgeWindowMs)}ms  BPM ${formatBpm(currentBpm)}  SCROLL ${formatScroll(currentScroll)}  STOP ${stopLabel}`,
    );
    const currentMeasure = findCurrentMeasure(this.options.measureTimeline, frame.currentSeconds) + 1;
    const totalMeasures = findTotalMeasures(this.options.measureTimeline);
    const displayMeasure = clamp(currentMeasure, 1, totalMeasures);
    const measureLength = resolveMeasureLength(this.options.measureLengths, displayMeasure - 1);
    const measureSignature = formatMeasureSignature(measureLength);
    lines.push(`MEASURE ${displayMeasure}/${totalMeasures}  METER ${measureSignature}`);
    lines.push(
      `CHART   LANE ${this.options.laneDisplayMode}  PLAYER ${formatPlayerLabel(this.options.player)}  RANK ${this.options.rankLabel ?? formatRankLabel(this.options.rank)}  PLAYLEVEL ${formatPlayLevelLabel(this.options.playLevel)}`,
    );
    lines.push(`PERF    FPS ${formatFps(currentFps)}`);
    if (randomPatternSummary) {
      lines.push(randomPatternSummary);
    }
    const animatedScore = this.resolveAnimatedScore(frame.summary.score, now);
    const maxExScore = Math.max(0, frame.summary.total * 2);
    lines.push(
      `NOTES ${formatNotesProgress(frame.summary)}  EX ${frame.summary.exScore}/${maxExScore}  SCORE ${animatedScore}/200000`,
    );
    lines.push(
      `PG ${frame.summary.perfect}  GR ${frame.summary.great}  GD ${frame.summary.good}  BD ${frame.summary.bad}  PR ${frame.summary.poor}  FAST ${frame.summary.fast}  SLOW ${frame.summary.slow}`,
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
    if (showLaneChannels) {
      laneLines.push(
        renderLaneRow(
          this.options.lanes.map((lane) => lane.channel),
          this.laneChannels,
          this.laneWidths,
          this.options.splitAfterIndex,
          this.options.noteHeight,
        ),
      );
    }
    const judgeRowIndex = Math.max(0, grid.length - 1);
    const playfieldIndicatorStartIndex = laneLines.length;
    for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
      const row = grid[rowIndex]!;
      if (rowIndex === judgeRowIndex) {
        laneLines.push(
          renderJudgeRow(
            row,
            this.laneChannels,
            this.laneWidths,
            this.options.splitAfterIndex,
            this.options.noteHeight,
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
            this.options.noteHeight,
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
          this.options.noteHeight,
          laneHighlightRatios,
          gridSourceChannels[rowIndex],
        ),
      );
    }
    const playfieldIndicatorEndIndex = Math.max(playfieldIndicatorStartIndex, laneLines.length - 1);

    const judgeComboLabels = this.resolveJudgeComboLabels(now);
    laneLines.push(renderJudgeComboLine(judgeComboLabels, this.laneWidths, this.options.splitAfterIndex));

    const [blackKeyRow, whiteAndScratchKeyRow] = renderInputKeyRows(
      this.options.lanes,
      this.laneWidths,
      this.options.splitAfterIndex,
      activeInputKeyChannels,
      this.options.laneDisplayMode.startsWith('9 KEY'),
    );
    laneLines.push(blackKeyRow);
    laneLines.push(whiteAndScratchKeyRow);

    const laneLinesWithProgress = renderLaneLinesWithProgressIndicators(
      laneLines,
      frame.currentSeconds,
      frame.totalSeconds,
      playfieldIndicatorStartIndex,
      playfieldIndicatorEndIndex,
      hasLaneSplit(this.options.splitAfterIndex, this.laneWidths.length),
    );
    const laneBlockStartRow = lines.length + 1;
    let kittyBgaPlacement:
      | {
          row: number;
          column: number;
          image: BgaKittyImage;
        }
      | undefined;
    if (this.terminalImageProtocol === 'kitty' && frame.bgaKittyImage) {
      const renderedKittyBga = renderLaneBlockWithKittyPadding(laneLinesWithProgress, frame.bgaKittyImage.cellWidth);
      lines.push(...renderedKittyBga.lines);
      kittyBgaPlacement = {
        row: laneBlockStartRow,
        column: renderedKittyBga.column,
        image: frame.bgaKittyImage,
      };
    } else {
      lines.push(...renderLaneBlockWithBga(laneLinesWithProgress, frame.bgaAnsiLines));
    }
    lines.push('');
    lines.push(
      formatGrooveGaugeLine(
        frame.summary,
        calculateLaneBlockVisibleWidth(this.laneWidths, this.options.splitAfterIndex ?? -1),
        resolveGrooveGaugeLeftPadding(this.laneWidths.length),
      ),
    );
    lines.push('');
    lines.push(
      `Space: pause/resume  Shift+R: restart  ${HIGH_SPEED_MODIFIER_LABEL}+odd/even lane: HS -/+  Ctrl+C/Esc: quit`,
    );

    const columns = this.terminalColumns ?? process.stdout.columns ?? 120;
    const paddedLines = lines.map((line) => padVisibleWidth(line, columns));
    const renderedLineCount = Math.max(this.previousRenderedLines.length, paddedLines.length);
    if (renderedLineCount > paddedLines.length) {
      const diff = renderedLineCount - paddedLines.length;
      for (let index = 0; index < diff; index += 1) {
        paddedLines.push(' '.repeat(columns));
      }
    }
    const needsFullRefresh = this.needsFullRefresh;
    const needsFullFrameWrite = needsFullRefresh || this.previousRenderedLines.length === 0;
    let overlaySequence = '';
    if (kittyBgaPlacement) {
      const placementToken =
        `${kittyBgaPlacement.row}:${kittyBgaPlacement.column}:` +
        `${kittyBgaPlacement.image.cellWidth}:${kittyBgaPlacement.image.cellHeight}`;
      if (needsFullRefresh || !this.kittyBgaVisible || this.lastKittyBgaPlacementToken !== placementToken) {
        const activeImageId = KITTY_BGA_IMAGE_IDS[this.activeKittyBgaImageIndex]!;
        const inactiveImageId = KITTY_BGA_IMAGE_IDS[(this.activeKittyBgaImageIndex + 1) % KITTY_BGA_IMAGE_IDS.length]!;
        overlaySequence = buildKittyGraphicsRenderSequence({
          imageId: activeImageId,
          placementId: 1,
          row: kittyBgaPlacement.row,
          column: kittyBgaPlacement.column,
          image: kittyBgaPlacement.image,
          zIndex: -1,
          doNotMoveCursor: true,
        });
        overlaySequence += buildKittyGraphicsDeleteImageSequence(inactiveImageId);
        this.lastKittyBgaToken = kittyBgaPlacement.image.token;
        this.lastKittyBgaPlacementToken = placementToken;
        this.kittyBgaVisible = true;
      } else if (this.lastKittyBgaToken !== kittyBgaPlacement.image.token) {
        const nextImageIndex = (this.activeKittyBgaImageIndex + 1) % KITTY_BGA_IMAGE_IDS.length;
        const nextImageId = KITTY_BGA_IMAGE_IDS[nextImageIndex]!;
        const previousImageId = KITTY_BGA_IMAGE_IDS[this.activeKittyBgaImageIndex]!;
        overlaySequence = buildKittyGraphicsRenderSequence({
          imageId: nextImageId,
          placementId: 1,
          row: kittyBgaPlacement.row,
          column: kittyBgaPlacement.column,
          image: kittyBgaPlacement.image,
          zIndex: -1,
          doNotMoveCursor: true,
        });
        overlaySequence += buildKittyGraphicsDeleteImageSequence(previousImageId);
        this.lastKittyBgaToken = kittyBgaPlacement.image.token;
        this.activeKittyBgaImageIndex = nextImageIndex;
      }
    } else if (this.kittyBgaVisible) {
      overlaySequence = KITTY_BGA_IMAGE_IDS.map((imageId) => buildKittyGraphicsDeleteImageSequence(imageId)).join('');
      this.lastKittyBgaToken = '';
      this.lastKittyBgaPlacementToken = '';
      this.activeKittyBgaImageIndex = 0;
      this.kittyBgaVisible = false;
    }
    const frameSequence = this.buildFrameWriteSequence(paddedLines, {
      clearBeforeWrite: needsFullRefresh,
      writeFullFrame: needsFullFrameWrite,
    });
    const output = `${frameSequence}${overlaySequence}`;
    if (output.length > 0) {
      process.stdout.write(output);
    }
    this.previousRenderedLines = paddedLines;
    this.needsFullRefresh = false;
    this.lastRenderedBeat = scrollBeat;
  }

  private buildFrameWriteSequence(
    lines: string[],
    options: Readonly<{
      clearBeforeWrite: boolean;
      writeFullFrame: boolean;
    }>,
  ): string {
    if (options.writeFullFrame) {
      return `${options.clearBeforeWrite ? '\u001b[2J' : ''}\u001b[H${lines.join('\n')}`;
    }

    let output = '';
    const previousLines = this.previousRenderedLines;
    const lineCount = Math.max(previousLines.length, lines.length);
    for (let index = 0; index < lineCount; index += 1) {
      const nextLine = lines[index];
      if (nextLine === undefined || previousLines[index] === nextLine) {
        continue;
      }
      output += `\u001b[${index + 1};1H${nextLine}`;
    }
    return output;
  }

  private resolveNoteWindow(
    notes: TuiNote[],
    currentBeat: number,
    scrollWindowBeats: number,
    state: NoteWindowState,
    visibleNotesLimit: number,
  ): { start: number; end: number } {
    if (state.source !== notes || currentBeat < state.beat) {
      state.source = notes;
      state.startIndex = 0;
      state.endIndex = 0;
    }
    state.beat = currentBeat;

    let start = state.startIndex;
    while (start < notes.length && canDropNoteFromRenderWindow(notes[start], currentBeat, scrollWindowBeats)) {
      start += 1;
    }

    let end = Math.max(state.endIndex, start);
    if (this.scrollDistanceMapper.hasBidirectionalScrollWithinLookahead(currentBeat)) {
      // As beatoraja's LaneRenderer: the walk ends where the chart first runs past the top of the grid, so notes a later
      // negative #SCROLL brings back down stay hidden until the playhead gets there.
      const capBeat = Math.min(
        Math.max(0, currentBeat) + MAX_SCROLL_LOOKAHEAD_BEATS,
        this.scrollDistanceMapper.firstBeatBeyondDistance(currentBeat, scrollWindowBeats),
      );
      // That beat can move back as the playhead runs down a negative #SCROLL, so the window is walked afresh.
      end = start;
      while (end < notes.length && notes[end].beat <= capBeat && end - start < visibleNotesLimit) {
        end += 1;
      }
    } else {
      const maxBeat = this.scrollDistanceMapper.maxBeatWithinDistance(currentBeat, scrollWindowBeats);
      if (!Number.isFinite(maxBeat)) {
        end = notes.length;
      } else {
        while (end < notes.length && notes[end].beat <= maxBeat && end - start < visibleNotesLimit) {
          end += 1;
        }
      }
    }

    state.startIndex = start;
    state.endIndex = end;
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

  private resolveVisibleNotesLimit(): number {
    const configured = this.options.visibleNotesLimit;
    if (typeof configured !== 'number' || !Number.isFinite(configured) || configured <= 0) {
      return DEFAULT_VISIBLE_NOTES_LIMIT;
    }
    return Math.max(1, Math.floor(configured));
  }

  private resolveLandmineNotesLimit(rowCount: number, laneCount: number): number {
    const gridCapacity = Math.max(1, rowCount) * Math.max(1, laneCount);
    const gridBoundedLimit = gridCapacity * DEFAULT_LANDMINE_NOTES_PER_CELL;
    return Math.max(128, Math.min(this.resolveVisibleNotesLimit(), gridBoundedLimit));
  }

  private resolveInvisibleNotesLimit(rowCount: number, laneCount: number): number {
    const gridCapacity = Math.max(1, rowCount) * Math.max(1, laneCount);
    const gridBoundedLimit = gridCapacity * DEFAULT_INVISIBLE_NOTES_PER_CELL;
    return Math.max(128, Math.min(this.resolveVisibleNotesLimit(), gridBoundedLimit));
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

  private resolveFps(nowMs: number): number | undefined {
    if (this.lastFrameRenderedAtMs <= 0) {
      this.lastFrameRenderedAtMs = nowMs;
      return undefined;
    }

    const elapsedMs = nowMs - this.lastFrameRenderedAtMs;
    this.lastFrameRenderedAtMs = nowMs;
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      return Number.isFinite(this.smoothedFps) ? this.smoothedFps : undefined;
    }

    const instantFps = 1000 / elapsedMs;
    if (!Number.isFinite(this.smoothedFps)) {
      this.smoothedFps = instantFps;
      return this.smoothedFps;
    }

    this.smoothedFps += (instantFps - this.smoothedFps) * FPS_SMOOTHING_FACTOR;
    return this.smoothedFps;
  }

  private resolveRenderLaneChannel(channel: string): string {
    const normalized = channel.toUpperCase();
    return this.freeZoneChannelToScratchChannel.get(normalized) ?? normalized;
  }

  private resolveJudgeComboTargets(channel?: string): JudgeComboDisplayState[] {
    if (!hasLaneSplit(this.options.splitAfterIndex, this.laneWidths.length)) {
      return [this.leftJudgeComboDisplay];
    }
    if (typeof channel !== 'string' || channel.length === 0) {
      return [this.leftJudgeComboDisplay, this.rightJudgeComboDisplay];
    }
    return this.resolveLaneSide(channel) === '2P' ? [this.rightJudgeComboDisplay] : [this.leftJudgeComboDisplay];
  }

  private resolveJudgeComboLabels(nowMs: number): { single: string; left: string; right: string } {
    if (!hasLaneSplit(this.options.splitAfterIndex, this.laneWidths.length)) {
      const single = resolveVisibleJudgeComboLabel(this.leftJudgeComboDisplay, nowMs, this.paused);
      return { single, left: single, right: single };
    }
    return {
      single: '',
      left: resolveVisibleJudgeComboLabel(this.leftJudgeComboDisplay, nowMs, this.paused),
      right: resolveVisibleJudgeComboLabel(this.rightJudgeComboDisplay, nowMs, this.paused),
    };
  }

  private resolveLaneSide(channel: string): '1P' | '2P' {
    const splitAfterIndex = this.options.splitAfterIndex ?? -1;
    const laneIndex = this.laneIndex.get(this.resolveRenderLaneChannel(channel));
    if (typeof laneIndex !== 'number') {
      return inferLaneSideByChannel(channel);
    }
    return laneIndex <= splitAfterIndex ? '1P' : '2P';
  }
}

function renderProgress(currentSeconds: number, totalSeconds: number): string {
  const barLength = 28;
  const safeTotal = Math.max(1, totalSeconds);
  const ratio = clamp(currentSeconds / safeTotal, 0, 1);
  const filled = Math.round(barLength * ratio);
  return `[${'#'.repeat(filled)}${'-'.repeat(barLength - filled)}] ${Math.round(ratio * 100)}%`;
}

function isDistanceWithinWindow(distance: number, scrollWindowBeats: number): boolean {
  return Number.isFinite(distance) && distance >= -BEAT_EPSILON && distance <= scrollWindowBeats;
}

function normalizeNoteApproachDistance(distance: number, currentBeat: number, targetBeat: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(currentBeat) || !Number.isFinite(targetBeat)) {
    return Number.NaN;
  }
  if (targetBeat + BEAT_EPSILON < currentBeat) {
    return Number.NaN;
  }
  const approachDistance = Math.abs(distance);
  if (approachDistance <= BEAT_EPSILON) {
    return 0;
  }
  return approachDistance;
}

function isUpcomingBeat(currentBeat: number, targetBeat: number): boolean {
  if (!Number.isFinite(currentBeat) || !Number.isFinite(targetBeat)) {
    return false;
  }
  return targetBeat + BEAT_EPSILON >= currentBeat;
}

function distanceToRow(distance: number, rowCount: number, scrollWindowBeats: number): number {
  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  const normalized = clamp(safeDistance / scrollWindowBeats, 0, 1);
  return rowCount - 1 - Math.floor(normalized * (rowCount - 1));
}

function distanceToNoteRow(
  distance: number,
  rowCount: number,
  scrollWindowBeats: number,
  previousRow?: number,
): number {
  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  const rowSpan = Math.max(1, rowCount - 1);
  const rowStepDistance = scrollWindowBeats / rowSpan;
  if (safeDistance <= Math.max(BEAT_EPSILON, rowStepDistance * 0.5)) {
    return rowCount - 1;
  }
  const shiftedDistance = Math.min(scrollWindowBeats, safeDistance + rowStepDistance);
  const nextRow = distanceToRow(shiftedDistance, rowCount, scrollWindowBeats);
  if (typeof previousRow !== 'number' || !Number.isFinite(previousRow)) {
    return nextRow;
  }

  const clampedPreviousRow = clamp(Math.floor(previousRow), 0, rowCount - 1);
  const normalizedProgressFromJudgeLine = clamp(shiftedDistance / scrollWindowBeats, 0, 1);
  const progressFromTop = normalizedProgressFromJudgeLine * rowSpan;
  const previousCellFromTop = rowSpan - clampedPreviousRow;
  const minToAdvance = previousCellFromTop - NOTE_ROW_HYSTERESIS_CELLS;
  const maxToRewind = previousCellFromTop + 1 + NOTE_ROW_HYSTERESIS_CELLS;
  if (progressFromTop >= minToAdvance && progressFromTop < maxToRewind) {
    return clampedPreviousRow;
  }
  return nextRow;
}

function createJudgeComboDisplayState(): JudgeComboDisplayState {
  return {
    latestJudge: '-',
    combo: 0,
    updatedAtMs: 0,
  };
}

function resetJudgeComboDisplayState(state: JudgeComboDisplayState): void {
  state.latestJudge = '-';
  state.combo = 0;
  state.updatedAtMs = 0;
}

function resolveVisibleJudgeComboLabel(state: JudgeComboDisplayState, nowMs: number, paused: boolean): string {
  if (paused) {
    return formatJudgeComboDisplay(state.latestJudge, state.combo, nowMs, true);
  }
  if (state.updatedAtMs <= 0 || nowMs - state.updatedAtMs > JUDGE_COMBO_VISIBILITY_TIMEOUT_MS) {
    return '';
  }
  return formatJudgeComboDisplay(state.latestJudge, state.combo, nowMs, false);
}

export function formatJudgeComboDisplay(latestJudge: string, combo: number, nowMs: number, paused: boolean): string {
  if (paused) {
    return colorizeText('PAUSE', PAUSE_FOREGROUND_RGB, PAUSE_BACKGROUND_RGB);
  }
  const normalizedJudge = latestJudge === 'PERFECT' ? 'GREAT' : latestJudge;
  // LR2 convention: the judge plate pairs with the combo readout for clean hits (PERFECT / GREAT / GOOD)
  // but reads as a bare verdict for misses (BAD / POOR). The previous code appended the combo unconditionally,
  // which made `POOR 5` appear after an EMPTY POOR (kara-poor — phantom press) — the engine preserves combo on
  // empty POOR per beatoraja behavior, so the combo argument is non-zero there even though no note was hit.
  const showCombo = latestJudge !== 'BAD' && latestJudge !== 'POOR';
  const safeCombo = Math.max(0, Math.floor(combo));
  const baseText = `${normalizedJudge}${showCombo && safeCombo > 0 ? ` ${safeCombo}` : ''}`;

  if (latestJudge === 'PERFECT') {
    return colorizeBlinkingRainbow(baseText, nowMs);
  }
  if (latestJudge === 'GREAT') {
    return colorizeBlinkingText(baseText, GREAT_JUDGE_RGB, dimRgb(GREAT_JUDGE_RGB, 0.5), nowMs);
  }
  if (latestJudge === 'GOOD') {
    return colorizeBlinkingText(baseText, GOOD_JUDGE_RGB, dimRgb(GOOD_JUDGE_RGB, 0.5), nowMs);
  }
  if (latestJudge === 'BAD') {
    return colorizeBlinkingText(baseText, BAD_JUDGE_RGB, dimRgb(BAD_JUDGE_RGB, 0.5), nowMs);
  }
  if (latestJudge === 'POOR') {
    return colorizeBlinkingText(baseText, POOR_JUDGE_RGB, dimRgb(POOR_JUDGE_RGB, 0.5), nowMs);
  }
  if (latestJudge === 'READY') {
    return colorizeText(baseText, READY_JUDGE_RGB);
  }
  if (latestJudge === '-') {
    return colorizeText(baseText, IDLE_JUDGE_RGB);
  }
  return baseText;
}

function colorizeBlinkingText(value: string, onColor: RgbColor, offColor: RgbColor, nowMs: number): string {
  // ANSI blink is not consistently supported, so emulate blink with a time-based pulse.
  const blinkOn = Math.floor(nowMs / JUDGE_COMBO_BLINK_INTERVAL_MS) % 2 === 0;
  return colorizeText(value, blinkOn ? onColor : offColor);
}

function colorizeBlinkingRainbow(value: string, nowMs: number): string {
  const blinkOn = Math.floor(nowMs / JUDGE_COMBO_BLINK_INTERVAL_MS) % 2 === 0;
  return colorizeRainbow(value, blinkOn);
}

function colorizeRainbow(value: string, bright = true): string {
  const brightness = bright ? 1 : 0.5;
  const characters = Array.from(value);
  return characters
    .map((character, index) =>
      colorizeText(character, dimRgb(RAINBOW_RGB_STEPS[index % RAINBOW_RGB_STEPS.length]!, brightness)),
    )
    .join('');
}

function renderLaneBlockWithBga(laneLines: string[], bgaAnsiLines?: string[]): string[] {
  if (!bgaAnsiLines || bgaAnsiLines.length === 0) {
    return laneLines;
  }

  const bgaWidth = Math.max(1, ...bgaAnsiLines.map((line) => visibleWidth(line)));
  const normalizedBgaLines = fitLinesToHeight(bgaAnsiLines, laneLines.length, bgaWidth).map((line) =>
    renderBgaLineWithScopedBlackBackground(line, bgaWidth),
  );
  const emptyBgaLine = renderBgaLineWithScopedBlackBackground(' '.repeat(bgaWidth), bgaWidth);
  return laneLines.map((laneLine, index) => `${laneLine}   ${normalizedBgaLines[index] ?? emptyBgaLine}`);
}

function renderLaneBlockWithKittyPadding(
  laneLines: string[],
  bgaWidth: number,
): {
  lines: string[];
  column: number;
} {
  const safeBgaWidth = Math.max(1, Math.floor(bgaWidth));
  const laneBlockWidth = calculateRenderedLineBlockWidth(laneLines);
  const emptyBgaLine = renderBgaLineWithScopedBlackBackground(' '.repeat(safeBgaWidth), safeBgaWidth);
  return {
    lines: laneLines.map((laneLine) => `${padVisibleWidth(laneLine, laneBlockWidth)}   ${emptyBgaLine}`),
    column: laneBlockWidth + 4,
  };
}

function calculateRenderedLineBlockWidth(lines: string[]): number {
  return Math.max(1, ...lines.map((line) => visibleWidth(line)));
}

function resolveGrooveGaugeLeftPadding(laneCount: number): number {
  if (laneCount <= 0) {
    return 0;
  }
  return PLAY_PROGRESS_INDICATOR_SIDE_WIDTH;
}

function renderLaneLinesWithProgressIndicators(
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
  const color = blendRgb(PLAY_PROGRESS_GROOVE_RGB, PLAY_PROGRESS_HEAD_RGB, glow);
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

function normalizeTerminalDimension(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function renderBgaLineWithScopedBlackBackground(line: string, width: number): string {
  const padded = padVisibleWidth(line, width);
  const backgrounds = decodeBackgroundColorsPerColumn(padded, width);
  return composeBackgroundRow(backgrounds, 0, backgrounds.length);
}

function decodeBackgroundColorsPerColumn(value: string, width: number): Array<RgbColor | undefined> {
  const safeWidth = Math.max(1, Math.floor(width));
  const colors: Array<RgbColor | undefined> = Array.from({ length: safeWidth }, () => undefined);
  let index = 0;
  let column = 0;
  let activeBackground: RgbColor | undefined;

  while (index < value.length && column < safeWidth) {
    if (value.charCodeAt(index) === 0x1b && index + 1 < value.length && value[index + 1] === '[') {
      const sequenceEnd = findAnsiSgrSequenceEnd(value, index + 2);
      if (sequenceEnd < 0) {
        index += 1;
        continue;
      }
      const params = parseAnsiSgrParams(value, index + 2, sequenceEnd);
      activeBackground = resolveAnsiBackgroundColor(params, activeBackground);
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

function parseAnsiSgrParams(value: string, start: number, end: number): number[] {
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

function resolveAnsiBackgroundColor(params: number[], current: RgbColor | undefined): RgbColor | undefined {
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
  backgrounds: Array<RgbColor | undefined>,
  blackStartColumn: number,
  blackEndColumn: number,
): string {
  let output = '';
  let activeBackground: RgbColor | undefined;
  const start = Math.max(0, Math.floor(blackStartColumn));
  const end = Math.max(start, Math.floor(blackEndColumn));

  for (let column = 0; column < backgrounds.length; column += 1) {
    const color = backgrounds[column];
    const nextBackground = color ?? (column >= start && column < end ? BLACK_RGB : undefined);
    if (!isSameRgb(activeBackground, nextBackground)) {
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

function inferLaneSideByChannel(channel: string): '1P' | '2P' {
  const normalized = channel.toUpperCase();
  if (normalized.startsWith('2')) {
    return '2P';
  }
  return '1P';
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

function formatPlayLevelLabel(value: BeMusicPlayLevel | undefined): string {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : '-';
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '-';
  }
  if (value === 0) {
    return '?';
  }
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}

function formatNotesProgress(summary: PlayerSummary): string {
  const total = Math.max(0, summary.total);
  const judged = Math.max(0, summary.perfect + summary.great + summary.good + summary.bad + summary.poor);
  return `${Math.min(total, judged)}/${total}`;
}

function formatGrooveGaugeLine(summary: PlayerSummary, laneBlockWidth: number, leftPadding = 0): string {
  const gauge = summary.gauge;
  if (!gauge) {
    return '-';
  }
  const percentLabel = `${formatGrooveGaugePercent(gauge.current)}%`;
  const safeLaneBlockWidth = Math.max(3, Math.floor(laneBlockWidth));
  const barWidth = Math.max(1, safeLaneBlockWidth - 2);
  const safeLeftPadding = Math.max(0, Math.floor(leftPadding));
  return `${' '.repeat(safeLeftPadding)}${colorizeLaneOuterBorder('┃')}${renderGrooveGaugeBar(gauge.current, gauge.clearThreshold, gauge.max, barWidth)}${colorizeLaneOuterBorder('┃')} ${percentLabel}`;
}

function renderGrooveGaugeBar(current: number, clearThreshold: number, max: number, width: number): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const ratio = clamp(current / safeMax, 0, 1);
  const clearRatio = clamp(clearThreshold / safeMax, 0, 1);
  const filled = Math.round(safeWidth * ratio);
  const clearIndex = Math.round(safeWidth * clearRatio);
  let output = '';
  for (let index = 0; index < safeWidth; index += 1) {
    const inClearZone = index >= clearIndex;
    const filledCell = index < filled;
    const color = inClearZone
      ? filledCell
        ? GROOVE_GAUGE_CLEAR_RGB
        : GROOVE_GAUGE_CLEAR_EMPTY_RGB
      : filledCell
        ? GROOVE_GAUGE_SAFE_RGB
        : GROOVE_GAUGE_SAFE_EMPTY_RGB;
    output += colorizeText(filledCell ? '█' : '░', color);
  }
  return output;
}

function formatGrooveGaugePercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return String(Math.max(0, Math.floor(value)));
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

function formatGenreLabel(value: string | undefined): string {
  if (typeof value !== 'string') {
    return '-';
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : '-';
}

function formatFps(fps: number | undefined): string {
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
    return '-';
  }
  return fps >= 100 ? fps.toFixed(0) : fps.toFixed(1);
}
