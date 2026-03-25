import { effect, effectScope } from 'alien-signals';
import type { BeMusicPlayLevel } from '@be-music/json';
import { clamp } from '@be-music/utils';
import type { BgaKittyImage } from '../bga.ts';
import type { PlayerSummary } from '../index.ts';
import { formatSeconds, resolveAltModifierLabel } from '../utils.ts';
import type { PlayerStateSignals } from '../state-signals.ts';
import {
  buildKittyGraphicsDeleteImageSequence,
  buildKittyGraphicsRenderSequence,
} from './kitty-graphics.ts';
import { findStackableRowIndex } from './lane-stacking.ts';
import { normalizeHighSpeed, resolveAnimatedHighSpeedValue, resolveVisibleBeatsForTuiGrid } from './high-speed.ts';
import {
  calculateLaneBlockVisibleWidth,
  calculateLaneSectionVisibleWidth,
  calculateTuiGridRowCount,
  DEFAULT_LANE_WIDTH,
  PLAY_PROGRESS_INDICATOR_SIDE_WIDTH,
  resolveLaneWidths,
  SPLIT_PANEL_INNER_WIDTH,
} from './layout.ts';
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
  genre?: string;
  player?: number;
  rank?: number;
  rankLabel?: string;
  playLevel?: BeMusicPlayLevel;
  lanes: TuiLane[];
  speed: number;
  highSpeed: number;
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
  totalSeconds: number;
  summary: PlayerSummary;
  notes: TuiNote[];
  audioBackend?: string;
  activeAudioFiles?: string[];
  activeAudioVoiceCount?: number;
  bgaAnsiLines?: string[];
  bgaKittyImage?: BgaKittyImage;
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

interface SpeedTimelinePoint {
  beat: number;
  speed: number;
}

interface StopWindowPoint {
  startSeconds: number;
  endSeconds: number;
}

interface ScrollSegment {
  startBeat: number;
  scrollSpeed: number;
  speedStart: number;
  speedSlope: number;
  startDistance: number;
}

const IIDX_MEASURE_BEATS = 4;
const MAX_SCROLL_LOOKAHEAD_BEATS = IIDX_MEASURE_BEATS * 64;
const MAX_NOTES_PER_RENDER_WINDOW = 2048;
const BEAT_EPSILON = 1e-9;
const FLASH_DURATION_MS = 180;
const MEASURE_LINE_SYMBOL = '▔';
const MEASURE_LINE_DIVIDER_SYMBOL = '┬';
const LANE_FILL_SYMBOL = '│';
const LANE_DIVIDER_SYMBOL = '│';
const LANE_OUTER_BORDER_SYMBOL = '┃';
const JUDGE_LINE_SYMBOL = '█';
const HIGHLIGHT_DECAY_POWER = 0.72;
const HIGHLIGHT_R_BOOST = 56;
const HIGHLIGHT_G_BOOST = 62;
const HIGHLIGHT_B_BOOST = 74;
const NOTE_ROW_HYSTERESIS_CELLS = 0.18;
const RED_NOTE_CHANNELS = new Set(['16', '26']);
const WHITE_NOTE_CHANNELS = new Set(['11', '13', '15', '19', '21', '23', '25', '29']);
const BLUE_NOTE_CHANNELS = new Set(['12', '14', '17', '18', '22', '24', '27', '28']);
const SCRATCH_LANE_CHANNELS = new Set(['16', '26']);
const NOTE_HEAD_SYMBOL = '●';
const LONG_NOTE_BODY_SYMBOL = '■';
const LONG_NOTE_TAIL_SYMBOL = '◆';
const MINE_NOTE_SYMBOL = '✕';
const INVISIBLE_NOTE_HEAD_SYMBOL = '◯';
const INVISIBLE_LONG_NOTE_BODY_SYMBOL = '□';
const INVISIBLE_LONG_NOTE_TAIL_SYMBOL = '◇';
const ANSI_RESET = '\u001b[0m';
const KITTY_BGA_IMAGE_IDS = [1_337, 1_338] as const;
const SCORE_COUNTUP_MIN_PER_SEC = 4000;
const SCORE_COUNTUP_DISTANCE_FACTOR = 6;
const HIGH_SPEED_TRANSITION_MS = 180;
const JUDGE_COMBO_VISIBILITY_TIMEOUT_MS = 1000;
const JUDGE_COMBO_BLINK_INTERVAL_MS = 80;
const FPS_SMOOTHING_FACTOR = 0.2;
const MEASURE_SIGNATURE_MAX_DENOMINATOR = 32;
const HIGH_SPEED_MODIFIER_LABEL = resolveAltModifierLabel();
const MEASURE_SIGNATURE_TOLERANCE = 1e-8;

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface JudgeComboDisplayState {
  latestJudge: string;
  combo: number;
  updatedAtMs: number;
}

