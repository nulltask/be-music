import { createAbortError, isAbortError } from '@be-music/utils';
import { effect } from 'alien-signals';
import { fileURLToPath } from 'node:url';
import { MessageChannel, type MessagePort, Worker } from 'node:worker_threads';
import type { LaneBinding } from '../manual-input.ts';
import type { PlayerStateSignals } from '../state-signals.ts';
import type { PlayerUiSignalBus } from '../core/ui-signal-bus.ts';
import { resolveHighSpeedMultiplier } from '../core/high-speed-control.ts';
import { createDeferredUiFlush } from './deferred-ui-flush.ts';
import type {
  NodeUiWorkerInboundMessage,
  NodeUiWorkerInitData,
  NodeUiWorkerOutboundMessage,
} from './node-ui-worker-protocol.ts';

export interface NodeUiRuntimeOptions {
  json: NodeUiWorkerInitData['json'];
  mode: NodeUiWorkerInitData['mode'];
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  uiFps?: number;
  judgeWindowMs: number;
  highSpeed: number;
  showLaneChannels?: boolean;
  randomPatternSummary?: string;
  kittyGraphics?: boolean;
  stateSignals?: PlayerStateSignals;
  uiSignals?: PlayerUiSignalBus;
  baseDir: string;
  loadSignal?: AbortSignal;
  onBgaLoadProgress?: (progress: { ratio: number; detail?: string }) => void;
  initialPaused?: boolean;
  initialJudgeCombo?: ReturnType<PlayerStateSignals['getJudgeCombo']>;
}

export interface NodeUiRuntime {
  readonly tuiEnabled: boolean;
  readonly playbackEndSeconds?: number;
  start: () => void;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
  triggerPoor: (seconds: number) => void;
  clearPoor: () => void;
  createBridgePort: () => MessagePort;
}

