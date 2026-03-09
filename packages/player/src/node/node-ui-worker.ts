import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { createTimingResolver } from '@be-music/audio-renderer';
import { createBeatResolver } from '@be-music/json';
import {
  createBpmTimeline,
  createMeasureBoundariesBeats,
  createMeasureTimeline,
  createScrollTimeline,
  createStopBeatWindows,
} from '../core/timeline.ts';
import { createBgaAnsiRenderer } from '../bga.ts';
import type { PlayerUiCommand, PlayerUiFramePayload } from '../core/player-ui-signal-bus.ts';
import { PlayerTui } from '../tui.ts';
import { createDeferredUiFlush } from './deferred-ui-flush.ts';
import type {
  NodeUiWorkerInboundMessage,
  NodeUiWorkerInitData,
  NodeUiWorkerOutboundMessage,
} from './node-ui-worker-protocol.ts';

const DEFAULT_LANE_WIDTH = 3;
const WIDE_SCRATCH_LANE_WIDTH = DEFAULT_LANE_WIDTH * 2;
const DEFAULT_GRID_ROWS = 14;
const MIN_GRID_ROWS = 4;
const STATIC_TUI_LINES = 15;
const BGA_LANE_GAP = 3;
const MIN_BGA_ASCII_WIDTH = 8;
const MIN_BGA_ASCII_HEIGHT = 6;
const DEFAULT_TERMINAL_COLUMNS = 120;

const port = parentPort;
const initData = workerData as NodeUiWorkerInitData;

