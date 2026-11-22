import { resolve } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { resolveCLIPath } from './cli-path.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test('uses the CLI launch directory before falling back to the current directory', () => {
  const launchDirectory = resolve('launch-directory');
  vi.stubEnv('INIT_CWD', launchDirectory);
  expect(resolveCLIPath('.')).toBe(launchDirectory);
  vi.stubEnv('INIT_CWD', undefined);
  expect(resolveCLIPath('')).toBe(process.cwd());
});

test('normalizes parent segments in Node ESM', () => {
  const cwd = resolve('charts');
  expect(resolveCLIPath('collection/../preview.bms', cwd)).toBe(resolve(cwd, 'preview.bms'));
  expect(resolveCLIPath('../preview.bms', cwd)).toBe(resolve('preview.bms'));
});

test('resolves ordinary relative paths when there is no Node process', () => {
  vi.stubGlobal('process', undefined);
  const plain = resolveCLIPath('preview.bms');
  const withParent = resolveCLIPath('collection/../preview.bms');
  vi.unstubAllGlobals();

  expect(plain).toBe('./preview.bms');
  expect(withParent).toBe('.');
});
