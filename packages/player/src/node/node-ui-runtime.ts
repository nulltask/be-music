import { effect } from 'alien-signals';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { LaneBinding } from '../manual-input.ts';
import type { PlayerStateSignals } from '../player-state-signals.ts';
import type { PlayerUiSignalBus } from '../core/player-ui-signal-bus.ts';
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
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
  triggerPoor: (seconds: number) => void;
  clearPoor: () => void;
}

export async function createNodeUiRuntime(options: NodeUiRuntimeOptions): Promise<NodeUiRuntime> {
  const worker = new Worker(resolveNodeUiWorkerUrl(), {
    workerData: createWorkerInitData(options),
    execArgv: process.execArgv,
    env: resolveNodeUiWorkerEnv(),
  });
  const workerReady = await waitForWorkerReady(worker, options.loadSignal, options.onBgaLoadProgress);
  if (!workerReady) {
    return {
      tuiEnabled: false,
      start: () => undefined,
      stop: () => Promise.resolve(),
      dispose: () => Promise.resolve(),
      triggerPoor: () => undefined,
      clearPoor: () => undefined,
    };
  }

  let disposed = false;
  let stopPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;
  const postWorkerMessage = (message: NodeUiWorkerInboundMessage): void => {
    if (disposed) {
      return;
    }
    worker.postMessage(message);
  };

  const deferredUiFlush = createDeferredUiFlush(({ commands, frame }) => {
    if (commands) {
      const queuedCommands = options.uiSignals.drainCommands();
      if (queuedCommands.length > 0) {
        postWorkerMessage({ kind: 'commands', commands: queuedCommands });
      }
    }
    if (frame) {
      postWorkerMessage({ kind: 'frame', frame: options.uiSignals.getFrame() });
    }
  });

  const stopFrameEffect = effect(() => {
    options.uiSignals.frameTick();
    deferredUiFlush.markFrameDirty();
  });

  const stopCommandEffect = effect(() => {
    options.uiSignals.commandTick();
    deferredUiFlush.markCommandsDirty();
  });

  const stopPausedEffect = effect(() => {
    postWorkerMessage({ kind: 'set-paused', value: options.stateSignals.paused() });
  });

  const stopHighSpeedEffect = effect(() => {
    postWorkerMessage({ kind: 'set-high-speed', value: options.stateSignals.highSpeed() });
  });

  const stopJudgeComboEffect = effect(() => {
    options.stateSignals.judgeComboTick();
    postWorkerMessage({ kind: 'set-judge-combo', state: options.stateSignals.getJudgeCombo() });
  });

  const detachResizeHandler = attachResizeHandler((columns, rows) => {
    postWorkerMessage({ kind: 'resize', columns, rows });
  });

  return {
    tuiEnabled: true,
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
      deferredUiFlush.dispose();
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
    judgeWindowMs: options.judgeWindowMs,
    highSpeed: resolveHighSpeedMultiplier(options.highSpeed),
    showLaneChannels: options.showLaneChannels,
    randomPatternSummary: options.randomPatternSummary,
    baseDir: options.baseDir,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
  };
}

function resolveNodeUiWorkerUrl(): URL {
  return new URL(import.meta.url.endsWith('.ts') ? './node-ui-worker.ts' : './node-ui-worker.js', import.meta.url);
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
): Promise<boolean> {
  if (signal?.aborted) {
    await worker.terminate();
    throw resolveAbortReason(signal);
  }

  return await new Promise<boolean>((resolve, reject) => {
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
        settle(() => resolve(true));
        return;
      }
      if (message.kind === 'unsupported') {
        settle(() => {
          void worker.terminate();
          resolve(false);
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
        void worker.terminate();
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
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(typeof reason === 'string' && reason.length > 0 ? reason : 'UI worker initialization aborted');
}
