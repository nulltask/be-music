import { describe, expect, test } from 'vite-plus/test';
import { resolveURLLoadProxyTarget, serveURLLoadProxy } from './url-load-proxy.ts';

const ARCHIVE = 'https://example.com/song.zip';
const proxyURL = (url: string) => `https://play.be-music.app/__url-load-proxy?url=${encodeURIComponent(url)}`;

/** A fake upstream recording what it was asked: 304 when the request's If-None-Match is its ETag. */
function upstream(etag: string) {
  const requests: { url: string; headers: Headers }[] = [];
  const fetcher = async (input: URL, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers);
    requests.push({ url: input.href, headers });
    const validators = { etag, 'last-modified': 'Sat, 31 Oct 2026 00:00:00 GMT' };
    if (headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: validators });
    return new Response('zip', { headers: { ...validators, 'content-type': 'application/zip' } });
  };
  return { requests, fetcher };
}

describe('serveURLLoadProxy', () => {
  test('passes the archive through with its validators, cached but revalidated each time', async () => {
    const { requests, fetcher } = upstream('"v1"');
    const response = await serveURLLoadProxy(new Request(proxyURL(ARCHIVE)), fetcher);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('zip');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('etag')).toBe('"v1"');
    expect(response.headers.get('last-modified')).toBe('Sat, 31 Oct 2026 00:00:00 GMT');
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(requests[0]!.url).toBe(ARCHIVE);
  });

  test("answers an unchanged archive's revalidation with a bodiless 304", async () => {
    const { requests, fetcher } = upstream('"v1"');
    const request = new Request(proxyURL(ARCHIVE), {
      headers: { 'if-none-match': '"v1"', 'if-modified-since': 'Sat, 31 Oct 2026 00:00:00 GMT' },
    });
    const response = await serveURLLoadProxy(request, fetcher);
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    expect(response.headers.get('etag')).toBe('"v1"');
    expect(requests[0]!.headers.get('if-none-match')).toBe('"v1"');
    expect(requests[0]!.headers.get('if-modified-since')).toBe('Sat, 31 Oct 2026 00:00:00 GMT');
  });

  test('downloads a changed archive again', async () => {
    const { fetcher } = upstream('"v2"');
    const request = new Request(proxyURL(ARCHIVE), { headers: { 'if-none-match': '"v1"' } });
    const response = await serveURLLoadProxy(request, fetcher);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"v2"');
  });

  test('forwards no other browser header, such as cookies', async () => {
    const { requests, fetcher } = upstream('"v1"');
    await serveURLLoadProxy(new Request(proxyURL(ARCHIVE), { headers: { cookie: 'session=1' } }), fetcher);
    expect([...requests[0]!.headers.keys()]).toEqual([]);
  });

  test('refuses other methods and targets it must not fetch', async () => {
    const { fetcher } = upstream('"v1"');
    expect((await serveURLLoadProxy(new Request(proxyURL(ARCHIVE), { method: 'POST' }), fetcher)).status).toBe(405);
    expect((await serveURLLoadProxy(new Request(proxyURL('http://example.com/a.zip')), fetcher)).status).toBe(400);
  });
});

describe('resolveURLLoadProxyTarget', () => {
  test('accepts https URLs only, without credentials', () => {
    expect(resolveURLLoadProxyTarget(ARCHIVE).href).toBe(ARCHIVE);
    expect(() => resolveURLLoadProxyTarget(null)).toThrow('missing url');
    expect(() => resolveURLLoadProxyTarget('http://example.com/a.zip')).toThrow('only https');
    expect(() => resolveURLLoadProxyTarget('https://user:pass@example.com/a.zip')).toThrow('credentials');
  });
});
