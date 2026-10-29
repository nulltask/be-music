import { settleWithTimeout as settleMaybeAsyncWithTimeout } from '@be-music/shared-utils/async';
import { effect } from 'alien-signals';
import { createAbortError } from '@be-music/shared-utils/core';
import type { LogEntry } from '@be-music/shared-utils/log';
import type { RandomDraws } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import { Worker, type MessagePort } from 'node:worker_threads';
import { createPlayerInputSignalBus } from '@be-music/player-engine/signals';
import { PlayerInterruptedError, type PlayerLoadProgress, type PlayerSummary } from '@be-music/player-engine';
import {
  createNodeInputRuntime,
  hasNegotiatedStatefulKeyboardProtocol,
  type NodeInputRuntime,
} from './node-input-runtime.ts';
import { createNodeUIRuntime, type NodeUIRuntime } from './node-ui-runtime.ts';
import { createSEAWorker, isSEARuntime } from './sea-worker.ts';
import type {
  NodeGameplayWorkerInboundMessage,
  NodeGameplayWorkerInitData,
  NodeGameplayWorkerOutboundMessage,
  NodeGameplayWorkerPlayOptions,
  NodeGameplayResolvedChartMetadata,
} from './node-gameplay-worker-protocol.ts';

export interface NodeGameplayRuntimeOptions {
  /** The chart to play, already resolved (`resolveBMSControlFlowWithDraws`). */
  json: BeMusicJSON;
  /** The `#RANDOM` / `#SWITCH` draws `json` was resolved with, for the engine's RANDOM summary. */
  randomDraws?: RandomDraws;
  mode: 'auto' | 'manual';
  autoScratch?: boolean;
  playOptions: NodeGameplayWorkerPlayOptions;
  signal?: AbortSignal;
  onLoadProgress?: (progress: PlayerLoadProgress) => void;
  onLoadComplete?: () => void;
  onLog?: (entry: LogEntry) => void;
  onResolvedChart?: (metadata: NodeGameplayResolvedChartMetadata) => void;
  onHighSpeedChange?: (value: number) => void;
  writeOutput?: (text: string) => void;
}

