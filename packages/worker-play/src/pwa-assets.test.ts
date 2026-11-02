import { describe, expect, test } from 'vite-plus/test';
import { pwaAssetHeaders, withPWAAssetHeaders } from './pwa-assets.ts';

describe('pwaAssetHeaders', () => {
  test('revalidates the service worker on every update check', () => {
    expect(pwaAssetHeaders('/sw.js')).toEqual({
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
    });
  });

  test('serves the web app manifest with its media type', () => {
    expect(pwaAssetHeaders('/manifest.webmanifest')?.['content-type']).toBe('application/manifest+json');
  });

  test('leaves every other path alone', () => {
    for (const path of ['/', '/index.html', '/embed/sw.js', '/assets/main-abc.js', '/toString', '/constructor']) {
      expect(pwaAssetHeaders(path)).toBeUndefined();
    }
  });
});

describe('withPWAAssetHeaders', () => {
  test('replaces the asset defaults on the service worker', async () => {
    const response = withPWAAssetHeaders(
      '/sw.js',
      new Response('self;', { headers: { 'cache-control': 'public, max-age=14400', etag: '"a"' } }),
    );
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('etag')).toBe('"a"');
    expect(await response.text()).toBe('self;');
  });

  test('passes a miss and other paths through untouched', () => {
    const missing = new Response('Not Found', { status: 404 });
    expect(withPWAAssetHeaders('/sw.js', missing)).toBe(missing);
    const page = new Response('<!doctype html>');
    expect(withPWAAssetHeaders('/', page)).toBe(page);
  });
});
