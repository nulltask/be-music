import { afterAll, beforeAll, describe, expect, test, vi } from 'vite-plus/test';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { handleAuth, readSession, verifyAccess, type OIDCEnv } from '@be-music/auth-client';
import worker from './index.ts';
import type { Env } from './auth.ts';

let env: Env;
let mf: Miniflare;
const app: OIDCEnv = {
  AUTH_ISSUER: 'https://accounts.example.com/api/auth',
  PUBLIC_ORIGIN: 'https://player.other.net',
  API_AUDIENCE: 'https://api.third.org',
  OIDC_CLIENT_ID: 'play',
  SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
};
const cookies = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {}',
      compatibilityDate: '2026-10-01',
      d1Databases: ['DB'],
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
    AUTH_ORIGIN: 'https://accounts.example.com',
    PASSKEY_RP_ID: 'example.com',
    API_AUDIENCE: app.API_AUDIENCE,
    BETTER_AUTH_SECRET: 'test-provider-secret-with-at-least-32-characters',
    OIDC_CLIENTS: JSON.stringify({ play: app.PUBLIC_ORIGIN, donate: 'https://support.another.net' }),
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== env.AUTH_ORIGIN) throw new Error('Unexpected network request');
    return worker.fetch(request, env);
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await mf.dispose();
});

describe('Accounts OIDC across unrelated domains', () => {
  test('uses PKCE, resource-bound tokens and host-only sessions; SSO keeps the same subject', async () => {
    const signIn = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/sign-in/anonymous`, {
        method: 'POST',
        headers: { origin: env.AUTH_ORIGIN, 'content-type': 'application/json' },
        body: '{}',
      }),
      env,
    );
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    const providerCookie = cookies(signIn);
    expect(signIn.headers.get('set-cookie')).not.toMatch(/Domain=/i);
    const signInBody = (await signIn.json()) as { user: { id: string } };
    async function login(config: OIDCEnv) {
      const start = (await handleAuth(
        new Request(`${config.PUBLIC_ORIGIN}/api/auth/sign-in?returnTo=/settings`),
        config,
      ))!;
      expect(start.status).toBe(302);
      expect(start.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax');
      expect(start.headers.get('set-cookie')).not.toMatch(/Domain=/i);
      const authorize = new URL(start.headers.get('location')!);
      expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
      const authorization = await worker.fetch(new Request(authorize, { headers: { cookie: providerCookie } }), env);
      expect(authorization.status, await authorization.clone().text()).toBe(302);
      const callback = authorization.headers.get('location')!;
      expect(callback).toContain(`${config.PUBLIC_ORIGIN}/api/auth/callback`);
      const finish = (await handleAuth(new Request(callback, { headers: { cookie: cookies(start) } }), config))!;
      expect(finish.status, await finish.clone().text()).toBe(302);
      expect(finish.headers.get('location')).toBe('/settings');
      expect((await handleAuth(new Request(callback, { headers: { cookie: cookies(start) } }), config))?.status).toBe(
        400,
      );
      const session = await readSession(
        new Request(config.PUBLIC_ORIGIN, { headers: { cookie: cookies(finish) } }),
        config,
      );
      expect(session?.identity.sub).toBe(signInBody.user.id);
      expect(session?.identity.anonymous).toBe(true);
      const access = await verifyAccess(
        new Request(`${config.API_AUDIENCE}/api/v0/me`, {
          headers: { authorization: `Bearer ${session!.accessToken}` },
        }),
        config,
      );
      expect(access?.sub).toBe(signInBody.user.id);
      const lowerCaseBearer = await verifyAccess(
        new Request(`${config.API_AUDIENCE}/api/v0/me`, {
          headers: { authorization: `bearer ${session!.accessToken}` },
        }),
        config,
      );
      expect(lowerCaseBearer?.sub).toBe(signInBody.user.id);
      expect(
        await verifyAccess(
          new Request(`${config.API_AUDIENCE}/api/v0/me`, {
            headers: { authorization: `Bearer ${session!.accessToken}` },
          }),
          { ...config, API_AUDIENCE: 'https://wrong.example' },
        ),
      ).toBeNull();
      expect(
        await readSession(new Request(config.PUBLIC_ORIGIN, { headers: { cookie: cookies(finish) } }), {
          ...config,
          SESSION_SECRET: 'different-secret-with-at-least-32-characters',
        }),
      ).toBeNull();
      expect(
        await readSession(new Request('https://hostile.example', { headers: { cookie: cookies(finish) } }), config),
      ).toBeNull();
    }
    const mismatched = (await handleAuth(new Request(`${app.PUBLIC_ORIGIN}/api/auth/sign-in`), app))!;
    const wrongNonce = new URL(mismatched.headers.get('location')!);
    wrongNonce.searchParams.set('nonce', 'another-transaction');
    const wrongAuthorization = await worker.fetch(
      new Request(wrongNonce, { headers: { cookie: providerCookie } }),
      env,
    );
    const rejected = await handleAuth(
      new Request(wrongAuthorization.headers.get('location')!, { headers: { cookie: cookies(mismatched) } }),
      app,
    );
    expect(rejected?.status).toBe(400);
    expect(rejected?.headers.get('set-cookie')).not.toContain('__Host-be-music.session=');
    await login(app);
    await login({
      ...app,
      PUBLIC_ORIGIN: 'https://support.another.net',
      OIDC_CLIENT_ID: 'donate',
      SESSION_SECRET: 'donate-session-secret-with-at-least-32-characters',
    });
  });
  test('rejects unregistered redirect URIs and public client registration', async () => {
    const metadata = (await (
      await worker.fetch(new Request(`${env.AUTH_ORIGIN}/api/auth/.well-known/openid-configuration`), env)
    ).json()) as { authorization_endpoint: string };
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: 'play',
      redirect_uri: 'https://attacker.example/callback',
      response_type: 'code',
      scope: 'openid',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
    }).toString();
    const response = await worker.fetch(new Request(url), env);
    expect(response.headers.get('location') ?? '').not.toContain('attacker.example');
    if (response.status === 302) {
      const destination = new URL(response.headers.get('location')!, env.AUTH_ORIGIN);
      expect(destination.origin).toBe(env.AUTH_ORIGIN);
      expect(destination.searchParams.has('code')).toBe(false);
    } else expect(response.status).toBeGreaterThanOrEqual(400);
    const register = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/oauth2/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['https://attacker.example/callback'] }),
      }),
      env,
    );
    expect(register.status).toBeGreaterThanOrEqual(400);
  });
  test('disables clients removed from deployment configuration', async () => {
    const next = { ...env, OIDC_CLIENTS: JSON.stringify({ play: app.PUBLIC_ORIGIN }) };
    expect((await worker.fetch(new Request(`${env.AUTH_ORIGIN}/login`), next)).status).toBe(200);
    const row = await env.DB.prepare('SELECT disabled FROM oauthClient WHERE clientId = ?')
      .bind('donate')
      .first<{ disabled: number }>();
    expect(row?.disabled).toBe(1);
  });
});
