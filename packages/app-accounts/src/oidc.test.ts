import { afterAll, beforeAll, describe, expect, test, vi } from 'vite-plus/test';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { handleAuth, readSession, verifyAccess, type OIDCEnv } from '@be-music/service-auth-client';
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

  test('automatically signs in browser visits and falls back safely when Accounts is signed out', async () => {
    const navigation = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html' };
    const entry = app.PUBLIC_ORIGIN + '/scores?mode=lr2';
    const start = (await handleAuth(new Request(entry, { headers: navigation }), app))!;
    const target = new URL(start.headers.get('location')!);
    expect(target.searchParams.get('prompt')).toBe('none');
    const anonymousAuthorization = await worker.fetch(new Request(target), env);
    const rejectedURL = new URL(anonymousAuthorization.headers.get('location')!);
    expect(rejectedURL.origin).toBe(app.PUBLIC_ORIGIN);
    expect(rejectedURL.searchParams.get('error')).toBe('login_required');
    const fallback = (await handleAuth(new Request(rejectedURL, { headers: { cookie: cookies(start) } }), app))!;
    expect(fallback.status).toBe(302);
    expect(fallback.headers.get('location')).toBe('/scores?mode=lr2');
    expect(fallback.headers.get('set-cookie')).not.toContain('__Host-be-music.session=');
    expect(
      await handleAuth(new Request(entry, { headers: { ...navigation, cookie: cookies(start) } }), app),
    ).toBeNull();
    rejectedURL.searchParams.set('state', 'wrong-state');
    expect((await handleAuth(new Request(rejectedURL, { headers: { cookie: cookies(start) } }), app))?.status).toBe(
      400,
    );

    const login = await worker.fetch(
      new Request(env.AUTH_ORIGIN + '/api/auth/sign-in/anonymous', {
        method: 'POST',
        headers: { origin: env.AUTH_ORIGIN, 'content-type': 'application/json' },
        body: '{}',
      }),
      env,
    );
    const subject = ((await login.json()) as { user: { id: string } }).user.id;
    for (const client of [
      app,
      {
        ...app,
        PUBLIC_ORIGIN: 'https://support.another.net',
        OIDC_CLIENT_ID: 'donate',
        SESSION_SECRET: 'donate-session-secret-with-at-least-32-characters',
      },
    ]) {
      const begin = (await handleAuth(new Request(client.PUBLIC_ORIGIN + '/', { headers: navigation }), client))!;
      const authorization = await worker.fetch(
        new Request(begin.headers.get('location')!, {
          headers: { cookie: cookies(login) },
        }),
        env,
      );
      const finish = (await handleAuth(
        new Request(authorization.headers.get('location')!, {
          headers: { cookie: cookies(begin) },
        }),
        client,
      ))!;
      expect(finish.status, await finish.clone().text()).toBe(302);
      const request = new Request(client.PUBLIC_ORIGIN + '/', { headers: { ...navigation, cookie: cookies(finish) } });
      expect((await readSession(request, client))?.identity.sub).toBe(subject);
      expect(await handleAuth(request, client)).toBeNull();
      expect(finish.headers.get('set-cookie')).not.toMatch(/Domain=/i);
    }
    const logout = (await handleAuth(
      new Request(app.PUBLIC_ORIGIN + '/api/auth/sign-out', {
        method: 'POST',
        headers: { origin: app.PUBLIC_ORIGIN },
      }),
      app,
    ))!;
    expect(
      await handleAuth(
        new Request(entry, {
          headers: { ...navigation, cookie: cookies(logout) },
        }),
        app,
      ),
    ).toBeNull();
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

describe('Accounts-owned profiles and avatars', () => {
  test('edits profiles and serves public avatars without downstream services', async () => {
    const signedIn = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/sign-in/anonymous`, {
        method: 'POST',
        headers: { origin: env.AUTH_ORIGIN, 'content-type': 'application/json' },
        body: '{}',
      }),
      env,
    );
    const cookie = cookies(signedIn);
    const subject = ((await signedIn.json()) as { user: { id: string } }).user.id;
    const profileEnv = env;
    const call = (path: string, init: RequestInit = {}) =>
      worker.fetch(
        new Request(`${env.AUTH_ORIGIN}${path}`, {
          ...init,
          headers: { cookie, origin: env.AUTH_ORIGIN, ...Object.fromEntries(new Headers(init.headers)) },
        }),
        profileEnv,
      );
    const initial = await call('/api/profile');
    expect(initial.status).toBe(200);
    const updated = await call('/api/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'profile_owner', displayName: 'Profile Owner' }),
    });
    expect(updated.status).toBe(200);

    const publicResponse = await worker.fetch(new Request(`${env.AUTH_ORIGIN}/api/profiles/${subject}`), profileEnv);
    const publicData = await publicResponse.json();
    expect(publicData).toEqual({
      handle: 'profile_owner',
      displayName: 'Profile Owner',
      avatarURL: `${env.AUTH_ORIGIN}/profiles/profile_owner/avatar?v=g`,
    });
    const otherSignIn = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/sign-in/anonymous`, {
        method: 'POST',
        headers: { origin: env.AUTH_ORIGIN, 'content-type': 'application/json' },
        body: '{}',
      }),
      profileEnv,
    );
    const duplicate = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/profile`, {
        method: 'PATCH',
        headers: { cookie: cookies(otherSignIn), origin: env.AUTH_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'profile_owner' }),
      }),
      profileEnv,
    );
    expect(duplicate.status).toBe(409);
    const page = await call('/account');
    expect(await page.text()).toContain('id="profile-form"');
    const forbidden = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/profile`, {
        method: 'PATCH',
        headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' },
        body: '{}',
      }),
      profileEnv,
    );
    expect(forbidden.status).toBe(403);
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
      (c) => c.charCodeAt(0),
    );
    expect((await call('/api/profile/avatar', { method: 'PUT', body: png })).status).toBe(200);
    const image = await worker.fetch(new Request(`${env.AUTH_ORIGIN}/profiles/profile_owner/avatar`), profileEnv);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('access-control-allow-origin')).toBe('*');
    const imageHead = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/profiles/profile_owner/avatar`, { method: 'HEAD' }),
      profileEnv,
    );
    expect(imageHead.status).toBe(200);
    expect(await imageHead.text()).toBe('');
    expect(imageHead.headers.get('content-type')).toBe('image/png');
    const uploadedPage = await call('/account');
    expect(await uploadedPage.text()).toMatch(/src="\/profiles\/profile_owner\/avatar\?v=[a-f0-9]{16}"/);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
    expect((await call('/api/profile/avatar', { method: 'PUT', body: new Uint8Array(128 * 1024 + 1) })).status).toBe(
      413,
    );
    expect((await call('/api/profile/avatar', { method: 'PUT', body: '<svg></svg>' })).status).toBe(415);
    expect((await call('/api/profile/avatar', { method: 'DELETE' })).status).toBe(200);
    const outbox = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profile_sync'",
    ).first();
    expect(outbox).toBeNull();
    const generated = await worker.fetch(new Request(`${env.AUTH_ORIGIN}/profiles/profile_owner/avatar`), profileEnv);
    expect(generated.headers.get('content-type')).toBe('image/svg+xml');
    expect(generated.headers.get('access-control-allow-origin')).toBe('*');
    expect(
      (await call('/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{' }))
        .status,
    ).toBe(400);
    expect(
      (
        await call('/api/profile', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle: 'admin' }),
        })
      ).status,
    ).toBe(400);
    expect((await worker.fetch(new Request(`${env.AUTH_ORIGIN}/api/profile`), profileEnv)).status).toBe(401);
  });
});
