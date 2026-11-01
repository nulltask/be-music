import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vite-plus/test';
import { renderServiceHeader } from './header.ts';

describe('renderServiceHeader', () => {
  test('keeps the brand fixed and trails the Leaderboard: account, Play, then language', () => {
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
    expect(html).toContain('>Be-Music Dashboard</a><span class="badge" data-variant="outline">Beta</span>');
    expect(html).not.toContain('>beta</span>');
    expect(html).not.toContain('ダッシュボード');
    expect(html).toContain('class="ms-auto flex items-center gap-1 whitespace-nowrap sm:gap-2"');
    const account = html.indexOf('aria-label="@alice のアカウント"');
    const play = html.indexOf('href="https://play.be-music.app/"');
    const language = html.indexOf('popovertarget="language-menu"');
    expect(account).toBeGreaterThan(-1);
    expect(account).toBeLessThan(play);
    expect(play).toBeLessThan(language);

    expect(html).toContain(
      'class="bg-muted ring-foreground/10 inline-block shrink-0 rounded-full ring-1" src="https://accounts.be-music.app/profiles/alice/avatar?v=g"',
    );
    expect(html).toContain('class="hidden max-w-[12ch] truncate sm:inline">@alice</span>');
    expect(html).toContain('class="lucide lucide-chevron-down"');
    expect(html).not.toContain('>Alice</span>');

    expect(html).toContain(
      'class="btn" data-size="sm" href="https://play.be-music.app/" title="ブラウザでプレイ" aria-label="プレイ"',
    );
    expect(html).toContain('class="lucide lucide-play"');
    expect(html).toContain('M5 5a2 2 0 0 1 3.008-1.728');
    expect(html).toContain('<span class="hidden md:inline">プレイ</span>');
    expect(html).not.toContain('aria-label="ブラウザでプレイ"');

    expect(html).toContain('class="relative"');
    expect(html).toContain('class="lucide lucide-languages"');
    expect(html).toContain('[&>svg]:size-4 text-muted-foreground');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('href="/?lang=en"');
    expect(html).toContain('position-area:block-end span-inline-start');
    expect(html).not.toContain('span-inline-end');
  });

  test('offers sign-in when signed out and marks a guest', () => {
    const signedOut = renderServiceHeader({
      locale: 'en',
      title: 'Be-Music Accounts',
      homeHref: '/account',
      accountHref: '/login',
      requestURL: '/login',
    });
    expect(signedOut).toContain('>Be-Music Accounts</a><span class="badge" data-variant="outline">Beta</span>');
    expect(signedOut).toContain('class="btn" data-size="sm" data-variant="ghost" href="/login">Sign in</a>');
    expect(signedOut).not.toMatch(/<(?:a|button)[^>]*data-variant="outline"/);
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
    expect(guest).toContain('title="&lt;x&gt; (guest)"');
    expect(guest).toContain('>@x1</span>');
    expect(guest).not.toContain('>&lt;x&gt;</span>');
    expect(guest).toContain('src="/profiles/x1/avatar?v=g"');
    expect(guest).not.toContain('<x>');
    expect(guest.indexOf('aria-label="Account of @x1"')).toBeLessThan(guest.indexOf('href="https://play.example/"'));
    expect(guest.indexOf('href="https://play.example/"')).toBeLessThan(guest.indexOf('popovertarget="language-menu"'));
  });
});

test('header account, Play and language controls do not sink when pressed', () => {
  const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
  const rule = /header nav :is\(a, button\)\.btn:active\s*\{([^}]*)\}/.exec(css);
  expect(rule?.[1]).toMatch(/translate:\s*none;/);
  expect(rule?.[1]).not.toMatch(/outline|box-shadow|scale|transform/);
});
