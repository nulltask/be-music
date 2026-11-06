import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { handleAccounts } from './handler.ts';
import { createAuth, type Env } from './auth.ts';

const worker = { fetch: handleAccounts };

let env: Env;
let mf: Miniflare;
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {}',
      compatibilityDate: '2026-10-01',
      d1Databases: ['DB'],
      r2Buckets: ['BLOBS'],
    }),
  );
  const DB = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of (await readdir(new URL('../../migrations/', import.meta.url))).sort()) {
    const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint'))
      if (statement.trim()) await DB.prepare(statement).run();
  }
  env = {
    DB,
    BLOBS: (await mf.getR2Bucket('BLOBS')) as unknown as R2Bucket,
    AUTH_ORIGIN: 'https://accounts.example.com',
    PASSKEY_RP_ID: 'example.com',
    API_AUDIENCE: 'https://api.third.org',
    BETTER_AUTH_SECRET: 'test-provider-secret-with-at-least-32-characters',
    OIDC_CLIENTS: JSON.stringify({ play: 'https://player.other.net' }),
    DISCORD_CLIENT_ID: 'discord-client',
    DISCORD_CLIENT_SECRET: 'discord-secret',
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
  };
});
afterAll(async () => {
  await mf.dispose();
});

const call = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  worker.fetch(
    new Request(`${env.AUTH_ORIGIN}${path}`, {
      ...init,
      headers: {
        origin: env.AUTH_ORIGIN,
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...Object.fromEntries(new Headers(init.headers)),
      },
    }),
    env,
  );
const startGuest = async () => {
  const response = await call('/api/auth/sign-in/anonymous', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  expect(response.status).toBe(200);
  return {
    cookie: cookies(response),
    userId: ((await response.json()) as { user: { id: string } }).user.id,
  };
};

describe('Welcome after sign-up', () => {
  test('sends a new account to the welcome until it is done, then shows the account page', async () => {
    const { cookie } = await startGuest();
    const account = await call('/account', { cookie });
    expect(account.status).toBe(302);
    expect(account.headers.get('location')).toBe('/welcome?next=%2Faccount');
    expect(((await (await call('/api/profile', { cookie })).json()) as { onboarded: boolean }).onboarded).toBe(false);
    const page = await call('/welcome?next=%2Faccount', { cookie });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('data-welcome-step="keep"');

    expect((await call('/api/profile/onboarded', { method: 'POST', cookie })).status).toBe(200);
    expect((await call('/account', { cookie })).status).toBe(200);
    expect(((await (await call('/api/profile', { cookie })).json()) as { onboarded: boolean }).onboarded).toBe(true);
  });

  test('sends a signed-out visitor of the welcome to sign in, and keeps the welcome on this host', async () => {
    const signedOut = await call('/welcome');
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get('location')).toBe('/login');
    const { cookie } = await startGuest();
    const page = await (await call('/welcome?next=https%3A%2F%2Fevil.example', { cookie })).text();
    expect(page).toContain('data-welcome-next="/account"');
  });

  test('checks a handle as it is typed', async () => {
    const { cookie } = await startGuest();
    const other = await startGuest();
    // A profile is made on the account's first request.
    await call('/api/profile', { cookie: other.cookie });
    const taken = (await env.DB.prepare('select handle from profile where user_id = ?')
      .bind(other.userId)
      .first<{ handle: string }>())!.handle;
    const check = async (value: string) =>
      (await call(`/api/profile/handle?${new URLSearchParams({ value })}`, { cookie })).json();
    expect(await check('DJ_Taro')).toEqual({ ok: true, handle: 'dj_taro' });
    expect(await check(taken)).toEqual({ ok: false, reason: 'taken' });
    expect(await check('admin')).toEqual({ ok: false, reason: 'reserved' });
    expect(await check('a-b')).toEqual({ ok: false, reason: 'format' });
  });

  test.each(['google', 'discord'])(
    'welcomes a guest again once %s keeps the account, renaming its placeholder',
    async (providerId) => {
      const { cookie, userId } = await startGuest();
      expect((await call('/api/profile/onboarded', { method: 'POST', cookie })).status).toBe(200);
      const context = await createAuth(env).$context;
      await context.internalAdapter.linkAccount({ userId, providerId, accountId: `${providerId}-kept-${userId}` });
      const row = await env.DB.prepare('select display_name, onboarded_at from profile where user_id = ?')
        .bind(userId)
        .first<{ display_name: string; onboarded_at: number | null }>();
      expect(row).toEqual({ display_name: 'Player', onboarded_at: null });
    },
  );

  test('leaves a regular account that links another provider alone', async () => {
    const { cookie, userId } = await startGuest();
    const context = await createAuth(env).$context;
    await context.internalAdapter.linkAccount({ userId, providerId: 'google', accountId: `google-first-${userId}` });
    expect((await call('/api/profile/onboarded', { method: 'POST', cookie })).status).toBe(200);
    await context.internalAdapter.linkAccount({ userId, providerId: 'discord', accountId: `discord-then-${userId}` });
    const row = await env.DB.prepare('select onboarded_at from profile where user_id = ?')
      .bind(userId)
      .first<{ onboarded_at: number | null }>();
    expect(row?.onboarded_at).not.toBeNull();
  });
});
