import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { FOLDER_HANDLE_TIMEOUT_MS, folderReadPermission, isSameFolder, settleWithin } from './folder-handle.ts';

const never = <T>() => new Promise<T>(() => {});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('settleWithin', () => {
  test('answers with the value that arrives in time', async () => {
    await expect(settleWithin(Promise.resolve('granted'), 100, 'late')).resolves.toBe('granted');
  });

  test('answers with the fallback when the work fails', async () => {
    await expect(settleWithin(Promise.reject(new Error('gone')), 100, 'fallback')).resolves.toBe('fallback');
  });

  test('answers with the fallback when the work never settles', async () => {
    const settled = settleWithin(never<string>(), 100, 'fallback');
    await vi.advanceTimersByTimeAsync(100);
    await expect(settled).resolves.toBe('fallback');
  });
});

describe('folderReadPermission', () => {
  test("passes on the browser's answer", async () => {
    await expect(folderReadPermission({ name: 'Pack', queryPermission: async () => 'granted' })).resolves.toBe(
      'granted',
    );
    await expect(folderReadPermission({ name: 'Pack', queryPermission: async () => 'denied' })).resolves.toBe('denied');
  });

  test('reads a query that never answers as one that needs the permission asked again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const permission = folderReadPermission({ name: 'Pack', queryPermission: never });
    await vi.advanceTimersByTimeAsync(FOLDER_HANDLE_TIMEOUT_MS);
    await expect(permission).resolves.toBe('prompt');
    expect(warn).toHaveBeenCalledOnce();
  });

  test('reads a failed query as one that needs the permission asked again', async () => {
    const rejecting = { name: 'Pack', queryPermission: () => Promise.reject(new Error('gone')) };
    await expect(folderReadPermission(rejecting)).resolves.toBe('prompt');
    const throwing = {
      name: 'Pack',
      queryPermission: (): Promise<PermissionState> => {
        throw new TypeError('not a handle');
      },
    };
    await expect(folderReadPermission(throwing)).resolves.toBe('prompt');
  });
});

describe('isSameFolder', () => {
  test("passes on the browser's answer", async () => {
    const folder = { isSameEntry: async (other: unknown) => other === folder };
    await expect(isSameFolder(folder, folder)).resolves.toBe(true);
    await expect(isSameFolder(folder, {})).resolves.toBe(false);
  });

  test('reads a comparison that never answers, or fails, as another folder', async () => {
    const compared = isSameFolder({ isSameEntry: never }, {});
    await vi.advanceTimersByTimeAsync(FOLDER_HANDLE_TIMEOUT_MS);
    await expect(compared).resolves.toBe(false);
    await expect(isSameFolder({ isSameEntry: () => Promise.reject(new Error('gone')) }, {})).resolves.toBe(false);
  });
});
