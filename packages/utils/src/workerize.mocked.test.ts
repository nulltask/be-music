import { afterEach, describe, expect, test, vi } from 'vitest';

async function loadWorkerizeModuleWithSeaMock(isSeaRuntime: boolean) {
  vi.resetModules();

  const workerizeUntyped = vi.fn(() =>
    Object.assign(
      (_value: number, callback: (error: unknown, result: number) => void) => {
        callback(undefined, 0);
      },
      { close: () => {} },
    ),
  );

  vi.doMock('node:sea', () => ({
    isSea: () => isSeaRuntime,
  }));
  vi.doMock('isoworker', () => ({
    workerize: workerizeUntyped,
  }));

  const module = await import('./workerize.ts');
  return { ...module, workerizeUntyped };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('node:sea');
  vi.doUnmock('isoworker');
});

describe('workerize SEA fallback', () => {
  test('uses inline execution when running inside SEA', async () => {
    const { workerize, workerizeUntyped } = await loadWorkerizeModuleWithSeaMock(true);

    const worker = workerize((value: number) => value + 1, () => []);
    try {
      await expect(
        new Promise<number>((resolve, reject) => {
          worker(41, (error, result) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(result);
          });
        }),
      ).resolves.toBe(42);
    } finally {
      worker.close();
    }

    expect(workerizeUntyped).not.toHaveBeenCalled();
  });

  test('uses isoworker outside SEA', async () => {
    const { workerize, workerizeUntyped } = await loadWorkerizeModuleWithSeaMock(false);

    const worker = workerize((value: number) => value + 1, () => []);
    worker.close();

    expect(workerizeUntyped).toHaveBeenCalledTimes(1);
  });
});
