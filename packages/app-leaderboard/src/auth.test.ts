import { describe, expect, test } from 'vite-plus/test';
import { authSettings, hasSessionCookie, passOnSetCookies } from './auth.ts';
import type { Env } from './env.ts';

const env = (vars: Partial<Env>): Env => ({ BETTER_AUTH_SECRET: 'x', ...vars }) as Env;

describe('authSettings', () => {
  test('without AUTH_ORIGIN, serves the request’s own origin with host-only cookies', () => {
    expect(authSettings(env({}), 'http://localhost:8787')).toEqual({
      baseURL: 'http://localhost:8787',
      trustedOrigins: ['http://localhost:8787'],
      cookieDomain: undefined,
      cookiePrefix: undefined,
      rpID: 'localhost',
    });
  });

  test('with AUTH_ORIGIN, every service shares one Better Auth and its parent-domain cookies', () => {
    const settings = authSettings(
      env({
        AUTH_ORIGIN: 'https://accounts.be-music.app',
        COOKIE_DOMAIN: 'be-music.app',
        PASSKEY_RP_ID: 'be-music.app',
        TRUSTED_ORIGINS: 'https://be-music.app, https://play.be-music.app,,https://accounts.be-music.app',
      }),
      'https://play.be-music.app',
    );
    expect(settings).toEqual({
      baseURL: 'https://accounts.be-music.app',
      trustedOrigins: ['https://accounts.be-music.app', 'https://be-music.app', 'https://play.be-music.app'],
      cookieDomain: 'be-music.app',
      cookiePrefix: undefined,
      rpID: 'be-music.app',
    });
  });

  test('the preview keeps its own cookie prefix and relying party', () => {
    const settings = authSettings(
      env({
        AUTH_ORIGIN: 'https://accounts.preview.be-music.app',
        COOKIE_DOMAIN: 'preview.be-music.app',
        COOKIE_PREFIX: 'be-music-preview',
        PASSKEY_RP_ID: 'preview.be-music.app',
      }),
      'https://leaderboard.preview.be-music.app',
    );
    expect(settings.cookiePrefix).toBe('be-music-preview');
    expect(settings.rpID).toBe('preview.be-music.app');
    expect(settings.trustedOrigins).toEqual(['https://accounts.preview.be-music.app']);
  });
});

describe('hasSessionCookie', () => {
  test('finds Better Auth’s session cookie, with or without the secure prefix', () => {
    expect(hasSessionCookie(new Headers({ cookie: 'better-auth.session_token=abc.def' }))).toBe(true);
    expect(hasSessionCookie(new Headers({ cookie: 'lb-lang=ja; __Secure-better-auth.session_token=abc' }))).toBe(true);
  });

  test('is false without one, so signed-out requests skip the session lookup', () => {
    expect(hasSessionCookie(new Headers())).toBe(false);
    expect(hasSessionCookie(new Headers({ cookie: 'lb-lang=ja; lb-ruleset=____' }))).toBe(false);
  });
});

describe('passOnSetCookies', () => {
  test('adds the refreshed cookies to a private response', () => {
    const response = new Response('ok', { headers: { 'cache-control': 'private, max-age=0' } });
    passOnSetCookies(response, ['better-auth.session_data=abc; Path=/', 'better-auth.session_token=def; Path=/']);
    expect(response.headers.getSetCookie()).toEqual([
      'better-auth.session_data=abc; Path=/',
      'better-auth.session_token=def; Path=/',
    ]);
  });

  test('leaves a publicly cacheable response without them', () => {
    const response = new Response('ok', { headers: { 'cache-control': 'public, max-age=31536000, immutable' } });
    passOnSetCookies(response, ['better-auth.session_data=abc; Path=/']);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