export async function runNodeGameplayRuntime(options: NodeGameplayRuntimeOptions): Promise<PlayerSummary> {
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const worker = isSEARuntime()
    ? createSEAWorker('node-gameplay-worker', createWorkerInitData(options))
    : new Worker(resolveNodeGameplayWorkerURL(), {
        workerData: createWorkerInitData(options),
        execArgv: resolveNodeGameplayWorkerExecArgv(),
      });
  const writeOutput = options.writeOutput ?? ((text: string) => process.stdout.write(text));

  let inputRuntime: NodeInputRuntime | undefined;
  let stopInputEffect = (): void => undefined;
  let uiRuntime: NodeUIRuntime | undefined;
  let settled = false;

  const cleanup = async (): Promise<void> => {
    inputRuntime?.stop();
    inputRuntime = undefined;
    stopInputEffect();
    stopInputEffect = () => undefined;
    await settleMaybeAsyncWithTimeout(uiRuntime?.stop(), 200);
    await settleMaybeAsyncWithTimeout(uiRuntime?.dispose(), 300);
    uiRuntime = undefined;
  };

  return await new Promise<PlayerSummary>((resolve, reject) => {
    const signal = options.signal;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup()
        .catch(() => undefined)
        .finally(() => {
          worker.off('message', onMessage);
          worker.off('error', onError);
          worker.off('exit', onExit);
          signal?.removeEventListener('abort', onAbort);
          callback();
        });
    };

    const onMessage = (message: NodeGameplayWorkerOutboundMessage): void => {
      if (message.kind === 'load-progress') {
        options.onLoadProgress?.(message.progress);
        return;
      }
      if (message.kind === 'load-complete') {
        options.onLoadComplete?.();
        return;
      }
      if (message.kind === 'log') {
        options.onLog?.(message.entry);
        return;
      }
      if (message.kind === 'resolved-chart') {
        options.onResolvedChart?.(message.metadata);
        return;
      }
      if (message.kind === 'output') {
        writeOutput(message.text);
        return;
      }
      if (message.kind === 'high-speed') {
        options.onHighSpeedChange?.(message.value);
        return;
      }
      if (message.kind === 'input-init') {
        inputRuntime?.stop();
        stopInputEffect();
        const inputSignals = createPlayerInputSignalBus();
        inputRuntime = createNodeInputRuntime({
          mode: message.runtime.mode,
          inputSignals,
          inputTokenToChannels: new Map(
            message.runtime.inputTokenToChannelsEntries.map(([token, channels]) => [token, [...channels]]),
          ),
          onLog: options.onLog,
        });
        stopInputEffect = effect(() => {
          inputSignals.tick();
          const commands = inputSignals.drainCommands();
          if (commands.length > 0) {
            options.onLog?.({
              source: 'input-runtime',
              level: 'info',
              event: 'input-runtime.commands.forwarded',
              fields: {
                emittedAtUnixMs: Date.now(),
                emittedAtMonotonicMs: performance.now(),
                commands: commands.map((command) => command.kind).join(','),
                count: commands.length,
              },
            });
            postWorkerMessage(worker, {
              kind: 'input-commands',
              commands,
            });
          }
        });
        return;
      }
      if (message.kind === 'input-start') {
        inputRuntime?.start();
        return;
      }
      if (message.kind === 'input-stop') {
        inputRuntime?.stop();
        return;
      }
      if (message.kind === 'ui-init') {
        void handleUIInit(worker, message, {
          setRuntime: (runtime) => {
            uiRuntime = runtime;
          },
          loadSignal: signal,
          onLog: options.onLog,
        });
        return;
      }
      if (message.kind === 'ui-stop') {
        void handleUILifecycleAck(worker, message.requestId, 'ui-stop-result', () => uiRuntime?.stop());
        return;
      }
      if (message.kind === 'ui-dispose') {
        void handleUILifecycleAck(worker, message.requestId, 'ui-dispose-result', async () => {
          await uiRuntime?.dispose();
          uiRuntime = undefined;
        });
        return;
      }
      if (message.kind === 'result') {
        settle(() => resolve(message.summary));
        return;
      }
      if (message.kind === 'interrupted') {
        settle(() => reject(new PlayerInterruptedError(message.reason)));
        return;
      }
      if (message.kind === 'error') {
        settle(() => reject(message.name === 'AbortError' ? createAbortError() : new Error(message.message)));
      }
    };

    const onError = (error: Error): void => {
      settle(() => reject(error));
    };

    const onExit = (code: number): void => {
      settle(() => reject(new Error(`Gameplay worker exited unexpectedly (code ${code})`)));
    };

    const onAbort = (): void => {
      postWorkerMessage(worker, { kind: 'abort' });
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function handleUIInit(
  worker: Worker,
  message: Extract<NodeGameplayWorkerOutboundMessage, { kind: 'ui-init' }>,
  runtimeStore: {
    setRuntime: (runtime: NodeUIRuntime | undefined) => void;
    loadSignal?: AbortSignal;
    onLog?: (entry: LogEntry) => void;
  },
): Promise<void> {
  try {
    const runtime = await createNodeUIRuntime({
      json: message.runtime.json,
      mode: message.runtime.mode,
      laneDisplayMode: message.runtime.laneDisplayMode,
      laneBindings: message.runtime.laneBindings,
      speed: message.runtime.speed,
      uiFPS: message.runtime.uiFPS,
      tuiVisibleNotesLimit: message.runtime.tuiVisibleNotesLimit,
      tuiNoteHeight: message.runtime.tuiNoteHeight,
      judgeWindowMs: message.runtime.judgeWindowMs,
      highSpeed: message.runtime.highSpeed,
      imageResizeAlgorithm: message.runtime.imageResizeAlgorithm,
      showLaneChannels: message.runtime.showLaneChannels,
      randomPatternSummary: message.runtime.randomPatternSummary,
      baseDir: message.runtime.baseDir,
      kittyGraphics: message.runtime.kittyGraphics,
      videoBGAStreaming: message.runtime.videoBGAStreaming,
      keyBoundBGACues: message.runtime.keyBoundBGACues,
      bmsonBGACues: message.runtime.bmsonBGACues,
      initialFrame: message.runtime.initialFrame,
      initialPaused: message.runtime.initialPaused,
      initialJudgeCombo: message.runtime.initialJudgeCombo,
      loadSignal: runtimeStore.loadSignal,
      onLog: runtimeStore.onLog,
      onBGALoadProgress: (progress) => {
        postWorkerMessage(worker, {
          kind: 'ui-bga-load-progress',
          requestId: message.requestId,
          progress,
        });
      },
    });
    runtimeStore.setRuntime(runtime.tuiEnabled ? runtime : undefined);
    const transferList: MessagePort[] = [];
    const response: NodeGameplayWorkerInboundMessage = {
      kind: 'ui-init-result',
      requestId: message.requestId,
      enabled: runtime.tuiEnabled,
      bgaPlaybackEndSeconds: runtime.playbackEndSeconds,
    };
    if (runtime.tuiEnabled) {
      response.port = runtime.createBridgePort();
      transferList.push(response.port);
    }
    postWorkerMessage(worker, response, transferList);
  } catch (error) {
    runtimeStore.setRuntime(undefined);
    postWorkerMessage(worker, {
      kind: 'ui-init-result',
      requestId: message.requestId,
      enabled: false,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined,
    });
  }
}

async function handleUILifecycleAck(
  worker: Worker,
  requestId: number,
  kind: 'ui-stop-result' | 'ui-dispose-result',
  action: () => void | Promise<void>,
): Promise<void> {
  try {
    await Promise.resolve(action());
    postWorkerMessage(worker, { kind, requestId });
  } catch (error) {
    postWorkerMessage(worker, {
      kind,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function createWorkerInitData(options: NodeGameplayRuntimeOptions): NodeGameplayWorkerInitData {
  return {
    json: options.json,
    ...(options.randomDraws !== undefined ? { randomDraws: options.randomDraws } : {}),
    mode: options.mode,
    autoScratch: options.autoScratch,
    playOptions: options.playOptions,
    ...(hasNegotiatedStatefulKeyboardProtocol() ? { inputReportsKeyReleases: true } : {}),
  };
}

function resolveNodeGameplayWorkerURL(): URL {
  return new URL(
    import.meta.url.endsWith('.ts') ? './node-gameplay-worker.ts' : './node-gameplay-worker.js',
    import.meta.url,
  );
}

function resolveNodeGameplayWorkerExecArgv(): string[] {
  if (!import.meta.url.endsWith('.ts')) {
    return process.execArgv;
  }
  if (process.execArgv.includes('--conditions=source')) {
    return process.execArgv;
  }
  return [...process.execArgv, '--conditions=source'];
}

function postWorkerMessage(
  worker: Worker,
  message: NodeGameplayWorkerInboundMessage,
  transferList?: MessagePort[],
): void {
  worker.postMessage(message, transferList ?? []);
}
