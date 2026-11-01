import { describe, expect, test, vi } from 'vite-plus/test';
import {
  enterTouchFullscreen,
  exitFullscreen,
  FullscreenEscapeLock,
  getFullscreenElement,
  playerFullscreenElement,
  requestFullscreen,
  shouldCaptureFullscreenEscape,
  toggleFullscreen,
} from './fullscreen.ts';

test('playerFullscreenElement is the play surface, outside the site header and footer', () => {
  const surface = { requestFullscreen: vi.fn() };
  const root = { requestFullscreen: vi.fn() };
  const doc = {
    documentElement: root,
    querySelector: (selector: string) => (selector === '#main' ? surface : null),
  };
  expect(playerFullscreenElement(doc)).toBe(surface);
  expect(playerFullscreenElement(doc)).not.toBe(root);
  expect(playerFullscreenElement({ documentElement: root, querySelector: () => null })).toBe(root);
});

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

describe('shouldCaptureFullscreenEscape with Escape locked', () => {
  test('leaves Escape to the page while the Keyboard Lock holds it', () => {
    expect(
      shouldCaptureFullscreenEscape({ key: 'Escape', code: 'Escape' }, { fullscreenElement: {} as Element }, true),
    ).toBe(false);
  });
});

describe('FullscreenEscapeLock', () => {
  test('locks Escape on entering fullscreen and unlocks on leaving', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const unlock = vi.fn();
    const escapeLock = new FullscreenEscapeLock({ keyboard: { lock, unlock } });
    await escapeLock.sync(true);
    expect(lock).toHaveBeenCalledWith(['Escape']);
    expect(escapeLock.isLocked()).toBe(true);
    await escapeLock.sync(false);
    expect(unlock).toHaveBeenCalledOnce();
    expect(escapeLock.isLocked()).toBe(false);
  });

  test('is a no-op without navigator.keyboard (Safari / Firefox)', async () => {
    const escapeLock = new FullscreenEscapeLock({});
    await expect(escapeLock.sync(true)).resolves.toBeUndefined();
    expect(escapeLock.isLocked()).toBe(false);
    await expect(escapeLock.sync(false)).resolves.toBeUndefined();
    await expect(new FullscreenEscapeLock(undefined).sync(true)).resolves.toBeUndefined();
  });

  test('reports a rejected lock and stays unlocked', async () => {
    const error = new Error('NotAllowedError');
    const onLockError = vi.fn();
    const escapeLock = new FullscreenEscapeLock({ keyboard: { lock: vi.fn().mockRejectedValue(error) } }, onLockError);
    await expect(escapeLock.sync(true)).resolves.toBeUndefined();
    expect(onLockError).toHaveBeenCalledWith(error);
    expect(escapeLock.isLocked()).toBe(false);
  });

  test('a lock that resolves after fullscreen was left is not recorded', async () => {
    let resolveLock: () => void = () => {};
    const lock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLock = resolve;
        }),
    );
    const escapeLock = new FullscreenEscapeLock({ keyboard: { lock, unlock: vi.fn() } });
    const pending = escapeLock.sync(true);
    await escapeLock.sync(false);
    resolveLock();
    await pending;
    expect(escapeLock.isLocked()).toBe(false);
  });
});

describe('enterTouchFullscreen', () => {
  test('enters fullscreen, then asks for landscape', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const lock = vi.fn().mockResolvedValue(undefined);
    await enterTouchFullscreen({ requestFullscreen: request }, {}, { orientation: { lock } });
    expect(request).toHaveBeenCalledOnce();
    expect(lock).toHaveBeenCalledWith('landscape');
  });

  test('leaves an existing fullscreen alone', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    await enterTouchFullscreen({ requestFullscreen: request }, { fullscreenElement: {} as Element }, {});
    expect(request).not.toHaveBeenCalled();
  });

  test('swallows a refused request and a missing orientation lock', async () => {
    const request = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    await expect(enterTouchFullscreen({ requestFullscreen: request }, {}, {})).resolves.toBeUndefined();
    await expect(enterTouchFullscreen({}, {}, {})).resolves.toBeUndefined();
  });
});
