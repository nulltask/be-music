import { EventEmitter } from 'node:events';
import { isAbortError } from '@be-music/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WorkerOptions } from 'node:worker_threads';
import { createEmptyJson } from '../../../json/src/index.ts';
import { createPlayerUiSignalBus } from '../core/ui-signal-bus.ts';
import { createPlayerStateSignals } from '../state-signals.ts';

type MockWorker = EventEmitter & {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
};

const workerState = vi.hoisted(() => ({
  lastWorker: undefined as MockWorker | undefined,
  lastWorkerOptions: undefined as WorkerOptions | undefined,
  autoAckLifecycle: true,
  autoReadyOnConstruct: true,
  readyMessage: { kind: 'ready' } as { kind: 'ready'; bgaPlaybackEndSeconds?: number },
}));

vi.mock('node:worker_threads', async () => {
  const actual = await vi.importActual<typeof import('node:worker_threads')>('node:worker_threads');
  return {
    ...actual,
    Worker: class MockWorker extends EventEmitter {
      readonly postMessage = vi.fn((message: unknown) => {
        if (!workerState.autoAckLifecycle || typeof message !== 'object' || message === null || !('kind' in message)) {
          return;
        }
        if (message.kind === 'stop') {
          queueMicrotask(() => {
            this.emit('message', { kind: 'stopped' });
          });
          return;
        }
        if (message.kind === 'dispose') {
          queueMicrotask(() => {
            this.emit('message', { kind: 'disposed' });
          });
        }
      });

      readonly terminate = vi.fn(async () => 0);

      constructor(..._args: unknown[]) {
        super();
        workerState.lastWorkerOptions = _args[1] as WorkerOptions | undefined;
        workerState.lastWorker = this;
        if (workerState.autoReadyOnConstruct) {
          queueMicrotask(() => {
            this.emit('message', workerState.readyMessage);
          });
        }
      }
    },
  };
});

import { createNodeUiRuntime } from './node-ui-runtime.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  workerState.lastWorker = undefined;
  workerState.lastWorkerOptions = undefined;
  workerState.autoAckLifecycle = true;
  workerState.autoReadyOnConstruct = true;
  workerState.readyMessage = { kind: 'ready' };
});

