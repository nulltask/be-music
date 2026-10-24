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
    DISCORD_CLIENT_ID: 'discord-client',
    DISCORD_CLIENT_SECRET: 'discord-secret',
  };
});
afterAll(async () => {
  await mf.dispose();
});

describe('Discord sign-in', () => {
  test('asks Discord for consent and returns to the Accounts callback', async () => {
    const response = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { origin: env.AUTH_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'discord', callbackURL: '/account', disableRedirect: true }),
      }),
      env,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { url?: string };
    const url = new URL(body.url ?? '');
    expect(url.origin).toBe('https://discord.com');
    expect(url.pathname).toBe('/api/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('discord-client');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toBe('identify email');
    expect(url.searchParams.get('redirect_uri')).toBe(`${env.AUTH_ORIGIN}/api/auth/callback/discord`);
  });

  test('hides Discord when the Worker has no credentials', async () => {
    const withoutDiscord = { ...env, DISCORD_CLIENT_ID: undefined, DISCORD_CLIENT_SECRET: undefined };
    const response = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/login`, { headers: { origin: env.AUTH_ORIGIN } }),
      withoutDiscord,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('data-action="discord"');
  });
});
