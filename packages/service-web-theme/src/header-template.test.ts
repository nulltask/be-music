import { html } from 'lit';
import { render } from '@lit-labs/ssr';
import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import { expect, test } from 'vite-plus/test';
import { serviceHeaderTemplate } from './header-template.ts';

test('escapes client text and attributes while retaining only fixed icon markup as HTML', () => {
  const result = collectResultSync(
    render(
      html`${serviceHeaderTemplate({ locale: 'en', title: '<Be-Music>', homeHref: '/?a=1&b=2', accountHref: '/account', account: { handle: 'alice', displayName: '"Alice" <script>', anonymous: false, avatarURL: '/avatar?a=1&b=2' }, accountNewTab: true, requestURL: '/', settings: true, settingsOpen: true })}`,
    ),
  );
  expect(result).toContain('&lt;Be-Music&gt;');
  expect(result).not.toContain('<script>');
  expect(result).toContain('&quot;Alice&quot; &lt;script&gt;');
  expect(result).toContain('href="/?a=1&amp;b=2"');
  expect(result).toContain('target="_blank"');
  expect(result).toContain('rel="noopener"');
  expect(result).toContain('aria-expanded="true"');
  expect(result).toContain('<svg class="lucide lucide-settings"');
});
