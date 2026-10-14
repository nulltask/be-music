import { describe, expect, test } from 'vite-plus/test';
import { hasSessionCookie } from './auth.ts';

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
