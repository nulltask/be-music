import { afterEach, expect, test, vi } from 'vite-plus/test';
import { settleWithTimeout } from './async.ts';

afterEach(() => vi.useRealTimers());

test('already settled cleanup succeeds and clears its timeout', async () => {
  vi.useFakeTimers();
  expect(await settleWithTimeout(Promise.resolve(), 500)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('a rejected cleanup counts as settled and is handled', async () => {
  vi.useFakeTimers();
  expect(await settleWithTimeout(Promise.reject(new Error('cleanup failed')), 500)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('missing and synchronous cleanup need no timer', async () => {
  const schedule = vi.fn();
  expect(await settleWithTimeout(undefined, 500, schedule)).toBe(true);
  expect(await settleWithTimeout(void 0, 500, schedule)).toBe(true);
  expect(schedule).not.toHaveBeenCalled();
});

test('a timeout stops waiting while the cleanup can still settle later', async () => {
  vi.useFakeTimers();
  let rejectCleanup!: (reason: Error) => void;
  const cleanup = new Promise<void>((_resolve, reject) => {
    rejectCleanup = reject;
  });
  const result = settleWithTimeout(cleanup, 50);
  await vi.advanceTimersByTimeAsync(50);
  expect(await result).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  rejectCleanup(new Error('late failure'));
  await Promise.resolve();
});

test('a host scheduler controls the deadline and is cancelled afterwards', async () => {
  let expire!: () => void;
  const cancel = vi.fn();
  const schedule = vi.fn((callback: () => void, timeoutMs: number) => {
    expect(timeoutMs).toBe(100);
    expire = callback;
    return cancel;
  });
  const result = settleWithTimeout(new Promise<void>(() => {}), 100, schedule);
  expire();
  expect(await result).toBe(false);
  expect(cancel).toHaveBeenCalledOnce();
});
