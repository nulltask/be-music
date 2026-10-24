import { describe, expect, test } from 'vite-plus/test';
import { renderServiceHeader } from './header.ts';

describe('renderServiceHeader', () => {
  test('keeps the brand fixed and shows an avatar, a Play icon, and a language menu', () => {
    const html = renderServiceHeader({
      locale: 'ja',
      title: 'Be-Music Dashboard',
      homeHref: '/',
      playHref: 'https://play.be-music.app/',
      accountHref: '/account',
      account: {
        handle: 'alice',
        displayName: 'Alice',
        anonymous: false,
        avatarURL: 'https://accounts.be-music.app/profiles/alice/avatar?v=g',
      },
      requestURL: 'https://be-music.app/',
    });
    expect(html).toContain('>Be-Music Dashboard</a>');
    expect(html).not.toContain('ダッシュボード');
    expect(html).toContain('href="https://play.be-music.app/"');
    expect(html).toContain('class="btn-icon"');
    expect(html).toContain('>プレイ<');
    expect(html).toContain('src="https://accounts.be-music.app/profiles/alice/avatar?v=g"');
    expect(html).toContain('popovertarget="language-menu"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('href="/?lang=en"');
  });

  test('offers sign-in when signed out and marks a guest', () => {
    const signedOut = renderServiceHeader({
      locale: 'en',
      title: 'Be-Music Accounts',
      homeHref: '/account',
      accountHref: '/login',
      requestURL: '/login',
    });
    expect(signedOut).toContain('>Be-Music Accounts</a>');
    expect(signedOut).toContain('href="/login">Sign in</a>');
    expect(signedOut).not.toContain('class="account-chip"');
    const guest = renderServiceHeader({
      locale: 'en',
      title: 'Be-Music Accounts',
      homeHref: '/account',
      playHref: 'https://play.example/',
      accountHref: '/account',
      account: { handle: 'x1', displayName: '<x>', anonymous: true, avatarURL: '/profiles/x1/avatar?v=g' },
      requestURL: '/account',
    });
    expect(guest).toContain('&lt;x&gt;');
    expect(guest).toContain('(guest)');
    expect(guest).toContain('src="/profiles/x1/avatar?v=g"');
    expect(guest).not.toContain('<x>');
  });
});
