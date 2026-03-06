const ABORT_ERROR_MESSAGE = 'The operation was aborted.';
const ABORT_ERROR_NAME = 'AbortError';

export function createAbortError(): Error {
  const error = new Error(ABORT_ERROR_MESSAGE);
  error.name = ABORT_ERROR_NAME;
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === ABORT_ERROR_NAME;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw createAbortError();
  }
}
