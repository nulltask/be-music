import type { KeyBoundBGACue } from '@be-music/chart-model';
import { createAbortError, isAbortError } from '@be-music/shared-utils/core';
import type { LogEntry } from '@be-music/shared-utils/log';
import { effect } from 'alien-signals';
import { MessageChannel, type MessagePort, Worker } from 'node:worker_threads';
import type { LaneBinding } from '../manual-input.ts';
import {
  resolveHighSpeedMultiplier,
  type PlayerStateSignals,
  type PlayerUISignalBus,
} from '@be-music/player-engine/signals';
import type { ImageResizeAlgorithm, TUINoteHeight } from '@be-music/player-engine/display';
import { createDeferredUIFlush } from './deferred-ui-flush.ts';
import { createSEAWorker, isSEARuntime } from './sea-worker.ts';
import { createUIFramePatchBuilder } from './ui-frame-patch.ts';
import type {
  NodeUIWorkerInboundMessage,
  NodeUIWorkerInitData,
  NodeUIWorkerOutboundMessage,
} from './node-ui-worker-protocol.ts';

export interface NodeUIRuntimeOptions {
  keyBoundBGACues?: readonly KeyBoundBGACue[];
  json: NodeUIWorkerInitData['json'];
  mode: NodeUIWorkerInitData['mode'];
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  uiFPS?: number;
  tuiVisibleNotesLimit?: number;
  tuiNoteHeight: TUINoteHeight;
  judgeWindowMs: number;
  highSpeed: number;
  imageResizeAlgorithm: ImageResizeAlgorithm;
  showLaneChannels?: boolean;
  randomPatternSummary?: string;
  kittyGraphics?: boolean;
  videoBGAStreaming?: boolean;
  stateSignals?: PlayerStateSignals;
  uiSignals?: PlayerUISignalBus;
  initialFrame?: ReturnType<PlayerUISignalBus['getFrame']>;
  baseDir: string;
  loadSignal?: AbortSignal;
  onBGALoadProgress?: (progress: { ratio: number; detail?: string }) => void;
  onLog?: (entry: LogEntry) => void;
  initialPaused?: boolean;
  initialJudgeCombo?: ReturnType<PlayerStateSignals['getJudgeCombo']>;
}

export interface NodeUIRuntime {
  readonly tuiEnabled: boolean;
  readonly playbackEndSeconds?: number;
  start: () => void;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
  triggerPoor: (seconds: number) => void;
  clearPoor: () => void;
  createBridgePort: () => MessagePort;
}

export async function createNodeUIRuntime(options: NodeUIRuntimeOptions): Promise<NodeUIRuntime> {
  const worker = isSEARuntime()
    ? createSEAWorker('node-ui-worker', createWorkerInitData(options))
    : new Worker(resolveNodeUIWorkerURL(), {
        workerData: createWorkerInitData(options),
        execArgv: resolveNodeUIWorkerExecArgv(),
      });
  const workerReady = await waitForWorkerReady(worker, options.loadSignal, options.onBGALoadProgress, options.onLog);
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
  const handleWorkerMessage = (message: NodeUIWorkerOutboundMessage): void => {
    if (message.kind === 'log') {
      options.onLog?.(message.entry);
    }
  };
  worker.on('message', handleWorkerMessage);
  const postWorkerMessage = (message: NodeUIWorkerInboundMessage): void => {
    if (disposed) {
      return;
    }
    worker.postMessage(message);
  };
  const buildUIFramePatch = createUIFramePatchBuilder();
  const postUIFrame = (frameState: Readonly<ReturnType<PlayerUISignalBus['getFrame']>>): void => {
    postWorkerMessage({
      kind: 'frame',
      frame: buildUIFramePatch(frameState),
    });
  };

  const initialFrame = options.initialFrame ?? options.uiSignals?.getFrame();
  if (initialFrame) {
    postUIFrame(initialFrame);
  }

  const deferredUIFlush =
    options.uiSignals && options.stateSignals
      ? createDeferredUIFlush(({ commands, frame }) => {
          if (commands) {
            const queuedCommands = options.uiSignals?.drainCommands() ?? [];
            if (queuedCommands.length > 0) {
              postWorkerMessage({ kind: 'commands', commands: queuedCommands });
            }
          }
          if (frame) {
            const frameState = options.uiSignals?.getFrame();
            if (frameState) {
              postUIFrame(frameState);
            }
          }
        })
      : undefined;

  const stopFrameEffect =
    options.uiSignals && deferredUIFlush
      ? effect(() => {
          options.uiSignals?.frameTick();
          deferredUIFlush.markFrameDirty();
        })
      : () => undefined;

  const stopCommandEffect =
    options.uiSignals && deferredUIFlush
      ? effect(() => {
          options.uiSignals?.commandTick();
          deferredUIFlush.markCommandsDirty();
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
      deferredUIFlush?.dispose();
      stopFrameEffect();
      stopCommandEffect();
      stopPausedEffect();
      stopHighSpeedEffect();
      stopJudgeComboEffect();
      detachResizeHandler();
      worker.off('message', handleWorkerMessage);
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
  message: NodeUIWorkerInboundMessage,
  expectedKind: Extract<NodeUIWorkerOutboundMessage, { kind: string }>['kind'],
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

    const onMessage = (workerMessage: NodeUIWorkerOutboundMessage): void => {
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

function createWorkerInitData(options: NodeUIRuntimeOptions): NodeUIWorkerInitData {
  return {
    json: options.json,
    mode: options.mode,
    laneDisplayMode: options.laneDisplayMode,
    laneBindings: options.laneBindings,
    speed: options.speed,
    uiFPS: options.uiFPS,
    tuiVisibleNotesLimit: options.tuiVisibleNotesLimit,
    tuiNoteHeight: options.tuiNoteHeight,
    judgeWindowMs: options.judgeWindowMs,
    highSpeed: resolveHighSpeedMultiplier(options.highSpeed),
    imageResizeAlgorithm: options.imageResizeAlgorithm,
    showLaneChannels: options.showLaneChannels,
    randomPatternSummary: options.randomPatternSummary,
    baseDir: options.baseDir,
    kittyGraphics: options.kittyGraphics,
    videoBGAStreaming: options.videoBGAStreaming,
    keyBoundBGACues: options.keyBoundBGACues,
    useAlternateScreen: shouldUseAlternateScreen(process.platform),
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

function shouldUseAlternateScreen(platform: NodeJS.Platform): boolean {
  return platform !== 'win32';
}

function resolveNodeUIWorkerURL(): URL {
  return new URL(import.meta.url.endsWith('.ts') ? './node-ui-worker.ts' : './node-ui-worker.js', import.meta.url);
}

function resolveNodeUIWorkerExecArgv(): string[] {
  if (!import.meta.url.endsWith('.ts')) {
    return process.execArgv;
  }
  if (process.execArgv.includes('--conditions=source')) {
    return process.execArgv;
  }
  return [...process.execArgv, '--conditions=source'];
}

async function waitForWorkerReady(
  worker: Worker,
  signal: AbortSignal | undefined,
  onBGALoadProgress: NodeUIRuntimeOptions['onBGALoadProgress'],
  onLog: NodeUIRuntimeOptions['onLog'],
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

    const onMessage = (message: NodeUIWorkerOutboundMessage): void => {
      if (message.kind === 'log') {
        onLog?.(message.entry);
        return;
      }
      if (message.kind === 'bga-load-progress') {
        onBGALoadProgress?.(message.progress);
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
    } satisfies NodeUIWorkerInboundMessage);
  } catch {
    void worker.terminate();
  }
}
