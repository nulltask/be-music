/// <reference types="@cloudflare/workers-types" />

// Worker entry for the Cloudflare deployment of the be-music web player.
//
// Almost everything is served straight from Workers Static Assets (`env.ASSETS`, configured via `assets.directory` in
// wrangler.jsonc). The exceptions are the ffmpeg.wasm core under `/ffmpeg-core/` and URL auto-load archives under
// `/__url-load-proxy`. The core lives in R2 because `ffmpeg-core.wasm` is ~31 MB, which blows past the 25 MiB per-file
// limit for Static Assets. The URL proxy lets shared demo links load cross-origin archive URLs even when the host does
// not send browser CORS headers. `assets.run_worker_first` routes both paths here before asset matching.
//
// The core files only change when the pinned `@ffmpeg/core` version changes — upload them with the `cf:r2:push` script.

interface Env {
  ASSETS: Fetcher;
  FFMPEG_CORE: R2Bucket;
}

const FFMPEG_PREFIX = '/ffmpeg-core/';
const URL_LOAD_PROXY_PATH = '/__url-load-proxy';

// `toBlobURL` (in @be-music/player-web) re-wraps the fetched bytes in a blob with its own explicit MIME, so the
// Content-Type here is mostly cosmetic — but keeping it correct makes a direct fetch / debugging session behave sanely.
const CONTENT_TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  wasm: 'application/wasm',
};

async function serveFfmpegCore(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  // Only the flat core files live in the bucket — reject empty keys and any nested path so a stray request can't probe
  // the bucket beyond what we put there.
  const key = pathname.slice(FFMPEG_PREFIX.length);
  if (!key || key.includes('/')) {
    return new Response('Not Found', { status: 404 });
  }

  const object = await env.FFMPEG_CORE.get(key);
  if (object === null) {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  const ext = key.slice(key.lastIndexOf('.') + 1);
  const contentType = CONTENT_TYPES[ext];
  if (contentType) {
    headers.set('content-type', contentType);
  }
  // The bytes are pinned to the deployed `@ffmpeg/core` version, so they're safe to cache indefinitely.
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  // The page lives on the same origin as this Worker, but state the policy explicitly.
  headers.set('cross-origin-resource-policy', 'same-origin');

  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

function resolveUrlLoadProxyTarget(rawUrl: string | null): URL {
  if (!rawUrl) {
    throw new Error('missing url query parameter');
  }
  const target = new URL(rawUrl);
  if (target.protocol !== 'https:') {
    throw new Error('only https proxy targets are allowed');
  }
  if (target.username || target.password) {
    throw new Error('proxy target credentials are not allowed');
  }
  return target;
}

async function serveUrlLoadProxy(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  let target: URL;
  try {
    target = resolveUrlLoadProxyTarget(new URL(request.url).searchParams.get('url'));
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'invalid proxy target', { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      redirect: 'follow',
    });
  } catch (error) {
    return new Response(`failed to fetch ${target.href}: ${error instanceof Error ? error.message : String(error)}`, {
      status: 502,
    });
  }

  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
  headers.set('cache-control', 'no-store');
  headers.set('cross-origin-resource-policy', 'same-origin');

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(FFMPEG_PREFIX)) {
      return serveFfmpegCore(request, env, pathname);
    }
    if (pathname === URL_LOAD_PROXY_PATH) {
      return serveUrlLoadProxy(request);
    }
    // Everything else: static assets, with `not_found_handling: single-page-application` serving index.html on a miss.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