export async function createNodeUiRuntime(options: NodeUiRuntimeOptions): Promise<NodeUiRuntime> {
  const worker = new Worker(resolveNodeUiWorkerUrl(), {
    workerData: createWorkerInitData(options),
    execArgv: resolveNodeUiWorkerExecArgv(),
    env: resolveNodeUiWorkerEnv(),
  });
  const workerReady = await waitForWorkerReady(worker, options.loadSignal, options.onBgaLoadProgress);
  if (!workerReady.enabled) {
    return {
      tuiEnabled: false,
      start: () => undefined,
      stop: () => Promise.resolve(),
      dispose: () => Promise.resolve(),
      triggerPoor: () => undefined,
      clearPoor: () => undefined,
      createBridgePort: () => {
        throw new Error('TUI bridge port is unavailable');
      },
    };
  }

  let disposed = false;
  let stopPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;
  let bridgePortAttached = false;
  const postWorkerMessage = (message: NodeUiWorkerInboundMessage): void => {
    if (disposed) {
      return;
    }
    worker.postMessage(message);
  };

  const deferredUiFlush =
    options.uiSignals && options.stateSignals
      ? createDeferredUiFlush(({ commands, frame }) => {
          if (commands) {
            const queuedCommands = options.uiSignals?.drainCommands() ?? [];
            if (queuedCommands.length > 0) {
              postWorkerMessage({ kind: 'commands', commands: queuedCommands });
            }
          }
          if (frame) {
            const frameState = options.uiSignals?.getFrame();
            if (frameState) {
              postWorkerMessage({ kind: 'frame', frame: frameState });
            }
          }
        })
      : undefined;

  const stopFrameEffect =
    options.uiSignals && deferredUiFlush
      ? effect(() => {
          options.uiSignals?.frameTick();
          deferredUiFlush.markFrameDirty();
        })
      : () => undefined;

  const stopCommandEffect =
    options.uiSignals && deferredUiFlush
      ? effect(() => {
          options.uiSignals?.commandTick();
          deferredUiFlush.markCommandsDirty();
        })
      : () => undefined;

  const stopPausedEffect =
    options.stateSignals && options.uiSignals
      ? effect(() => {
          postWorkerMessage({ kind: 'set-paused', value: options.stateSignals?.paused() ?? false });
        })
      : () => undefined;

  const stopHighSpeedEffect =
    options.stateSignals && options.uiSignals
      ? effect(() => {
          postWorkerMessage({ kind: 'set-high-speed', value: options.stateSignals?.highSpeed() ?? options.highSpeed });
        })
      : () => undefined;

  const stopJudgeComboEffect =
    options.stateSignals && options.uiSignals
      ? effect(() => {
          options.stateSignals?.judgeComboTick();
          const state = options.stateSignals?.getJudgeCombo();
          if (state) {
            postWorkerMessage({ kind: 'set-judge-combo', state });
          }
        })
      : () => undefined;

  const detachResizeHandler = attachResizeHandler((columns, rows) => {
    postWorkerMessage({ kind: 'resize', columns, rows });
  });

  return {
    tuiEnabled: true,
    playbackEndSeconds: workerReady.bgaPlaybackEndSeconds,
    start: () => {
      postWorkerMessage({ kind: 'start' });
    },
    stop: () => {
      if (disposed) {
        return Promise.resolve();
      }
      if (stopPromise) {
        return stopPromise;
      }
      stopPromise = postWorkerMessageAndWaitForAck(worker, { kind: 'stop' }, 'stopped');
      return stopPromise;
    },
    dispose: () => {
      if (disposePromise) {
        return disposePromise;
      }
      disposed = true;
      deferredUiFlush?.dispose();
      stopFrameEffect();
      stopCommandEffect();
      stopPausedEffect();
      stopHighSpeedEffect();
      stopJudgeComboEffect();
      detachResizeHandler();
      disposePromise = postWorkerMessageAndWaitForAck(worker, { kind: 'dispose' }, 'disposed', true);
      return disposePromise;
    },
    triggerPoor: (seconds: number) => {
      postWorkerMessage({ kind: 'trigger-poor', seconds });
    },
    clearPoor: () => {
      postWorkerMessage({ kind: 'clear-poor' });
    },
    createBridgePort: () => {
      if (disposed) {
        throw new Error('TUI bridge port is unavailable');
      }
      if (bridgePortAttached) {
        throw new Error('TUI bridge port is already attached');
      }
      const channel = new MessageChannel();
      bridgePortAttached = true;
      worker.postMessage({ kind: 'attach-bridge-port', port: channel.port1 }, [channel.port1]);
      return channel.port2;
    },
  };
}

function postWorkerMessageAndWaitForAck(
  worker: Worker,
  message: NodeUiWorkerInboundMessage,
  expectedKind: Extract<NodeUiWorkerOutboundMessage, { kind: string }>['kind'],
  resolveOnExit = false,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };

    const settle = (cb: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      cb();
    };

    const onMessage = (workerMessage: NodeUiWorkerOutboundMessage): void => {
      if (workerMessage.kind === expectedKind) {
        settle(resolve);
        return;
      }
      if (workerMessage.kind === 'error') {
        settle(() => reject(new Error(workerMessage.message)));
      }
    };

    const onError = (error: Error): void => {
      settle(() => reject(error));
    };

    const onExit = (code: number): void => {
      if (resolveOnExit && code === 0) {
        settle(resolve);
        return;
      }
      settle(() => reject(new Error(`UI worker exited before ${expectedKind} (code ${code})`)));
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    worker.postMessage(message);
  });
}

function createWorkerInitData(options: NodeUiRuntimeOptions): NodeUiWorkerInitData {
  return {
    json: options.json,
    mode: options.mode,
    laneDisplayMode: options.laneDisplayMode,
    laneBindings: options.laneBindings,
    speed: options.speed,
    uiFps: options.uiFps,
    judgeWindowMs: options.judgeWindowMs,
    highSpeed: resolveHighSpeedMultiplier(options.highSpeed),
    showLaneChannels: options.showLaneChannels,
    randomPatternSummary: options.randomPatternSummary,
    baseDir: options.baseDir,
    kittyGraphics: options.kittyGraphics,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    initialPaused: options.initialPaused ?? options.stateSignals?.paused() ?? false,
    initialJudgeCombo: options.initialJudgeCombo ??
      options.stateSignals?.getJudgeCombo() ?? {
        judge: 'READY',
        combo: 0,
        updatedAtMs: 0,
      },
  };
}

