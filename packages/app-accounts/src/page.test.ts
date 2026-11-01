import { describe, expect, test } from 'vite-plus/test';
import { accountNotice, renderAccountPage } from './page.ts';

function buttonHTML(page: string, action: string): string {
  const button = page.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>[\\s\\S]*?</button>`));
  expect(button, action).not.toBeNull();
  return button![0];
}
describe('Accounts page', () => {
  const input = { signedIn: false, anonymous: false, name: '', login: true, discord: false, google: false };
  test('only offers configured providers and a guest account when signed out', () => {
    const page = renderAccountPage(input);
    expect(page).toContain('data-action="passkey"');
    expect(page).toContain('data-action="guest"');
    expect(page).not.toContain('data-action="discord"');
    expect(renderAccountPage({ ...input, google: true })).toContain('data-action="google"');
  });
  test('escapes names and offers account management and return links when signed in', () => {
    const page = renderAccountPage({
      ...input,
      signedIn: true,
      login: false,
      name: '<script>bad</script>',
      apps: { play: 'https://play.example' },
    });
    expect(page).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(page).toContain('data-action="add-passkey"');
    expect(page).toContain('href="https://play.example/api/auth/sign-in"');
    expect(page).not.toContain('data-action="guest"');
  });
  test('keeps preview Donate only in the footer', () => {
    const page = renderAccountPage({
      ...input,
      showDonateLink: true,
      apps: { play: 'https://play.example', donate: 'https://donate.example' },
    });
    expect(page.split('</main>')[0]).not.toContain('https://donate.example');
    expect(page).toContain(
      '<footer class="text-muted-foreground mx-auto max-w-5xl space-y-2 border-t px-4 pt-4 pb-8 text-xs"><p lang="en">Public Beta. Data may be deleted without notice.</p><nav class="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Services"><a class="underline underline-offset-4 hover:text-foreground" data-service="dashboard" href="https://be-music.app/">Dashboard</a><span aria-current="page">Accounts</span><a class="underline underline-offset-4 hover:text-foreground" data-service="play" href="https://play.be-music.app/">Play</a><a class="underline underline-offset-4 hover:text-foreground" data-service="leaderboard" href="https://leaderboard.be-music.app/">Leaderboard</a></nav><div class="space-y-2"><a class="underline underline-offset-4 hover:text-foreground" href="https://donate.example/api/auth/sign-in">Donate</a></div><p>© 2026 nulltask · MIT License</p></footer>',
    );
    expect(page).not.toContain('>Accounts</a>');
    expect(page).not.toContain('>beta</span>');
    const japanese = renderAccountPage({ ...input, locale: 'ja' });
    expect(japanese).toContain('<p lang="ja">パブリックベータ。データは予告なく削除されることがあります。</p>');
    expect(japanese).toContain('lang="ja"');
    expect(japanese).not.toContain('Public Beta');
  });
  test('hides Donate unless explicitly enabled', () => {
    for (const showDonateLink of [undefined, false]) {
      const page = renderAccountPage({ ...input, showDonateLink, apps: { donate: 'https://donate.example' } });
      expect(page).not.toContain('https://donate.example');
      expect(page).not.toContain('>Donate<');
    }
  });
  test('shows a mark on Google, Discord, and passkey actions', () => {
    const page = renderAccountPage({ ...input, google: true, discord: true });
    expect(buttonHTML(page, 'passkey')).toContain('M2.586 17.414');
    expect(buttonHTML(page, 'google')).toContain('#4285F4');
    expect(buttonHTML(page, 'discord')).toContain('#5865F2');
    expect(buttonHTML(page, 'guest')).not.toContain('<svg');
    const linked = renderAccountPage({
      ...input,
      signedIn: true,
      login: false,
      discord: true,
      google: true,
    });
    expect(buttonHTML(linked, 'add-passkey')).toContain('M2.586 17.414');
    expect(buttonHTML(linked, 'link-google')).toContain('#4285F4');
    expect(buttonHTML(linked, 'link-discord')).toContain('#5865F2');
    expect(buttonHTML(linked, 'sign-out')).not.toContain('<svg');
  });
  test('lets a signed-in account link each configured provider once', () => {
    const linked = renderAccountPage({
      ...input,
      signedIn: true,
      login: false,
      discord: true,
      google: true,
      linkedDiscord: true,
    });
    expect(linked).toContain('data-action="link-google"');
    expect(linked).toContain('data-action="add-passkey"');
    expect(linked).toContain('Discord is linked.');
    expect(linked).not.toContain('data-action="discord"');
    expect(linked).not.toContain('data-action="link-discord"');
    expect(linked).not.toContain('data-action="google"');
  });
  test('keeps continuation and account actions available in the shared shell', () => {
    const page = renderAccountPage({ ...input, signedIn: true, anonymous: true, name: 'Guest' });
    expect(page).toContain('href="#main"');
    expect(page).toContain('id="main"');
    expect(page).toContain('data-action="continue"');
    expect(page).toContain('data-action="sign-out"');
    expect(page).toContain('aria-live="polite"');
    expect(page).not.toContain('data-action="guest"');
  });
});

test('explains a failed provider link without echoing the query', () => {
  expect(accountNotice(null)).toBe('');
  expect(accountNotice('account_already_linked_to_different_user')).toContain('another be-music account');
  expect(accountNotice('<script>')).toBe('Could not link that account.');
  expect(accountNotice('access_denied', 'ja')).toBe('連携を取り消しました。');
  expect(accountNotice('account_already_linked_to_different_user', 'ja')).toContain('別の be-music アカウント');
});

test('renders the sign-in page in Japanese when the locale is ja', () => {
  const input = { signedIn: false, anonymous: false, name: '', login: true, discord: false, google: false };
  const page = renderAccountPage({ ...input, locale: 'ja' });
  expect(page).toContain('lang="ja"');
  expect(page).toContain('パスキーでログイン');
  expect(page).toContain('ゲストアカウントで始める');
  expect(page).toContain('>ログイン</h1>');
  expect(page).not.toContain('Sign in with a passkey');
  expect(page).not.toContain('Start a guest account');
  const signedIn = renderAccountPage({
    ...input,
    locale: 'ja',
    signedIn: true,
    login: false,
    name: '太郎',
    discord: true,
    linkedDiscord: true,
    profile: { handle: 'taro', displayName: '太郎', avatarURL: '/a.png' },
  });
  expect(signedIn).toContain('ユーザー名');
  expect(signedIn).toContain('表示名');
  expect(signedIn).toContain('プロフィールを保存');
  expect(signedIn).toContain('アバター');
  expect(signedIn).toContain('Discord は連携済みです。');
  expect(signedIn).not.toContain('Discord is linked.');
});

test('includes stable build information in the account footer', () => {
  const page = renderAccountPage({
    signedIn: false,
    anonymous: false,
    name: '',
    login: true,
    discord: false,
    google: false,
    buildInfo: { builtAt: '2026-10-20T08:00:00Z', revision: '0123456789abcdef' },
  });
  expect(page.split('</main>')[1]).toContain('2026-10-20 08:00:00 UTC');
  expect(page).toContain('>01234567</code>');
});
