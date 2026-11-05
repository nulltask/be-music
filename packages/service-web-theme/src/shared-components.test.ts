import { expect, test } from 'vite-plus/test';
import { html } from 'lit';
import { html as serverHTML, renderHTML, popoverTemplate as serverPopoverTemplate } from './server.ts';
import { authButtonTemplate, authPanelTemplate } from './auth-template.ts';
import { accountIdentityTemplate, avatarTemplate } from './account-identity-template.ts';
import { resolveAccountIdentity } from './account-model.ts';
import { languageLinksTemplate, languageMenuTemplate, popoverTemplate } from './popover-template.ts';

const compact = (value: unknown) => renderHTML(value).replace(/\s+/g, ' ').replace(/\s+>/g, '>');
const account = { handle: 'alice', displayName: 'Alice', anonymous: false, avatarURL: '/avatar' };
const choices = [
  { locale: 'en', current: true, href: '/lang/en?next=%2F%3Fa%3D1' },
  { locale: 'ja', current: false, href: '/lang/ja?next=%2F%3Fa%3D1' },
] as const;

test('auth actions escape caller text and emit one app-independent intent', () => {
  const output = compact(
    authButtonTemplate({ action: 'google"<script>', method: 'google', label: '<img src=x>', variant: 'outline' }),
  );
  expect(output).toContain('data-auth-action="google&quot;&lt;script&gt;"');
  expect(output).toContain('&lt;img src=x&gt;');
  expect(output).not.toContain('<script>');
  expect(output).not.toContain('<img');
  expect(output).toContain('<svg');
  expect(output).toContain('data-variant="outline"');
  const submit = compact(authButtonTemplate({ type: 'submit', label: 'Create', method: 'passkey' }));
  expect(submit).toContain('type="submit"');
  expect(submit).not.toContain('data-auth-action=');
  expect(submit).not.toContain('data-variant=');
});

test('auth panels share localized providers, field constraints, fallback status, and action intents', () => {
  const signIn = compact(authPanelTemplate({ id: 'login', locale: 'en', mode: 'sign-in' }));
  expect(signIn).toContain('id="login-title"');
  expect(signIn).toContain('data-auth-action="sign-in"');
  expect(signIn).toContain('data-auth-action="sign-in-google"');
  expect(signIn).toContain('data-auth-action="sign-in-discord"');
  expect(signIn).toContain('data-auth-action="open-sign-up"');
  expect(signIn).toContain('data-auth-action="close"');
  expect(signIn).toContain('Sign in with a passkey');
  expect(signIn).toContain('<be-music-status');
  expect(signIn).toContain('data-auth-status role="status" hidden');
  expect(signIn).not.toContain('<form');
  const signUp = compact(authPanelTemplate({ id: 'register', locale: 'ja', mode: 'sign-up' }));
  expect(signUp).toContain('アカウントを作成');
  expect(signUp).toContain('Google で登録');
  expect(signUp).toContain('Discord で登録');
  expect(signUp).toContain('data-auth-sign-up-form method="dialog"');
  expect(signUp).toContain('name="handle" required minlength="3" maxlength="15"');
  expect(signUp).toContain('pattern="[A-Za-z0-9_]{3,15}"');
  expect(signUp).toContain('name="displayName" required maxlength="64"');
  expect(signUp).toContain('type="submit"');
  expect(compact(authPanelTemplate({ id: 'keep', locale: 'en', mode: 'keep' }))).toContain('Keep this account');
  expect(compact(authPanelTemplate({ id: 'keep', locale: 'ja', mode: 'keep' }))).toContain('このアカウントを残す');
});

test('identity decisions agree for named, anonymous, and handle-less accounts', () => {
  expect(resolveAccountIdentity(account, 'en')).toEqual({
    label: '@alice',
    ariaLabel: 'Account of @alice',
    title: 'Alice',
    guest: 'guest',
  });
  expect(resolveAccountIdentity({ ...account, anonymous: true }, 'ja')).toMatchObject({
    title: 'Alice (ゲスト)',
    ariaLabel: '@alice のアカウント',
  });
  expect(resolveAccountIdentity({ ...account, handle: '' }, 'en')).toMatchObject({
    label: 'Alice',
    ariaLabel: 'Alice',
  });
});

