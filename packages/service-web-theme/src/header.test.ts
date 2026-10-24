import { describe, expect, test } from 'vite-plus/test';
import { renderServiceHeader } from './header.ts';

describe('renderServiceHeader', () => {
  test('shows the signed-in person, Play, and the current language', () => {
    const html = renderServiceHeader({
      locale: 'ja',
      product: 'ダッシュボード',
      homeHref: '/',
      playHref: 'https://play.be-music.app/',
      accountHref: '/account',
      account: { handle: 'alice', displayName: 'Alice', anonymous: false },
      requestURL: 'https://be-music.app/',
    });
    expect(html).toContain('lang="ja"');
    expect(html).toContain('<span>ダッシュボード</span>');
    expect(html).toContain('href="https://play.be-music.app/"');
    expect(html).toContain('>プレイ<');
    expect(html).toContain('>Alice</span>');
    expect(html).toContain('@alice');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('href="/?lang=en"');
  });

  test('offers sign-in when signed out and marks a guest', () => {
    const signedOut = renderServiceHeader({
      locale: 'en',
      product: 'Accounts',
      homeHref: '/account',
      accountHref: '/login',
      requestURL: '/login',
    });
    expect(signedOut).toContain('href="/login">Sign in</a>');
    expect(signedOut).not.toContain('class="account-chip"');
    const guest = renderServiceHeader({
      locale: 'en',
      product: 'Accounts',
      homeHref: '/account',
      playHref: 'https://play.example/',
      accountHref: '/account',
      account: { handle: 'x1', displayName: '<x>', anonymous: true },
      requestURL: '/account',
    });
    expect(guest).toContain('&lt;x&gt;');
    expect(guest).toContain('(guest)');
    expect(guest).not.toContain('<x>');
  });
});
