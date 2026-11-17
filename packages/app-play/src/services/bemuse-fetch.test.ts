import { md5HexOfBytes } from '@be-music/player-browser/collection';
import { describe, expect, test } from 'vite-plus/test';
import { bemuseProxyURL, createBemuseFetcher, type BemuseChartCache } from './bemuse-fetch.ts';

const PAGE = 'https://play.example/';

describe('bemuseProxyURL', () => {
  test('routes another https origin through the page’s proxy', () => {
    expect(bemuseProxyURL('https://music.example/a b.json', PAGE)).toBe(
      'https://play.example/__url-load-proxy?url=https%3A%2F%2Fmusic.example%2Fa%2520b.json',
    );
  });

  test('leaves same-origin, plain-http and page-less reads alone', () => {
    expect(bemuseProxyURL('https://play.example/x.json', PAGE)).toBeUndefined();
    expect(bemuseProxyURL('http://music.example/x.json', PAGE)).toBeUndefined();
    expect(bemuseProxyURL('https://music.example/x.json', undefined)).toBeUndefined();
  });
});

describe('createBemuseFetcher', () => {
  test('retries a blocked read through the proxy and sends that origin there from then on', async () => {
    const requested: string[] = [];
    const fetcher = createBemuseFetcher({
      pageHref: PAGE,
      fetch: async (url) => {
        requested.push(url);
        if (url.startsWith('https://music.example/')) throw new TypeError('Failed to fetch');
        return new Response('ok');
      },
    });
    expect(new TextDecoder().decode(await fetcher.bytes('https://music.example/a'))).toBe('ok');
    await fetcher.bytes('https://music.example/b');
    expect(requested).toEqual([
      'https://music.example/a',
      'https://play.example/__url-load-proxy?url=https%3A%2F%2Fmusic.example%2Fa',
      'https://play.example/__url-load-proxy?url=https%3A%2F%2Fmusic.example%2Fb',
    ]);
  });

  test('reports an HTTP failure and answers exists() by status', async () => {
    const fetcher = createBemuseFetcher({
      pageHref: PAGE,
      fetch: async (url) => new Response('', { status: url.endsWith('/here') ? 200 : 404 }),
    });
    await expect(fetcher.json('https://music.example/gone')).rejects.toThrow(/HTTP 404/);
    expect(await fetcher.exists('https://music.example/here')).toBe(true);
    expect(await fetcher.exists('https://music.example/gone')).toBe(false);
  });

  test('serves a chart from the cache only while its MD5 matches the index', async () => {
    const stored = new Map<string, Uint8Array>();
    const cache: BemuseChartCache = {
      get: async (url, md5) => {
        const bytes = stored.get(url);
        return bytes && md5HexOfBytes(bytes) === md5 ? bytes : undefined;
      },
      put: async (url, bytes) => {
        stored.set(url, bytes);
      },
    };
    let fetches = 0;
    const body = new TextEncoder().encode('#TITLE x');
    const md5 = md5HexOfBytes(body);
    const fetcher = createBemuseFetcher({
      pageHref: PAGE,
      chartCache: cache,
      fetch: async () => {
        fetches += 1;
        return new Response(new Uint8Array(body));
      },
    });
    await fetcher.chart('https://music.example/x.bms', md5);
    await fetcher.chart('https://music.example/x.bms', md5);
    expect(fetches).toBe(1);
    // A changed chart (another MD5 in the index) is fetched again, and one without an MD5 is never cached.
    await fetcher.chart('https://music.example/x.bms', '0'.repeat(32));
    await fetcher.chart('https://music.example/y.bms', undefined);
    expect(fetches).toBe(3);
    expect([...stored.keys()]).toEqual(['https://music.example/x.bms']);
  });
});
