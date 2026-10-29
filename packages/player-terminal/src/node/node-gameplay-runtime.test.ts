import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { MessageChannel, type MessagePort, type WorkerOptions } from 'node:worker_threads';
import { createAbortError, isAbortError } from '@be-music/shared-utils/core';
import { createEmptyJSON } from '../../../chart-source/src/index.ts';
import type { NodeInputRuntime } from './node-input-runtime.ts';
import type { NodeUIRuntime } from './node-ui-runtime.ts';

type MockWorker = EventEmitter & {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
};

const workerState = vi.hoisted(() => ({
  lastWorker: undefined as MockWorker | undefined,
  lastWorkerOptions: undefined as WorkerOptions | undefined,
}));

const inputRuntimeState = vi.hoisted(() => ({
  context: undefined as Parameters<(typeof import('./node-input-runtime.ts'))['createNodeInputRuntime']>[0] | undefined,
  runtime: undefined as NodeInputRuntime | undefined,
  start: vi.fn(),
  stop: vi.fn(),
  negotiated: false,
}));

const uiRuntimeState = vi.hoisted(() => ({
  context: undefined as Parameters<(typeof import('./node-ui-runtime.ts'))['createNodeUIRuntime']>[0] | undefined,
  runtime: undefined as NodeUIRuntime | undefined,
  bridgePort: undefined as MessagePort | undefined,
  createError: undefined as Error | undefined,
  start: vi.fn(),
  stop: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
  triggerPoor: vi.fn(),
  clearPoor: vi.fn(),
  tuiEnabled: true,
  playbackEndSeconds: undefined as number | undefined,
}));

vi.mock('node:worker_threads', async () => {
  const actual = await vi.importActual<typeof import('node:worker_threads')>('node:worker_threads');
  return {
    ...actual,
    Worker: class MockWorker extends EventEmitter {
      readonly postMessage = vi.fn();

      readonly terminate = vi.fn(async () => 0);

      constructor(...args: unknown[]) {
        super();
        workerState.lastWorker = this;
        workerState.lastWorkerOptions = args[1] as WorkerOptions | undefined;
      }
    },
  };
});

vi.mock('./node-input-runtime.ts', () => ({
  hasNegotiatedStatefulKeyboardProtocol: vi.fn(() => inputRuntimeState.negotiated),
  createNodeInputRuntime: vi.fn((context) => {
    inputRuntimeState.context = context;
    inputRuntimeState.runtime = {
      start: inputRuntimeState.start,
      stop: inputRuntimeState.stop,
    };
    return inputRuntimeState.runtime;
  }),
}));

vi.mock('./node-ui-runtime.ts', () => ({
  createNodeUIRuntime: vi.fn(async (context) => {
    uiRuntimeState.context = context;
    if (uiRuntimeState.createError) {
      throw uiRuntimeState.createError;
    }
    uiRuntimeState.bridgePort = new MessageChannel().port1;
    uiRuntimeState.runtime = {
      tuiEnabled: uiRuntimeState.tuiEnabled,
      playbackEndSeconds: uiRuntimeState.playbackEndSeconds,
      start: uiRuntimeState.start,
      stop: uiRuntimeState.stop,
      dispose: uiRuntimeState.dispose,
      triggerPoor: uiRuntimeState.triggerPoor,
      clearPoor: uiRuntimeState.clearPoor,
      createBridgePort: () => {
        if (!uiRuntimeState.bridgePort) {
          throw new Error('bridge port missing');
        }
        return uiRuntimeState.bridgePort;
      },
    };
    return uiRuntimeState.runtime;
  }),
}));

import { runNodeGameplayRuntime } from './node-gameplay-runtime.ts';

afterEach(() => {
  vi.restoreAllMocks();
  workerState.lastWorker = undefined;
  workerState.lastWorkerOptions = undefined;
  inputRuntimeState.context = undefined;
  inputRuntimeState.runtime = undefined;
  inputRuntimeState.start.mockReset();
  inputRuntimeState.stop.mockReset();
  inputRuntimeState.negotiated = false;
  uiRuntimeState.context = undefined;
  uiRuntimeState.runtime = undefined;
  uiRuntimeState.bridgePort = undefined;
  uiRuntimeState.createError = undefined;
  uiRuntimeState.start.mockReset();
  uiRuntimeState.stop.mockReset();
  uiRuntimeState.dispose.mockReset();
  uiRuntimeState.triggerPoor.mockReset();
  uiRuntimeState.clearPoor.mockReset();
  uiRuntimeState.tuiEnabled = true;
  uiRuntimeState.playbackEndSeconds = undefined;
});

