import { describe, expect, test } from 'vite-plus/test';
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
    expect(response?.headers.getSetCookie()).toHaveLength(2);
    expect(response?.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
