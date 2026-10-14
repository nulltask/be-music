import { describe, expect, test } from 'vite-plus/test';
import { hasSessionCookie, passOnSetCookies } from './auth.ts';

describe('hasSessionCookie', () => {
  test('finds Better Auth’s session cookie, with or without the secure prefix', () => {
    expect(hasSessionCookie(new Headers({ cookie: 'better-auth.session_token=abc.def' }))).toBe(true);
    expect(hasSessionCookie(new Headers({ cookie: 'lb-lang=ja; __Secure-better-auth.session_token=abc' }))).toBe(true);
  });

  test('is false without one, so signed-out requests skip the session lookup', () => {
    expect(hasSessionCookie(new Headers())).toBe(false);
    expect(hasSessionCookie(new Headers({ cookie: 'lb-lang=ja; lb-ruleset=iidx' }))).toBe(false);
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
