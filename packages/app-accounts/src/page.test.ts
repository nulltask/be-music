import { describe, expect, test } from 'vite-plus/test';
import { accountNotice, renderAccountPage } from './page.ts';
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
      '<footer class="text-muted-foreground mx-auto max-w-5xl border-t px-4 py-4 text-xs"><a class="underline underline-offset-4 hover:text-foreground" href="https://donate.example/api/auth/sign-in">Donate</a></footer>',
    );
  });
  test('hides Donate unless explicitly enabled', () => {
    for (const showDonateLink of [undefined, false]) {
      const page = renderAccountPage({ ...input, showDonateLink, apps: { donate: 'https://donate.example' } });
      expect(page).not.toContain('https://donate.example');
      expect(page).not.toContain('>Donate<');
    }
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
