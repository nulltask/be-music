import { afterEach, expect, test, vi } from 'vite-plus/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { isCLIEntryPoint } from './cli.ts';

const workerState = vi.hoisted(() => ({ main: true }));
vi.mock('node:worker_threads', () => ({
  get isMainThread() {
    return workerState.main;
  },
}));
const originalArgv = process.argv;
afterEach(() => {
  process.argv = originalArgv;
  workerState.main = true;
});

test('matches the entry file with relative paths and URL encoding', () => {
  process.argv = [process.execPath, './folder with spaces/cli.ts'];
  expect(isCLIEntryPoint(() => pathToFileURL(resolve(process.argv[1]!)).href)).toBe(true);
  expect(isCLIEntryPoint(() => pathToFileURL(resolve('another.ts')).href)).toBe(false);
});

test('does not start without a process entry path', () => {
  process.argv = [process.execPath];
  expect(isCLIEntryPoint(() => undefined, { allowExecutableFallback: true })).toBe(false);
});

test('executable fallback is opt-in for unavailable module URLs', () => {
  process.argv = [process.execPath, process.execPath];
  expect(isCLIEntryPoint(() => undefined)).toBe(false);
  expect(isCLIEntryPoint(() => undefined, { allowExecutableFallback: true })).toBe(true);
  expect(
    isCLIEntryPoint(
      () => {
        throw new Error('import.meta unavailable');
      },
      { allowExecutableFallback: true },
    ),
  ).toBe(true);
  expect(isCLIEntryPoint(() => 'not a file URL')).toBe(false);
});

test('fallback never overrides a usable module URL that names another file', () => {
  process.argv = [process.execPath, process.execPath];
  expect(isCLIEntryPoint(() => pathToFileURL(resolve('another.ts')).href, { allowExecutableFallback: true })).toBe(
    false,
  );
});

test('worker threads never start the CLI, including executable fallback', () => {
  process.argv = [process.execPath, process.execPath];
  workerState.main = false;
  const readModuleURL = vi.fn(() => undefined);
  expect(isCLIEntryPoint(readModuleURL, { allowExecutableFallback: true })).toBe(false);
  expect(readModuleURL).not.toHaveBeenCalled();
});
