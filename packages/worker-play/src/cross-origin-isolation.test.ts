import { describe, expect, test } from 'vite-plus/test';
import { CROSS_ORIGIN_ISOLATION_HEADERS, withCrossOriginIsolation } from './cross-origin-isolation.ts';

describe('withCrossOriginIsolation', () => {
  test('isolates the page without blocking cross-origin resources that send no CORP', () => {
    expect(CROSS_ORIGIN_ISOLATION_HEADERS).toEqual({
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'credentialless',
    });
  });

  test('adds the headers and keeps the status, the other headers and the body', async () => {
    const response = withCrossOriginIsolation(
      new Response('<!doctype html>', { status: 404, headers: { 'content-type': 'text/html', etag: '"a"' } }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('etag')).toBe('"a"');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('credentialless');
    expect(await response.text()).toBe('<!doctype html>');
  });

  test('replaces a weaker policy from upstream', () => {
    const response = withCrossOriginIsolation(
      new Response(null, { headers: { 'cross-origin-opener-policy': 'unsafe-none' } }),
    );
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });

  test('works on a response whose headers are immutable', () => {
    const redirect = Response.redirect('https://play.be-music.app/', 302);
    const response = withCrossOriginIsolation(redirect);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://play.be-music.app/');
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('credentialless');
  });
});
