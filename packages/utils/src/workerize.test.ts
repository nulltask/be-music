import { describe, expect, test } from 'vitest';
import { createAbortError, invokeWorkerizedFunction, throwIfAborted, workerize } from './index.ts';

describe('workerize utilities', () => {
  test('createAbortError: creates AbortError instances', () => {
    const error = createAbortError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AbortError');
    expect(error.message).toBe('The operation was aborted.');
  });

  test('throwIfAborted: throws only for aborted signals', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    const abortController = new AbortController();
    expect(() => throwIfAborted(abortController.signal)).not.toThrow();
    abortController.abort();
    try {
      throwIfAborted(abortController.signal);
      throw new Error('Expected AbortError');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'AbortError',
        message: 'The operation was aborted.',
      });
    }
  });

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
});
