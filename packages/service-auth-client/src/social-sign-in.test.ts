import { describe, expect, test, vi } from 'vite-plus/test';
import { handleAuth, type OIDCEnv } from './index.ts';
import {
  accountSignInPath,
  applySocialSignInMethod,
  socialSignInMethod,
  socialSignInToStart,
  SOCIAL_SIGN_IN_PARAM,
} from './social-sign-in.ts';

describe('social sign-in', () => {
  test('names only Google and Discord', () => {
    expect(socialSignInMethod('google')).toBe('google');
    expect(socialSignInMethod('discord')).toBe('discord');
    expect(socialSignInMethod('passkey')).toBeUndefined();
    expect(socialSignInMethod('password')).toBeUndefined();
    expect(socialSignInMethod(null)).toBeUndefined();
  });

  test('builds the same sign-in URL a passkey uses, plus the provider', () => {
    expect(accountSignInPath('/play?chart=1')).toBe('/api/auth/sign-in?returnTo=%2Fplay%3Fchart%3D1');
    expect(accountSignInPath('/play?chart=1', 'google')).toBe(
      '/api/auth/sign-in?returnTo=%2Fplay%3Fchart%3D1&method=google',
    );
    expect(accountSignInPath('/settings', 'discord')).toBe('/api/auth/sign-in?returnTo=%2Fsettings&method=discord');
    expect(accountSignInPath('')).toBe('/api/auth/sign-in');
  });

  test('forwards only a known provider onto the authorization URL', () => {
    const target = new URL('https://accounts.example/api/auth/oauth2/authorize');
    applySocialSignInMethod(target, 'google');
    expect(target.searchParams.get(SOCIAL_SIGN_IN_PARAM)).toBe('google');
    const ignored = new URL('https://accounts.example/api/auth/oauth2/authorize');
    applySocialSignInMethod(ignored, 'passkey');
    expect(ignored.searchParams.has(SOCIAL_SIGN_IN_PARAM)).toBe(false);
  });

  test('starts the provider from the login page unless sign-in already failed or can continue', () => {
    const ready = {
      pathname: '/login',
      search: `?client_id=play&${SOCIAL_SIGN_IN_PARAM}=discord`,
      providerConfigured: true,
      alreadyContinuing: false,
    };
    expect(socialSignInToStart(ready)).toBe('discord');
    expect(socialSignInToStart({ ...ready, pathname: '/account' })).toBeUndefined();
    expect(socialSignInToStart({ ...ready, providerConfigured: false })).toBeUndefined();
    expect(socialSignInToStart({ ...ready, alreadyContinuing: true })).toBeUndefined();
    expect(socialSignInToStart({ ...ready, search: `${ready.search}&error=access_denied` })).toBeUndefined();
  });
});

test('sign-in puts Google or Discord on the Accounts authorization request', async () => {
  const issuer = 'https://accounts.social-sign-in.test/api/auth';
  const env: OIDCEnv = {
    AUTH_ISSUER: issuer,
    PUBLIC_ORIGIN: 'https://play.social-sign-in.test',
    API_AUDIENCE: 'https://api.social-sign-in.test',
    OIDC_CLIENT_ID: 'play',
    SESSION_SECRET: 'social-sign-in-secret-with-32-characters',
  };
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/oauth2/authorize`,
          token_endpoint: `${issuer}/oauth2/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  try {
    const google = await handleAuth(
      new Request(`${env.PUBLIC_ORIGIN}/api/auth/sign-in?returnTo=/play&method=google`),
      env,
    );
    expect(google?.status).toBe(302);
    const location = new URL(google?.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(`${issuer}/oauth2/authorize`);
    expect(location.searchParams.get(SOCIAL_SIGN_IN_PARAM)).toBe('google');
    expect(location.searchParams.get('client_id')).toBe('play');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');

    const discord = await handleAuth(
      new Request(`${env.PUBLIC_ORIGIN}/api/auth/sign-in?returnTo=/settings&method=discord`),
      env,
    );
    expect(new URL(discord?.headers.get('location') ?? '').searchParams.get(SOCIAL_SIGN_IN_PARAM)).toBe('discord');

    const passkey = await handleAuth(new Request(`${env.PUBLIC_ORIGIN}/api/auth/sign-in?method=passkey`), env);
    expect(new URL(passkey?.headers.get('location') ?? '').searchParams.has(SOCIAL_SIGN_IN_PARAM)).toBe(false);

    const silent = await handleAuth(
      new Request(`${env.PUBLIC_ORIGIN}/api/auth/sign-in?automatic=1&method=google`),
      env,
    );
    const silentURL = new URL(silent?.headers.get('location') ?? '');
    expect(silentURL.searchParams.get('prompt')).toBe('none');
    expect(silentURL.searchParams.has(SOCIAL_SIGN_IN_PARAM)).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
