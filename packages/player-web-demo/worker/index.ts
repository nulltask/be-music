/// <reference types="@cloudflare/workers-types" />

// Worker entry for the Cloudflare deployment of the be-music web player.
//
// Almost everything is served straight from Workers Static Assets (`env.ASSETS`, configured via `assets.directory` in
// wrangler.jsonc). The one exception is the ffmpeg.wasm core under `/ffmpeg-core/`: `ffmpeg-core.wasm` is ~31 MB, which
// blows past the 25 MiB per-file limit for Static Assets, so we keep the two core files in an R2 bucket and stream them
// through this Worker instead. `assets.run_worker_first` routes `/ffmpeg-core/*` here before asset matching, and the
// build's `.assetsignore` keeps the oversized files out of the uploaded asset manifest.
//
// The core files only change when the pinned `@ffmpeg/core` version changes — upload them with the `cf:r2:push` script.

interface Env {
  ASSETS: Fetcher;
  FFMPEG_CORE: R2Bucket;
}

const FFMPEG_PREFIX = '/ffmpeg-core/';

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(FFMPEG_PREFIX)) {
      return serveFfmpegCore(request, env, pathname);
    }
    // Everything else: static assets, with `not_found_handling: single-page-application` serving index.html on a miss.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