describe('node ui runtime', () => {
  test('coalesces frames before posting them to the UI worker', async () => {
    vi.useFakeTimers();
    const uiSignals = createPlayerUiSignalBus(createFrame());
    const runtime = await createNodeUiRuntime(createContext(uiSignals));
    const worker = getLastWorker();

    worker.postMessage.mockClear();
    uiSignals.publishFrame(createFrame({ currentBeat: 1, currentSeconds: 1 }));
    uiSignals.publishFrame(createFrame({ currentBeat: 2, currentSeconds: 2 }));

    expect(messagesOfKind(worker, 'frame')).toHaveLength(0);

    await vi.runAllTimersAsync();

    const frameMessages = messagesOfKind(worker, 'frame');
    expect(frameMessages).toHaveLength(1);
    expect(frameMessages[0]).toMatchObject({
      kind: 'frame',
      frame: {
        currentBeat: 2,
        currentSeconds: 2,
      },
    });

    runtime.dispose();
  });

  test('posts lifecycle and state updates to the UI worker', async () => {
    vi.useFakeTimers();
    const stateSignals = createPlayerStateSignals(1);
    const uiSignals = createPlayerUiSignalBus(createFrame());
    const runtime = await createNodeUiRuntime(createContext(uiSignals, stateSignals));
    const worker = getLastWorker();

    worker.postMessage.mockClear();

    runtime.start();
    expect(messagesOfKind(worker, 'start')).toHaveLength(1);

    stateSignals.setPaused(true);
    expect(messagesOfKind(worker, 'set-paused')).toHaveLength(1);

    stateSignals.setHighSpeed(1.5);
    expect(messagesOfKind(worker, 'set-high-speed')).toHaveLength(1);

    stateSignals.publishJudgeCombo('GREAT', 12, '11', 1_234);
    const judgeMessages = messagesOfKind(worker, 'set-judge-combo');
    expect(judgeMessages).toHaveLength(1);
    expect(judgeMessages[0]).toMatchObject({
      kind: 'set-judge-combo',
      state: {
        judge: 'GREAT',
        combo: 12,
        channel: '11',
        updatedAtMs: 1_234,
      },
    });

    await runtime.stop();
    expect(messagesOfKind(worker, 'stop')).toHaveLength(1);

    await runtime.dispose();
    expect(messagesOfKind(worker, 'dispose')).toHaveLength(1);
  });

  test('passes tsx tsconfig path to the UI worker in source runs', async () => {
    const uiSignals = createPlayerUiSignalBus(createFrame());
    const runtime = await createNodeUiRuntime(createContext(uiSignals));
    const workerEnv = workerState.lastWorkerOptions?.env;
    const workerEnvObject = typeof workerEnv === 'object' ? (workerEnv as NodeJS.ProcessEnv) : undefined;
    const workerExecArgv = workerState.lastWorkerOptions?.execArgv;
    const workerData = workerState.lastWorkerOptions?.workerData as
      | { stdinIsTTY?: boolean; stdoutIsTTY?: boolean; uiFps?: number }
      | undefined;

    expect(typeof workerEnv).toBe('object');
    expect(workerEnvObject?.TSX_TSCONFIG_PATH).toContain('tsconfig.typecheck.json');
    expect(workerExecArgv).toContain('--conditions=source');
    expect(workerData).toMatchObject({
      stdinIsTTY: Boolean(process.stdin.isTTY),
      stdoutIsTTY: Boolean(process.stdout.isTTY),
      uiFps: 60,
    });

    await runtime.dispose();
  });

  test('waits for stop acknowledgement before resolving lifecycle cleanup', async () => {
    workerState.autoAckLifecycle = false;
    const uiSignals = createPlayerUiSignalBus(createFrame());
    const runtime = await createNodeUiRuntime(createContext(uiSignals));
    const worker = getLastWorker();

    let resolved = false;
    const stopPromise = runtime.stop().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(messagesOfKind(worker, 'stop')).toHaveLength(1);

    worker.emit('message', { kind: 'stopped' });
    await stopPromise;
    expect(resolved).toBe(true);

    const disposePromise = runtime.dispose();
    worker.emit('message', { kind: 'disposed' });
    await disposePromise;
  });

  test('creates a dedicated bridge port for direct UI IPC', async () => {
    const uiSignals = createPlayerUiSignalBus(createFrame());
    const runtime = await createNodeUiRuntime(createContext(uiSignals));
    const worker = getLastWorker();

    worker.postMessage.mockClear();

    const bridgePort = runtime.createBridgePort();
    expect(bridgePort).toBeDefined();
    expect(messagesOfKind(worker, 'attach-bridge-port')).toHaveLength(1);

    await runtime.dispose();
  });

  test('captures BGA playback end seconds from the UI worker ready message', async () => {
    workerState.readyMessage = { kind: 'ready', bgaPlaybackEndSeconds: 3.25 };
    const uiSignals = createPlayerUiSignalBus(createFrame());
    const runtime = await createNodeUiRuntime(createContext(uiSignals));

    expect(runtime.playbackEndSeconds).toBe(3.25);

    await runtime.dispose();
  });

  test('aborts UI worker initialization cooperatively through an abort message', async () => {
    workerState.autoReadyOnConstruct = false;
    const controller = new AbortController();
    const uiSignals = createPlayerUiSignalBus(createFrame());
    const promise = createNodeUiRuntime({
      ...createContext(uiSignals),
      loadSignal: controller.signal,
    });
    const worker = getLastWorker();

    controller.abort();

    await expect(promise).rejects.toSatisfy((error: unknown) => isAbortError(error));
    expect(messagesOfKind(worker, 'abort')).toHaveLength(1);
    expect(messagesOfKind(worker, 'abort')[0]).toMatchObject({ kind: 'abort' });
    expect(worker.terminate).not.toHaveBeenCalled();
  });
});

function createContext(
  uiSignals: ReturnType<typeof createPlayerUiSignalBus>,
  stateSignals = createPlayerStateSignals(1),
): Parameters<typeof createNodeUiRuntime>[0] {
  return {
    json: createEmptyJson('bms'),
    mode: 'MANUAL',
    laneDisplayMode: '7 KEY',
    laneBindings: [
      { channel: '16', keyLabel: 'A', inputTokens: ['a'], isScratch: true, side: '1P' },
      { channel: '11', keyLabel: 'S', inputTokens: ['s'], isScratch: false, side: '1P' },
      { channel: '12', keyLabel: 'D', inputTokens: ['d'], isScratch: false, side: '1P' },
    ],
    speed: 1,
    uiFps: 60,
    judgeWindowMs: 16.67,
    highSpeed: 1,
    stateSignals,
    uiSignals,
    baseDir: process.cwd(),
    onBgaLoadProgress: () => undefined,
  };
}

function createFrame(
  overrides: Partial<Parameters<ReturnType<typeof createPlayerUiSignalBus>['publishFrame']>[0]> = {},
): Parameters<ReturnType<typeof createPlayerUiSignalBus>['publishFrame']>[0] {
  return {
    currentBeat: 0,
    currentSeconds: 0,
    totalSeconds: 120,
    summary: {
      total: 100,
      perfect: 0,
      fast: 0,
      slow: 0,
      great: 0,
      good: 0,
      bad: 0,
      poor: 0,
      exScore: 0,
      score: 0,
    },
    notes: [],
    ...overrides,
  };
}

function getLastWorker(): MockWorker {
  if (!workerState.lastWorker) {
    throw new Error('worker was not created');
  }
  return workerState.lastWorker;
}

function messagesOfKind(worker: MockWorker, kind: string): unknown[] {
  return worker.postMessage.mock.calls
    .map((call) => call[0])
    .filter(
      (message): message is { kind: string } => typeof message === 'object' && message !== null && 'kind' in message,
    )
    .filter((message) => message.kind === kind);
}
