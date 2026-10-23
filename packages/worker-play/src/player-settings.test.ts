import { describe, expect, test } from 'vite-plus/test';
import { handlePlayerSettings, type PlayerSettingsBucket } from './player-settings.ts';

function bucket(): PlayerSettingsBucket & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key) => {
      const text = values.get(key);
      return text === undefined ? null : { text: async () => text };
    },
    put: async (key, value) => {
      values.set(key, value);
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
