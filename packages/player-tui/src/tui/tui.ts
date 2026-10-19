import { effect, effectScope } from 'alien-signals';
import type { BeMusicPlayLevel } from '@be-music/json';
import { clamp } from '@be-music/utils/core';
import type { BGAKittyImage } from '../bga.ts';
import type { PlayerSummary } from '@be-music/player';
import {
  DEFAULT_TUI_NOTE_HEIGHT,
  formatSeconds,
  resolveAltModifierLabel,
  ScrollDistanceMapper,
  type TUINoteHeight,
} from '@be-music/player/display';
import type { PlayerStateSignals } from '@be-music/player/signals';
import type { ScrollTimelinePoint, SpeedTimelinePoint } from '@be-music/chart';
import { buildKittyGraphicsDeleteImageSequence, buildKittyGraphicsRenderSequence } from './kitty-graphics.ts';
import { normalizeHighSpeed, resolveAnimatedHighSpeedValue, resolveVisibleBeatsForTUIGrid } from './high-speed.ts';
import {
  calculateLaneBlockVisibleWidth,
  calculateTUIGridRowCount,
  DEFAULT_LANE_WIDTH,
  resolveLaneWidths,
} from './layout.ts';
import { padVisibleWidth } from './ansi-text.ts';
import {
  type MeasureTimelinePoint,
  type BPMTimelinePoint,
  type StopWindowPoint,
  IIDX_MEASURE_BEATS,
  findCurrentMeasure,
  findTotalMeasures,
  resolveMeasureLength,
  formatMeasureSignature,
  findCurrentBPM,
  findCurrentScroll,
  findRemainingStopSeconds,
} from './timeline.ts';
import {
  type TUILane,
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
  hasLaneSplit,
} from './lane-rows.ts';
import {
  type JudgeComboDisplayState,
  renderProgress,
  createJudgeComboDisplayState,
  resetJudgeComboDisplayState,
  resolveVisibleJudgeComboLabel,
  formatPlayerLabel,
  formatRankLabel,
  formatPlayLevelLabel,
  formatNotesProgress,
  formatGrooveGaugeLine,
  formatActiveAudioFiles,
  formatBPM,
  formatHighSpeed,
  formatScroll,
  formatStopSeconds,
  formatJudgeWindowMs,
  formatAudioBackendLabel,
  formatGenreLabel,
  formatFPS,
} from './hud.ts';
import {
  renderLaneBlockWithBGA,
  renderLaneBlockWithKittyPadding,
  resolveGrooveGaugeLeftPadding,
  renderLaneLinesWithProgressIndicators,
} from './lane-block.ts';
export { resolveAnimatedHighSpeedValue, resolveVisibleBeatsForTUIGrid } from './high-speed.ts';
export { formatMeasureSignature } from './timeline.ts';
export { formatJudgeComboDisplay } from './hud.ts';

interface TUIOptions {
  mode: 'AUTO' | 'MANUAL' | 'AUTO SCRATCH';
  laneDisplayMode: string;
  title: string;
  artist?: string;
  genre?: string;
  player?: number;
  rank?: number;
  rankLabel?: string;
  playLevel?: BeMusicPlayLevel;
  lanes: TUILane[];
  speed: number;
  highSpeed: number;
  visibleNotesLimit?: number;
  noteHeight?: TUINoteHeight;
  judgeWindowMs: number;
  showLaneChannels?: boolean;
  randomPatternSummary?: string;
  bpmTimeline?: ReadonlyArray<BPMTimelinePoint>;
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

interface TUINote {
  channel: string;
  beat: number;
  endBeat?: number;
  visibleUntilBeat?: number;
  seconds: number;
  judged: boolean;
  mine?: boolean;
  invisible?: boolean;
}

interface TUIFrame {
  currentBeat: number;
  currentSeconds: number;
  /** Mirrored display clock past the LR2 negative-BPM reversal (#134) — the lane grid scrolls from it when set. */
  displayBeat?: number;
  /** Chart time of the LR2 reversal, when the chart has one — the BGA and the BPM readout freeze there. */
  reversalSeconds?: number;
  totalSeconds: number;
  summary: PlayerSummary;
  notes: TUINote[];
  landmineNotes?: TUINote[];
  invisibleNotes?: TUINote[];
  audioBackend?: string;
  activeAudioFiles?: string[];
  activeAudioVoiceCount?: number;
  bgaANSILines?: string[];
  bgaKittyImage?: BGAKittyImage;
}

interface NoteWindowState {
  source?: TUINote[];
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
const FPS_SMOOTHING_FACTOR = 0.2;
const HIGH_SPEED_MODIFIER_LABEL = resolveAltModifierLabel();

export class PlayerTUI {
  private readonly options: TUIOptions;

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

