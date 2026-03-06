import { access } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { isAbortError, throwIfAborted } from './abort.ts';

export async function resolveFirstExistingPath(
  baseDir: string,
  candidates: Iterable<string>,
  signal?: AbortSignal,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    throwIfAborted(signal);
    const absolute = isAbsolute(candidate) ? candidate : resolve(baseDir, candidate);
    if (await pathExists(absolute, signal)) {
      return absolute;
    }
  }
  return undefined;
}

async function pathExists(path: string, signal?: AbortSignal): Promise<boolean> {
  try {
    throwIfAborted(signal);
    await access(path);
    throwIfAborted(signal);
    return true;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return false;
  }
}
