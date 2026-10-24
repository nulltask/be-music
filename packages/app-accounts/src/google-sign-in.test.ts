import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker from './index.ts';
import type { Env } from './auth.ts';

let env: Env;
let mf: Miniflare;
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
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
  };
});
afterAll(async () => {
  await mf.dispose();
});

describe('Google sign-in', () => {
  test('returns to the Accounts callback and does not send prompt=none', async () => {
    const response = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { origin: env.AUTH_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: '/account', disableRedirect: true }),
      }),
      env,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { url?: string };
    const url = new URL(body.url ?? '');
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.pathname).toBe('/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('google-client');
    expect(url.searchParams.get('redirect_uri')).toBe(`${env.AUTH_ORIGIN}/api/auth/callback/google`);
    // Google omits prompt unless one is set. prompt=none would block the first consent screen.
    expect(url.searchParams.get('prompt')).toBeNull();
  });

  test('hides Google when the Worker has no credentials', async () => {
    const withoutGoogle = { ...env, GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined };
    const response = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/login`, { headers: { origin: env.AUTH_ORIGIN } }),
      withoutGoogle,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('data-action="google"');
  });
});
