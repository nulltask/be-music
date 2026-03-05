import { effect } from 'alien-signals';
import { createTimingResolver } from '@be-music/audio-renderer';
import { createBeatResolver, type BeMusicJson } from '@be-music/json';
import {
  createBeatAtSecondsResolver,
  createBpmTimeline,
  createMeasureBoundariesBeats,
  createMeasureTimeline,
  createScrollTimeline,
  createStopBeatWindows,
} from '../core/timeline.ts';
import type { LaneBinding } from '../manual-input.ts';
import { PlayerTui } from '../tui.ts';
import { createBgaAnsiRenderer, type BgaAnsiRenderer } from '../bga.ts';
import type { PlayerStateSignals } from '../player-state-signals.ts';
import type { PlayerUiSignalBus } from '../core/player-ui-signal-bus.ts';
import { resolveHighSpeedMultiplier } from '../core/high-speed-control.ts';

const DEFAULT_LANE_WIDTH = 3;
const WIDE_SCRATCH_LANE_WIDTH = DEFAULT_LANE_WIDTH * 2;
const DEFAULT_GRID_ROWS = 14;
const MIN_GRID_ROWS = 4;
const STATIC_TUI_LINES = 15;
const BGA_LANE_GAP = 3;
const MIN_BGA_ASCII_WIDTH = 8;
const MIN_BGA_ASCII_HEIGHT = 6;
const DEFAULT_TERMINAL_COLUMNS = 120;

export interface NodeUiRuntimeOptions {
  json: BeMusicJson;
  mode: 'AUTO' | 'MANUAL' | 'AUTO SCRATCH';
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  judgeWindowMs: number;
  highSpeed: number;
  showLaneChannels?: boolean;
  randomPatternSummary?: string;
  stateSignals: PlayerStateSignals;
  uiSignals: PlayerUiSignalBus;
  baseDir: string;
  loadSignal?: AbortSignal;
  onBgaLoadProgress?: (progress: { ratio: number; detail?: string }) => void;
}

export interface NodeUiRuntime {
  readonly tuiEnabled: boolean;
  start: () => void;
  stop: () => void;
  dispose: () => void;
  triggerPoor: (seconds: number) => void;
  clearPoor: () => void;
}

export async function createNodeUiRuntime(options: NodeUiRuntimeOptions): Promise<NodeUiRuntime> {
  const splitAfterIndex = resolveSplitAfterIndex(options.laneBindings);
  const lanes = options.laneBindings.map((binding) => ({
    channel: binding.channel,
    key: binding.keyLabel,
    isScratch: binding.isScratch,
  }));
  const timingResolver = createTimingResolver(options.json);
  const beatResolver = createBeatResolver(options.json);
  const measureLengths = new Map<number, number>();
  for (const measure of options.json.measures) {
    const measureIndex = Math.max(0, Math.floor(measure.index));
    if (typeof measure.length !== 'number' || !Number.isFinite(measure.length) || measure.length <= 0) {
      continue;
    }
    measureLengths.set(measureIndex, measure.length);
  }
  const measureTimeline = createMeasureTimeline(options.json, timingResolver, beatResolver);
  const bpmTimeline = createBpmTimeline(options.json, timingResolver);
  const scrollTimeline = createScrollTimeline(options.json, beatResolver);
  const stopWindows = createStopBeatWindows(timingResolver).map((window) => ({
    startSeconds: window.startSeconds,
    endSeconds: window.endSeconds,
  }));
  const measureBoundariesBeats = createMeasureBoundariesBeats(options.json, beatResolver);

  const tui = new PlayerTui({
    mode: options.mode,
    laneDisplayMode: options.laneDisplayMode,
    title: options.json.metadata.title ?? 'Untitled',
    artist: options.json.metadata.artist,
    genre: options.json.metadata.genre,
    player: options.json.bms.player,
    rank: options.json.metadata.rank,
    playLevel: options.json.metadata.playLevel,
    lanes,
    speed: options.speed,
    highSpeed: resolveHighSpeedMultiplier(options.highSpeed),
    judgeWindowMs: options.judgeWindowMs,
    showLaneChannels: options.showLaneChannels,
    randomPatternSummary: options.randomPatternSummary,
    bpmTimeline,
    scrollTimeline,
    stopWindows,
    measureTimeline,
    measureLengths,
    measureBoundariesBeats,
    splitAfterIndex,
    stateSignals: options.stateSignals,
  });

  if (!tui.isSupported()) {
    return {
      tuiEnabled: false,
      start: () => undefined,
      stop: () => undefined,
      dispose: () => undefined,
      triggerPoor: () => undefined,
      clearPoor: () => undefined,
    };
  }

  const bgaDisplay = estimateBgaAnsiDisplaySize(options.laneBindings);
  const bgaRenderer = await createBgaAnsiRenderer(options.json, {
    baseDir: options.baseDir,
    width: bgaDisplay.width,
    height: bgaDisplay.height,
    signal: options.loadSignal,
    onLoadProgress: (progress) => {
      options.onBgaLoadProgress?.({
        ratio: progress.ratio,
        detail: progress.detail,
      });
    },
  });

  const stopFrameEffect = effect(() => {
    options.uiSignals.frameTick();
    const frame = options.uiSignals.getFrame();
    tui.render({
      ...frame,
      bgaAnsiLines: bgaRenderer?.getAnsiLines(frame.currentSeconds),
    });
  });

  const stopCommandEffect = effect(() => {
    options.uiSignals.commandTick();
    const commands = options.uiSignals.drainCommands();
    for (const command of commands) {
      if (command.kind === 'flash-lane') {
        tui.flashLane(command.channel);
        continue;
      }
      if (command.kind === 'hold-lane-until-beat') {
        tui.holdLaneUntilBeat(command.channel, command.beat);
        continue;
      }
      if (command.kind === 'press-lane') {
        tui.pressLane(command.channel);
        continue;
      }
      if (command.kind === 'release-lane') {
        tui.releaseLane(command.channel);
        continue;
      }
      if (command.kind === 'trigger-poor-bga') {
        bgaRenderer?.triggerPoor(command.seconds);
        continue;
      }
      bgaRenderer?.clearPoor();
    }
  });

  const detachBgaResizeHandler = attachBgaResizeHandler(tui, bgaRenderer, options.laneBindings);

  return {
    tuiEnabled: true,
    start: () => {
      tui.start();
    },
    stop: () => {
      tui.stop();
    },
    dispose: () => {
      stopFrameEffect();
      stopCommandEffect();
      detachBgaResizeHandler();
    },
    triggerPoor: (seconds: number) => {
      bgaRenderer?.triggerPoor(seconds);
    },
    clearPoor: () => {
      bgaRenderer?.clearPoor();
    },
  };
}

