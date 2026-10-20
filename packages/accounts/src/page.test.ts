import { describe, expect, test } from 'vite-plus/test';
import { renderAccountPage } from './page.ts';
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
