import { afterAll, beforeAll, describe, expect, test, vi } from 'vite-plus/test';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { handleAuth, readSession, type OIDCEnv } from '@be-music/service-auth-client';
import { DESKTOP_SCHEME, desktopChallenge, desktopReturnURL, parseDesktopSignInRequest } from './desktop-sign-in.ts';
import { handleAccounts } from './handler.ts';
import { nextPath } from './next-path.ts';
import type { Env } from './auth.ts';

describe('desktop sign-in helpers', () => {
  test('computes the PKCE S256 challenge (RFC 7636, appendix B)', async () => {
    expect(await desktopChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  test('reads a request and rejects malformed values', () => {
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    const state = 'abcdefghijklmnop';
    expect(parseDesktopSignInRequest(new URLSearchParams({ state, challenge }))).toEqual({ state, challenge });
    expect(parseDesktopSignInRequest(new URLSearchParams({ state }))).toBeNull();
    expect(parseDesktopSignInRequest(new URLSearchParams({ state: 'short', challenge }))).toBeNull();
    expect(parseDesktopSignInRequest(new URLSearchParams({ state, challenge: `${challenge}=` }))).toBeNull();
    expect(parseDesktopSignInRequest(new URLSearchParams({ state: `${state}/`, challenge }))).toBeNull();
  });

  test('hands the code back through the app scheme', () => {
    const url = new URL(desktopReturnURL('a+b', 'state-1'));
    expect(url.protocol).toBe(`${DESKTOP_SCHEME}:`);
    expect(url.host).toBe('sign-in');
    expect(url.searchParams.get('code')).toBe('a+b');
    expect(url.searchParams.get('state')).toBe('state-1');
  });

  test('keeps the next page on this host', () => {
    expect(nextPath('/desktop/sign-in?state=a')).toBe('/desktop/sign-in?state=a');
    expect(nextPath('//evil.example/')).toBe('/account');
    expect(nextPath('/\\evil.example/')).toBe('/account');
    expect(nextPath('https://evil.example/')).toBe('/account');
    expect(nextPath(null)).toBe('/account');
  });
});

const worker = { fetch: handleAccounts };
let env: Env;
let mf: Miniflare;
const app: OIDCEnv = {
  AUTH_ISSUER: 'https://accounts.example.com/api/auth',
  PUBLIC_ORIGIN: 'https://player.other.net',
  API_AUDIENCE: 'https://api.third.org',
  OIDC_CLIENT_ID: 'play',
  SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
};
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
    API_AUDIENCE: app.API_AUDIENCE,
    BETTER_AUTH_SECRET: 'test-provider-secret-with-at-least-32-characters',
    OIDC_CLIENTS: JSON.stringify({ play: app.PUBLIC_ORIGIN }),
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

describe('desktop sign-in through the browser', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const state = 'desktop-state-0123456789';
  const page = (cookie?: string, query = new URLSearchParams({ state, challenge })) =>
    worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/desktop/sign-in?${query}`, { headers: cookie ? { cookie } : {} }),
      env,
    );
  const redeem = (body: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/desktop-sign-in/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
      env,
    );
  async function issueCode(browserCookie: string): Promise<string> {
    const response = await page(browserCookie);
    expect(response.status).toBe(200);
    const html = await response.text();
    const href = /href="(be-music-play:[^"]+)"/u.exec(html)?.[1]?.replaceAll('&amp;', '&');
    expect(href).toBeDefined();
    const url = new URL(href!);
    expect(url.searchParams.get('state')).toBe(state);
    return url.searchParams.get('code')!;
  }

  test('sends a signed-out browser to the login page and back', async () => {
    const response = await page();
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!, env.AUTH_ORIGIN);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe(`/desktop/sign-in?state=${state}&challenge=${challenge}`);
    expect((await page(undefined, new URLSearchParams({ state }))).status).toBe(400);
  });

  test('gives the app its own Accounts session, which signs in to the player', async () => {
    const signIn = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/sign-in/anonymous`, {
        method: 'POST',
        headers: { origin: env.AUTH_ORIGIN, 'content-type': 'application/json' },
        body: '{}',
      }),
      env,
    );
    expect(signIn.status).toBe(200);
    const browserCookie = cookies(signIn);
    const userId = ((await signIn.json()) as { user: { id: string } }).user.id;

    // A browser request cannot issue a code; only the page does.
    const direct = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/desktop-sign-in/code`, {
        method: 'POST',
        headers: { origin: env.AUTH_ORIGIN, 'content-type': 'application/json', cookie: browserCookie },
        body: JSON.stringify({ challenge }),
      }),
      env,
    );
    expect(direct.status).toBe(404);

    // A wrong verifier spends the code.
    const spent = await issueCode(browserCookie);
    expect((await redeem({ code: spent, verifier: 'x'.repeat(43) })).status).toBe(400);
    expect((await redeem({ code: spent, verifier })).status).toBe(400);
    expect((await redeem({ code: 'unknown', verifier })).status).toBe(400);

    const code = await issueCode(browserCookie);
    const redeemed = await redeem({ code, verifier });
    expect(redeemed.status, await redeemed.clone().text()).toBe(200);
    const appCookie = cookies(redeemed);
    expect(appCookie).toContain('be-music-accounts.session_token=');
    expect(appCookie).not.toBe(browserCookie);
    expect((await redeem({ code, verifier })).status).toBe(400);

    // The app's session is a session of the same user, apart from the browser's.
    const appSession = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/get-session`, { headers: { cookie: appCookie } }),
      env,
    );
    const appSessionBody = (await appSession.json()) as { user: { id: string }; session: { token: string } };
    expect(appSessionBody.user.id).toBe(userId);
    const browserSession = await worker.fetch(
      new Request(`${env.AUTH_ORIGIN}/api/auth/get-session`, { headers: { cookie: browserCookie } }),
      env,
    );
    expect(((await browserSession.json()) as { session: { token: string } }).session.token).not.toBe(
      appSessionBody.session.token,
    );

    // The player's sign-in goes through with the app's session, as in the window.
    const start = (await handleAuth(new Request(`${app.PUBLIC_ORIGIN}/api/auth/sign-in?returnTo=/`), app))!;
    const authorization = await worker.fetch(
      new Request(start.headers.get('location')!, { headers: { cookie: appCookie } }),
      env,
    );
    expect(authorization.status, await authorization.clone().text()).toBe(302);
    const finish = (await handleAuth(
      new Request(authorization.headers.get('location')!, { headers: { cookie: cookies(start) } }),
      app,
    ))!;
    expect(finish.status).toBe(302);
    const session = await readSession(new Request(app.PUBLIC_ORIGIN, { headers: { cookie: cookies(finish) } }), app);
    expect(session?.identity.sub).toBe(userId);
  });
});