describe('node gameplay runtime', () => {
  test('hands the gameplay worker the resolved chart together with the draws it was resolved with', async () => {
    const json = createEmptyJSON('bms');
    const randomDraws = [{ command: 'RANDOM' as const, range: 2, value: 2 }];
    const promise = runNodeGameplayRuntime(createOptions({ json, randomDraws }));

    expect(workerState.lastWorkerOptions?.workerData).toMatchObject({ json, randomDraws });

    getLastWorker().emit('message', { kind: 'result', summary: createSummary() });
    await promise;
  });

  test('tells the gameplay worker whether the terminal negotiated key releases before the play', async () => {
    const play = async (): Promise<unknown> => {
      const promise = runNodeGameplayRuntime(createOptions());
      const workerData = workerState.lastWorkerOptions?.workerData;
      getLastWorker().emit('message', { kind: 'result', summary: createSummary() });
      await promise;
      return workerData;
    };

    expect(await play()).not.toHaveProperty('inputReportsKeyReleases');
    inputRuntimeState.negotiated = true;
    expect(await play()).toMatchObject({ inputReportsKeyReleases: true });
  });

  test('passes source resolution condition to the gameplay worker in source runs', async () => {
    const promise = runNodeGameplayRuntime(createOptions());
    const workerExecArgv = workerState.lastWorkerOptions?.execArgv;

    expect(workerExecArgv).toContain('--conditions=source');

    getLastWorker().emit('message', { kind: 'result', summary: createSummary() });
    await promise;
  });

  test('creates input runtime and forwards input commands to the gameplay worker', async () => {
    const promise = runNodeGameplayRuntime(createOptions());
    const worker = getLastWorker();

    worker.emit('message', {
      kind: 'input-init',
      runtime: {
        mode: 'manual',
        inputTokenToChannelsEntries: [['a', ['11']]],
      },
    });

    expect(inputRuntimeState.context?.mode).toBe('manual');
    expect(inputRuntimeState.context?.inputTokenToChannels.get('a')).toEqual(['11']);

    inputRuntimeState.context?.inputSignals.pushCommand({
      kind: 'lane-input',
      tokens: ['a'],
    });

    expect(messagesOfKind(worker, 'input-commands')).toEqual([
      {
        kind: 'input-commands',
        commands: [{ kind: 'lane-input', tokens: ['a'] }],
      },
    ]);

    worker.emit('message', { kind: 'result', summary: createSummary() });
    await expect(promise).resolves.toEqual(createSummary());
    expect(inputRuntimeState.stop).toHaveBeenCalled();
  });

  test('passes a direct bridge port to the gameplay worker and keeps lifecycle acks on the main thread', async () => {
    uiRuntimeState.playbackEndSeconds = 4.5;
    const promise = runNodeGameplayRuntime(createOptions());
    const worker = getLastWorker();

    worker.emit('message', {
      kind: 'ui-init',
      requestId: 3,
      runtime: createUIInit(),
    });
    await Promise.resolve();

    expect(uiRuntimeState.context?.laneDisplayMode).toBe('7 KEY');
    expect(uiRuntimeState.context?.uiFPS).toBe(60);
    expect(uiRuntimeState.context?.tuiVisibleNotesLimit).toBe(8192);
    expect(uiRuntimeState.context?.tuiNoteHeight).toBe(8);
    expect(uiRuntimeState.context?.imageResizeAlgorithm).toBe('nearest');
    expect(uiRuntimeState.context?.videoBGAStreaming).toBe(true);
    expect(uiRuntimeState.context?.keyBoundBGACues).toEqual(createUIInit().keyBoundBGACues);
    expect(uiRuntimeState.context?.initialFrame).toMatchObject({
      currentBeat: 0,
      currentSeconds: 0,
      notes: [],
    });
    const uiInitResults = messagesOfKind(worker, 'ui-init-result');
    expect(uiInitResults).toHaveLength(1);
    expect(uiInitResults[0]).toMatchObject({
      kind: 'ui-init-result',
      requestId: 3,
      enabled: true,
      bgaPlaybackEndSeconds: 4.5,
    });
    expect((uiInitResults[0] as { port?: MessagePort }).port).toBe(uiRuntimeState.bridgePort);

    worker.emit('message', { kind: 'ui-stop', requestId: 4 });
    await Promise.resolve();
    expect(uiRuntimeState.stop).toHaveBeenCalled();
    expect(messagesOfKind(worker, 'ui-stop-result')).toEqual([{ kind: 'ui-stop-result', requestId: 4 }]);

    worker.emit('message', { kind: 'ui-dispose', requestId: 5 });
    await Promise.resolve();
    await Promise.resolve();
    expect(uiRuntimeState.dispose).toHaveBeenCalled();
    expect(messagesOfKind(worker, 'ui-dispose-result')).toEqual([{ kind: 'ui-dispose-result', requestId: 5 }]);

    worker.emit('message', { kind: 'result', summary: createSummary() });
    await promise;
  });

  test('passes the gameplay abort signal through to the UI runtime initializer', async () => {
    const controller = new AbortController();
    const promise = runNodeGameplayRuntime(createOptions({ signal: controller.signal }));
    const worker = getLastWorker();

    worker.emit('message', {
      kind: 'ui-init',
      requestId: 7,
      runtime: createUIInit(),
    });
    await Promise.resolve();

    expect(uiRuntimeState.context?.loadSignal).toBe(controller.signal);

    worker.emit('message', { kind: 'result', summary: createSummary() });
    await promise;
  });

  test('forwards gameplay and UI runtime log messages to the caller', async () => {
    const onLog = vi.fn();
    const promise = runNodeGameplayRuntime(createOptions({ onLog }));
    const worker = getLastWorker();

    worker.emit('message', {
      kind: 'log',
      entry: {
        source: 'gameplay-worker',
        level: 'info',
        event: 'playback.prepared',
      },
    });

    worker.emit('message', {
      kind: 'ui-init',
      requestId: 9,
      runtime: createUIInit(),
    });
    await Promise.resolve();

    uiRuntimeState.context?.onLog?.({
      source: 'ui-worker',
      level: 'info',
      event: 'ui-worker.first-frame.rendered',
      fields: { seconds: 0 },
    });

    expect(onLog).toHaveBeenNthCalledWith(1, {
      source: 'gameplay-worker',
      level: 'info',
      event: 'playback.prepared',
    });
    expect(onLog).toHaveBeenNthCalledWith(2, {
      source: 'ui-worker',
      level: 'info',
      event: 'ui-worker.first-frame.rendered',
      fields: { seconds: 0 },
    });

    worker.emit('message', { kind: 'result', summary: createSummary() });
    await promise;
  });

  test('maps worker abort errors back to AbortError', async () => {
    const promise = runNodeGameplayRuntime(createOptions());
    const worker = getLastWorker();

    worker.emit('message', {
      kind: 'error',
      name: 'AbortError',
      message: 'The operation was aborted.',
    });

    await expect(promise).rejects.toSatisfy((error: unknown) => isAbortError(error));
  });

  test('reports UI initialization aborts with AbortError metadata', async () => {
    const abortError = createAbortError();
    abortError.message = 'This operation was aborted';
    uiRuntimeState.createError = abortError;

    const promise = runNodeGameplayRuntime(createOptions());
    const worker = getLastWorker();

    worker.emit('message', {
      kind: 'ui-init',
      requestId: 8,
      runtime: createUIInit(),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(messagesOfKind(worker, 'ui-init-result')).toContainEqual({
      kind: 'ui-init-result',
      requestId: 8,
      enabled: false,
      errorName: 'AbortError',
      error: 'This operation was aborted',
    });

    worker.emit('message', { kind: 'result', summary: createSummary() });
    await promise;
  });
});

function createOptions(
  overrides: Partial<Parameters<typeof runNodeGameplayRuntime>[0]> = {},
): Parameters<typeof runNodeGameplayRuntime>[0] {
  return {
    json: createEmptyJSON('bms'),
    mode: 'manual',
    playOptions: {
      tui: true,
      speed: 1,
      tuiVisibleNotesLimit: 8192,
      tuiNoteHeight: 8,
      imageResizeAlgorithm: 'nearest' as const,
      audioBaseDir: process.cwd(),
      videoBGAStreaming: true,
    },
    ...overrides,
  };
}

function createUIInit() {
  return {
    json: createEmptyJSON('bms'),
    mode: 'MANUAL' as const,
    laneDisplayMode: '7 KEY',
    laneBindings: [{ channel: '11', keyLabel: 'A', inputTokens: ['a'], isScratch: false, side: '1P' as const }],
    speed: 1,
    uiFPS: 60,
    tuiVisibleNotesLimit: 8192,
    tuiNoteHeight: 8,
    judgeWindowMs: 16.67,
    highSpeed: 1,
    imageResizeAlgorithm: 'nearest' as const,
    showLaneChannels: false,
    baseDir: process.cwd(),
    videoBGAStreaming: true,
    keyBoundBGACues: [
      {
        seconds: 0,
        endSeconds: 4,
        definitionId: 'stage:0:61',
        definition: {
          frameIntervalMs: 100,
          durationMs: 0,
          channel: '11',
          loop: true,
          argb: { a: 255, r: 255, g: 255, b: 255 },
          frames: ['longImage'],
        },
      },
    ],
    initialFrame: {
      currentBeat: 0,
      currentSeconds: 0,
      totalSeconds: 120,
      summary: createSummary(),
      notes: [],
    },
    initialPaused: false,
    initialJudgeCombo: {
      judge: 'READY',
      combo: 0,
      updatedAtMs: 0,
    },
  };
}

function createSummary() {
  return {
    total: 100,
    perfect: 0,
    fast: 0,
    slow: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    emptyPoor: 0,
    exScore: 0,
    score: 0,
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
