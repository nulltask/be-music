import { describe, expect, test, vi } from 'vitest';
import {
  exitFullscreen,
  getFullscreenElement,
  requestFullscreen,
  shouldCaptureFullscreenEscape,
  toggleFullscreen,
} from './fullscreen.ts';

describe('getFullscreenElement', () => {
  test('prefers the unprefixed Fullscreen API', () => {
    const element = {} as Element;
    expect(getFullscreenElement({ fullscreenElement: element, webkitFullscreenElement: null })).toBe(element);
  });

  test('falls back to the webkit alias used by Safari', () => {
    const element = {} as Element;
    expect(getFullscreenElement({ webkitFullscreenElement: element })).toBe(element);
  });

  test('returns null when nothing is fullscreen', () => {
    expect(getFullscreenElement({})).toBeNull();
  });
});

describe('requestFullscreen / exitFullscreen', () => {
  test('calls requestFullscreen on the target element', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    await requestFullscreen({ requestFullscreen: request });
    expect(request).toHaveBeenCalledOnce();
  });

  test('falls back to webkitRequestFullscreen', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    await requestFullscreen({ webkitRequestFullscreen: request });
    expect(request).toHaveBeenCalledOnce();
  });

  test('calls exitFullscreen on the document', async () => {
    const exit = vi.fn().mockResolvedValue(undefined);
    await exitFullscreen({ exitFullscreen: exit });
    expect(exit).toHaveBeenCalledOnce();
  });

  test('falls back to webkitExitFullscreen', async () => {
    const exit = vi.fn().mockResolvedValue(undefined);
    await exitFullscreen({ webkitExitFullscreen: exit });
    expect(exit).toHaveBeenCalledOnce();
  });
});

describe('toggleFullscreen', () => {
  test('requests fullscreen when the document is windowed', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    await toggleFullscreen({ requestFullscreen: request }, {});
    expect(request).toHaveBeenCalledOnce();
  });

  test('exits fullscreen when an element is already fullscreen', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);
    await toggleFullscreen({ requestFullscreen: request }, { fullscreenElement: {} as Element, exitFullscreen: exit });
    expect(exit).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  test('swallows request failures so a rejected gesture stays a no-op', async () => {
    const request = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    await expect(toggleFullscreen({ requestFullscreen: request }, {})).resolves.toBeUndefined();
  });
});

describe('shouldCaptureFullscreenEscape', () => {
  test('captures Escape only while fullscreen', () => {
    expect(shouldCaptureFullscreenEscape({ key: 'Escape', code: 'Escape' }, { fullscreenElement: {} as Element })).toBe(
      true,
    );
    expect(shouldCaptureFullscreenEscape({ key: 'Escape', code: 'Escape' }, {})).toBe(false);
  });

  test('ignores unrelated keys even while fullscreen', () => {
    expect(shouldCaptureFullscreenEscape({ key: 'Enter', code: 'Enter' }, { fullscreenElement: {} as Element })).toBe(
      false,
    );
  });
});
