import { describe, expect, test } from 'vitest';
import { invokeWorkerizedFunction, workerize } from './index.ts';

describe('workerize utilities', () => {
  test('invokeWorkerizedFunction: resolves workerized results', async () => {
    const worker = workerize((value: number) => value + 1, () => []);
    try {
      await expect(invokeWorkerizedFunction(worker, [41])).resolves.toBe(42);
    } finally {
      worker.close();
    }
  });

  test('invokeWorkerizedFunction: rejects with AbortError when signal is aborted', async () => {
    const worker = workerize(
      async (value: number) => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return value + 1;
      },
      () => [],
      true,
    );
    const abortController = new AbortController();
    const promise = invokeWorkerizedFunction(worker, [41], { signal: abortController.signal });
    abortController.abort();
    try {
      await expect(promise).rejects.toMatchObject({
        name: 'AbortError',
        message: 'The operation was aborted.',
      });
    } finally {
      worker.close();
    }
  });

  test('invokeWorkerizedFunction: rejects worker callback errors', async () => {
    const worker = Object.assign(
      (_value: number, callback: (error: unknown, result: number) => void) => {
        callback(new Error('boom'), 0);
      },
      { close: () => {} },
    );

    await expect(invokeWorkerizedFunction(worker, [41])).rejects.toMatchObject({
      message: 'boom',
    });
  });

  test('invokeWorkerizedFunction: rejects immediately when signal is already aborted', async () => {
    let workerCalled = false;
    const worker = Object.assign(
      (_value: number, callback: (error: unknown, result: number) => void) => {
        workerCalled = true;
        callback(undefined, 42);
      },
      { close: () => {} },
    );
    const abortController = new AbortController();
    abortController.abort();

    await expect(invokeWorkerizedFunction(worker, [41], { signal: abortController.signal })).rejects.toMatchObject({
      name: 'AbortError',
      message: 'The operation was aborted.',
    });
    expect(workerCalled).toBe(false);
  });

  test('invokeWorkerizedFunction: calls onAbort once and ignores late worker callbacks', async () => {
    let callback: ((error: unknown, result: number) => void) | undefined;
    let abortCalls = 0;
    const worker = Object.assign(
      (_value: number, next: (error: unknown, result: number) => void) => {
        callback = next;
      },
      { close: () => {} },
    );
    const abortController = new AbortController();

    const promise = invokeWorkerizedFunction(worker, [41], {
      signal: abortController.signal,
      onAbort: () => {
        abortCalls += 1;
      },
    });

    abortController.abort();
    callback?.(undefined, 42);

    await expect(promise).rejects.toMatchObject({
      name: 'AbortError',
      message: 'The operation was aborted.',
    });
    expect(abortCalls).toBe(1);
  });

  test('invokeWorkerizedFunction: handles synchronous abort during listener registration', async () => {
    let workerCalled = false;
    let removeCalls = 0;
    const signal = {
      aborted: false,
      addEventListener: (_type: string, listener: () => void) => {
        listener();
      },
      removeEventListener: () => {
        removeCalls += 1;
      },
    } as unknown as AbortSignal;
    const worker = Object.assign(
      (_value: number, callback: (error: unknown, result: number) => void) => {
        workerCalled = true;
        callback(undefined, 42);
      },
      { close: () => {} },
    );

    await expect(
      invokeWorkerizedFunction(worker, [41], {
        signal,
      }),
    ).rejects.toMatchObject({
      name: 'AbortError',
      message: 'The operation was aborted.',
    });
    expect(workerCalled).toBe(false);
    expect(removeCalls).toBe(1);
  });
});
