import { expect, test, vi } from 'vite-plus/test';
import { requestPersistentStorage } from './storage-persistence.ts';

test('asks for persistent storage once it is not granted yet', async () => {
  const persist = vi.fn(async () => true);
  expect(await requestPersistentStorage({ persisted: async () => false, persist })).toBe(true);
  expect(persist).toHaveBeenCalledOnce();
});

test('does not ask again once the storage is persistent', async () => {
  const persist = vi.fn(async () => true);
  expect(await requestPersistentStorage({ persisted: async () => true, persist })).toBe(true);
  expect(persist).not.toHaveBeenCalled();
});

test('reports a refusal, and nothing where the browser has no API or the call fails', async () => {
  expect(await requestPersistentStorage({ persisted: async () => false, persist: async () => false })).toBe(false);
  expect(await requestPersistentStorage(undefined)).toBeUndefined();
  expect(await requestPersistentStorage({})).toBeUndefined();
  expect(
    await requestPersistentStorage({
      persist: async () => {
        throw new Error('denied');
      },
    }),
  ).toBeUndefined();
});