const BLACK_RGB: RgbColor = { r: 0, g: 0, b: 0 };
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

  private noteWindowSource?: TuiNote[];

  private noteWindowStartIndex = 0;

  private noteWindowEndIndex = 0;

  private noteWindowBeat = Number.NEGATIVE_INFINITY;

  private visibleNoteIndices = new Set<number>();

  private visibleNoteRows = new Map<number, number>();

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
    this.options = options;
    this.stateSignals = options.stateSignals;
    this.displayedHighSpeed = initialHighSpeed;
    this.targetHighSpeed = initialHighSpeed;
    this.highSpeedTransitionFrom = initialHighSpeed;
    this.laneChannels = options.lanes.map((lane) => lane.channel);
    this.scrollDistanceMapper = new ScrollDistanceMapper(options.scrollTimeline, options.speedTimeline);
    this.supported = Boolean(
      (options.stdoutIsTTY ?? process.stdout.isTTY) && (options.stdinIsTTY ?? process.stdin.isTTY),
    );
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
    process.stdout.write('\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l');
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
    this.noteWindowSource = undefined;
    this.noteWindowStartIndex = 0;
    this.noteWindowEndIndex = 0;
    this.noteWindowBeat = Number.NEGATIVE_INFINITY;
    this.visibleNoteIndices.clear();
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
    process.stdout.write(`${clearKittyBga}\u001b[0m\u001b[?25h\u001b[?1049l`);
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
    const visibleNoteRows = new Map<number, number>();

    for (let noteIndex = noteStartIndex; noteIndex < noteEndIndex; noteIndex += 1) {
      const note = frame.notes[noteIndex];
      const previousRow = this.visibleNoteRows.get(noteIndex);
      let visibleThisFrame = false;
      const keepVisible =
        typeof note.visibleUntilBeat === 'number' &&
        Number.isFinite(note.visibleUntilBeat) &&
        note.visibleUntilBeat > frame.currentBeat;
      const crossedJudgeLineSinceLastFrame =
        note.judged &&
        Number.isFinite(this.lastRenderedBeat) &&
        note.beat + BEAT_EPSILON >= this.lastRenderedBeat &&
        note.beat <= frame.currentBeat + BEAT_EPSILON;
      const keepJudgedUntilJudgeLine =
        note.judged &&
        !keepVisible &&
        Number.isFinite(note.beat) &&
        (note.beat + BEAT_EPSILON >= frame.currentBeat || crossedJudgeLineSinceLastFrame);
      if (note.judged && !keepVisible && !keepJudgedUntilJudgeLine) {
        continue;
      }
      const lane = this.laneIndex.get(this.resolveRenderLaneChannel(note.channel));
      if (lane === undefined) {
        continue;
      }

      if (note.mine) {
        const distance = this.scrollDistanceMapper.distanceBetween(frame.currentBeat, note.beat);
        const visibleDistance = normalizeNoteApproachDistance(distance, frame.currentBeat, note.beat);
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
        visibleNoteIndices.add(noteIndex);
        visibleNoteRows.set(noteIndex, placedRow);
        continue;
      }

      if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
        const longBodySymbol = note.invisible ? INVISIBLE_LONG_NOTE_BODY_SYMBOL : LONG_NOTE_BODY_SYMBOL;
        const longTailSymbol = note.invisible ? INVISIBLE_LONG_NOTE_TAIL_SYMBOL : LONG_NOTE_TAIL_SYMBOL;
        const bodyStartBeat = Math.max(note.beat, frame.currentBeat);
        const bodyEndBeat = note.endBeat;
        const bodyStartDistance = this.scrollDistanceMapper.distanceBetween(frame.currentBeat, bodyStartBeat);
        const bodyEndDistance = this.scrollDistanceMapper.distanceBetween(frame.currentBeat, bodyEndBeat);
        const normalizedBodyStart = normalizeNoteApproachDistance(bodyStartDistance, frame.currentBeat, bodyStartBeat);
        const normalizedBodyEnd = normalizeNoteApproachDistance(bodyEndDistance, frame.currentBeat, bodyEndBeat);
        const hasBodyStart = Number.isFinite(normalizedBodyStart);
        const hasBodyEnd = Number.isFinite(normalizedBodyEnd);

        if (hasBodyStart || hasBodyEnd) {
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
            setLaneCell(grid, gridSourceChannels, row, lane, longBodySymbol, note.channel, this.freeZoneSourceChannels);
          }
          visibleThisFrame = true;
        }

        const tailDistance = this.scrollDistanceMapper.distanceBetween(frame.currentBeat, note.endBeat);
        const tailVisibleDistance = normalizeNoteApproachDistance(tailDistance, frame.currentBeat, note.endBeat);
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
      const row = distanceToNoteRow(headVisibleDistance, rowCount, scrollWindowBeats, previousRow);
      const placedRow = setLaneCell(
        grid,
        gridSourceChannels,
        row,
        lane,
        note.invisible ? INVISIBLE_NOTE_HEAD_SYMBOL : NOTE_HEAD_SYMBOL,
        note.channel,
        this.freeZoneSourceChannels,
        true,
      );
      visibleThisFrame = true;
      visibleNoteIndices.add(noteIndex);
      visibleNoteRows.set(noteIndex, placedRow);
    }
    this.visibleNoteIndices = visibleNoteIndices;
    this.visibleNoteRows = visibleNoteRows;

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
    const currentBpm = findCurrentBpm(this.options.bpmTimeline, frame.currentSeconds);
    const currentScroll = findCurrentScroll(this.options.scrollTimeline, frame.currentBeat);
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
    this.lastRenderedBeat = frame.currentBeat;
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
  ): { start: number; end: number } {
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

class ScrollDistanceMapper {
  private readonly segments: ScrollSegment[];

  constructor(
    scrollTimeline?: ReadonlyArray<ScrollTimelinePoint>,
    speedTimeline?: ReadonlyArray<SpeedTimelinePoint>,
  ) {
    this.segments = buildScrollSegments(scrollTimeline, speedTimeline);
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

      const traversableDistance = integratedAbsoluteSegmentDistance(segment, beat, segmentEndBeat);
      if (traversableDistance <= 1e-9) {
        beat = segmentEndBeat;
        index += 1;
        continue;
      }
      if (traversableDistance >= remainingDistance) {
        return Math.min(capBeat, beat + solveBeatDeltaWithinSegment(segment, beat, remainingDistance));
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
    return segment.startDistance + integratedSignedSegmentDistance(segment, segment.startBeat, safeBeat);
  }
}

function buildScrollSegments(
  scrollTimeline?: ReadonlyArray<ScrollTimelinePoint>,
  speedTimeline?: ReadonlyArray<SpeedTimelinePoint>,
): ScrollSegment[] {
  const scrollPoints = normalizeScrollPoints(scrollTimeline);
  const speedPoints = normalizeSpeedPoints(speedTimeline);
  const breakpoints = [...new Set([...scrollPoints.map((point) => point.beat), ...speedPoints.map((point) => point.beat)])]
    .filter((beat) => Number.isFinite(beat) && beat >= 0)
    .sort((left, right) => left - right);
  if (breakpoints.length === 0 || breakpoints[0] !== 0) {
    breakpoints.unshift(0);
  }

  const segments: ScrollSegment[] = [];
  let distance = 0;
  for (let index = 0; index < breakpoints.length; index += 1) {
    const startBeat = breakpoints[index]!;
    const endBeat = breakpoints[index + 1];
    const scrollSpeed = resolveScrollSpeedAtBeat(scrollPoints, startBeat);
    const speedStart = resolveInterpolatedSpeedAtBeat(speedPoints, startBeat);
    const speedEnd =
      typeof endBeat === 'number' ? resolveInterpolatedSpeedAtBeat(speedPoints, endBeat) : speedStart;
    const speedSlope =
      typeof endBeat === 'number' && endBeat > startBeat ? (speedEnd - speedStart) / (endBeat - startBeat) : 0;
    segments.push({
      startBeat,
      scrollSpeed,
      speedStart,
      speedSlope,
      startDistance: distance,
    });
    if (typeof endBeat === 'number') {
      distance += integratedSignedSegmentDistance(
        {
          startBeat,
          scrollSpeed,
          speedStart,
          speedSlope,
          startDistance: distance,
        },
        startBeat,
        endBeat,
      );
    }
  }
  return segments.length > 0
    ? segments
    : [{ startBeat: 0, scrollSpeed: 1, speedStart: 1, speedSlope: 0, startDistance: 0 }];
}

function normalizeScrollPoints(timeline?: ReadonlyArray<ScrollTimelinePoint>): ScrollTimelinePoint[] {
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
  return merged;
}

function normalizeSpeedPoints(timeline?: ReadonlyArray<SpeedTimelinePoint>): SpeedTimelinePoint[] {
  const points: SpeedTimelinePoint[] = [{ beat: 0, speed: 1 }];
  for (const point of timeline ?? []) {
    if (!Number.isFinite(point.beat) || !Number.isFinite(point.speed) || point.beat < 0 || point.speed < 0) {
      continue;
    }
    points.push({
      beat: point.beat,
      speed: point.speed,
    });
  }
  points.sort((left, right) => left.beat - right.beat);

  const merged: SpeedTimelinePoint[] = [];
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
    merged.push({ ...point });
  }
  return merged;
}

function resolveScrollSpeedAtBeat(points: ReadonlyArray<ScrollTimelinePoint>, beat: number): number {
  const index = findLastTimelineIndexAtOrBefore(points, beat);
  return points[Math.max(0, index)]?.speed ?? 1;
}

function resolveInterpolatedSpeedAtBeat(points: ReadonlyArray<SpeedTimelinePoint>, beat: number): number {
  const index = findLastTimelineIndexAtOrBefore(points, beat);
  const current = points[Math.max(0, index)] ?? { beat: 0, speed: 1 };
  const next = points[index + 1];
  if (!next || beat <= current.beat || Math.abs(next.beat - current.beat) < 1e-9) {
    return current.speed;
  }
  const ratio = clamp((beat - current.beat) / (next.beat - current.beat), 0, 1);
  return current.speed + (next.speed - current.speed) * ratio;
}

function integratedSignedSegmentDistance(segment: ScrollSegment, fromBeat: number, toBeat: number): number {
  const delta = Math.max(0, toBeat - fromBeat);
  if (delta <= 0) {
    return 0;
  }
  const offset = Math.max(0, fromBeat - segment.startBeat);
  const startSpeed = segment.speedStart + segment.speedSlope * offset;
  return segment.scrollSpeed * (startSpeed * delta + 0.5 * segment.speedSlope * delta * delta);
}

function integratedAbsoluteSegmentDistance(segment: ScrollSegment, fromBeat: number, toBeat: number): number {
  const delta = Math.max(0, toBeat - fromBeat);
  if (delta <= 0) {
    return 0;
  }
  const offset = Math.max(0, fromBeat - segment.startBeat);
  const startSpeed = segment.speedStart + segment.speedSlope * offset;
  return Math.abs(segment.scrollSpeed) * (startSpeed * delta + 0.5 * segment.speedSlope * delta * delta);
}

function solveBeatDeltaWithinSegment(segment: ScrollSegment, fromBeat: number, distance: number): number {
  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  if (safeDistance <= 0) {
    return 0;
  }

  const offset = Math.max(0, fromBeat - segment.startBeat);
  const baseSpeed = segment.speedStart + segment.speedSlope * offset;
  const absScroll = Math.abs(segment.scrollSpeed);
  if (absScroll <= 1e-9) {
    return 0;
  }
  const linear = absScroll * baseSpeed;
  const quadratic = 0.5 * absScroll * segment.speedSlope;
  if (Math.abs(quadratic) <= 1e-9) {
    return linear <= 1e-9 ? 0 : safeDistance / linear;
  }
  const discriminant = linear * linear + 4 * quadratic * safeDistance;
  if (discriminant <= 0) {
    return 0;
  }
  return Math.max(0, (-linear + Math.sqrt(discriminant)) / (2 * quadratic));
}

function findLastTimelineIndexAtOrBefore<T extends { beat: number }>(points: ReadonlyArray<T>, beat: number): number {
  let low = 0;
  let high = points.length - 1;
  let index = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = points[mid]!;
    if (candidate.beat <= beat) {
      index = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }
  return index;
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

function renderLaneRow(
  values: string[],
  channels: string[],
  laneWidths: number[],
  splitAfterIndex = -1,
  laneHighlightRatios = new Map<number, number>(),
  sourceChannels?: string[],
  applyLaneBackground = true,
): string {
  const cells = values.map((value, index) => {
    const laneWidth = laneWidths[index] ?? DEFAULT_LANE_WIDTH;
    const laneChannel = resolveLaneRenderChannel(index, channels, sourceChannels);
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

function renderInputKeyRows(
  lanes: ReadonlyArray<TuiLane>,
  laneWidths: number[],
  splitAfterIndex = -1,
  activeChannels = new Set<string>(),
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

function renderJudgeComboLine(
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
      const channel = resolveLaneRenderChannel(index, channels, sourceChannels);
      let cell = renderMeasureLaneCell(values[index] ?? LANE_FILL_SYMBOL, laneWidth, channel);
      const highlightRatio = laneHighlightRatios.get(index);
      if (highlightRatio !== undefined) {
        cell = highlightCell(cell, channel, highlightRatio);
      } else {
        cell = colorizeLaneBackground(cell, channel);
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
  const divider = colorizeMeasureLine(MEASURE_LINE_DIVIDER_SYMBOL);
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
      const channel = resolveLaneRenderChannel(index, channels, sourceChannels);
      let cell = renderJudgeLaneCell(values[index] ?? LANE_FILL_SYMBOL, laneWidth, channel);
      const highlightRatio = laneHighlightRatios.get(index);
      if (highlightRatio !== undefined) {
        cell = highlightCell(cell, channel, highlightRatio);
      } else {
        cell = colorizeLaneBackground(cell, channel);
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
    symbol === LONG_NOTE_TAIL_SYMBOL ||
    symbol === INVISIBLE_NOTE_HEAD_SYMBOL ||
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
  if (symbol === MINE_NOTE_SYMBOL) {
    return 5;
  }
  if (
    symbol === NOTE_HEAD_SYMBOL ||
    symbol === LONG_NOTE_TAIL_SYMBOL ||
    symbol === INVISIBLE_NOTE_HEAD_SYMBOL ||
    symbol === INVISIBLE_LONG_NOTE_TAIL_SYMBOL
  ) {
    return isFreeZoneSourceChannel ? 3 : 4;
  }
  if (symbol === LONG_NOTE_BODY_SYMBOL || symbol === INVISIBLE_LONG_NOTE_BODY_SYMBOL) {
    return isFreeZoneSourceChannel ? 2 : 3;
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

function colorizeLaneOuterBorder(symbol: string): string {
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

function formatJudgeComboDisplay(latestJudge: string, combo: number, nowMs: number, paused: boolean): string {
  if (paused) {
    return colorizeText('PAUSE', PAUSE_FOREGROUND_RGB, PAUSE_BACKGROUND_RGB);
  }
  const normalizedJudge = latestJudge === 'PERFECT' ? 'GREAT' : latestJudge;
  const safeCombo = Math.max(0, Math.floor(combo));
  const baseText = `${normalizedJudge}${safeCombo > 0 ? ` ${safeCombo}` : ''}`;

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

function colorizeText(value: string, foreground: RgbColor, background?: RgbColor, underline = false): string {
  const sgr = [`38;2;${foreground.r};${foreground.g};${foreground.b}`];
  if (background) {
    sgr.push(`48;2;${background.r};${background.g};${background.b}`);
  }
  if (underline) {
    sgr.push('4');
  }
  return `\u001b[${sgr.join(';')}m${value}${ANSI_RESET}`;
}

function colorizeRainbow(value: string, bright = true): string {
  const brightness = bright ? 1 : 0.5;
  const characters = [...value];
  return characters
    .map((character, index) =>
      colorizeText(character, dimRgb(RAINBOW_RGB_STEPS[index % RAINBOW_RGB_STEPS.length]!, brightness)),
    )
    .join('');
}

function dimRgb(color: RgbColor, factor: number): RgbColor {
  const safeFactor = clamp(factor, 0, 1);
  return {
    r: clampColorByte(color.r * safeFactor),
    g: clampColorByte(color.g * safeFactor),
    b: clampColorByte(color.b * safeFactor),
  };
}

function blendRgb(from: RgbColor, to: RgbColor, ratio: number): RgbColor {
  const safeRatio = clamp(ratio, 0, 1);
  return {
    r: clampColorByte(from.r + (to.r - from.r) * safeRatio),
    g: clampColorByte(from.g + (to.g - from.g) * safeRatio),
    b: clampColorByte(from.b + (to.b - from.b) * safeRatio),
  };
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
  const markerPosition = resolveProgressIndicatorMarkerPosition(startRowIndex, endRowIndex, currentSeconds, totalSeconds);
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

function padVisibleWidth(line: string, width: number): string {
  const clipped = truncateVisibleWidth(line, width);
  const currentWidth = visibleWidth(clipped);
  if (currentWidth >= width) {
    return clipped;
  }
  return `${clipped}${' '.repeat(width - currentWidth)}`;
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

function clampColorByte(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return clamp(Math.floor(value), 0, 255);
}

function isSameRgb(left: RgbColor | undefined, right: RgbColor | undefined): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.r === right.r && left.g === right.g && left.b === right.b;
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

  while (index < value.length) {
    if (value.charCodeAt(index) === 0x1b && index + 1 < value.length && value[index + 1] === '[') {
      const sequenceEnd = findAnsiSgrSequenceEnd(value, index + 2);
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

function hasLaneSplit(splitAfterIndex: number | undefined, laneCount: number): boolean {
  const safeSplit = Number.isInteger(splitAfterIndex) ? (splitAfterIndex as number) : -1;
  return safeSplit >= 0 && safeSplit < laneCount - 1;
}

function inferLaneSideByChannel(channel: string): '1P' | '2P' {
  const normalized = channel.toUpperCase();
  if (normalized.startsWith('2')) {
    return '2P';
  }
  return '1P';
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
      ? (filledCell ? GROOVE_GAUGE_CLEAR_RGB : GROOVE_GAUGE_CLEAR_EMPTY_RGB)
      : (filledCell ? GROOVE_GAUGE_SAFE_RGB : GROOVE_GAUGE_SAFE_EMPTY_RGB);
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
  const fraction = approximateFraction(quarterBeats, MEASURE_SIGNATURE_MAX_DENOMINATOR, MEASURE_SIGNATURE_TOLERANCE);
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
