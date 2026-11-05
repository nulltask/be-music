import { expect, test } from 'vite-plus/test';
import { html, renderHTML, renderServiceHeader, unsafeHTML, serviceSkipLink } from './server.ts';

test('renders documents, raw trusted styles and escaped data without hydration markers', () => {
  const output = renderHTML(
    html`<!doctype html>
      <html>
        <head>
          ${unsafeHTML('<style>body { color: red; }</style>')}
        </head>
        <body>
          <!--authored-->
          <p title=${'"quoted"'}>${'<img src=x>'}</p>
        </body>
      </html>`,
  );
  expect(output).toContain('<!doctype html>');
  expect(output).toContain('<style>body { color: red; }</style>');
  expect(output).toContain('title="&quot;quoted&quot;"');
  expect(output).toContain('&lt;img src=x&gt;');
  expect(output).toContain('<!--authored-->');
  expect(output).not.toContain('<!--lit-');
  expect(output).not.toContain('<!--/lit-');
  expect(output).not.toContain('<?>');
  expect(output).not.toContain('<img src=x>');
});

test('does not silently stringify asynchronous page content', () => {
  expect(() => renderHTML(html`<p>${Promise.resolve('late')}</p>`)).toThrow(/promise|async/i);
});

test('renders the same header template used by the browser', () => {
  const output = renderServiceHeader({
    locale: 'ja',
    title: '<Be-Music>',
    homeHref: '/',
    accountHref: '/account',
    requestURL: '/',
    settings: true,
    settingsOpen: true,
  });
  expect(output).toContain('&lt;Be-Music&gt;');
  expect(output).toContain('aria-label="設定"');
  expect(output).toContain('aria-expanded="true"');
  expect(output).not.toContain('<!--lit-');
});

test('requires an explicit trusted boundary for dynamic styles and scripts', () => {
  expect(() =>
    renderHTML(
      html`<style>
        ${'body{}'}
      </style>`,
    ),
  ).toThrow(/style/);
  expect(() =>
    renderHTML(
      html`<script>
        ${'run()'};
      </script>`,
    ),
  ).toThrow(/script/);
});

test('skip links retain their target in each language', () => {
  expect(serviceSkipLink('en')).toMatch(/href="#main"\s*>Skip to content<\/a\s*>/);
  expect(serviceSkipLink('ja')).toMatch(/href="#main"\s*>本文へ移動<\/a\s*>/);
});
