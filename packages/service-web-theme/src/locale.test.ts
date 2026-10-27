import { describe, expect, test } from 'vite-plus/test';
import { localeFromCookie, localeSetCookie, resolveLocale, withLocale } from './locale.ts';

describe('resolveLocale', () => {
  test('prefers the query, then the cookie, then Accept-Language, then English', () => {
    expect(resolveLocale({ query: 'ja', cookie: 'en', acceptLanguage: 'en' })).toBe('ja');
    expect(resolveLocale({ cookie: 'ja', acceptLanguage: 'en-US' })).toBe('ja');
    expect(resolveLocale({ acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8' })).toBe('ja');
    expect(resolveLocale({ acceptLanguage: 'fr;q=0.9, ja;q=0.5, en;q=0.4' })).toBe('ja');
    expect(resolveLocale({})).toBe('en');
    expect(resolveLocale({ query: 'fr', cookie: 'xx', acceptLanguage: 'fr-FR' })).toBe('en');
  });
});

describe('locale cookie and links', () => {
  test('reads only the service language cookie', () => {
    expect(localeFromCookie('a=1; be-music-lang=ja; b=2')).toBe('ja');
    expect(localeFromCookie(null)).toBeUndefined();
  });

  test('keeps the other query parameters when switching language', () => {
    expect(withLocale('https://accounts.be-music.app/login?client_id=play', 'ja')).toBe(
      '/login?client_id=play&lang=ja',
    );
  });

  test('marks the cookie Secure only for https', () => {
    expect(localeSetCookie('ja', true)).toContain('Secure');
    expect(localeSetCookie('en', false)).not.toContain('Secure');
  });
});
