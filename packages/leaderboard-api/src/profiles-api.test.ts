import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { createApp } from './app.ts';
import type { Env } from './env.ts';
import { ORIGIN, signInAnonymously, startTestBindings } from '../test/support.ts';

let env: Env;
let dispose: () => Promise<void>;
const app = createApp({ chartsetLookup: async () => undefined });
const fetchApp = (path: string, init?: RequestInit): Promise<Response> =>
  Promise.resolve(app.request(`${ORIGIN}${path}`, init, env));

beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});

afterAll(async () => {
  await dispose();
});

const patchMe = (cookie: string, body: unknown) =>
  fetchApp('/api/v0/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });

type Account = { handle: string; displayName: string; avatarUrl: string };

/** A 1 x 1 PNG. */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);

describe('profiles', () => {
  test('a player renames themselves; the old handle stays theirs and its page redirects', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const before = (await (await fetchApp('/api/v0/me', { headers: { cookie } })).json()) as Account;
    expect(before.handle).toMatch(/^player_[a-z0-9]{8}$/);

    const renamed = await patchMe(cookie, { handle: 'DJ_Taro', displayName: '  たろう ' });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ handle: 'dj_taro', displayName: 'たろう' });

    const old = await fetchApp(`/leaderboard/players/${before.handle}?x=1`);
    expect(old.status).toBe(301);
    expect(old.headers.get('location')).toBe('/leaderboard/players/dj_taro?x=1');
    expect((await fetchApp('/leaderboard/players/DJ_TARO')).status).toBe(200);

    // Another player can take neither the new handle nor the old one.
    const other = await signInAnonymously(fetchApp);
    expect((await patchMe(other, { handle: 'dj_taro' })).status).toBe(409);
    expect((await patchMe(other, { handle: before.handle.replace('player_', 'player_') })).status).toBe(409);

    // The player can take their old handle back.
    expect(await (await patchMe(cookie, { handle: before.handle })).json()).toMatchObject({ handle: before.handle });
    expect((await fetchApp(`/leaderboard/players/${before.handle}`)).status).toBe(200);
  });

  test('broken rules answer 400 with the reason, and the account is unchanged', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const invalidHandle = await patchMe(cookie, { handle: 'no-hyphens' });
    expect(invalidHandle.status).toBe(400);
    expect(await invalidHandle.json()).toEqual({ error: 'invalid-handle', detail: 'format' });
    expect(await (await patchMe(cookie, { handle: 'admin' })).json()).toEqual({
      error: 'invalid-handle',
      detail: 'reserved',
    });
    expect(await (await patchMe(cookie, { displayName: 'a\nb' })).json()).toEqual({
      error: 'invalid-display-name',
      detail: 'characters',
    });
    expect((await patchMe(cookie, { handle: 42 })).status).toBe(400);
    expect((await fetchApp('/api/v0/me', { method: 'PATCH', body: '{}' })).status).toBe(401);
  });

  test('an uploaded icon replaces the generated one until it is removed', async () => {
    const cookie = await signInAnonymously(fetchApp);
    const me = (await (await fetchApp('/api/v0/me', { headers: { cookie } })).json()) as Account;
    expect(me.avatarUrl).toMatch(/\?v=g$/);
    const generated = await fetchApp(me.avatarUrl);
    expect(generated.headers.get('content-type')).toBe('image/svg+xml');

    const put = await fetchApp('/api/v0/me/avatar', {
      method: 'PUT',
      headers: { 'content-type': 'image/png', cookie },
      body: PNG,
    });
    expect(put.status).toBe(200);
    const uploaded = (await put.json()) as Account;
    expect(uploaded.avatarUrl).toMatch(/\?v=[0-9a-f]{16}$/);
    const image = await fetchApp(uploaded.avatarUrl);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);

    // The ranking and the player page show it.
    expect(await (await fetchApp(`/leaderboard/players/${me.handle}`)).text()).toContain(
      uploaded.avatarUrl.replace('&', '&amp;'),
    );

    const svg = await fetchApp('/api/v0/me/avatar', {
      method: 'PUT',
      headers: { 'content-type': 'image/svg+xml', cookie },
      body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
    expect(svg.status).toBe(415);
    const big = await fetchApp('/api/v0/me/avatar', {
      method: 'PUT',
      headers: { 'content-type': 'image/png', cookie },
      body: new Uint8Array(200 * 1024),
    });
    expect(big.status).toBe(413);

    const removed = (await (
      await fetchApp('/api/v0/me/avatar', { method: 'DELETE', headers: { cookie } })
    ).json()) as Account;
    expect(removed.avatarUrl).toMatch(/\?v=g$/);
    expect((await fetchApp(removed.avatarUrl)).headers.get('content-type')).toBe('image/svg+xml');
  });
});
