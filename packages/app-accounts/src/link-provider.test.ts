import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker from './index.ts';
import type { Env } from './auth.ts';

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
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).sort()) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
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

describe('Linking providers onto the signed-in account', () => {
  test('offers Discord, Google, and a passkey, then hides a provider after it is linked', async () => {
    const signIn = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/sign-in/anonymous`, {
        method: 'POST',
        headers: { origin: env.AUTH_ORIGIN, 'content-type': 'application/json' },
        body: '{}',
      }),
      env,
    );
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    const cookie = cookies(signIn);
    const userId = ((await signIn.json()) as { user: { id: string } }).user.id;
    const accountPage = await worker.fetch(new Request(`${env.AUTH_ORIGIN}/account`, { headers: { cookie } }), env);
    const html = await accountPage.text();
    expect(html).toContain('data-action="link-discord"');
    expect(html).toContain('data-action="link-google"');
    expect(html).toContain('data-action="add-passkey"');
    expect(html).not.toContain('data-action="discord"');
    expect(html).not.toContain('data-action="google"');

    const link = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/link-social`, {
        method: 'POST',
        headers: { origin: env.AUTH_ORIGIN, 'content-type': 'application/json', cookie },
        body: JSON.stringify({ provider: 'discord', callbackURL: '/account', errorCallbackURL: '/account' }),
      }),
      env,
    );
    expect(link.status, await link.clone().text()).toBe(200);
    const body = (await link.json()) as { url?: string };
    const url = new URL(body.url ?? '');
    expect(url.origin).toBe('https://discord.com');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('redirect_uri')).toBe(`${env.AUTH_ORIGIN}/api/auth/callback/discord`);

    await env.DB.prepare('insert into account (id, account_id, provider_id, user_id) values (?, ?, ?, ?)')
      .bind('linked-discord', 'discord-user', 'discord', userId)
      .run();
    const linkedPage = await worker.fetch(new Request(`${env.AUTH_ORIGIN}/account`, { headers: { cookie } }), env);
    const linked = await linkedPage.text();
    expect(linked).toContain('Discord is linked.');
    expect(linked).not.toContain('data-action="link-discord"');
    expect(linked).toContain('data-action="link-google"');
    expect(linked).toContain('data-action="add-passkey"');
  });
});
