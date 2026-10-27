import { describe, expect, test } from 'vite-plus/test';
import { handlePlayerSettings, type PlayerSettingsBucket } from './player-settings.ts';

function bucket(): PlayerSettingsBucket & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key) => {
      const text = values.get(key);
      return text === undefined ? null : { etag: text, text: async () => text };
    },
    put: async (key, value, options) => {
      const current = values.get(key);
      if (options?.onlyIf.etagMatches !== undefined && current !== options.onlyIf.etagMatches) return null;
      if (options?.onlyIf.etagDoesNotMatch === '*' && current !== undefined) return null;
      values.set(key, value);
      return { etag: value };
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
}

const document = {
  version: 1,
  updatedAt: 20,
  settings: { gauge: 'HARD', peakGain: true },
};

function put(store: PlayerSettingsBucket, body: unknown = document, cookie?: string): Promise<Response> {
  return handlePlayerSettings(
    new Request('https://play.be-music.app/api/player-settings', {
      method: 'PUT',
      headers: {
        origin: 'https://play.be-music.app',
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    store,
    undefined,
    20,
  );
}

describe('handlePlayerSettings', () => {
  test('sets a device cookie and returns the newer document', async () => {
    const store = bucket();
    const saved = await put(store);
    expect(saved.status).toBe(200);
    const cookie = saved.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('__Host-be-music.device=');
    expect(cookie).toContain('HttpOnly');
    const id = /__Host-be-music\.device=([a-f0-9]{32})/.exec(cookie)?.[1];
    const read = await handlePlayerSettings(
      new Request('https://play.be-music.app/api/player-settings', {
        headers: { cookie: `__Host-be-music.device=${id}` },
      }),
      store,
      undefined,
      30,
    );
    expect(await read.json()).toMatchObject({ settings: { gauge: 'HARD' } });
    const older = await put(
      store,
      { ...document, updatedAt: 10, settings: { gauge: 'EASY' } },
      `__Host-be-music.device=${id}`,
    );
    expect(await older.json()).toMatchObject({ updatedAt: 20, settings: { gauge: 'HARD' } });
  });

  test('keeps an account copy when a session is present', async () => {
    const store = bucket();
    await handlePlayerSettings(
      new Request('https://play.be-music.app/api/player-settings', {
        method: 'PUT',
        headers: { origin: 'https://play.be-music.app', 'content-type': 'application/json' },
        body: JSON.stringify(document),
      }),
      store,
      'account-1',
      20,
    );
    expect([...store.values.keys()].some((key) => key.includes('account/account-1'))).toBe(true);
  });

  test('refuses a put from another origin', async () => {
    const response = await handlePlayerSettings(
      new Request('https://play.be-music.app/api/player-settings', {
        method: 'PUT',
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        body: JSON.stringify(document),
      }),
      bucket(),
      undefined,
    );
    expect(response.status).toBe(403);
  });
});

test('does not replace client edit ordering with a faster server clock', async () => {
  const store = bucket();
  const cookie = `__Host-be-music.device=${'a'.repeat(32)}`;
  const request = (updatedAt: number, gauge: string) =>
    new Request('https://play.be-music.app/api/player-settings', {
      method: 'PUT',
      headers: { origin: 'https://play.be-music.app', cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, updatedAt, settings: { gauge } }),
    });
  await handlePlayerSettings(request(20, 'HARD'), store, undefined, 10000);
  const response = await handlePlayerSettings(request(21, 'EASY'), store, undefined, 10001);
  expect(await response.json()).toMatchObject({ updatedAt: 21, settings: { gauge: 'EASY' } });
});

test('reading settings never writes an older snapshot back to the bucket', async () => {
  const store = bucket();
  const cookie = `__Host-be-music.device=${'a'.repeat(32)}`;
  const deviceKey = `player-settings/device/${'a'.repeat(32)}`;
  const accountKey = 'player-settings/account/user';
  store.values.set(accountKey, JSON.stringify(document));
  const putSpy: string[] = [];
  const putOriginal = store.put;
  store.put = async (key, value) => {
    putSpy.push(key);
    return putOriginal(key, value);
  };
  await handlePlayerSettings(
    new Request('https://play.be-music.app/api/player-settings', { headers: { cookie } }),
    store,
    'user',
    30,
  );
  expect(putSpy).toEqual([]);
  expect(store.values.has(deviceKey)).toBe(false);
});

test('retries a concurrent write without overwriting its newer version', async () => {
  const store = bucket();
  const id = 'a'.repeat(32);
  const key = `player-settings/device/${id}`;
  store.values.set(key, JSON.stringify(document));
  const originalPut = store.put;
  let race = true;
  store.put = async (path, value, options) => {
    if (race) {
      race = false;
      store.values.set(path, JSON.stringify({ ...document, updatedAt: 100, settings: { gauge: 'EASY' } }));
    }
    return originalPut(path, value, options);
  };
  const response = await put(store, { ...document, updatedAt: 30 }, `__Host-be-music.device=${id}`);
  expect(await response.json()).toMatchObject({ updatedAt: 100, settings: { gauge: 'EASY' } });
  expect(JSON.parse(store.values.get(key)!)).toMatchObject({ updatedAt: 100 });
});

test('reset retains no setting values and rejects delayed pre-reset saves', async () => {
  const store = bucket();
  const id = 'a'.repeat(32),
    cookie = `__Host-be-music.device=${id}`;
  await put(store, document, cookie);
  const reset = await handlePlayerSettings(
    new Request('https://play.be-music.app/api/player-settings', {
      method: 'DELETE',
      headers: { origin: 'https://play.be-music.app', cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ...document, updatedAt: 10, deleted: true }),
    }),
    store,
    'user',
    99999,
  );
  const deleted = await reset.json();
  expect(deleted).toEqual({ version: 1, updatedAt: 21, settings: {}, deleted: true });
  expect(await (await put(store, document, cookie)).json()).toEqual(deleted);
  for (const value of store.values.values()) expect(JSON.parse(value)).toEqual(deleted);
  const read = await handlePlayerSettings(
    new Request('https://play.be-music.app/api/player-settings', { headers: { cookie } }),
    store,
    'user',
  );
  expect(await read.json()).toEqual(deleted);
});

test('repeated reset retries keep the same empty revision barrier', async () => {
  const store = bucket();
  const cookie = `__Host-be-music.device=${'a'.repeat(32)}`;
  const request = () =>
    new Request('https://play.be-music.app/api/player-settings', {
      method: 'DELETE',
      headers: { origin: 'https://play.be-music.app', cookie },
      body: JSON.stringify({ version: 1, updatedAt: 30, settings: {}, deleted: true }),
    });
  const first = await (await handlePlayerSettings(request(), store, undefined)).json();
  expect(await (await handlePlayerSettings(request(), store, undefined)).json()).toEqual(first);
});

test('returns a conflict when conditional writes keep racing', async () => {
  const store = bucket();
  store.put = async () => null;
  expect((await put(store)).status).toBe(409);
});

test('limits UTF-8 request bytes rather than JavaScript character count', async () => {
  expect((await put(bucket(), { ...document, settings: { text: 'あ'.repeat(23000) } })).status).toBe(413);
});
