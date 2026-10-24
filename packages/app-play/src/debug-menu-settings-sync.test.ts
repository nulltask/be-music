import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import {
  DEBUG_MENU_SETTINGS_STORAGE_KEY,
  readStoredDebugMenuSettings,
  type DebugMenuSettingsDocument,
} from './debug-menu-settings.ts';
import { DebugMenuSettingsSync, RESET_PENDING_KEY } from './debug-menu-settings-sync.ts';

function memory(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    key: (index) => [...values.keys()][index] ?? null,
  };
}
const doc = (updatedAt = 20, gauge: 'HARD' | 'EASY' = 'HARD'): DebugMenuSettingsDocument => ({
  version: 1,
  updatedAt,
  settings: { gauge },
});
const result = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

describe('DebugMenuSettingsSync', () => {
  test('persists locally before the debounce and publishes only the latest edit', async () => {
    vi.useFakeTimers();
    const storage = memory();
    const doFetch = vi.fn<typeof fetch>(async (_url, init) => result(JSON.parse(init?.body as string)));
    const sync = new DebugMenuSettingsSync({ storage, fetch: doFetch });
    sync.save(doc());
    expect(readStoredDebugMenuSettings(storage)?.settings.gauge).toBe('HARD');
    sync.save(doc(21, 'EASY'));
    expect(readStoredDebugMenuSettings(storage)?.settings.gauge).toBe('EASY');
    expect(doFetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    await sync.flush();
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(doFetch.mock.calls[0]![1]!.body as string).settings.gauge).toBe('EASY');
  });

  test('a late PUT response cannot replace a subsequent local edit', async () => {
    vi.useFakeTimers();
    const storage = memory(),
      first = deferred<Response>();
    const doFetch = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (_url, init) => result(JSON.parse(init?.body as string)));
    const sync = new DebugMenuSettingsSync({ storage, fetch: doFetch });
    sync.save(doc());
    const sending = sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    sync.save(doc(22, 'EASY'));
    first.resolve(result(doc(21)));
    await sending;
    expect(readStoredDebugMenuSettings(storage)).toMatchObject({ updatedAt: 22, settings: { gauge: 'EASY' } });
    await sync.flush();
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  test('orders DELETE after an in-flight PUT and suppresses subsequent saves during reset', async () => {
    vi.useFakeTimers();
    const storage = memory(),
      first = deferred<Response>();
    storage.setItem('be-music.chart-best-records', 'keep');
    const doFetch = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (_url, init) => result(JSON.parse(init?.body as string)));
    const sync = new DebugMenuSettingsSync({ storage, fetch: doFetch, now: () => 30 });
    sync.save(doc());
    const sending = sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    sync.save(doc(21, 'EASY'));
    const resetting = sync.reset();
    sync.save(doc(40));
    expect(storage.getItem(DEBUG_MENU_SETTINGS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(RESET_PENDING_KEY)).not.toBeNull();
    first.resolve(result(doc(25)));
    await sending;
    await resetting;
    await vi.advanceTimersByTimeAsync(1000);
    expect(doFetch.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'DELETE']);
    expect(storage.getItem(DEBUG_MENU_SETTINGS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('be-music.chart-best-records')).toBe('keep');
    expect(storage.getItem(RESET_PENDING_KEY)).toBeNull();
  });

  test('reset cancels an unsent debounced save', async () => {
    vi.useFakeTimers();
    const doFetch = vi.fn<typeof fetch>(async (_url, init) => result(JSON.parse(init?.body as string)));
    const sync = new DebugMenuSettingsSync({ storage: memory(), fetch: doFetch });
    sync.save(doc());
    await sync.reset();
    await vi.advanceTimersByTimeAsync(1000);
    expect(doFetch.mock.calls.map(([, init]) => init?.method)).toEqual(['DELETE']);
  });

  test('keeps an offline reset marker in local storage and retries it in a new page', async () => {
    const storage = memory();
    const offline = vi.fn<typeof fetch>(async () => {
      throw new Error('offline');
    });
    const first = new DebugMenuSettingsSync({ storage, fetch: offline, now: () => 30 });
    await first.reset();
    expect(storage.getItem(RESET_PENDING_KEY)).not.toBeNull();
    const online = vi.fn<typeof fetch>(async (_url, init) =>
      init?.method === 'DELETE' ? result(JSON.parse(init.body as string)) : new Response(null, { status: 204 }),
    );
    await new DebugMenuSettingsSync({ storage, fetch: online }).reconcile();
    expect(online.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['DELETE', 'GET']);
    expect(storage.getItem(RESET_PENDING_KEY)).toBeNull();
  });

  test('retries deletion before publishing edits made after an offline reset', async () => {
    vi.useFakeTimers();
    const storage = memory();
    await new DebugMenuSettingsSync({
      storage,
      fetch: async () => {
        throw new Error('offline');
      },
      now: () => 30,
    }).reset();
    const doFetch = vi.fn<typeof fetch>(async (_url, init) =>
      init?.method === 'DELETE'
        ? result({ version: 1, updatedAt: 500, settings: {}, deleted: true })
        : result(JSON.parse(init?.body as string)),
    );
    const next = new DebugMenuSettingsSync({ storage, fetch: doFetch });
    next.save(doc(31, 'EASY'));
    await next.flush();
    expect(doFetch.mock.calls.map(([, init]) => init?.method)).toEqual(['DELETE', 'PUT']);
    expect(readStoredDebugMenuSettings(storage)).toMatchObject({ settings: { gauge: 'EASY' } });
    expect(readStoredDebugMenuSettings(storage)!.updatedAt).toBeGreaterThan(500);
    expect(JSON.parse(doFetch.mock.calls[1]![1]!.body as string).updatedAt).toBeGreaterThan(500);
  });

  test('restores a newer remote document before boot', async () => {
    const storage = memory();
    storage.setItem(DEBUG_MENU_SETTINGS_STORAGE_KEY, JSON.stringify(doc()));
    await new DebugMenuSettingsSync({ storage, fetch: async () => result(doc(21, 'EASY')) }).reconcile();
    expect(readStoredDebugMenuSettings(storage)?.settings.gauge).toBe('EASY');
  });

  test('a remote reset clears settings but preserves records and the next edit advances its revision', async () => {
    vi.useFakeTimers();
    const storage = memory();
    storage.setItem(DEBUG_MENU_SETTINGS_STORAGE_KEY, JSON.stringify(doc()));
    storage.setItem('be-music.chart-best-records', 'keep');
    const doFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(result({ version: 1, updatedAt: 500, settings: {}, deleted: true }))
      .mockImplementation(async (_url, init) => result(JSON.parse(init?.body as string)));
    const sync = new DebugMenuSettingsSync({ storage, fetch: doFetch });
    await sync.reconcile();
    expect(storage.getItem(DEBUG_MENU_SETTINGS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('be-music.chart-best-records')).toBe('keep');
    sync.save(doc(21, 'EASY'));
    await sync.flush();
    expect(readStoredDebugMenuSettings(storage)).toMatchObject({ updatedAt: 501, settings: { gauge: 'EASY' } });
  });

  test('does not publish or restore while reset retry is offline', async () => {
    const storage = memory();
    await new DebugMenuSettingsSync({
      storage,
      fetch: async () => {
        throw new Error('offline');
      },
    }).reset();
    const doFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    await new DebugMenuSettingsSync({ storage, fetch: doFetch }).reconcile();
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(doFetch.mock.calls[0]![1]!.method).toBe('DELETE');
    expect(storage.getItem(RESET_PENDING_KEY)).not.toBeNull();
  });

  test('a late GET cannot overwrite a local edit made in flight', async () => {
    vi.useFakeTimers();
    const storage = memory(),
      get = deferred<Response>();
    const doFetch = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => get.promise)
      .mockImplementation(async (_url, init) => result(JSON.parse(init?.body as string)));
    const sync = new DebugMenuSettingsSync({ storage, fetch: doFetch });
    const reconciling = sync.reconcile();
    await vi.advanceTimersByTimeAsync(0);
    sync.save(doc(22, 'EASY'));
    get.resolve(result(doc(23)));
    await reconciling;
    expect(readStoredDebugMenuSettings(storage)?.settings.gauge).toBe('EASY');
    await sync.flush();
  });

  test('local revisions stay monotonic when the clock moves backwards', async () => {
    vi.useFakeTimers();
    const storage = memory();
    const sync = new DebugMenuSettingsSync({
      storage,
      fetch: async (_url, init) => result(JSON.parse(init?.body as string)),
    });
    sync.save(doc(100));
    sync.save(doc(20, 'EASY'));
    expect(readStoredDebugMenuSettings(storage)).toMatchObject({ updatedAt: 101, settings: { gauge: 'EASY' } });
    await sync.flush();
  });
});
