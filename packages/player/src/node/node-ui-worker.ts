import { createAbortError, isAbortError, type LogLevel } from '@be-music/utils';
import { createBeatResolver } from '@be-music/chart';
import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { createTimingResolver } from '@be-music/audio-renderer';
import {
  createBpmTimeline,
  createMeasureBoundariesBeats,
  createMeasureTimeline,
  createScrollTimeline,
  createSpeedTimeline,
  createStopBeatWindows,
} from '../core/timeline.ts';
import { createBgaAnsiRenderer } from '../bga.ts';
import {
  resolveDisplayedJudgeRankLabel,
  resolveDisplayedJudgeRankValue,
  resolveDisplayedPlayLevelValue,
} from '../utils.ts';
import type { PlayerUiCommand, PlayerUiFramePayload } from '../core/ui-signal-bus.ts';
import { PlayerTui } from '../tui.ts';
import { supportsKittyGraphicsProtocol } from '../tui/kitty-graphics.ts';
import { estimateBgaAnsiDisplaySize as resolveBgaDisplaySize, resolveLaneWidths } from '../tui/layout.ts';
import { createDeferredUiFlush } from './deferred-ui-flush.ts';
import { createRenderThrottle } from './render-throttle.ts';
import { createUiWorkerFrameState } from './ui-worker-frame-state.ts';
import type {
  NodeUiWorkerInboundMessage,
  NodeUiWorkerInitData,
  NodeUiWorkerOutboundMessage,
} from './node-ui-worker-protocol.ts';

const port = parentPort;
const initData = workerData as NodeUiWorkerInitData;
const DEFAULT_UI_FPS = 60;

