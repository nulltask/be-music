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