function resolveSplitAfterIndex(bindings: LaneBinding[]): number {
  const has2P = bindings.some((binding) => binding.side === '2P');
  if (!has2P) {
    return -1;
  }
  for (let index = bindings.length - 1; index >= 0; index -= 1) {
    if (bindings[index]?.side === '1P') {
      return index;
    }
  }
  return -1;
}

function estimateBgaAnsiDisplaySize(bindings: LaneBinding[]): { width: number; height: number } {
  const laneWidths = bindings.map((binding) => (binding.isScratch ? WIDE_SCRATCH_LANE_WIDTH : DEFAULT_LANE_WIDTH));
  const laneCount = laneWidths.length;
  const splitAfterIndex = resolveSplitAfterIndex(bindings);
  const laneTextWidth = laneWidths.reduce((sum, width) => sum + width, 0);
  const laneSpacingWidth = laneCount > 0 ? laneCount - 1 : 0;
  const splitExtraWidth = splitAfterIndex >= 0 && splitAfterIndex < laneCount - 1 ? 2 : 0;
  const laneBlockWidth = laneTextWidth + laneSpacingWidth + splitExtraWidth;

  const columns = process.stdout.columns ?? DEFAULT_TERMINAL_COLUMNS;
  const width = Math.max(MIN_BGA_ASCII_WIDTH, columns - laneBlockWidth - BGA_LANE_GAP);

  const terminalRows = process.stdout.rows ?? DEFAULT_GRID_ROWS + STATIC_TUI_LINES;
  const rowCount = Math.max(MIN_GRID_ROWS, terminalRows - STATIC_TUI_LINES);
  const laneBlockHeight = rowCount + 4;
  const height = Math.max(MIN_BGA_ASCII_HEIGHT, laneBlockHeight);
  return { width, height };
}

function attachBgaResizeHandler(
  tui: PlayerTui,
  bgaRenderer: BgaAnsiRenderer | undefined,
  bindings: LaneBinding[],
): () => void {
  if (!bgaRenderer || !process.stdout.isTTY) {
    return () => undefined;
  }
  const onResize = (): void => {
    const size = estimateBgaAnsiDisplaySize(bindings);
    bgaRenderer.setDisplaySize(size.width, size.height);
  };
  process.stdout.on('resize', onResize);
  onResize();
  return () => {
    process.stdout.off('resize', onResize);
  };
}
