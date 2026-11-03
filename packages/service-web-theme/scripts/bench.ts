import { renderBuildInfo, renderServiceFooter } from '../src/server.ts';
const info = { builtAt: '2026-10-20T08:00:00Z', revision: 'a'.repeat(40) };
const buildStarted = performance.now();
for (let index = 0; index < 10000; index++) renderBuildInfo(info);
console.log(
  JSON.stringify({ name: 'renderBuildInfo', iterations: 10000, durationMs: performance.now() - buildStarted }),
);
const footerStarted = performance.now();
for (let index = 0; index < 10000; index++)
  renderServiceFooter({ current: 'dashboard', hostname: 'be-music.app', buildInfo: info, siteHTML: 'Be-Music' });
console.log(
  JSON.stringify({ name: 'renderServiceFooter', iterations: 10000, durationMs: performance.now() - footerStarted }),
);
const { defineServiceUI } = await import('../src/client.ts');
const clientStarted = performance.now();
for (let index = 0; index < 10000; index++) defineServiceUI();
console.log(
  JSON.stringify({ name: 'defineServiceUI', iterations: 10000, durationMs: performance.now() - clientStarted }),
);
const { resolveServiceHeader } = await import('../src/header-model.ts');
const { serviceHeaderTemplate } = await import('../src/header-template.ts');
const headerInput = {
  locale: 'en',
  title: 'Be-Music',
  homeHref: '/',
  accountHref: '/account',
  requestURL: '/',
  settings: true,
} as const;
for (const [name, run] of [
  ['resolveServiceHeader', () => resolveServiceHeader(headerInput)],
  ['serviceHeaderTemplate', () => serviceHeaderTemplate(headerInput)],
] as const) {
  const started = performance.now();
  for (let index = 0; index < 10000; index++) run();
  console.log(JSON.stringify({ name, iterations: 10000, durationMs: performance.now() - started }));
}
const { html, renderHTML, renderServiceHeader } = await import('../src/server.ts');
for (const [name, run] of [
  ['renderHTML', () => renderHTML(html`<p>${'Be-Music'}</p>`)],
  ['renderServiceHeader', () => renderServiceHeader(headerInput)],
] as const) {
  const started = performance.now();
  for (let index = 0; index < 10000; index++) run();
  console.log(JSON.stringify({ name, iterations: 10000, durationMs: performance.now() - started }));
}

const { buildInfoTemplate, publicBetaNoticeTemplate, serviceFooterTemplate } =
  await import('../src/footer-template.ts');
const { serviceSkipLinkTemplate } = await import('../src/header-template.ts');
const { renderPublicBetaNotice, serviceSkipLink } = await import('../src/server.ts');
for (const [name, run] of [
  ['buildInfoTemplate', () => buildInfoTemplate(info)],
  ['publicBetaNoticeTemplate', () => publicBetaNoticeTemplate('both')],
  ['serviceFooterTemplate', () => serviceFooterTemplate({ current: 'accounts' })],
  ['serviceSkipLinkTemplate', () => serviceSkipLinkTemplate('en')],
  ['renderPublicBetaNotice', () => renderPublicBetaNotice('both')],
  ['serviceSkipLink', () => serviceSkipLink('en')],
] as const) {
  const started = performance.now();
  for (let index = 0; index < 10000; index++) run();
  console.log(JSON.stringify({ name, iterations: 10000, durationMs: performance.now() - started }));
}

const { authButtonTemplate, authPanelTemplate } = await import('../src/auth-template.ts');
const { resolveAccountIdentity } = await import('../src/account-model.ts');
const { accountIdentityTemplate, avatarTemplate } = await import('../src/account-identity-template.ts');
const { popoverTemplate, languageMenuTemplate, languageLinksTemplate } = await import('../src/popover-template.ts');
const { popoverTemplate: serverPopoverTemplate } = await import('../src/server.ts');
const identity = { handle: 'alice', displayName: 'Alice', anonymous: false, avatarURL: '/avatar' };
const choices = [
  { locale: 'en', href: '/?lang=en', current: true },
  { locale: 'ja', href: '/?lang=ja', current: false },
] as const;
for (const [name, run] of [
  [
    'authButtonTemplate',
    () => authButtonTemplate({ action: 'google', method: 'google', label: 'Sign in with Google' }),
  ],
  ['authPanelTemplate', () => authPanelTemplate({ id: 'signup', mode: 'sign-up', locale: 'en' })],
  ['resolveAccountIdentity', () => resolveAccountIdentity(identity, 'en')],
  ['accountIdentityTemplate', () => accountIdentityTemplate({ account: identity, locale: 'en' })],
  ['avatarTemplate', () => avatarTemplate({ src: '/avatar', size: 24 })],
  ['popoverTemplate', () => popoverTemplate({ id: 'menu', label: 'Menu', trigger: 'Open', content: 'Choices' })],
  ['languageMenuTemplate', () => languageMenuTemplate({ label: 'Language', choices })],
  ['languageLinksTemplate', () => languageLinksTemplate(choices)],
  [
    'popoverTemplate:server',
    () =>
      serverPopoverTemplate({
        id: 'menu',
        label: 'Menu',
        trigger: html`<span>Open</span>`,
        content: html`<p>Choices</p>`,
      }),
  ],
] as const) {
  const started = performance.now();
  for (let index = 0; index < 10000; index++) run();
  console.log(JSON.stringify({ name, iterations: 10000, durationMs: performance.now() - started }));
}
