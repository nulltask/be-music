import { expect, test, vi } from 'vite-plus/test';
import { readWorkerCount, storeWorkerCount, WORKER_COUNT_STORAGE_KEY } from './worker-settings.ts';
test('restores overrides and uses CPU defaults for missing, invalid, or inaccessible storage', () => {
  expect(readWorkerCount(undefined, 12)).toBe(6);
  for (const raw of [null, '', '0', 'garbage', '1.5'])
    expect(readWorkerCount({ getItem: () => raw, setItem: () => {} }, 8)).toBe(4);
  expect(readWorkerCount({ getItem: () => '3', setItem: () => {} }, 8)).toBe(3);
  expect(
    readWorkerCount(
      {
        getItem: () => {
          throw Error();
        },
        setItem: () => {},
      },
      8,
    ),
  ).toBe(4);
});
test('stores without exposing blocked-storage errors', () => {
  const setItem = vi.fn();
  storeWorkerCount({ getItem: () => null, setItem }, 3);
  expect(setItem).toHaveBeenCalledWith(WORKER_COUNT_STORAGE_KEY, '3');
  expect(() =>
    storeWorkerCount(
      {
        getItem: () => null,
        setItem: () => {
          throw Error();
        },
      },
      3,
    ),
  ).not.toThrow();
});
