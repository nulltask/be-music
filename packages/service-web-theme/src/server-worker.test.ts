import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { expect, test } from 'vite-plus/test';

test('the generated renderer serves escaped HTML in a bundled workerd application', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: import.meta.dirname,
      contents: [
        'import { html, renderHTML, renderServiceHeader } from "@be-music/service-web-theme/server";',
        'export default { fetch(request) {',
        '  const name = new URL(request.url).searchParams.get("name");',
        '  const page = renderHTML(html`<!doctype html><html><body><h1>${name}</h1></body></html>`);',
        '  const header = renderServiceHeader({locale:"en",title:"Be-Music",homeHref:"/",accountHref:"/account",requestURL:"/",settings:true});',
        '  return new Response(page + header, {headers:{"content-type":"text/html; charset=utf-8"}});',
        '} };',
      ].join('\n'),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    conditions: ['workerd', 'worker'],
    external: ['node:buffer'],
  });
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0]!.text,
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
    }),
  );
  try {
    const response = await worker.dispatchFetch('http://localhost/?name=%3Cscript%3E');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('<h1>&lt;script&gt;</h1>');
    expect(body).toContain('data-service-header="settings"');
    expect(body).not.toContain('<!--lit-');
  } finally {
    await worker.dispose();
  }
});

test('browser bundles cannot accidentally import the server-only entry', async () => {
  await expect(
    build({
      stdin: {
        resolveDir: import.meta.dirname,
        contents: 'import { html } from "@be-music/service-web-theme/server"; console.log(html`<p>test</p>`);',
      },
      platform: 'browser',
      bundle: true,
      write: false,
      logLevel: 'silent',
    }),
  ).rejects.toThrow(/resolve|export|disabled/i);
});
