import { expect, test, vi } from 'vite-plus/test';
import { LibraryRefresh } from './library-refresh.ts';

test('aborts a running refresh and starts it again when the player returns to select', async () => {
  const refresh = new LibraryRefresh();
  let firstSignal: AbortSignal | undefined;
  const work = vi.fn((signal: AbortSignal) => {
    if (firstSignal !== undefined) return Promise.resolve('updated');
    firstSignal = signal;
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });

  const pending = refresh.run(work);
  refresh.pause();
  expect(firstSignal?.aborted).toBe(true);
  await Promise.resolve();
  expect(work).toHaveBeenCalledTimes(1);

  refresh.resume();
  await expect(pending).resolves.toBe('updated');
  expect(work).toHaveBeenCalledTimes(2);
  expect(work.mock.calls[1]?.[0].aborted).toBe(false);
});

test('keeps new refreshes queued and lets unrelated work fail normally', async () => {
  const refresh = new LibraryRefresh();
  refresh.pause();

  const work = vi.fn(async () => {
    throw new Error('source unavailable');
  });
  const pending = refresh.run(work);
  expect(work).not.toHaveBeenCalled();
  refresh.resume();

  await expect(pending).rejects.toThrow('source unavailable');
  expect(work).toHaveBeenCalledTimes(1);
});
