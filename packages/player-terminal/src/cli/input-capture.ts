import { isAbortError } from '@be-music/shared-utils/core';
import readline from 'node:readline';
import { beginSharedRawInputCapture } from '../raw-input-capture.ts';

export interface RawInputCapture {
  stdin: NodeJS.ReadStream & { isRaw?: boolean };
  restore: () => void;
}

type LoadingCancelReason = 'escape' | 'ctrl-c';

interface LoadingAbortCapture {
  signal: AbortSignal;
  getReason: () => LoadingCancelReason | undefined;
  dispose: () => void;
}

export function beginRawInputCapture(): RawInputCapture {
  return beginSharedRawInputCapture();
}

export function beginLoadingAbortCapture(): LoadingAbortCapture | undefined {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return undefined;
  }
  const inputCapture = beginRawInputCapture();
  const controller = new AbortController();
  let reason: LoadingCancelReason | undefined;
  const onKeyPress = (_chunk: string | undefined, key: readline.Key): void => {
    if (key.sequence === '\u0003') {
      reason = 'ctrl-c';
      controller.abort();
      return;
    }
    if (key.name?.toLowerCase() === 'escape' || key.sequence === '\u001b') {
      reason = 'escape';
      controller.abort();
    }
  };
  inputCapture.stdin.on('keypress', onKeyPress);
  return {
    signal: controller.signal,
    getReason: () => reason,
    dispose: () => {
      inputCapture.stdin.removeListener('keypress', onKeyPress);
      inputCapture.restore();
    },
  };
}

export function resolveLoadingCancelReason(
  error: unknown,
  capture: LoadingAbortCapture | undefined,
): LoadingCancelReason | undefined {
  if (!isAbortError(error)) {
    return undefined;
  }
  return capture?.getReason();
}

export function applyLoadingCancel(reason: LoadingCancelReason): void {
  process.exitCode = reason === 'ctrl-c' ? 130 : 0;
  if (process.stdout.isTTY) {
    process.stdout.write('\u001b[2J\u001b[H');
  }
}