void bootstrap().catch((error) => {
  postWorkerMessage({
    kind: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
  throw error;
});

async function bootstrap(): Promise<void> {
  if (!port) {
    throw new Error('UI worker parent port is unavailable');
  }

  const splitAfterIndex = resolveSplitAfterIndex(initData.laneBindings);
  const lanes = initData.laneBindings.map((binding) => ({
    channel: binding.channel,
    key: binding.keyLabel,
    isScratch: binding.isScratch,
  }));
  const timingResolver = createTimingResolver(initData.json);
  const beatResolver = createBeatResolver(initData.json);
  const measureLengths = new Map<number, number>();
  for (const measure of initData.json.measures) {
    const measureIndex = Math.max(0, Math.floor(measure.index));
    if (typeof measure.length !== 'number' || !Number.isFinite(measure.length) || measure.length <= 0) {
      continue;
    }
    measureLengths.set(measureIndex, measure.length);
  }
  const measureTimeline = createMeasureTimeline(initData.json, timingResolver, beatResolver);
  const bpmTimeline = createBpmTimeline(initData.json, timingResolver);
  const scrollTimeline = createScrollTimeline(initData.json, beatResolver);
  const stopWindows = createStopBeatWindows(timingResolver).map((window) => ({
    startSeconds: window.startSeconds,
    endSeconds: window.endSeconds,
  }));
  const measureBoundariesBeats = createMeasureBoundariesBeats(initData.json, beatResolver);

  const tui = new PlayerTui({
    mode: initData.mode,
    laneDisplayMode: initData.laneDisplayMode,
    title: initData.json.metadata.title ?? 'Untitled',
    artist: initData.json.metadata.artist,
    genre: initData.json.metadata.genre,
    player: initData.json.bms.player,
    rank: initData.json.metadata.rank,
    playLevel: initData.json.metadata.playLevel,
    lanes,
    speed: initData.speed,
    highSpeed: initData.highSpeed,
    judgeWindowMs: initData.judgeWindowMs,
    showLaneChannels: initData.showLaneChannels,
    randomPatternSummary: initData.randomPatternSummary,
    bpmTimeline,
    scrollTimeline,
    stopWindows,
    measureTimeline,
    measureLengths,
    measureBoundariesBeats,
    splitAfterIndex,
    stdinIsTTY: initData.stdinIsTTY,
    stdoutIsTTY: initData.stdoutIsTTY,
  });
  tui.setPaused(initData.initialPaused);
  tui.setLatestJudge(initData.initialJudgeCombo.judge, initData.initialJudgeCombo.channel);
  tui.setCombo(initData.initialJudgeCombo.combo, initData.initialJudgeCombo.channel);

  if (!tui.isSupported()) {
    postWorkerMessage({ kind: 'unsupported' });
    process.exit(0);
    return;
  }

  const initialBgaSize = estimateBgaAnsiDisplaySize(initData.laneBindings);
  const bgaRenderer = await createBgaAnsiRenderer(initData.json, {
    baseDir: initData.baseDir,
    width: initialBgaSize.width,
    height: initialBgaSize.height,
    onLoadProgress: (progress) => {
      postWorkerMessage({
        kind: 'bga-load-progress',
        progress: {
          ratio: progress.ratio,
          detail: progress.detail,
        },
      });
    },
  });

  let latestFrame: PlayerUiFramePayload | undefined;
  const queuedCommands: PlayerUiCommand[] = [];
  let bridgePort: MessagePort | undefined;

  const deferredUiFlush = createDeferredUiFlush(({ commands, frame }) => {
    if (commands) {
      while (queuedCommands.length > 0) {
        const command = queuedCommands.shift();
        if (!command) {
          continue;
        }
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
    }

    if (frame && latestFrame) {
      tui.render({
        ...latestFrame,
        bgaAnsiLines: bgaRenderer?.getAnsiLines(latestFrame.currentSeconds),
      });
    }
  });

  const handleRenderMessage = (message: NodeUiWorkerInboundMessage): boolean => {
    if (message.kind === 'start') {
      tui.start();
      return true;
    }
    if (message.kind === 'frame') {
      latestFrame = message.frame;
      deferredUiFlush.markFrameDirty();
      return true;
    }
    if (message.kind === 'commands') {
      queuedCommands.push(...message.commands);
      deferredUiFlush.markCommandsDirty();
      return true;
    }
    if (message.kind === 'set-paused') {
      tui.setPaused(message.value);
      if (latestFrame) {
        deferredUiFlush.markFrameDirty();
      }
      return true;
    }
    if (message.kind === 'set-high-speed') {
      tui.setHighSpeed(message.value);
      if (latestFrame) {
        deferredUiFlush.markFrameDirty();
      }
      return true;
    }
    if (message.kind === 'set-judge-combo') {
      tui.setLatestJudge(message.state.judge, message.state.channel);
      tui.setCombo(message.state.combo, message.state.channel);
      if (latestFrame) {
        deferredUiFlush.markFrameDirty();
      }
      return true;
    }
    if (message.kind === 'trigger-poor') {
      bgaRenderer?.triggerPoor(message.seconds);
      if (latestFrame) {
        deferredUiFlush.markFrameDirty();
      }
      return true;
    }
    if (message.kind === 'clear-poor') {
      bgaRenderer?.clearPoor();
      if (latestFrame) {
        deferredUiFlush.markFrameDirty();
      }
      return true;
    }
    return false;
  };

  const handleControlMessage = (message: NodeUiWorkerInboundMessage): void => {
    if (message.kind === 'attach-bridge-port') {
      bridgePort?.off('message', handleControlMessage);
      bridgePort = message.port;
      bridgePort.on('message', handleControlMessage);
      return;
    }
    if (handleRenderMessage(message)) {
      return;
    }
    if (message.kind === 'stop') {
      tui.stop();
      postWorkerMessage({ kind: 'stopped' });
      return;
    }
    if (message.kind === 'dispose') {
      deferredUiFlush.dispose();
      bridgePort?.close();
      tui.stop();
      postWorkerMessage({ kind: 'disposed' });
      port.close();
      process.exit(0);
      return;
    }
    if (message.kind !== 'resize') {
      return;
    }

    tui.setTerminalSize(message.columns, message.rows);
    const size = estimateBgaAnsiDisplaySize(initData.laneBindings, message.columns, message.rows);
    bgaRenderer?.setDisplaySize(size.width, size.height);
    if (latestFrame) {
      deferredUiFlush.markFrameDirty();
    }
  };

  port.on('message', handleControlMessage);

  postWorkerMessage({ kind: 'ready' });
}

function resolveSplitAfterIndex(bindings: NodeUiWorkerInitData['laneBindings']): number {
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

function estimateBgaAnsiDisplaySize(
  bindings: NodeUiWorkerInitData['laneBindings'],
  columns = process.stdout.columns ?? DEFAULT_TERMINAL_COLUMNS,
  rows = process.stdout.rows ?? DEFAULT_GRID_ROWS + STATIC_TUI_LINES,
): { width: number; height: number } {
  const laneWidths = bindings.map((binding) => (binding.isScratch ? WIDE_SCRATCH_LANE_WIDTH : DEFAULT_LANE_WIDTH));
  const laneCount = laneWidths.length;
  const splitAfterIndex = resolveSplitAfterIndex(bindings);
  const laneTextWidth = laneWidths.reduce((sum, width) => sum + width, 0);
  const laneSpacingWidth = laneCount > 0 ? laneCount - 1 : 0;
  const splitExtraWidth = splitAfterIndex >= 0 && splitAfterIndex < laneCount - 1 ? 2 : 0;
  const laneBlockWidth = laneTextWidth + laneSpacingWidth + splitExtraWidth;

  const width = Math.max(MIN_BGA_ASCII_WIDTH, columns - laneBlockWidth - BGA_LANE_GAP);
  const rowCount = Math.max(MIN_GRID_ROWS, rows - STATIC_TUI_LINES);
  const laneBlockHeight = rowCount + 4;
  const height = Math.max(MIN_BGA_ASCII_HEIGHT, laneBlockHeight);
  return { width, height };
}

function postWorkerMessage(message: NodeUiWorkerOutboundMessage): void {
  port?.postMessage(message);
}