void bootstrap().catch((error) => {
  if (isAbortError(error)) {
    port?.close();
    process.exit(0);
    return;
  }
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
  postLog('info', 'ui-worker.bootstrap.start', {
    kittyGraphics: initData.kittyGraphics === true,
    uiFps: initData.uiFps ?? DEFAULT_UI_FPS,
  });
  const abortController = new AbortController();
  const handleAbortMessage = (message: NodeUiWorkerInboundMessage): void => {
    if (message.kind !== 'abort' || abortController.signal.aborted) {
      return;
    }
    abortController.abort(resolveAbortReason(message.reason));
  };
  port.on('message', handleAbortMessage);

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
  const speedTimeline = createSpeedTimeline(initData.json, beatResolver);
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
    rank: resolveDisplayedJudgeRankValue(initData.json),
    rankLabel: resolveDisplayedJudgeRankLabel(initData.json),
    playLevel: resolveDisplayedPlayLevelValue(initData.json),
    lanes,
    speed: initData.speed,
    highSpeed: initData.highSpeed,
    judgeWindowMs: initData.judgeWindowMs,
    showLaneChannels: initData.showLaneChannels,
    randomPatternSummary: initData.randomPatternSummary,
    bpmTimeline,
    scrollTimeline,
    speedTimeline,
    stopWindows,
    measureTimeline,
    measureLengths,
    measureBoundariesBeats,
    splitAfterIndex,
    stdinIsTTY: initData.stdinIsTTY,
    stdoutIsTTY: initData.stdoutIsTTY,
    terminalImageProtocol:
      initData.kittyGraphics === true && supportsKittyGraphicsProtocol(process.env) ? 'kitty' : 'none',
  });

  if (!tui.isSupported()) {
    postLog('warn', 'ui-worker.unsupported');
    postWorkerMessage({ kind: 'unsupported' });
    process.exit(0);
    return;
  }

  const useKittyGraphicsForBga = tui.usesKittyGraphicsForBga();

  const initialBgaSize = estimateBgaAnsiDisplaySize(initData.laneBindings);
  const bgaRenderer = await createBgaAnsiRenderer(initData.json, {
    baseDir: initData.baseDir,
    width: initialBgaSize.width,
    height: initialBgaSize.height,
    signal: abortController.signal,
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
  postLog('info', 'ui-worker.ready', {
    hasBgaRenderer: bgaRenderer !== undefined,
    bgaPlaybackEndSeconds: bgaRenderer?.playbackEndSeconds,
  });

  const queuedCommands: PlayerUiCommand[] = [];
  let bridgePort: MessagePort | undefined;
  let firstFrameRendered = false;

  const syncBgaDisplaySize = (
    frame: PlayerUiFramePayload | undefined,
    columns: number | undefined,
    rows: number | undefined,
  ): void => {
    const size = estimateBgaAnsiDisplaySize(initData.laneBindings, columns, rows, frame);
    bgaRenderer?.setDisplaySize(size.width, size.height);
  };

  let renderThrottle: ReturnType<typeof createRenderThrottle> | undefined;
  const frameState = createUiWorkerFrameState({
    initialPaused: initData.initialPaused,
    initialHighSpeed: initData.highSpeed,
    initialJudgeCombo: initData.initialJudgeCombo,
    applyPaused: (value) => {
      tui.setPaused(value);
    },
    applyHighSpeed: (value) => {
      tui.setHighSpeed(value);
    },
    applyJudgeCombo: (state) => {
      tui.setJudgeComboState(state);
    },
    applyTerminalSize: (columns, rows) => {
      tui.setTerminalSize(columns, rows);
    },
    syncFrameLayout: (frame, columns, rows) => {
      syncBgaDisplaySize(frame, columns, rows);
    },
    requestFrameRender: () => {
      deferredUiFlush.markFrameDirty();
    },
  });

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

    if (frame || commands) {
      renderThrottle?.request();
    }
  });

  renderThrottle = createRenderThrottle(
    () => {
      const latestFrame = frameState.getFrame();
      if (!latestFrame) {
        return;
      }
      tui.render({
        ...latestFrame,
        bgaAnsiLines: useKittyGraphicsForBga ? undefined : bgaRenderer?.getAnsiLines(latestFrame.currentSeconds),
        bgaKittyImage: useKittyGraphicsForBga ? bgaRenderer?.getKittyImage(latestFrame.currentSeconds) : undefined,
      });
      if (!firstFrameRendered) {
        firstFrameRendered = true;
        postLog('info', 'ui-worker.first-frame.rendered', {
          seconds: latestFrame.currentSeconds,
        });
      }
    },
    {
      minIntervalMs: resolveTuiRenderMinIntervalMs(initData.uiFps),
    },
  );

  const handleRenderMessage = (message: NodeUiWorkerInboundMessage): boolean => {
    if (message.kind === 'start') {
      postLog('info', 'ui-worker.start.received');
      tui.start();
      return true;
    }
    if (message.kind === 'frame') {
      frameState.setFrame(message.frame);
      return true;
    }
    if (message.kind === 'commands') {
      queuedCommands.push(...message.commands);
      deferredUiFlush.markCommandsDirty();
      return true;
    }
    if (message.kind === 'set-paused') {
      frameState.setPaused(message.value);
      return true;
    }
    if (message.kind === 'set-high-speed') {
      frameState.setHighSpeed(message.value);
      return true;
    }
    if (message.kind === 'set-judge-combo') {
      frameState.setJudgeCombo(message.state);
      return true;
    }
    if (message.kind === 'trigger-poor') {
      bgaRenderer?.triggerPoor(message.seconds);
      frameState.invalidateFrame();
      return true;
    }
    if (message.kind === 'clear-poor') {
      bgaRenderer?.clearPoor();
      frameState.invalidateFrame();
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
      frameState.dispose();
      deferredUiFlush.dispose();
      renderThrottle?.dispose();
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

    frameState.setTerminalSize(message.columns, message.rows);
  };

  port.on('message', handleControlMessage);

  postWorkerMessage({ kind: 'ready', bgaPlaybackEndSeconds: bgaRenderer?.playbackEndSeconds });
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

function resolveTuiRenderMinIntervalMs(uiFps: number | undefined): number {
  const fps = typeof uiFps === 'number' && Number.isFinite(uiFps) && uiFps > 0 ? uiFps : DEFAULT_UI_FPS;
  return 1000 / fps;
}

function estimateBgaAnsiDisplaySize(
  bindings: NodeUiWorkerInitData['laneBindings'],
  columns = process.stdout.columns,
  rows = process.stdout.rows,
  frame?: Pick<PlayerUiFramePayload, 'activeAudioFiles' | 'activeAudioVoiceCount'>,
): { width: number; height: number } {
  return resolveBgaDisplaySize({
    laneWidths: resolveLaneWidths(bindings),
    splitAfterIndex: resolveSplitAfterIndex(bindings),
    columns,
    rows,
    showLaneChannels: initData.showLaneChannels === true,
    hasRandomPatternSummary:
      typeof initData.randomPatternSummary === 'string' && initData.randomPatternSummary.length > 0,
    hasAudioDebugLine: frame?.activeAudioFiles !== undefined || frame?.activeAudioVoiceCount !== undefined,
  });
}

function postWorkerMessage(message: NodeUiWorkerOutboundMessage): void {
  port?.postMessage(message);
}

function postLog(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  postWorkerMessage({
    kind: 'log',
    entry: {
      source: 'ui-worker',
      level,
      event,
      fields,
    },
  });
}

function resolveAbortReason(reason?: string): Error {
  const error = createAbortError();
  if (typeof reason === 'string' && reason.length > 0) {
    error.message = reason;
  }
  return error;
}
