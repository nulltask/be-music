import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WorkerOptions } from 'node:worker_threads';
import { isAbortError } from '@be-music/utils';
import { createEmptyJson } from '../../../json/src/index.ts';
import type { NodeInputRuntime } from './node-input-runtime.ts';
import type { NodeUiRuntime } from './node-ui-runtime.ts';

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
}));

const uiRuntimeState = vi.hoisted(() => ({
  context: undefined as Parameters<(typeof import('./node-ui-runtime.ts'))['createNodeUiRuntime']>[0] | undefined,
  runtime: undefined as NodeUiRuntime | undefined,
  start: vi.fn(),
  stop: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
  triggerPoor: vi.fn(),
  clearPoor: vi.fn(),
  tuiEnabled: true,
}));

vi.mock('node:worker_threads', () => ({
  Worker: class MockWorker extends EventEmitter {
    readonly postMessage = vi.fn();

    readonly terminate = vi.fn(async () => 0);

    constructor(...args: unknown[]) {
      super();
      workerState.lastWorker = this;
      workerState.lastWorkerOptions = args[1] as WorkerOptions | undefined;
    }
  },
}));

vi.mock('./node-input-runtime.ts', () => ({
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
  createNodeUiRuntime: vi.fn(async (context) => {
    uiRuntimeState.context = context;
    uiRuntimeState.runtime = {
      tuiEnabled: uiRuntimeState.tuiEnabled,
      start: uiRuntimeState.start,
      stop: uiRuntimeState.stop,
      dispose: uiRuntimeState.dispose,
      triggerPoor: uiRuntimeState.triggerPoor,
      clearPoor: uiRuntimeState.clearPoor,
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
  uiRuntimeState.context = undefined;
  uiRuntimeState.runtime = undefined;
  uiRuntimeState.start.mockReset();
  uiRuntimeState.stop.mockReset();
  uiRuntimeState.dispose.mockReset();
  uiRuntimeState.triggerPoor.mockReset();
  uiRuntimeState.clearPoor.mockReset();
  uiRuntimeState.tuiEnabled = true;
});

describe('node gameplay runtime', () => {
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

  test('bridges UI lifecycle and updates through the main thread runtime', async () => {
    const promise = runNodeGameplayRuntime(createOptions());
    const worker = getLastWorker();

    worker.emit('message', {
      kind: 'ui-init',
      requestId: 3,
      runtime: createUiInit(),
    });
    await Promise.resolve();

    expect(uiRuntimeState.context?.laneDisplayMode).toBe('7 KEY');
    expect(messagesOfKind(worker, 'ui-init-result')).toEqual([{ kind: 'ui-init-result', requestId: 3, enabled: true }]);

    worker.emit('message', { kind: 'ui-start' });
    expect(uiRuntimeState.start).toHaveBeenCalled();

    worker.emit('message', {
      kind: 'ui-frame',
      frame: {
        ...createUiInit().initialFrame,
        currentBeat: 8,
        currentSeconds: 4,
      },
    });
    expect(uiRuntimeState.context?.uiSignals.getFrame()).toMatchObject({
      currentBeat: 8,
      currentSeconds: 4,
    });

    worker.emit('message', {
      kind: 'ui-set-judge-combo',
      state: {
        judge: 'GREAT',
        combo: 12,
        channel: '11',
        updatedAtMs: 1234,
      },
    });
    expect(uiRuntimeState.context?.stateSignals.getJudgeCombo()).toMatchObject({
      judge: 'GREAT',
      combo: 12,
      channel: '11',
      updatedAtMs: 1234,
    });

    worker.emit('message', { kind: 'ui-trigger-poor', seconds: 1.25 });
    worker.emit('message', { kind: 'ui-clear-poor' });
    expect(uiRuntimeState.triggerPoor).toHaveBeenCalledWith(1.25);
    expect(uiRuntimeState.clearPoor).toHaveBeenCalled();

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
});

function createOptions(): Parameters<typeof runNodeGameplayRuntime>[0] {
  return {
    json: createEmptyJson('bms'),
    mode: 'manual',
    playOptions: {
      tui: true,
      speed: 1,
      audioBaseDir: process.cwd(),
    },
  };
}

function createUiInit() {
  return {
    json: createEmptyJson('bms'),
    mode: 'MANUAL' as const,
    laneDisplayMode: '7 KEY',
    laneBindings: [{ channel: '11', keyLabel: 'A', inputTokens: ['a'], isScratch: false, side: '1P' as const }],
    speed: 1,
    judgeWindowMs: 16.67,
    highSpeed: 1,
    showLaneChannels: false,
    baseDir: process.cwd(),
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
