import { createAbortError, isAbortError } from '@be-music/shared-utils/core';
import type { LogLevel } from '@be-music/shared-utils/log';
import { createBPMTimeline, createMeasureTimeline, createStopBeatWindows, resolveChart } from '@be-music/chart-model';
import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { createBgaANSIRenderer } from '../bga.ts';
import {
  resolveDisplayedJudgeRankLabel,
  resolveDisplayedJudgeRankValue,
  resolveDisplayedPlayLevelValue,
} from '@be-music/player-engine/display';
import type { PlayerUICommand, PlayerUIFramePayload } from '@be-music/player-engine/signals';
import { PlayerTUI } from '../tui.ts';
import { supportsKittyGraphicsProtocol } from '../tui/kitty-graphics.ts';
import { estimateBgaANSIDisplaySize as resolveBGADisplaySize, resolveLaneWidths } from '../tui/layout.ts';
import { createDeferredUIFlush } from './deferred-ui-flush.ts';
import { createRenderThrottle } from './render-throttle.ts';
import { createUIWorkerFrameState } from './ui-worker-frame-state.ts';
import type {
  NodeUIWorkerInboundMessage,
  NodeUIWorkerInitData,
  NodeUIWorkerOutboundMessage,
} from './node-ui-worker-protocol.ts';