function resolveNodeUiWorkerUrl(): URL {
  return new URL(import.meta.url.endsWith('.ts') ? './node-ui-worker.ts' : './node-ui-worker.js', import.meta.url);
}

function resolveNodeUiWorkerExecArgv(): string[] {
  if (!import.meta.url.endsWith('.ts')) {
    return process.execArgv;
  }
  if (process.execArgv.includes('--conditions=source')) {
    return process.execArgv;
  }
  return [...process.execArgv, '--conditions=source'];
}

function resolveNodeUiWorkerEnv(): NodeJS.ProcessEnv {
  if (!import.meta.url.endsWith('.ts')) {
    return process.env;
  }

  return {
    ...process.env,
    TSX_TSCONFIG_PATH:
      process.env.TSX_TSCONFIG_PATH ?? fileURLToPath(new URL('../../../../tsconfig.typecheck.json', import.meta.url)),
  };
}

async function waitForWorkerReady(
  worker: Worker,
  signal: AbortSignal | undefined,
  onBgaLoadProgress: NodeUiRuntimeOptions['onBgaLoadProgress'],
): Promise<{ enabled: boolean; bgaPlaybackEndSeconds?: number }> {
  if (signal?.aborted) {
    await worker.terminate();
    throw resolveAbortReason(signal);
  }

  return await new Promise<{ enabled: boolean; bgaPlaybackEndSeconds?: number }>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      signal?.removeEventListener('abort', onAbort);
    };

    const settle = (cb: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      cb();
    };

    const onMessage = (message: NodeUiWorkerOutboundMessage): void => {
      if (message.kind === 'bga-load-progress') {
        onBgaLoadProgress?.(message.progress);
        return;
      }
      if (message.kind === 'ready') {
        settle(() =>
          resolve({
            enabled: true,
            bgaPlaybackEndSeconds: message.bgaPlaybackEndSeconds,
          }),
        );
        return;
      }
      if (message.kind === 'unsupported') {
        settle(() => {
          void worker.terminate();
          resolve({ enabled: false });
        });
        return;
      }
      if (message.kind === 'error') {
        settle(() => reject(new Error(message.message)));
      }
    };

    const onError = (error: Error): void => {
      settle(() => reject(error));
    };

    const onExit = (code: number): void => {
      settle(() => reject(new Error(`UI worker exited before ready (code ${code})`)));
    };

    const onAbort = (): void => {
      settle(() => {
        postWorkerAbort(worker, signal);
        reject(resolveAbortReason(signal));
      });
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function attachResizeHandler(onResize: (columns: number | undefined, rows: number | undefined) => void): () => void {
  if (!process.stdout.isTTY) {
    return () => undefined;
  }
  const handleResize = (): void => {
    onResize(process.stdout.columns, process.stdout.rows);
  };
  process.stdout.on('resize', handleResize);
  handleResize();
  return () => {
    process.stdout.off('resize', handleResize);
  };
}

function resolveAbortReason(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason;
  if (isAbortError(reason)) {
    return reason;
  }
  const error = createAbortError();
  if (reason instanceof Error && typeof reason.message === 'string' && reason.message.length > 0) {
    error.message = reason.message;
    return error;
  }
  if (typeof reason === 'string' && reason.length > 0) {
    error.message = reason;
  }
  return error;
}

function postWorkerAbort(worker: Worker, signal: AbortSignal | undefined): void {
  try {
    worker.postMessage({
      kind: 'abort',
      reason: resolveAbortReason(signal).message,
    } satisfies NodeUiWorkerInboundMessage);
  } catch {
    void worker.terminate();
  }
}
