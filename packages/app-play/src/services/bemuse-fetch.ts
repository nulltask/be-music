// How Be-Music reads a Bemuse music server over the network. A request goes to the server first; when the browser
// blocks it because the server does not let other sites read it (no CORS header), it goes again through the player's
// same-origin proxy (`/__url-load-proxy`, which the `?music=` links use), and later requests to that origin go straight
// to the proxy. Chart files are kept in Cache Storage and checked against the MD5 the server index lists, so opening
// the player again fetches only the indexes.
import { md5HexOfBytes } from '@be-music/player-browser/collection';
import { URL_LOAD_PROXY_PATH } from '../url-load.ts';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Chart files by URL, each served only while its bytes still have the MD5 asked for. */
export interface BemuseChartCache {
  get(url: string, md5: string): Promise<Uint8Array | undefined>;
  put(url: string, bytes: Uint8Array): Promise<void>;
}

/** The reads `readBemuseServerFiles` makes. */
export interface BemuseFetcher {
  bytes(url: string): Promise<Uint8Array>;
  json(url: string): Promise<unknown>;
  /** Whether `url` answers a HEAD request with a success; false on any failure. */
  exists(url: string): Promise<boolean>;
  /** A chart file, from the cache when its bytes have `md5`, else fetched (and cached). */
  chart(url: string, md5: string | undefined): Promise<Uint8Array>;
}

const CHART_CACHE_NAME = 'be-music-bemuse-charts';

/** The proxy URL that reads `url` for this page, or `undefined` when the proxy cannot (not https, or same origin). */
export function bemuseProxyURL(url: string, pageHref: string | undefined): string | undefined {
  if (pageHref === undefined) return undefined;
  let target: URL;
  let page: URL;
  try {
    target = new URL(url);
    page = new URL(pageHref);
  } catch {
    return undefined;
  }
  if (target.protocol !== 'https:' || target.origin === page.origin) return undefined;
  if (page.protocol !== 'https:' && page.protocol !== 'http:') return undefined;
  const proxy = new URL(URL_LOAD_PROXY_PATH, page);
  proxy.searchParams.set('url', target.href);
  return proxy.href;
}

/** A chart cache over Cache Storage, or `undefined` where the page has none (an insecure origin, a worker test). */
export function createCacheStorageChartCache(
  storage: CacheStorage | undefined = globalThis.caches,
): BemuseChartCache | undefined {
  if (storage === undefined) return undefined;
  const open = () => storage.open(CHART_CACHE_NAME);
  return {
    async get(url, md5) {
      try {
        const response = await (await open()).match(url);
        if (response === undefined) return undefined;
        const bytes = new Uint8Array(await response.arrayBuffer());
        return md5HexOfBytes(bytes) === md5 ? bytes : undefined;
      } catch {
        return undefined;
      }
    },
    async put(url, bytes) {
      try {
        await (await open()).put(url, new Response(new Uint8Array(bytes)));
      } catch {
        // A full or blocked store: the chart is fetched again next time.
      }
    },
  };
}

export function createBemuseFetcher(
  options: { fetch?: Fetch; pageHref?: string; chartCache?: BemuseChartCache } = {},
): BemuseFetcher {
  const fetchFn: Fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const pageHref = options.pageHref ?? globalThis.location?.href;
  /** Origins that blocked a direct read: their requests go through the proxy. */
  const proxied = new Set<string>();

  async function request(url: string, init?: RequestInit): Promise<Response> {
    const origin = new URL(url).origin;
    const proxyURL = bemuseProxyURL(url, pageHref);
    if (proxyURL !== undefined && proxied.has(origin)) return fetchFn(proxyURL, init);
    try {
      return await fetchFn(url, init);
    } catch (error) {
      // A bare TypeError is the browser refusing a cross-origin read (or the network failing): try the proxy once.
      if (proxyURL === undefined) throw error;
      const response = await fetchFn(proxyURL, init);
      proxied.add(origin);
      return response;
    }
  }

  async function ok(url: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await request(url, init);
    } catch (error) {
      throw new Error(`could not fetch ${url} — network error or the server does not allow other sites to read it`, {
        cause: error,
      });
    }
    if (!response.ok) throw new Error(`could not fetch ${url} — HTTP ${response.status}`);
    return response;
  }

  const bytes = async (url: string) => new Uint8Array(await (await ok(url)).arrayBuffer());

  return {
    bytes,
    json: async (url) => (await ok(url)).json(),
    async exists(url) {
      try {
        return (await request(url, { method: 'HEAD' })).ok;
      } catch {
        return false;
      }
    },
    async chart(url, md5) {
      if (md5 !== undefined) {
        const cached = await options.chartCache?.get(url, md5);
        if (cached !== undefined) return cached;
      }
      const fetched = await bytes(url);
      if (md5 !== undefined && md5HexOfBytes(fetched) === md5) await options.chartCache?.put(url, fetched);
      return fetched;
    },
  };
}
