/// <reference types="@cloudflare/workers-types" />

// The Player Worker (`play` on `play.be-music.app`, docs/services.md), serving the web player that
// `@be-music/app-play` builds.
//
// `/api/*` goes to the Leaderboard Worker through the `LEADERBOARD` Service Binding, so the player's API requests and
// host-only OIDC session stays on its own origin; the upstream receives only a resource-bound access token.
//
// Almost everything is served straight from Workers Static Assets (`env.ASSETS`; wrangler.config.ts points at the
// player's `dist`). The exceptions are the ffmpeg.wasm core under `/ffmpeg-core/` and URL auto-load archives under
// `/__url-load-proxy`. The core lives in R2 because `ffmpeg-core.wasm` is ~31 MB, which blows past the 25 MiB per-file
// limit for Static Assets. The URL proxy lets shared player links load cross-origin archive URLs even when the host does
// not send browser CORS headers. `assets.runWorkerFirst` (cloudflare.config.ts) routes both paths here before asset
// matching.
//
// The core files only change when the pinned `@ffmpeg/core` version changes — upload them with the `cf:r2:push` script.

import { handleAuth, readSession, type OIDCEnv } from '@be-music/service-auth-client';
import { isLeaderboardPath } from './leaderboard-paths.ts';
import { handlePlayerSettings, PLAYER_SETTINGS_PATH } from './player-settings.ts';

interface Env extends OIDCEnv {
  ASSETS: Fetcher;
  FFMPEG_CORE: R2Bucket;
  /** The Leaderboard Worker (`packages/app-leaderboard`) of the same environment. */
  LEADERBOARD: Fetcher;
}

const FFMPEG_PREFIX = '/ffmpeg-core/';
const URL_LOAD_PROXY_PATH = '/__url-load-proxy';

// `toBlobURL` (in @be-music/player-browser) re-wraps the fetched bytes in a blob with its own explicit MIME, so the
// Content-Type here is mostly cosmetic — but keeping it correct makes a direct fetch / debugging session behave sanely.
const CONTENT_TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  wasm: 'application/wasm',
};

async function serveFFmpegCore(request: Request, env: Env, pathname: string): Promise<Response> {
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

function resolveURLLoadProxyTarget(rawURL: string | null): URL {
  if (!rawURL) {
    throw new Error('missing url query parameter');
  }
  const target = new URL(rawURL);
  if (target.protocol !== 'https:') {
    throw new Error('only https proxy targets are allowed');
  }
  if (target.username || target.password) {
    throw new Error('proxy target credentials are not allowed');
  }
  return target;
}

async function serveURLLoadProxy(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  let target: URL;
  try {
    target = resolveURLLoadProxyTarget(new URL(request.url).searchParams.get('url'));
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
    const auth = await handleAuth(request, env);
    if (auth) return auth;
    const { pathname, origin } = new URL(request.url);
    if (origin !== env.PUBLIC_ORIGIN) return new Response('Unknown origin', { status: 400 });
    if (pathname.startsWith(FFMPEG_PREFIX)) {
      return serveFFmpegCore(request, env, pathname);
    }
    if (pathname === URL_LOAD_PROXY_PATH) {
      return serveURLLoadProxy(request);
    }
    // Debug Menu settings. Handled here, not forwarded: the Leaderboard does not keep them. The device cookie and
    // the R2 copy survive Safari deleting script-written storage.
    if (pathname === PLAYER_SETTINGS_PATH) {
      const session = await readSession(request, env);
      return handlePlayerSettings(request, env.FFMPEG_CORE, session?.identity.sub);
    }
    // The browser only calls this origin. Strip browser credentials and forward the server-held API token.
    if (isLeaderboardPath(pathname)) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('origin') !== env.PUBLIC_ORIGIN)
        return new Response('Invalid origin', { status: 403 });
      const session = await readSession(request, env);
      const headers = new Headers(request.headers);
      headers.delete('cookie');
      headers.delete('authorization');
      if (session) headers.set('authorization', `Bearer ${session.accessToken}`);
      const url = new URL(request.url);
      url.host = new URL(env.API_AUDIENCE).host;
      return env.LEADERBOARD.fetch(new Request(url, new Request(request, { headers })));
    }
    // Everything else: static assets, with `not_found_handling: single-page-application` serving index.html on a miss.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