const port = parentPort;
const initData = workerData as NodeUIWorkerInitData;
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
    kittyGraphics: Boolean(initData.kittyGraphics),
    uiFPS: initData.uiFPS ?? DEFAULT_UI_FPS,
    tuiVisibleNotesLimit: initData.tuiVisibleNotesLimit,
  });
  const abortController = new AbortController();
  const handleAbortMessage = (message: NodeUIWorkerInboundMessage): void => {
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
  // The worker receives the chart over `postMessage`, so it resolves it again on its side.
  const resolvedChart = resolveChart(initData.json);
  const timingResolver = resolvedChart.timing;
  const beatResolver = resolvedChart.beatResolver;
  const measureLengths = new Map<number, number>();
  for (const measure of initData.json.measures) {
    const measureIndex = Math.max(0, Math.floor(measure.index));
    if (typeof measure.length !== 'number' || !Number.isFinite(measure.length) || measure.length <= 0) {
      continue;
    }
    measureLengths.set(measureIndex, measure.length);
  }
  const measureTimeline = createMeasureTimeline(initData.json, timingResolver, beatResolver);
  const bpmTimeline = createBPMTimeline(initData.json, timingResolver);
  const scrollTimeline = resolvedChart.scroll;
  const speedTimeline = resolvedChart.speed;
  const stopWindows = createStopBeatWindows(timingResolver).map((window) => ({
    startSeconds: window.startSeconds,
    endSeconds: window.endSeconds,
  }));
  // The resolved chart's bar lines: none when a bmson chart suppresses them with `lines: []`.
  const measureBoundariesBeats = [...resolvedChart.barLines];

  const tui = new PlayerTUI({
    mode: initData.mode,
    laneDisplayMode: initData.laneDisplayMode,
    title: initData.json.metadata.title ?? 'Untitled',
    artist: initData.json.metadata.artist,
    genre: initData.json.metadata.genre,
    player: initData.json.bms.player,
    rank: resolveDisplayedJudgeRankValue(resolvedChart),
    rankLabel: resolveDisplayedJudgeRankLabel(resolvedChart),
    playLevel: resolveDisplayedPlayLevelValue(initData.json),
    lanes,
    speed: initData.speed,
    highSpeed: initData.highSpeed,
    visibleNotesLimit: initData.tuiVisibleNotesLimit,
    noteHeight: initData.tuiNoteHeight,
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
    useAlternateScreen: initData.useAlternateScreen,
    terminalImageProtocol:
      Boolean(initData.kittyGraphics) && supportsKittyGraphicsProtocol(process.env) ? 'kitty' : 'none',
  });

  if (!tui.isSupported()) {
    postLog('warn', 'ui-worker.unsupported');
    postWorkerMessage({ kind: 'unsupported' });
    process.exit(0);
    return;
  }

  const useKittyGraphicsForBGA = tui.usesKittyGraphicsForBGA();
  postLog('info', 'ui-worker.bga.render-mode', {
    terminalImageProtocol: useKittyGraphicsForBGA ? 'kitty' : 'none',
    kittyGraphicsRequested: Boolean(initData.kittyGraphics),
    kittyGraphicsSupported: supportsKittyGraphicsProtocol(process.env),
    useKittyGraphicsForBGA,
  });

  const initialBGASize = estimateBgaANSIDisplaySize(initData.laneBindings);
  const bgaRenderer = await createBgaANSIRenderer(initData.json, {
    baseDir: initData.baseDir,
    width: initialBGASize.width,
    height: initialBGASize.height,
    imageResizeAlgorithm: initData.imageResizeAlgorithm,
    videoBGAStreaming: initData.videoBGAStreaming,
    keyBoundBGACues: initData.keyBoundBGACues,
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
    hasBGARenderer: bgaRenderer !== undefined,
    bgaPlaybackEndSeconds: bgaRenderer?.playbackEndSeconds,
    videoBGAStreaming: initData.videoBGAStreaming !== false,
  });

  const queuedCommands: PlayerUICommand[] = [];
  let bridgePort: MessagePort | undefined;
  let firstFrameRendered = false;

  const syncBGADisplaySize = (
    frame: PlayerUIFramePayload | undefined,
    columns: number | undefined,
    rows: number | undefined,
  ): void => {
    const size = estimateBgaANSIDisplaySize(initData.laneBindings, columns, rows, frame);
    bgaRenderer?.setDisplaySize(size.width, size.height);
  };

  let renderThrottle: ReturnType<typeof createRenderThrottle> | undefined;
  let bgaStreamingScheduled = false;
  let loggedFirstKittyImageReady = false;
  let loggedFirstKittyImageMissing = false;
  let loggedFirstANSIFrameReady = false;
  const frameState = createUIWorkerFrameState({
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
      syncBGADisplaySize(frame, columns, rows);
    },
    requestFrameRender: () => {
      deferredUIFlush.markFrameDirty();
    },
  });

  const deferredUIFlush = createDeferredUIFlush(({ commands, frame }) => {
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
        if (command.kind === 'clear-poor-bga') {
          bgaRenderer?.clearPoor();
        }
        // Long-note start / end commands are for graphical skins; the TUI already lights the lane through
        // `hold-lane-until-beat` / `release-lane`.
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
      // The BGA renderer itself stops cue changes at an LR2 negative-BPM reversal (a playing movie keeps running), so
      // it is driven by the true clock.
      const bgaANSILines = useKittyGraphicsForBGA
        ? undefined
        : bgaRenderer?.getANSILines(latestFrame.currentSeconds, latestFrame.keyBoundBGA);
      const bgaKittyImage = useKittyGraphicsForBGA
        ? bgaRenderer?.getKittyImage(latestFrame.currentSeconds, latestFrame.keyBoundBGA)
        : undefined;
      if (useKittyGraphicsForBGA) {
        if (bgaKittyImage && !loggedFirstKittyImageReady) {
          loggedFirstKittyImageReady = true;
          postLog('info', 'ui-worker.bga.kitty-image.ready', {
            seconds: latestFrame.currentSeconds,
            cellWidth: bgaKittyImage.cellWidth,
            cellHeight: bgaKittyImage.cellHeight,
            pixelWidth: bgaKittyImage.pixelWidth,
            pixelHeight: bgaKittyImage.pixelHeight,
          });
        } else if (!bgaKittyImage && !loggedFirstKittyImageMissing) {
          loggedFirstKittyImageMissing = true;
          postLog('warn', 'ui-worker.bga.kitty-image.missing', {
            seconds: latestFrame.currentSeconds,
            hasBGARenderer: Boolean(bgaRenderer),
          });
        }
      } else if (bgaANSILines && bgaANSILines.length > 0 && !loggedFirstANSIFrameReady) {
        loggedFirstANSIFrameReady = true;
        postLog('info', 'ui-worker.bga.ansi-frame.ready', {
          seconds: latestFrame.currentSeconds,
          lineCount: bgaANSILines.length,
        });
      }
      tui.render({
        ...latestFrame,
        bgaANSILines,
        bgaKittyImage,
      });
      if (!firstFrameRendered) {
        firstFrameRendered = true;
        postLog('info', 'ui-worker.first-frame.rendered', {
          seconds: latestFrame.currentSeconds,
        });
      }
    },
    {
      minIntervalMs: resolveTUIRenderMinIntervalMs(initData.uiFPS),
    },
  );

  const handleRenderMessage = (message: NodeUIWorkerInboundMessage): boolean => {
    if (message.kind === 'start') {
      postLog('info', 'ui-worker.start.received');
      tui.start();
      if (!bgaStreamingScheduled) {
        bgaStreamingScheduled = true;
        setImmediate(() => {
          bgaRenderer?.startStreaming();
        });
      }
      deferredUIFlush.markFrameDirty();
      return true;
    }
    if (message.kind === 'frame') {
      frameState.setFrame(message.frame);
      return true;
    }
    if (message.kind === 'commands') {
      queuedCommands.push(...message.commands);
      deferredUIFlush.markCommandsDirty();
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

  const handleControlMessage = (message: NodeUIWorkerInboundMessage): void => {
    if (message.kind === 'attach-bridge-port') {
      bridgePort?.off('message', handleControlMessage);
      bridgePort = message.port;
      bridgePort.on('message', handleControlMessage);
      postLog('info', 'ui-worker.bridge-port.attached');
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
      deferredUIFlush.dispose();
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

function resolveSplitAfterIndex(bindings: NodeUIWorkerInitData['laneBindings']): number {
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

function resolveTUIRenderMinIntervalMs(uiFPS: number | undefined): number {
  const fps = typeof uiFPS === 'number' && Number.isFinite(uiFPS) && uiFPS > 0 ? uiFPS : DEFAULT_UI_FPS;
  return 1000 / fps;
}

function estimateBgaANSIDisplaySize(
  bindings: NodeUIWorkerInitData['laneBindings'],
  columns = process.stdout.columns,
  rows = process.stdout.rows,
  frame?: Pick<PlayerUIFramePayload, 'activeAudioFiles' | 'activeAudioVoiceCount'>,
): { width: number; height: number } {
  return resolveBGADisplaySize({
    laneWidths: resolveLaneWidths(bindings),
    splitAfterIndex: resolveSplitAfterIndex(bindings),
    columns,
    rows,
    showLaneChannels: Boolean(initData.showLaneChannels),
    hasRandomPatternSummary:
      typeof initData.randomPatternSummary === 'string' && initData.randomPatternSummary.length > 0,
    hasAudioDebugLine: frame?.activeAudioFiles !== undefined || frame?.activeAudioVoiceCount !== undefined,
  });
}

function postWorkerMessage(message: NodeUIWorkerOutboundMessage): void {
  port?.postMessage(message);
}

function postLog(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  postWorkerMessage({
    kind: 'log',
    entry: {
      source: 'ui-worker',
      level,
      event,
      fields: {
        emittedAtUnixMs: Date.now(),
        emittedAtMonotonicMs: performance.now(),
        ...fields,
      },
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
