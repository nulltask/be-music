import { afterEach, describe, expect, test, vi } from 'vitest';
import { createRenderThrottle } from './render-throttle.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('render throttle', () => {
  test('renders immediately on the first request', () => {
    vi.useFakeTimers();
    const renderSpy = vi.fn();
    const throttle = createRenderThrottle(renderSpy, {
      minIntervalMs: 33,
    });

    throttle.request();

    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  test('coalesces repeated requests within the throttle window', async () => {
    vi.useFakeTimers();
    const renderSpy = vi.fn();
    const throttle = createRenderThrottle(renderSpy, {
      minIntervalMs: 33,
    });

    throttle.request();
    throttle.request();
    throttle.request();

    expect(renderSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(32);
    expect(renderSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });

  test('cancels pending renders on dispose', async () => {
    vi.useFakeTimers();
    const renderSpy = vi.fn();
    const throttle = createRenderThrottle(renderSpy, {
      minIntervalMs: 33,
    });

    throttle.request();
    throttle.request();
    throttle.dispose();

    await vi.runAllTimersAsync();

    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});
