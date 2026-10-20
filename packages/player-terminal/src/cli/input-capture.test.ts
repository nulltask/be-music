import { createAbortError } from '@be-music/shared-utils/core';
import { describe, expect, test } from 'vite-plus/test';
import { resolveLoadingCancelReason } from './input-capture.ts';

function createCapture(reason: 'escape' | 'ctrl-c' | undefined) {
  return {
    signal: new AbortController().signal,
    getReason: () => reason,
    dispose: () => {},
  };
}

describe('resolveLoadingCancelReason', () => {
  test('returns the key that aborted the load', () => {
    expect(resolveLoadingCancelReason(createAbortError(), createCapture('escape'))).toBe('escape');
    expect(resolveLoadingCancelReason(createAbortError(), createCapture('ctrl-c'))).toBe('ctrl-c');
  });

  test('ignores errors that are not aborts', () => {
    expect(resolveLoadingCancelReason(new Error('broken chart'), createCapture('escape'))).toBeUndefined();
    expect(resolveLoadingCancelReason('AbortError', createCapture('escape'))).toBeUndefined();
  });

  test('has no reason without a capture', () => {
    expect(resolveLoadingCancelReason(createAbortError(), undefined)).toBeUndefined();
  });
});
