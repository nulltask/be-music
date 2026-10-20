import { describe, expect, test, vi } from 'vite-plus/test';
import { handleAuth, readSession, returnPath, verifyAccess, type OIDCEnv } from './index.ts';
const env: OIDCEnv = {
  AUTH_ISSUER: 'https://accounts.example/api/auth',
  PUBLIC_ORIGIN: 'https://app.example',
  API_AUDIENCE: 'https://api.example',
  OIDC_CLIENT_ID: 'app',
  SESSION_SECRET: 'test-secret-with-more-than-32-characters',
};
describe('relying-party boundaries', () => {
  test('limits return destinations to local paths', () => {
    for (const value of [null, '//attacker.example', 'https://attacker.example', '/\\attacker.example', '/\nheader'])
      expect(returnPath(value)).toBe('/');
    expect(returnPath('/scores/1?mode=lr2')).toBe('/scores/1?mode=lr2');
    expect(returnPath('/日本語')).toBe('/%E6%97%A5%E6%9C%AC%E8%AA%9E');
  });
  test('invalid or missing cookies and bearer tokens never authenticate', async () => {
    for (const cookie of ['', '__Host-be-music.session=forged'])
      expect(await readSession(new Request(env.PUBLIC_ORIGIN, { headers: { cookie } }), env)).toBeNull();
    expect(await verifyAccess(new Request(env.API_AUDIENCE), env)).toBeNull();
  });
  test('rejects missing transactions, unknown hosts and cross-origin sign-out', async () => {
    expect(
      (await handleAuth(new Request(`${env.PUBLIC_ORIGIN}/api/auth/callback?code=stolen&state=x`), env))?.status,
    ).toBe(400);
    expect((await handleAuth(new Request('https://attacker.example/api/auth/get-session'), env))?.status).toBe(400);
    expect(
      (
        await handleAuth(
          new Request(`${env.PUBLIC_ORIGIN}/api/auth/sign-out`, {
            method: 'POST',
            headers: { origin: 'https://attacker.example' },
          }),
          env,
        )
      )?.status,
    ).toBe(403);
    const response = await handleAuth(
      new Request(`${env.PUBLIC_ORIGIN}/api/auth/sign-out`, { method: 'POST', headers: { origin: env.PUBLIC_ORIGIN } }),
      env,
    );
    expect(response?.headers.getSetCookie()).toHaveLength(3);
    expect(response?.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

test('never starts automatic SSO for APIs, assets, embeds, prefetches or non-GET requests', async () => {
  const navigation = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html' };
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  try {
    for (const [path, init] of [
      ['/api/v0/me', { headers: navigation }],
      ['/style.css', { headers: { ...navigation, 'sec-fetch-dest': 'style' } }],
      ['/', { headers: { ...navigation, 'sec-fetch-dest': 'iframe' } }],
      ['/', { headers: { ...navigation, 'sec-purpose': 'prefetch' } }],
      ['/', { method: 'POST', headers: navigation }],
      ['/', {}],
    ] as [string, RequestInit][]) {
      expect(await handleAuth(new Request(env.PUBLIC_ORIGIN + path, init), env)).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
