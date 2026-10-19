import { effect } from 'alien-signals';
import { createAbortError } from '@be-music/utils/core';
import type { LogEntry, LogLevel } from '@be-music/utils/log';
import type { BeMusicJSON } from '@be-music/json';
import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import {
  resolveDisplayedJudgeRankLabel,
  resolveDisplayedJudgeRankValue,
  resolveDisplayedPlayLevelValue,
} from '@be-music/player/display';
import {
  autoPlay,
  manualPlay,
  PlayerInterruptedError,
  type CreatePlayerInputRuntimeContext,
  type CreatePlayerUIRuntimeContext,
  type PlayerInputRuntime,
  type PlayerLoadProgress,
} from '@be-music/player';
import { createDeferredUIFlush } from './deferred-ui-flush.ts';
import { createUIFramePatchBuilder } from './ui-frame-patch.ts';
import type {
  NodeGameplayWorkerInboundMessage,
  NodeGameplayWorkerInitData,
  NodeGameplayWorkerOutboundMessage,
  NodeGameplayResolvedChartMetadata,
  NodeGameplayUIRuntimeInit,
} from './node-gameplay-worker-protocol.ts';

const port = parentPort;
const initData = workerData as NodeGameplayWorkerInitData;

void bootstrap().catch((error) => {
  postWorkerMessage({
    kind: 'error',
    name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  throw error;
});

async function bootstrap(): Promise<void> {
  if (!port) {
    throw new Error('Gameplay worker parent port is unavailable');
  }
  postLog('info', 'gameplay-worker.bootstrap.start', {
    mode: initData.mode,
    tui: Boolean(initData.playOptions.tui),
  });

  const abortController = new AbortController();
  let bridgedInputContext: CreatePlayerInputRuntimeContext | undefined;
  let nextUIRequestId = 0;

  const pendingUIInit = new Map<
    number,
    {
      resolve: (result: { enabled: boolean; port?: MessagePort; bgaPlaybackEndSeconds?: number }) => void;
      reject: (error: Error) => void;
      onProgress: CreatePlayerUIRuntimeContext['onBGALoadProgress'];
    }
  >();
  const pendingUIStop = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  const pendingUIDispose = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();

  port.on('message', (message: NodeGameplayWorkerInboundMessage) => {
    if (message.kind === 'abort') {
      if (!abortController.signal.aborted) {
        abortController.abort(resolveAbortReason(message.reason));
      }
      return;
    }
    if (message.kind === 'input-commands') {
      postLog('info', 'input-runtime.bridge.commands', {
        count: message.commands.length,
        commands: message.commands.map((command) => command.kind).join(','),
      });
      for (const command of message.commands) {
        bridgedInputContext?.inputSignals.pushCommand(command);
      }
      return;
    }
    if (message.kind === 'ui-init-result') {
      const pending = pendingUIInit.get(message.requestId);
      if (!pending) {
        return;
      }
      pendingUIInit.delete(message.requestId);
      if (typeof message.error === 'string' && message.error.length > 0) {
        pending.reject(deserializeUIInitError(message.error, message.errorName));
        return;
      }
      pending.resolve({
        enabled: message.enabled,
        port: message.port,
        bgaPlaybackEndSeconds: message.bgaPlaybackEndSeconds,
      });
      return;
    }
    if (message.kind === 'ui-bga-load-progress') {
      const pending = pendingUIInit.get(message.requestId);
      pending?.onProgress(message.progress);
      return;
    }
    const pendingAcks = message.kind === 'ui-stop-result' ? pendingUIStop : pendingUIDispose;
    const pending = pendingAcks.get(message.requestId);
    if (!pending) {
      return;
    }
    pendingAcks.delete(message.requestId);
    if (typeof message.error === 'string' && message.error.length > 0) {
      pending.reject(new Error(message.error));
      return;
    }
    pending.resolve();
  });

  const createInputRuntime = (context: CreatePlayerInputRuntimeContext): PlayerInputRuntime => {
    bridgedInputContext = context;
    postWorkerMessage({
      kind: 'input-init',
      runtime: {
        mode: context.mode,
        inputTokenToChannelsEntries: [...context.inputTokenToChannels.entries()].map(([token, channels]) => [
          token,
          [...channels],
        ]),
      },
    });
    let started = false;
    let stopped = false;

    return {
      // The main thread's input runtime reads the keys; it knew before the play whether they report their releases.
      ...(initData.inputReportsKeyReleases === true ? { reportsKeyReleases: true } : {}),
      start: () => {
        if (started || stopped) {
          return;
        }
        started = true;
        postWorkerMessage({ kind: 'input-start' });
      },
      stop: () => {
        if (stopped) {
          return;
        }
        stopped = true;
        postWorkerMessage({ kind: 'input-stop' });
      },
    };
  };

  const createUIRuntime = async (context: CreatePlayerUIRuntimeContext) => {
    const initRequestId = nextUIRequestId;
    nextUIRequestId += 1;
    postLog('debug', 'ui.init.requested', {
      requestId: initRequestId,
      mode: context.mode,
    });
    const uiInitResult = await requestUIInit(initRequestId, context, pendingUIInit);
    postLog('info', 'ui.init.resolved', {
      requestId: initRequestId,
      enabled: uiInitResult.enabled,
      bgaPlaybackEndSeconds: uiInitResult.bgaPlaybackEndSeconds,
    });
    if (!uiInitResult.enabled) {
      postWorkerMessage({
        kind: 'output',
        text: 'TUI is unavailable in this environment. Falling back to text output.\n',
      });
      return {
        tuiEnabled: false,
        start: () => undefined,
        stop: () => Promise.resolve(),
        dispose: () => Promise.resolve(),
        triggerPoor: () => undefined,
        clearPoor: () => undefined,
      };
    }
    if (!uiInitResult.port) {
      throw new Error('UI bridge port is unavailable');
    }
    const bridgePort = uiInitResult.port;

    const buildUIFramePatch = createUIFramePatchBuilder();
    const postUIMessage = (
      message:
        | { kind: 'start' }
        | { kind: 'frame'; frame: ReturnType<typeof buildUIFramePatch> }
        | { kind: 'commands'; commands: ReturnType<CreatePlayerUIRuntimeContext['uiSignals']['drainCommands']> }
        | { kind: 'set-paused'; value: boolean }
        | { kind: 'set-high-speed'; value: number }
        | { kind: 'set-judge-combo'; state: ReturnType<CreatePlayerUIRuntimeContext['stateSignals']['getJudgeCombo']> }
        | { kind: 'trigger-poor'; seconds: number }
        | { kind: 'clear-poor' },
    ): void => {
      bridgePort.postMessage(message);
    };
    const createUIFrameMessage = (
      frame: ReturnType<CreatePlayerUIRuntimeContext['uiSignals']['getFrame']>,
    ): { kind: 'frame'; frame: ReturnType<typeof buildUIFramePatch> } => ({
      kind: 'frame',
      frame: buildUIFramePatch(frame),
    });

    let disposed = false;
    let stopPromise: Promise<void> | undefined;
    let disposePromise: Promise<void> | undefined;

    const deferredUIFlush = createDeferredUIFlush(({ commands, frame }) => {
      if (commands) {
        const queuedCommands = context.uiSignals.drainCommands();
        if (queuedCommands.length > 0) {
          postUIMessage({ kind: 'commands', commands: queuedCommands });
        }
      }
      if (frame) {
        postUIMessage(createUIFrameMessage(context.uiSignals.getFrame()));
      }
    });

    const stopFrameEffect = effect(() => {
      context.uiSignals.frameTick();
      deferredUIFlush.markFrameDirty();
    });

    const stopCommandEffect = effect(() => {
      context.uiSignals.commandTick();
      deferredUIFlush.markCommandsDirty();
    });

    const stopPausedEffect = effect(() => {
      postUIMessage({ kind: 'set-paused', value: context.stateSignals.paused() });
    });

    const stopHighSpeedEffect = effect(() => {
      postUIMessage({ kind: 'set-high-speed', value: context.stateSignals.highSpeed() });
    });

    const stopJudgeComboEffect = effect(() => {
      context.stateSignals.judgeComboTick();
      postUIMessage({ kind: 'set-judge-combo', state: context.stateSignals.getJudgeCombo() });
    });

    return {
      tuiEnabled: true,
      playbackEndSeconds: uiInitResult.bgaPlaybackEndSeconds,
      start: () => {
        if (disposed) {
          return;
        }
        postLog('info', 'ui.start.posted');
        postUIMessage({ kind: 'start' });
      },
      stop: () => {
        if (disposed) {
          return Promise.resolve();
        }
        if (stopPromise) {
          return stopPromise;
        }
        const requestId = nextUIRequestId;
        nextUIRequestId += 1;
        stopPromise = requestUILifecycleAck('ui-stop', requestId, pendingUIStop);
        return stopPromise;
      },
      dispose: () => {
        if (disposePromise) {
          return disposePromise;
        }
        disposed = true;
        bridgePort.close();
        deferredUIFlush.dispose();
        stopFrameEffect();
        stopCommandEffect();
        stopPausedEffect();
        stopHighSpeedEffect();
        stopJudgeComboEffect();
        const requestId = nextUIRequestId;
        nextUIRequestId += 1;
        disposePromise = requestUILifecycleAck('ui-dispose', requestId, pendingUIDispose);
        return disposePromise;
      },
      triggerPoor: (seconds: number) => {
        if (disposed) {
          return;
        }
        postUIMessage({ kind: 'trigger-poor', seconds });
      },
      clearPoor: () => {
        if (disposed) {
          return;
        }
        postUIMessage({ kind: 'clear-poor' });
      },
    };
  };

  try {
    const playOptions = {
      ...initData.playOptions,
      ...(initData.randomDraws !== undefined ? { randomDraws: initData.randomDraws } : {}),
      signal: abortController.signal,
      createInputRuntime,
      createUIRuntime: initData.playOptions.tui ? createUIRuntime : undefined,
      writeOutput: (text: string): void => {
        postWorkerMessage({ kind: 'output', text });
      },
      onHighSpeedChange: (value: number): void => {
        postWorkerMessage({ kind: 'high-speed', value });
      },
      onLoadProgress: (progress: PlayerLoadProgress): void => {
        postWorkerMessage({ kind: 'load-progress', progress });
      },
      onLoadComplete: (): void => {
        postWorkerMessage({ kind: 'load-complete' });
      },
      onResolvedChart: (json: BeMusicJSON): void => {
        const metadata: NodeGameplayResolvedChartMetadata = {
          title: json.metadata.title,
          artist: json.metadata.artist,
          player: json.bms.player,
          rank: resolveDisplayedJudgeRankValue(json),
          rankLabel: resolveDisplayedJudgeRankLabel(json),
          playLevel: resolveDisplayedPlayLevelValue(json),
        };
        postWorkerMessage({
          kind: 'resolved-chart',
          metadata,
        });
      },
      onLog: (entry: LogEntry) => {
        postWorkerMessage({
          kind: 'log',
          entry,
        });
      },
    };

    const summary =
      initData.mode === 'auto'
        ? await autoPlay(initData.json, {
            ...playOptions,
            auto: true,
          })
        : await manualPlay(initData.json, {
            ...playOptions,
            autoScratch: Boolean(initData.autoScratch),
          });
    postWorkerMessage({ kind: 'result', summary });
  } catch (error) {
    if (error instanceof PlayerInterruptedError) {
      postWorkerMessage({ kind: 'interrupted', reason: error.reason });
    } else {
      postWorkerMessage({
        kind: 'error',
        name: error instanceof Error ? error.name : undefined,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  } finally {
    port.close();
  }
}

function requestUIInit(
  requestId: number,
  context: CreatePlayerUIRuntimeContext,
  pendingUIInit: Map<
    number,
    {
      resolve: (result: { enabled: boolean; port?: MessagePort; bgaPlaybackEndSeconds?: number }) => void;
      reject: (error: Error) => void;
      onProgress: CreatePlayerUIRuntimeContext['onBGALoadProgress'];
    }
  >,
): Promise<{ enabled: boolean; port?: MessagePort; bgaPlaybackEndSeconds?: number }> {
  return new Promise<{ enabled: boolean; port?: MessagePort; bgaPlaybackEndSeconds?: number }>((resolve, reject) => {
    pendingUIInit.set(requestId, {
      resolve,
      reject,
      onProgress: context.onBGALoadProgress,
    });
    postWorkerMessage({
      kind: 'ui-init',
      requestId,
      runtime: serializeUIRuntimeInit(context),
    });
  });
}

function requestUILifecycleAck(
  kind: 'ui-stop' | 'ui-dispose',
  requestId: number,
  pending: Map<number, { resolve: () => void; reject: (error: Error) => void }>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    postWorkerMessage({ kind, requestId });
  });
}

function serializeUIRuntimeInit(context: CreatePlayerUIRuntimeContext): NodeGameplayUIRuntimeInit {
  return {
    json: context.json,
    mode: context.mode,
    laneDisplayMode: context.laneDisplayMode,
    laneBindings: [...context.laneBindings],
    speed: context.speed,
    uiFPS: context.uiFPS,
    tuiVisibleNotesLimit: context.tuiVisibleNotesLimit,
    tuiNoteHeight: context.tuiNoteHeight,
    judgeWindowMs: context.judgeWindowMs,
    highSpeed: context.highSpeed,
    imageResizeAlgorithm: context.imageResizeAlgorithm,
    showLaneChannels: context.showLaneChannels,
    randomPatternSummary: context.randomPatternSummary,
    baseDir: context.baseDir,
    kittyGraphics: Boolean(initData.playOptions.kittyGraphics),
    videoBGAStreaming: context.videoBGAStreaming !== false,
    initialFrame: context.uiSignals.getFrame(),
    initialPaused: context.stateSignals.paused(),
    initialJudgeCombo: context.stateSignals.getJudgeCombo(),
  };
}

function resolveAbortReason(reason?: string): Error {
  const error = createAbortError();
  if (typeof reason === 'string' && reason.length > 0) {
    error.message = reason;
  }
  return error;
}

function deserializeUIInitError(message: string, name: string | undefined): Error {
  if (name === 'AbortError') {
    return resolveAbortReason(message);
  }
  const error = new Error(message);
  if (typeof name === 'string' && name.length > 0) {
    error.name = name;
  }
  return error;
}

function postWorkerMessage(message: NodeGameplayWorkerOutboundMessage): void {
  port?.postMessage(message);
}

function postLog(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  postWorkerMessage({
    kind: 'log',
    entry: {
      source: 'gameplay-worker',
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
