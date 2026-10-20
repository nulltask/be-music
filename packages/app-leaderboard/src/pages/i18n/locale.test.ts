import { describe, expect, test } from 'vite-plus/test';
import { resolveLocale } from './locale.ts';

describe('resolveLocale', () => {
  test('takes ?lang= first, then the cookie, then Accept-Language, then English', () => {
    expect(resolveLocale({ query: 'ja', cookie: 'en', acceptLanguage: 'en' })).toBe('ja');
    expect(resolveLocale({ cookie: 'ja', acceptLanguage: 'en-US' })).toBe('ja');
    expect(resolveLocale({ acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8' })).toBe('ja');
    expect(resolveLocale({})).toBe('en');
  });

  test('ignores values that are not a language the pages come in', () => {
    expect(resolveLocale({ query: 'fr', cookie: 'xx', acceptLanguage: 'fr-FR' })).toBe('en');
  });

  test('follows the Accept-Language preference order and drops q=0', () => {
    expect(resolveLocale({ acceptLanguage: 'fr;q=0.9, ja;q=0.5, en;q=0.4' })).toBe('ja');
    expect(resolveLocale({ acceptLanguage: 'en;q=0.3, ja;q=0.8' })).toBe('ja');
    expect(resolveLocale({ acceptLanguage: 'ja;q=0, en' })).toBe('en');
  });
});
