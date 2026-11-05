import { describe, expect, test } from 'vite-plus/test';
import { accountNotice, renderAccountPage as renderPage, renderWelcomePage } from './page.ts';

// Ignore template source indentation while preserving the existing markup/content assertions.
function renderAccountPage(input: Parameters<typeof renderPage>[0]): string {
  return renderPage(input)
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s+>/g, '>')
    .replace(/>\s+([^<]*?)\s+</g, '>$1<');
}

function buttonHTML(page: string, action: string): string {
  const button = page.match(new RegExp(`<button[^>]*data-auth-action="${action}"[^>]*>[\\s\\S]*?</button>`));
  expect(button, action).not.toBeNull();
  return button![0];
}
describe('Accounts page', () => {
  const input = { signedIn: false, anonymous: false, name: '', login: true, discord: false, google: false };
  test('only offers configured providers and a guest account when signed out', () => {
    const page = renderAccountPage(input);
    expect(page).toContain('data-auth-action="passkey"');
    expect(page).toContain('data-auth-action="guest"');
    expect(page).not.toContain('data-auth-action="discord"');
    expect(renderAccountPage({ ...input, google: true })).toContain('data-auth-action="google"');
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
    expect(page).toContain('data-auth-action="add-passkey"');
    expect(page).toContain('href="https://play.example/api/auth/sign-in"');
    expect(page).not.toContain('data-auth-action="guest"');
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
    expect(page).toContain('>Be-Music Accounts</a><span class="badge" data-variant="outline">Beta</span>');
    expect(page).not.toContain('>beta</span>');
    expect(page.slice(page.lastIndexOf('<footer'))).not.toContain('>Beta</span>');
    const japanese = renderAccountPage({ ...input, locale: 'ja' });
    expect(japanese).toContain('>Be-Music Accounts</a><span class="badge" data-variant="outline">Beta</span>');
    expect(japanese).toContain('<p lang="ja">パブリックベータのためデータは予告なく削除されることがあります。</p>');
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
    expect(linked).toContain('data-auth-action="link-google"');
    expect(linked).toContain('data-auth-action="add-passkey"');
    expect(linked).toContain('Discord is linked.');
    expect(linked).not.toContain('data-auth-action="discord"');
    expect(linked).not.toContain('data-auth-action="link-discord"');
    expect(linked).not.toContain('data-auth-action="google"');
  });
  test('keeps continuation and account actions available in the shared shell', () => {
    const page = renderAccountPage({ ...input, signedIn: true, anonymous: true, name: 'Guest' });
    expect(page).toContain('href="#main"');
    expect(page).toContain('id="main"');
    expect(page).toContain('data-auth-action="continue"');
    expect(page).toContain('data-auth-action="sign-out"');
    expect(page).toContain('aria-live="polite"');
    expect(page).not.toContain('data-auth-action="guest"');
  });
});

test('explains a failed provider link without echoing the query', () => {
  expect(accountNotice(null)).toBe('');
  expect(accountNotice('account_already_linked_to_different_user')).toContain('another Be-Music account');
  expect(accountNotice('<script>')).toBe('Could not link that account.');
  expect(accountNotice('access_denied', 'ja')).toBe('連携を取り消しました。');
  expect(accountNotice('account_already_linked_to_different_user', 'ja')).toContain('別の Be-Music アカウント');
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

describe('Sign-in page', () => {
  test('offers starting a new account with a passkey when signed out, and not when signed in', () => {
    const input = { signedIn: false, anonymous: false, name: '', login: true, discord: false, google: false };
    expect(renderAccountPage(input)).toContain('data-auth-action="passkey-start"');
    expect(renderAccountPage({ ...input, signedIn: true })).not.toContain('data-auth-action="passkey-start"');
  });
});

describe('Welcome page', () => {
  const welcome = (input: Partial<Parameters<typeof renderWelcomePage>[0]> = {}) =>
    renderWelcomePage({
      anonymous: false,
      name: 'Player',
      discord: true,
      google: true,
      next: '/account',
      continuing: false,
      step: 'profile',
      profile: { handle: 'player_abcd1234', displayName: 'Player', avatarURL: '/profiles/player_abcd1234/avatar' },
      apps: { dashboard: '/', play: 'https://play.example' },
      ...input,
    }).replace(/\s+/g, ' ');

  test('shows the profile step first and leaves the placeholder name out of the field', () => {
    const page = welcome();
    expect(page).toMatch(/data-welcome-step="profile"(?! hidden)/u);
    expect(page).toMatch(/name="displayName" value=""/u);
    expect(page).toContain('value="player_abcd1234"');
    expect(page).toContain('data-welcome-next="/account"');
  });

  test('keeps a name the player chose in the field', () => {
    expect(welcome({ profile: { handle: 'taro', displayName: 'Taro', avatarURL: '/a' } })).toMatch(
      /name="displayName" value="Taro"/u,
    );
  });

  test('gives a guest the step that keeps the account, with the providers not yet linked', () => {
    const page = welcome({ anonymous: true, linkedDiscord: true });
    expect(page).toContain('data-welcome-step="keep"');
    expect(page).toContain('data-auth-action="add-passkey"');
    expect(page).toContain('data-auth-action="link-google"');
    expect(page).not.toContain('data-auth-action="link-discord"');
    expect(page).toContain('Step 1 of 3');
    expect(page).toContain('data-next="keep"');
  });

  test('takes anyone else from the profile straight to the end', () => {
    const page = welcome();
    expect(page).not.toContain('data-welcome-step="keep"');
    expect(page).toContain('Step 1 of 2');
    expect(page).toContain('data-next="finish"');
  });

  test('opens on the last step after a provider is linked, and offers the services unless an app is waiting', () => {
    const page = welcome({ step: 'finish' });
    expect(page).toMatch(/data-welcome-step="profile" hidden/u);
    expect(page).toMatch(/data-welcome-step="finish"(?! hidden)/u);
    const playLink = 'data-variant="outline" href="https://play.example/api/auth/sign-in"';
    expect(page).toContain(playLink);
    expect(welcome({ step: 'finish', continuing: true })).not.toContain(playLink);
  });

  test('speaks Japanese', () => {
    expect(welcome({ locale: 'ja', anonymous: true })).toContain('Be-Music へようこそ');
  });
});
