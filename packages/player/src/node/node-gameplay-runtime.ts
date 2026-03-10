import { effect } from 'alien-signals';
import { createAbortError } from '@be-music/utils';
import type { BeMusicJson } from '@be-music/json';
import { fileURLToPath } from 'node:url';
import { Worker, type TransferListItem } from 'node:worker_threads';
import { createPlayerInputSignalBus } from '../core/player-input-signal-bus.ts';
import type { PlayerLoadProgress, PlayerSummary } from '../core/player-engine.ts';
import { PlayerInterruptedError } from '../core/player-engine.ts';
import { createNodeInputRuntime, type NodeInputRuntime } from './node-input-runtime.ts';
import { createNodeUiRuntime, type NodeUiRuntime } from './node-ui-runtime.ts';
import type {
  NodeGameplayWorkerInboundMessage,
  NodeGameplayWorkerInitData,
  NodeGameplayWorkerOutboundMessage,
  NodeGameplayWorkerPlayOptions,
  NodeGameplayResolvedChartMetadata,
} from './node-gameplay-worker-protocol.ts';

export interface NodeGameplayRuntimeOptions {
  json: BeMusicJson;
  mode: 'auto' | 'manual';
  autoScratch?: boolean;
  playOptions: NodeGameplayWorkerPlayOptions;
  signal?: AbortSignal;
  onLoadProgress?: (progress: PlayerLoadProgress) => void;
  onLoadComplete?: () => void;
  onResolvedChart?: (metadata: NodeGameplayResolvedChartMetadata) => void;
  onHighSpeedChange?: (value: number) => void;
  writeOutput?: (text: string) => void;
}

export async function runNodeGameplayRuntime(options: NodeGameplayRuntimeOptions): Promise<PlayerSummary> {
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  const worker = new Worker(resolveNodeGameplayWorkerUrl(), {
    workerData: createWorkerInitData(options),
    execArgv: resolveNodeGameplayWorkerExecArgv(),
    env: resolveNodeGameplayWorkerEnv(),
  });
  const writeOutput = options.writeOutput ?? ((text: string) => process.stdout.write(text));

  let inputRuntime: NodeInputRuntime | undefined;
  let stopInputEffect = (): void => undefined;
  let uiRuntime: NodeUiRuntime | undefined;
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
        });
        stopInputEffect = effect(() => {
          inputSignals.tick();
          const commands = inputSignals.drainCommands();
          if (commands.length > 0) {
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
        void handleUiInit(worker, message, {
          setRuntime: (runtime) => {
            uiRuntime = runtime;
          },
        });
        return;
      }
      if (message.kind === 'ui-stop') {
        void handleUiLifecycleAck(worker, message.requestId, 'ui-stop-result', () => uiRuntime?.stop());
        return;
      }
      if (message.kind === 'ui-dispose') {
        void handleUiLifecycleAck(worker, message.requestId, 'ui-dispose-result', async () => {
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

async function handleUiInit(
  worker: Worker,
  message: Extract<NodeGameplayWorkerOutboundMessage, { kind: 'ui-init' }>,
  runtimeStore: {
    setRuntime: (runtime: NodeUiRuntime | undefined) => void;
  },
): Promise<void> {
  try {
    const runtime = await createNodeUiRuntime({
      json: message.runtime.json,
      mode: message.runtime.mode,
      laneDisplayMode: message.runtime.laneDisplayMode,
      laneBindings: message.runtime.laneBindings,
      speed: message.runtime.speed,
      judgeWindowMs: message.runtime.judgeWindowMs,
      highSpeed: message.runtime.highSpeed,
      showLaneChannels: message.runtime.showLaneChannels,
      randomPatternSummary: message.runtime.randomPatternSummary,
      baseDir: message.runtime.baseDir,
      initialPaused: message.runtime.initialPaused,
      initialJudgeCombo: message.runtime.initialJudgeCombo,
      onBgaLoadProgress: (progress) => {
        postWorkerMessage(worker, {
          kind: 'ui-bga-load-progress',
          requestId: message.requestId,
          progress,
        });
      },
    });
    runtimeStore.setRuntime(runtime.tuiEnabled ? runtime : undefined);
    const transferList: TransferListItem[] = [];
    const response: NodeGameplayWorkerInboundMessage = {
      kind: 'ui-init-result',
      requestId: message.requestId,
      enabled: runtime.tuiEnabled,
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
    });
  }
}

async function handleUiLifecycleAck(
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
    mode: options.mode,
    autoScratch: options.autoScratch,
    playOptions: options.playOptions,
  };
}

function resolveNodeGameplayWorkerUrl(): URL {
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

function resolveNodeGameplayWorkerEnv(): NodeJS.ProcessEnv {
  if (!import.meta.url.endsWith('.ts')) {
    return process.env;
  }

  return {
    ...process.env,
    TSX_TSCONFIG_PATH:
      process.env.TSX_TSCONFIG_PATH ?? fileURLToPath(new URL('../../../../tsconfig.typecheck.json', import.meta.url)),
  };
}

function postWorkerMessage(
  worker: Worker,
  message: NodeGameplayWorkerInboundMessage,
  transferList?: TransferListItem[],
): void {
  worker.postMessage(message, transferList ?? []);
}

async function settleMaybeAsyncWithTimeout(
  task: void | Promise<void> | undefined,
  timeoutMs: number,
): Promise<boolean> {
  if (!task) {
    return true;
  }
  return await settleWithTimeout(Promise.resolve(task), timeoutMs);
}

async function settleWithTimeout(task: Promise<void>, timeoutMs: number): Promise<boolean> {
  let completed = false;
  const guardedTask = task
    .catch(() => undefined)
    .then(() => {
      completed = true;
    });
  await Promise.race([guardedTask, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  return completed;
}
