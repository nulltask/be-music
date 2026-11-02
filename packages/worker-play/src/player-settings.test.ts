import { describe, expect, test } from 'vite-plus/test';
import { handlePlayerSettings, type PlayerSettingsBucket } from './player-settings.ts';

interface Stored {
  bytes: Uint8Array;
  etag: string;
  contentEncoding?: string;
}

function bucket(): PlayerSettingsBucket & {
  values: Map<string, Stored>;
  seed(key: string, text: string): void;
} {
  const values = new Map<string, Stored>();
  let serial = 0;
  return {
    values,
    seed(key, text) {
      serial += 1;
      values.set(key, { bytes: new TextEncoder().encode(text), etag: `seed-${serial}` });
    },
    get: async (key) => {
      const stored = values.get(key);
      if (stored === undefined) return null;
      return {
        etag: stored.etag,
        httpMetadata: stored.contentEncoding === undefined ? undefined : { contentEncoding: stored.contentEncoding },
        arrayBuffer: async () => stored.bytes.slice().buffer,
      };
    },
    put: async (key, value, options) => {
      const current = values.get(key);
      if (options?.onlyIf.etagMatches !== undefined && current?.etag !== options.onlyIf.etagMatches) return null;
      if (options?.onlyIf.etagDoesNotMatch === '*' && current !== undefined) return null;
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
      serial += 1;
      const etag = `etag-${serial}`;
      values.set(key, { bytes, etag, contentEncoding: options?.httpMetadata?.contentEncoding });
      return { etag };
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
}

async function storedJSON(stored: Stored): Promise<unknown> {
  const buffer = new ArrayBuffer(stored.bytes.byteLength);
  new Uint8Array(buffer).set(stored.bytes);
  const text =
    stored.contentEncoding === 'gzip'
      ? await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      : new TextDecoder().decode(buffer);
  return JSON.parse(text);
}

const document = {
  version: 0,
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
      body: JSON.stringify({ version: 0, updatedAt, settings: { gauge } }),
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
  store.seed(accountKey, JSON.stringify(document));
  const putSpy: string[] = [];
  const putOriginal = store.put;
  store.put = async (key, value, options) => {
    putSpy.push(key);
    return putOriginal(key, value, options);
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
  store.seed(key, JSON.stringify(document));
  const originalPut = store.put;
  let race = true;
  store.put = async (path, value, options) => {
    if (race) {
      race = false;
      store.seed(path, JSON.stringify({ ...document, updatedAt: 100, settings: { gauge: 'EASY' } }));
    }
    return originalPut(path, value, options);
  };
  const response = await put(store, { ...document, updatedAt: 30 }, `__Host-be-music.device=${id}`);
  expect(await response.json()).toMatchObject({ updatedAt: 100, settings: { gauge: 'EASY' } });
  expect(await storedJSON(store.values.get(key)!)).toMatchObject({ updatedAt: 100 });
});

test('reads a plain JSON object written before compression', async () => {
  const store = bucket();
  const id = 'b'.repeat(32);
  const key = `player-settings/device/${id}`;
  store.seed(key, JSON.stringify({ version: 0, updatedAt: 40, settings: { gauge: 'EASY' } }));
  const read = await handlePlayerSettings(
    new Request('https://play.be-music.app/api/player-settings', {
      headers: { cookie: `__Host-be-music.device=${id}` },
    }),
    store,
    undefined,
  );
  expect(await read.json()).toMatchObject({ version: 0, updatedAt: 40, settings: { gauge: 'EASY' } });
  expect(store.values.get(key)?.contentEncoding).toBeUndefined();
});

test('treats a document stamped with an older version as absent', async () => {
  const store = bucket();
  expect((await put(store, { ...document, version: 1 })).status).toBe(400);
  const id = 'c'.repeat(32);
  const key = `player-settings/device/${id}`;
  store.seed(key, JSON.stringify({ version: 1, updatedAt: 40, settings: { gauge: 'EASY' } }));
  const read = await handlePlayerSettings(
    new Request('https://play.be-music.app/api/player-settings', {
      headers: { cookie: `__Host-be-music.device=${id}` },
    }),
    store,
    undefined,
  );
  expect(read.status).toBe(204);
  expect(store.values.get(key)?.contentEncoding).toBeUndefined();
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
  expect(deleted).toEqual({ version: 0, updatedAt: 21, settings: {}, deleted: true });
  expect(await (await put(store, document, cookie)).json()).toEqual(deleted);
  for (const value of store.values.values()) {
    expect(value.contentEncoding).toBe('gzip');
    expect(value.bytes[0]).toBe(0x1f);
    expect(value.bytes[1]).toBe(0x8b);
    expect(await storedJSON(value)).toEqual(deleted);
  }
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
      body: JSON.stringify({ version: 0, updatedAt: 30, settings: {}, deleted: true }),
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
