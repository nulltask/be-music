import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker, { type Env } from './index.ts';

let env: Env;
let mf: Miniflare;
const SESSION_COOKIE = '__Secure-be-music-accounts.session_token';
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
const cookieNamed = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0];

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
    AUTH_ORIGIN: 'https://dashboard.example',
    PASSKEY_RP_ID: 'dashboard.example',
    API_AUDIENCE: 'https://leaderboard.example',
    BETTER_AUTH_SECRET: 'test-provider-secret-with-at-least-32-characters',
    OIDC_CLIENTS: JSON.stringify({ play: 'https://play.example' }),
    PLAY_ORIGIN: 'https://play.example/',
    LEADERBOARD_ORIGIN: 'https://leaderboard.example/',
    DONATE_ORIGIN: 'https://donate.example/',
  };
});
afterAll(async () => {
  await mf.dispose();
});

async function signInAsGuest(): Promise<Response> {
  const response = await worker.fetch(
    new Request(`${env.AUTH_ORIGIN}/api/auth/sign-in/anonymous`, {
      method: 'POST',
      headers: { origin: env.AUTH_ORIGIN, 'content-type': 'application/json' },
      body: '{}',
    }),
    env,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return response;
}

describe('Dashboard host', () => {
  test('shows the dashboard to signed-out visitors', async () => {
    const response = await worker.fetch(new Request(env.AUTH_ORIGIN), env);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('data-state="signed-out"');
    expect(html).toContain('href="/login"');
    expect(response.headers.get('content-security-policy')).toContain("img-src 'self'");
  });

  test('welcomes a new account before showing the Dashboard', async () => {
    const cookie = cookies(await signInAsGuest());
    const response = await worker.fetch(new Request(env.AUTH_ORIGIN, { headers: { cookie } }), env);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/welcome?next=%2F');
  });

  test('reads the Accounts session directly and shows the profile', async () => {
    const cookie = cookies(await signInAsGuest());
    // Past the welcome a new account sees first.
    await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/profile/onboarded`, {
        method: 'POST',
        headers: { cookie, origin: env.AUTH_ORIGIN },
      }),
      env,
    );
    const response = await worker.fetch(new Request(env.AUTH_ORIGIN, { headers: { cookie } }), env);
    const html = await response.text();
    expect(html).toContain('data-state="anonymous"');
    expect(html).toContain('href="/account"');
    expect(html).toContain('<form method="post" action="/sign-out">');
    expect(html).toMatch(/src="https:\/\/dashboard\.example\/profiles\/[a-z0-9_]+\/avatar\?v=g"/);
  });

  test('signs out through Better Auth only for a same-origin form', async () => {
    const cookie = cookies(await signInAsGuest());
    const forged = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/sign-out`, {
        method: 'POST',
        headers: { cookie, origin: 'https://evil.example' },
      }),
      env,
    );
    expect(forged.status).toBe(403);
    const response = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/sign-out`, { method: 'POST', headers: { cookie, origin: env.AUTH_ORIGIN } }),
      env,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(cookieNamed(response, SESSION_COOKIE)).toBe(`${SESSION_COOKIE}=`);
  });

  test('serves the issuer at the Dashboard origin', async () => {
    const response = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/.well-known/openid-configuration`),
      env,
    );
    expect(((await response.json()) as { issuer: string }).issuer).toBe(`${env.AUTH_ORIGIN}/api/auth`);
  });

  test('rejects unknown hosts', async () => {
    expect((await worker.fetch(new Request('https://other.example/'), env)).status).toBe(400);
  });
});
