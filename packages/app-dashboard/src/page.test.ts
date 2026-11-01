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
    expect(html).toContain('<form method="post" action="/api/auth/sign-out?returnTo=%2F">');
    expect(html).toContain('type="submit">Sign out</button>');
  });

  test('tells anonymous and signed-out visitors apart', () => {
    const anonymous = renderDashboard({
      account: { handle: 'x1', displayName: 'x1', anonymous: true },
      hostname: 'preview.be-music.app',
      locale: 'ja',
    });
    expect(anonymous).toContain('data-state="anonymous"');
    expect(anonymous).toContain('lang="ja"');
    expect(anonymous).toContain('type="submit">ログアウト</button>');
    const signedOut = renderDashboard({ account: undefined, hostname: 'be-music.app', locale: 'en' });
    expect(signedOut).toContain('data-state="signed-out"');
    expect(signedOut).not.toContain('/api/auth/sign-out');
  });

  test('keeps the skip target and localized service navigation', () => {
    const html = renderDashboard({
      account: undefined,
      hostname: 'preview.be-music.app',
      locale: 'ja',
      showDonateLink: true,
    });
    expect(html).toContain('href="#main"');
    expect(html).toContain('id="main"');
    expect(html).toContain('aria-label="サービス"');
    expect(html).toContain('href="https://donate.preview.be-music.app/"');
    expect(html.split('</main>')[0]).not.toContain('https://donate.');
    expect(html).toContain(
      '<footer class="text-muted-foreground mx-auto max-w-5xl space-y-2 border-t px-4 pt-4 pb-8 text-xs"><p lang="ja">パブリックベータのためデータは予告なく削除されることがあります。</p><nav class="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="サービス"><span aria-current="page">Dashboard</span><a class="underline underline-offset-4 hover:text-foreground" data-service="accounts" href="https://accounts.preview.be-music.app/">Accounts</a><a class="underline underline-offset-4 hover:text-foreground" data-service="play" href="https://play.preview.be-music.app/">Play</a><a class="underline underline-offset-4 hover:text-foreground" data-service="leaderboard" href="https://leaderboard.preview.be-music.app/">Leaderboard</a></nav><div class="space-y-2">be-music · <a class="underline underline-offset-4 hover:text-foreground" href="https://donate.preview.be-music.app/">寄付</a></div><p>© 2026 nulltask · MIT License</p></footer>',
    );
    expect(html).not.toContain('>Dashboard</a>');
    expect(html).toContain('>Be-Music Dashboard</a><span class="badge" data-variant="outline">Beta</span>');
    expect(html).not.toContain('>beta</span>');
    expect(html.slice(html.lastIndexOf('<footer'))).not.toContain('>Beta</span>');
    expect(html).toContain('class="btn no-underline" data-size="sm" href="/api/auth/sign-in"');
  });

  test('hides Donate unless explicitly enabled', () => {
    for (const showDonateLink of [undefined, false]) {
      const html = renderDashboard({ account: undefined, hostname: 'be-music.app', locale: 'en', showDonateLink });
      expect(html).not.toContain('https://donate.');
      expect(html).toContain('>Be-Music Dashboard</a><span class="badge" data-variant="outline">Beta</span>');
      expect(html).toContain(
        '<footer class="text-muted-foreground mx-auto max-w-5xl space-y-2 border-t px-4 pt-4 pb-8 text-xs"><p lang="en">Public Beta. Data may be deleted without notice.</p><nav class="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Services"><span aria-current="page">Dashboard</span><a class="underline underline-offset-4 hover:text-foreground" data-service="accounts" href="https://accounts.be-music.app/">Accounts</a><a class="underline underline-offset-4 hover:text-foreground" data-service="play" href="https://play.be-music.app/">Play</a><a class="underline underline-offset-4 hover:text-foreground" data-service="leaderboard" href="https://leaderboard.be-music.app/">Leaderboard</a></nav><div class="space-y-2">be-music</div><p>© 2026 nulltask · MIT License</p></footer>',
      );
    }
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

test('includes stable build information in the dashboard footer', () => {
  const page = renderDashboard({
    account: undefined,
    hostname: 'be-music.app',
    locale: 'en',
    buildInfo: { builtAt: '2026-10-20T08:00:00Z', revision: '0123456789abcdef' },
  });
  expect(page.split('</main>')[1]).toContain('2026-10-20 08:00:00 UTC');
  expect(page).toContain('>01234567</code>');
});
