import { describe, expect, test } from 'vite-plus/test';
import { escapeHTML, pickLocale, renderDashboard, serviceLinks } from './page.ts';

describe('serviceLinks', () => {
  test('links the services of the same environment', () => {
    expect(serviceLinks('be-music.app')).toEqual({
      play: 'https://play.be-music.app/',
      leaderboard: 'https://leaderboard.be-music.app/',
    });
    expect(serviceLinks('preview.be-music.app').play).toBe('https://play.preview.be-music.app/');
  });
});

describe('pickLocale', () => {
  test('takes Japanese only when it comes first', () => {
    expect(pickLocale('ja,en-US;q=0.8')).toBe('ja');
    expect(pickLocale('ja-JP')).toBe('ja');
    expect(pickLocale('en-US,ja;q=0.5')).toBe('en');
    expect(pickLocale(null)).toBe('en');
  });
});

describe('renderDashboard', () => {
  test('shows who is signed in and links to the services', () => {
    const html = renderDashboard({
      account: { handle: 'alice', displayName: 'Alice', anonymous: false },
      hostname: 'be-music.app',
      locale: 'en',
    });
    expect(html).toContain('data-state="signed-in"');
    expect(html).toContain('Signed in as Alice (@alice).');
    expect(html).toContain('href="https://play.be-music.app/"');
    expect(html).toContain('href="https://leaderboard.be-music.app/"');
  });

  test('tells anonymous and signed-out visitors apart', () => {
    const anonymous = renderDashboard({
      account: { handle: 'x1', displayName: 'x1', anonymous: true },
      hostname: 'preview.be-music.app',
      locale: 'ja',
    });
    expect(anonymous).toContain('data-state="anonymous"');
    expect(anonymous).toContain('lang="ja"');
    const signedOut = renderDashboard({ account: undefined, hostname: 'be-music.app', locale: 'en' });
    expect(signedOut).toContain('data-state="signed-out"');
  });

  test('keeps the skip target and localized service navigation', () => {
    const html = renderDashboard({ account: undefined, hostname: 'preview.be-music.app', locale: 'ja' });
    expect(html).toContain('href="#main"');
    expect(html).toContain('id="main"');
    expect(html).toContain('aria-label="サービス"');
    expect(html).toContain('href="https://donate.preview.be-music.app/"');
    expect(html).toContain('class="button" href="/api/auth/sign-in"');
  });

  test('escapes the display name', () => {
    const html = renderDashboard({
      account: { handle: 'a', displayName: '<script>x</script>', anonymous: false },
      hostname: 'be-music.app',
      locale: 'en',
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('escapeHTML', () => {
  test('escapes markup and quotes', () => {
    expect(escapeHTML(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