  private smoothedFPS = Number.NaN;

  private lastFrameRenderedAtMs = 0;

  private lastRenderedBeat = Number.NaN;

  private lastKittyBGAToken = '';

  private lastKittyBGAPlacementToken = '';

  private activeKittyBGAImageIndex = 0;

  private kittyBGAVisible = false;

  constructor(options: TUIOptions) {
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

  usesKittyGraphicsForBGA(): boolean {
    return this.terminalImageProtocol === 'kitty';
  }

  start(): void {
    if (!this.supported || this.active) {
      return;
    }
    this.active = true;
    this.needsFullRefresh = false;
    this.previousRenderedLines = [];
    this.lastKittyBGAToken = '';
    this.lastKittyBGAPlacementToken = '';
    this.activeKittyBGAImageIndex = 0;
    this.kittyBGAVisible = false;
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
    this.smoothedFPS = Number.NaN;
    this.lastFrameRenderedAtMs = 0;
    this.lastRenderedBeat = Number.NaN;
    const clearKittyBGA = this.kittyBGAVisible
      ? KITTY_BGA_IMAGE_IDS.map((imageId) => buildKittyGraphicsDeleteImageSequence(imageId)).join('')
      : '';
    this.lastKittyBGAToken = '';
    this.lastKittyBGAPlacementToken = '';
    this.activeKittyBGAImageIndex = 0;
    this.kittyBGAVisible = false;
    process.stdout.write(
      this.useAlternateScreen
        ? `${clearKittyBGA}\u001b[0m\u001b[?25h\u001b[?1049l`
        : `${clearKittyBGA}\u001b[0m\u001b[?25h\u001b[2J\u001b[H`,
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

  render(frame: TUIFrame): void {
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
    const rowCount = calculateTUIGridRowCount(terminalRows, {
      showLaneChannels,
      hasRandomPatternSummary: randomPatternSummary !== undefined,
      hasAudioDebugLine: debugLineCount > 0,
    });
    const laneCount = Math.max(1, this.options.lanes.length);
    const now = Date.now();
    const currentFPS = this.resolveFPS(now);
    const displayHighSpeed = this.resolveDisplayHighSpeed(now);
    const scrollWindowBeats = resolveVisibleBeatsForTUIGrid(rowCount, displayHighSpeed);
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
      notes: TUINote[],
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
    const currentBPM = findCurrentBPM(this.options.bpmTimeline, bpmReadoutSeconds);
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
      `TIMING  SPEED x${this.options.speed.toFixed(2)}  HS x${formatHighSpeed(displayHighSpeed)}  BAD ±${formatJudgeWindowMs(this.options.judgeWindowMs)}ms  BPM ${formatBPM(currentBPM)}  SCROLL ${formatScroll(currentScroll)}  STOP ${stopLabel}`,
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
    lines.push(`PERF    FPS ${formatFPS(currentFPS)}`);
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
    let kittyBGAPlacement:
      | {
          row: number;
          column: number;
          image: BGAKittyImage;
        }
      | undefined;
    if (this.terminalImageProtocol === 'kitty' && frame.bgaKittyImage) {
      const renderedKittyBGA = renderLaneBlockWithKittyPadding(laneLinesWithProgress, frame.bgaKittyImage.cellWidth);
      lines.push(...renderedKittyBGA.lines);
      kittyBGAPlacement = {
        row: laneBlockStartRow,
        column: renderedKittyBGA.column,
        image: frame.bgaKittyImage,
      };
    } else {
      lines.push(...renderLaneBlockWithBGA(laneLinesWithProgress, frame.bgaANSILines));
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
    if (kittyBGAPlacement) {
      const placementToken =
        `${kittyBGAPlacement.row}:${kittyBGAPlacement.column}:` +
        `${kittyBGAPlacement.image.cellWidth}:${kittyBGAPlacement.image.cellHeight}`;
      if (needsFullRefresh || !this.kittyBGAVisible || this.lastKittyBGAPlacementToken !== placementToken) {
        const activeImageId = KITTY_BGA_IMAGE_IDS[this.activeKittyBGAImageIndex]!;
        const inactiveImageId = KITTY_BGA_IMAGE_IDS[(this.activeKittyBGAImageIndex + 1) % KITTY_BGA_IMAGE_IDS.length]!;
        overlaySequence = buildKittyGraphicsRenderSequence({
          imageId: activeImageId,
          placementId: 1,
          row: kittyBGAPlacement.row,
          column: kittyBGAPlacement.column,
          image: kittyBGAPlacement.image,
          zIndex: -1,
          doNotMoveCursor: true,
        });
        overlaySequence += buildKittyGraphicsDeleteImageSequence(inactiveImageId);
        this.lastKittyBGAToken = kittyBGAPlacement.image.token;
        this.lastKittyBGAPlacementToken = placementToken;
        this.kittyBGAVisible = true;
      } else if (this.lastKittyBGAToken !== kittyBGAPlacement.image.token) {
        const nextImageIndex = (this.activeKittyBGAImageIndex + 1) % KITTY_BGA_IMAGE_IDS.length;
        const nextImageId = KITTY_BGA_IMAGE_IDS[nextImageIndex]!;
        const previousImageId = KITTY_BGA_IMAGE_IDS[this.activeKittyBGAImageIndex]!;
        overlaySequence = buildKittyGraphicsRenderSequence({
          imageId: nextImageId,
          placementId: 1,
          row: kittyBGAPlacement.row,
          column: kittyBGAPlacement.column,
          image: kittyBGAPlacement.image,
          zIndex: -1,
          doNotMoveCursor: true,
        });
        overlaySequence += buildKittyGraphicsDeleteImageSequence(previousImageId);
        this.lastKittyBGAToken = kittyBGAPlacement.image.token;
        this.activeKittyBGAImageIndex = nextImageIndex;
      }
    } else if (this.kittyBGAVisible) {
      overlaySequence = KITTY_BGA_IMAGE_IDS.map((imageId) => buildKittyGraphicsDeleteImageSequence(imageId)).join('');
      this.lastKittyBGAToken = '';
      this.lastKittyBGAPlacementToken = '';
      this.activeKittyBGAImageIndex = 0;
      this.kittyBGAVisible = false;
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
    notes: TUINote[],
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

  private resolveFPS(nowMs: number): number | undefined {
    if (this.lastFrameRenderedAtMs <= 0) {
      this.lastFrameRenderedAtMs = nowMs;
      return undefined;
    }

    const elapsedMs = nowMs - this.lastFrameRenderedAtMs;
    this.lastFrameRenderedAtMs = nowMs;
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      return Number.isFinite(this.smoothedFPS) ? this.smoothedFPS : undefined;
    }

    const instantFPS = 1000 / elapsedMs;
    if (!Number.isFinite(this.smoothedFPS)) {
      this.smoothedFPS = instantFPS;
      return this.smoothedFPS;
    }

    this.smoothedFPS += (instantFPS - this.smoothedFPS) * FPS_SMOOTHING_FACTOR;
    return this.smoothedFPS;
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

function normalizeTerminalDimension(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function canDropNoteFromRenderWindow(note: TUINote, currentBeat: number, scrollWindowBeats: number): boolean {
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
