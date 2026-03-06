import { expect, test } from 'vitest';
import { createAbortError, isAbortError, throwIfAborted } from './index.ts';

test('abort utils: createAbortError and isAbortError return AbortError semantics', () => {
  const error = createAbortError();
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('AbortError');
  expect(error.message).toBe('The operation was aborted.');
  expect(isAbortError(error)).toBe(true);
  expect(isAbortError(new Error('x'))).toBe(false);
  expect(isAbortError(undefined)).toBe(false);
});

test('abort utils: throwIfAborted throws only for aborted signals', () => {
  expect(() => throwIfAborted(undefined)).not.toThrow();
  const abortController = new AbortController();
  expect(() => throwIfAborted(abortController.signal)).not.toThrow();
  abortController.abort();
  expect(() => throwIfAborted(abortController.signal)).toThrowError(/aborted/);
});
