import readline from 'node:readline';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { beginSharedRawInputCapture } from './raw-input-capture.ts';

describe('shared raw input capture', () => {
  const stdin = process.stdin as NodeJS.ReadStream & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (value: boolean) => void;
  };
  const originalIsTTY = stdin.isTTY;
  const originalIsRaw = stdin.isRaw;
  const originalSetRawMode = stdin.setRawMode;
  const originalResume = stdin.resume.bind(stdin);

  beforeEach(() => {
    stdin.isTTY = true;
    stdin.isRaw = false;
    stdin.setRawMode = vi.fn();
    stdin.resume = vi.fn() as typeof stdin.resume;
    vi.spyOn(readline, 'emitKeypressEvents').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdin.isTTY = originalIsTTY;
    stdin.isRaw = originalIsRaw;
    stdin.setRawMode = originalSetRawMode;
    stdin.resume = originalResume;
    vi.restoreAllMocks();
  });

  test('reuses a single raw capture across nested acquisitions', () => {
    const first = beginSharedRawInputCapture();
    const second = beginSharedRawInputCapture();

    expect(readline.emitKeypressEvents).toHaveBeenCalledTimes(1);
    expect(stdin.setRawMode).toHaveBeenCalledTimes(1);
    expect(stdin.setRawMode).toHaveBeenCalledWith(true);
    expect(stdin.resume).toHaveBeenCalledTimes(1);

    first.restore();
    expect(stdin.setRawMode).toHaveBeenCalledTimes(1);

    second.restore();
    expect(stdin.setRawMode).toHaveBeenCalledTimes(2);
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });

  test('can force a raw mode reset before enabling capture', () => {
    stdin.isRaw = true;

    const capture = beginSharedRawInputCapture({ forceResetRawMode: true });

    expect(stdin.setRawMode).toHaveBeenNthCalledWith(1, false);
    expect(stdin.setRawMode).toHaveBeenNthCalledWith(2, true);

    capture.restore();
    expect(stdin.setRawMode).toHaveBeenNthCalledWith(3, true);
  });

  test('reinitializes keypress events across repeated capture lifecycles', () => {
    const first = beginSharedRawInputCapture();
    first.restore();

    const second = beginSharedRawInputCapture();
    second.restore();

    expect(readline.emitKeypressEvents).toHaveBeenCalledTimes(2);
  });
});
