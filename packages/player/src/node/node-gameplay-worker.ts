import { effect } from 'alien-signals';
import { createAbortError } from '@be-music/utils';
import type { BeMusicJson } from '@be-music/json';
import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import {
  resolveDisplayedJudgeRankLabel,
  resolveDisplayedJudgeRankValue,
  resolveDisplayedPlayLevelValue,
} from '../utils.ts';
import type {
  CreatePlayerInputRuntimeContext,
  CreatePlayerUiRuntimeContext,
  PlayerInputRuntime,
} from '../core/engine.ts';
import { autoPlay, manualPlay, PlayerInterruptedError } from '../core/engine.ts';
import type { PlayerLoadProgress } from '../core/engine.ts';
import { createDeferredUiFlush } from './deferred-ui-flush.ts';
import type {
  NodeGameplayWorkerInboundMessage,
  NodeGameplayWorkerInitData,
  NodeGameplayWorkerOutboundMessage,
  NodeGameplayResolvedChartMetadata,
  NodeGameplayUiRuntimeInit,
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

  const abortController = new AbortController();
  let bridgedInputContext: CreatePlayerInputRuntimeContext | undefined;
  let nextUiRequestId = 0;

  const pendingUiInit = new Map<
    number,
    {
      resolve: (result: { enabled: boolean; port?: MessagePort; bgaPlaybackEndSeconds?: number }) => void;
      reject: (error: Error) => void;
      onProgress: CreatePlayerUiRuntimeContext['onBgaLoadProgress'];
    }
  >();
  const pendingUiStop = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  const pendingUiDispose = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();

  port.on('message', (message: NodeGameplayWorkerInboundMessage) => {
    if (message.kind === 'abort') {
      if (!abortController.signal.aborted) {
        abortController.abort(resolveAbortReason(message.reason));
      }
      return;
    }
    if (message.kind === 'input-commands') {
      for (const command of message.commands) {
        bridgedInputContext?.inputSignals.pushCommand(command);
      }
      return;
    }
    if (message.kind === 'ui-init-result') {
      const pending = pendingUiInit.get(message.requestId);
      if (!pending) {
        return;
      }
      pendingUiInit.delete(message.requestId);
      if (typeof message.error === 'string' && message.error.length > 0) {
        pending.reject(deserializeUiInitError(message.error, message.errorName));
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
      const pending = pendingUiInit.get(message.requestId);
      pending?.onProgress(message.progress);
      return;
    }
    const pendingAcks = message.kind === 'ui-stop-result' ? pendingUiStop : pendingUiDispose;
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

  const createUiRuntime = async (context: CreatePlayerUiRuntimeContext) => {
    const initRequestId = nextUiRequestId;
    nextUiRequestId += 1;
    const uiInitResult = await requestUiInit(initRequestId, context, pendingUiInit);
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

    const postUiMessage = (
      message:
        | { kind: 'start' }
        | { kind: 'frame'; frame: ReturnType<CreatePlayerUiRuntimeContext['uiSignals']['getFrame']> }
        | { kind: 'commands'; commands: ReturnType<CreatePlayerUiRuntimeContext['uiSignals']['drainCommands']> }
        | { kind: 'set-paused'; value: boolean }
        | { kind: 'set-high-speed'; value: number }
        | { kind: 'set-judge-combo'; state: ReturnType<CreatePlayerUiRuntimeContext['stateSignals']['getJudgeCombo']> }
        | { kind: 'trigger-poor'; seconds: number }
        | { kind: 'clear-poor' },
    ): void => {
      bridgePort.postMessage(message);
    };

    let disposed = false;
    let stopPromise: Promise<void> | undefined;
    let disposePromise: Promise<void> | undefined;

    const deferredUiFlush = createDeferredUiFlush(({ commands, frame }) => {
      if (commands) {
        const queuedCommands = context.uiSignals.drainCommands();
        if (queuedCommands.length > 0) {
          postUiMessage({ kind: 'commands', commands: queuedCommands });
        }
      }
      if (frame) {
        postUiMessage({ kind: 'frame', frame: context.uiSignals.getFrame() });
      }
    });

    const stopFrameEffect = effect(() => {
      context.uiSignals.frameTick();
      deferredUiFlush.markFrameDirty();
    });

    const stopCommandEffect = effect(() => {
      context.uiSignals.commandTick();
      deferredUiFlush.markCommandsDirty();
    });

    const stopPausedEffect = effect(() => {
      postUiMessage({ kind: 'set-paused', value: context.stateSignals.paused() });
    });

    const stopHighSpeedEffect = effect(() => {
      postUiMessage({ kind: 'set-high-speed', value: context.stateSignals.highSpeed() });
    });

    const stopJudgeComboEffect = effect(() => {
      context.stateSignals.judgeComboTick();
      postUiMessage({ kind: 'set-judge-combo', state: context.stateSignals.getJudgeCombo() });
    });

    return {
      tuiEnabled: true,
      playbackEndSeconds: uiInitResult.bgaPlaybackEndSeconds,
      start: () => {
        if (disposed) {
          return;
        }
        postUiMessage({ kind: 'start' });
      },
      stop: () => {
        if (disposed) {
          return Promise.resolve();
        }
        if (stopPromise) {
          return stopPromise;
        }
        const requestId = nextUiRequestId;
        nextUiRequestId += 1;
        stopPromise = requestUiLifecycleAck('ui-stop', requestId, pendingUiStop);
        return stopPromise;
      },
      dispose: () => {
        if (disposePromise) {
          return disposePromise;
        }
        disposed = true;
        bridgePort.close();
        deferredUiFlush.dispose();
        stopFrameEffect();
        stopCommandEffect();
        stopPausedEffect();
        stopHighSpeedEffect();
        stopJudgeComboEffect();
        const requestId = nextUiRequestId;
        nextUiRequestId += 1;
        disposePromise = requestUiLifecycleAck('ui-dispose', requestId, pendingUiDispose);
        return disposePromise;
      },
      triggerPoor: (seconds: number) => {
        if (disposed) {
          return;
        }
        postUiMessage({ kind: 'trigger-poor', seconds });
      },
      clearPoor: () => {
        if (disposed) {
          return;
        }
        postUiMessage({ kind: 'clear-poor' });
      },
    };
  };

  try {
    const playOptions = {
      ...initData.playOptions,
      signal: abortController.signal,
      createInputRuntime,
      createUiRuntime: initData.playOptions.tui === true ? createUiRuntime : undefined,
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
      onResolvedChart: (json: BeMusicJson): void => {
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
    };

    const summary =
      initData.mode === 'auto'
        ? await autoPlay(initData.json, {
            ...playOptions,
            auto: true,
          })
        : await manualPlay(initData.json, {
            ...playOptions,
            autoScratch: initData.autoScratch === true,
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

function requestUiInit(
  requestId: number,
  context: CreatePlayerUiRuntimeContext,
  pendingUiInit: Map<
    number,
    {
      resolve: (result: { enabled: boolean; port?: MessagePort; bgaPlaybackEndSeconds?: number }) => void;
      reject: (error: Error) => void;
      onProgress: CreatePlayerUiRuntimeContext['onBgaLoadProgress'];
    }
  >,
): Promise<{ enabled: boolean; port?: MessagePort; bgaPlaybackEndSeconds?: number }> {
  return new Promise<{ enabled: boolean; port?: MessagePort; bgaPlaybackEndSeconds?: number }>((resolve, reject) => {
    pendingUiInit.set(requestId, {
      resolve,
      reject,
      onProgress: context.onBgaLoadProgress,
    });
    postWorkerMessage({
      kind: 'ui-init',
      requestId,
      runtime: serializeUiRuntimeInit(context),
    });
  });
}

function requestUiLifecycleAck(
  kind: 'ui-stop' | 'ui-dispose',
  requestId: number,
  pending: Map<number, { resolve: () => void; reject: (error: Error) => void }>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    postWorkerMessage({ kind, requestId });
  });
}

function serializeUiRuntimeInit(context: CreatePlayerUiRuntimeContext): NodeGameplayUiRuntimeInit {
  return {
    json: context.json,
    mode: context.mode,
    laneDisplayMode: context.laneDisplayMode,
    laneBindings: [...context.laneBindings],
    speed: context.speed,
    judgeWindowMs: context.judgeWindowMs,
    highSpeed: context.highSpeed,
    showLaneChannels: context.showLaneChannels,
    randomPatternSummary: context.randomPatternSummary,
    baseDir: context.baseDir,
    kittyGraphics: initData.playOptions.kittyGraphics === true,
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

function deserializeUiInitError(message: string, name: string | undefined): Error {
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
