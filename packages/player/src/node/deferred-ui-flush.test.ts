import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDeferredUiFlush } from './deferred-ui-flush.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('deferred ui flush', () => {
  test('defers flush work and coalesces repeated frame marks', async () => {
    vi.useFakeTimers();
    const flushSpy = vi.fn();
    const deferred = createDeferredUiFlush(flushSpy);

    deferred.markFrameDirty();
    deferred.markFrameDirty();

    expect(flushSpy).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(flushSpy).toHaveBeenCalledWith({ frame: true, commands: false });
  });

  test('flushes frame and command dirties together in one asynchronous pass', async () => {
    vi.useFakeTimers();
    const flushSpy = vi.fn();
    const deferred = createDeferredUiFlush(flushSpy);

    deferred.markFrameDirty();
    deferred.markCommandsDirty();

    await vi.runAllTimersAsync();

    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(flushSpy).toHaveBeenCalledWith({ frame: true, commands: true });
  });
});