test('avatars are always round, cropped squares with lazy decorative defaults and an optional accessible name', () => {
  expect(compact(avatarTemplate({ size: 24 }))).toBe('');
  const decorative = compact(avatarTemplate({ src: '/avatar?a=1&b=2', size: 24 }));
  expect(decorative).toContain('src="/avatar?a=1&amp;b=2"');
  expect(decorative).toContain('width="24" height="24"');
  expect(decorative).toContain('alt="" loading="lazy" decoding="async"');
  expect(decorative).toContain(
    'class="bg-muted ring-foreground/10 inline-block aspect-square shrink-0 rounded-full object-cover ring-1"',
  );
  const preview = compact(avatarTemplate({ src: '/avatar', size: 96, className: 'size-24', alt: '"Your avatar"' }));
  expect(preview).toContain('alt="&quot;Your avatar&quot;"');
  expect(preview).toContain('rounded-full object-cover ring-1 size-24"');
  expect(preview).not.toContain('rounded-lg');
});

test('compact and detailed identities retain escaping and anonymous presentation', () => {
  const unsafe = { ...account, displayName: '<img src=x>', handle: '"user"', anonymous: true };
  const detail = compact(accountIdentityTemplate({ account: unsafe, locale: 'ja' }));
  expect(detail).toContain('&lt;img src=x&gt;');
  expect(detail).not.toContain('<img src=x>');
  expect(detail).toContain('ゲスト');
  expect(detail).toContain('@&quot;user&quot;');
  expect(detail).toContain('width="40"');
  expect(compact(accountIdentityTemplate({ account, locale: 'en', showAvatar: false }))).not.toContain('<img');
  const small = compact(accountIdentityTemplate({ account, locale: 'en', variant: 'compact' }));
  expect(small).toContain('width="24"');
  expect(small).toContain('@alice');
  expect(small).not.toContain('data-account-identity');
});

test('popover frame owns native semantics and responsive anchoring without client transport', () => {
  const output = compact(
    popoverTemplate({
      id: 'rules',
      label: 'Rules "menu"',
      title: 'Pick rules',
      trigger: html`<span>LR2</span>`,
      content: html`<a href="/rules/lr2">LR2</a>`,
      width: 'w-72',
    }),
  );
  expect(output).toContain('popovertarget="rules"');
  expect(output).toContain('aria-label="Rules &quot;menu&quot;"');
  expect(output).toContain('id="rules" popover="auto"');
  expect(output).toContain('anchor-name:--rules');
  expect(output).toContain('position-anchor:--rules');
  expect(output).toContain('position-try-fallbacks:flip-inline,--header-menu-span');
  expect(output).toContain('w-72');
  expect(output).toContain('href="/rules/lr2"');
  expect(output).not.toContain('<script');
});

test('language picker preserves caller URL policy and marks only the current locale', () => {
  const output = compact(languageMenuTemplate({ label: 'Language: English', choices }));
  expect(output).toContain('popovertarget="language-menu"');
  expect(output).toContain('aria-label="Language: English"');
  expect(output.match(/aria-current="true"/g)).toHaveLength(1);
  expect(output).toContain('href="/lang/ja?next=%2F%3Fa%3D1"');
  expect(output).toContain('lang="ja" hreflang="ja"');
  expect(output).toContain('日本語');
  const links = compact(languageLinksTemplate([{ ...choices[1], current: true, label: '<script>' }]));
  expect(links).toContain('&lt;script&gt;');
  expect(links).not.toContain('<script>');
  expect(links).not.toContain('<button');
});

test('server popovers accept server-only fragments through their rendering adapter', () => {
  const output = compact(
    serverPopoverTemplate({
      id: 'menu',
      label: 'Menu',
      trigger: serverHTML`<span>${'<button>'}</span>`,
      content: serverHTML`<p>${'<script>'}</p>`,
    }),
  );
  expect(output).toContain('&lt;button&gt;');
  expect(output).toContain('<p>&lt;script&gt;</p>');
  expect(output).not.toContain('<script>');
  expect(output).not.toContain('<!--lit-');
});
