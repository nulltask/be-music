import { md5HexOfBytes } from '@be-music/player-browser/collection';
import { describe, expect, test } from 'vite-plus/test';
import {
  BEMUSE_PROXIED_ORIGINS_STORAGE_KEY,
  bemuseProxyURL,
  createBemuseFetcher,
  createStoredBemuseProxiedOrigins,
  type BemuseChartCache,
} from './bemuse-fetch.ts';

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
      proxiedOrigins: createStoredBemuseProxiedOrigins(undefined),
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

  test('sends a known CORS-less default server straight to the proxy', async () => {
    const requested: string[] = [];
    const fetcher = createBemuseFetcher({
      pageHref: PAGE,
      proxiedOrigins: createStoredBemuseProxiedOrigins(undefined),
      fetch: async (url) => {
        requested.push(url);
        return new Response('{}');
      },
    });
    await fetcher.json('https://bmson.nekokan.dyndns.info/mettatunes/index.json');
    expect(requested).toEqual([
      'https://play.example/__url-load-proxy?url=https%3A%2F%2Fbmson.nekokan.dyndns.info%2Fmettatunes%2Findex.json',
    ]);
  });

  test('remembers an origin only once the proxy has reached it', async () => {
    const proxiedOrigins = createStoredBemuseProxiedOrigins(undefined);
    let proxyStatus = 502;
    const fetcher = createBemuseFetcher({
      pageHref: PAGE,
      proxiedOrigins,
      fetch: async (url) => {
        if (!url.startsWith(PAGE)) throw new TypeError('Failed to fetch');
        return new Response('', { status: proxyStatus });
      },
    });
    await expect(fetcher.bytes('https://down.example/a')).rejects.toThrow(/HTTP 502/);
    expect(proxiedOrigins.has('https://down.example')).toBe(false);
    proxyStatus = 200;
    await fetcher.bytes('https://down.example/a');
    expect(proxiedOrigins.has('https://down.example')).toBe(true);
  });
});

describe('createStoredBemuseProxiedOrigins', () => {
  test('keeps learned origins across visits, besides the known ones, and drops what is not an https origin', () => {
    const values = new Map<string, string>([
      [BEMUSE_PROXIED_ORIGINS_STORAGE_KEY, JSON.stringify(['https://a.example', 'http://b.example', 'nope', 1])],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const first = createStoredBemuseProxiedOrigins(storage);
    expect(first.has('https://a.example')).toBe(true);
    expect(first.has('http://b.example')).toBe(false);
    expect(first.has('https://bmson.nekokan.dyndns.info')).toBe(true);
    first.add('https://c.example');
    first.add('https://bmson.nekokan.dyndns.info');
    expect(JSON.parse(values.get(BEMUSE_PROXIED_ORIGINS_STORAGE_KEY)!)).toEqual([
      'https://a.example',
      'https://c.example',
    ]);
    expect(createStoredBemuseProxiedOrigins(storage).has('https://c.example')).toBe(true);
  });

  test('works without storage, and with storage that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    for (const storage of [undefined, throwing]) {
      const origins = createStoredBemuseProxiedOrigins(storage);
      origins.add('https://a.example');
      expect(origins.has('https://a.example')).toBe(true);
    }
  });
});
