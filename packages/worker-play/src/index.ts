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
import { playAppShortName, playAppTitle, playEnvironmentOfOrigin, retitleManifest } from './app-title.ts';
import { withCrossOriginIsolation } from './cross-origin-isolation.ts';
import { isLeaderboardPath } from './leaderboard-paths.ts';
import { handlePlayerSettings, PLAYER_SETTINGS_PATH } from './player-settings.ts';
import { withPWAAssetHeaders } from './pwa-assets.ts';
import { serveURLLoadProxy } from './url-load-proxy.ts';

interface Env extends OIDCEnv {
  ASSETS: Fetcher;
  FFMPEG_CORE: R2Bucket;
  /** The Leaderboard Worker (`packages/app-leaderboard`) of the same environment. */
  LEADERBOARD: Fetcher;
  /** The Dashboard Worker, which runs Accounts (the OIDC issuer), of the same environment. */
  ACCOUNTS: Fetcher;
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

/**
 * `response` retitled for the deployment this Worker serves (`app-title.ts`): the player page's title and the web app
 * manifest's names. Production, other paths and misses pass through untouched. The embed page is not installable and
 * keeps its own title.
 */
async function withEnvironmentTitle(pathname: string, response: Response, publicOrigin: string): Promise<Response> {
  const environment = playEnvironmentOfOrigin(publicOrigin);
  if (environment === 'production' || !response.ok) return response;
  if (pathname === '/manifest.webmanifest') {
    const served = new Response(retitleManifest(await response.text(), environment), response);
    served.headers.delete('content-length');
    return served;
  }
  const isPage = response.headers.get('content-type')?.startsWith('text/html') === true;
  if (!isPage || pathname.startsWith('/embed/')) return response;
  return new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(playAppTitle(environment));
      },
    })
    .on('meta[name="apple-mobile-web-app-title"]', {
      element(element) {
        element.setAttribute('content', playAppShortName(environment));
      },
    })
    .transform(response);
}

/** The response to `request`, before the headers every response shares. */
async function route(request: Request, env: Env): Promise<Response> {
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
  // Options dialog settings. Handled here, not forwarded: the Leaderboard does not keep them. The device cookie and
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
  // The service worker and the web app manifest get their own headers (`pwa-assets.ts`), and the page and the manifest
  // the title of this deployment (`app-title.ts`).
  const asset = await withEnvironmentTitle(pathname, await env.ASSETS.fetch(request), env.PUBLIC_ORIGIN);
  return withPWAAssetHeaders(pathname, asset);
}

export default {
  // Every response carries the cross-origin isolation headers (`cross-origin-isolation.ts`): the pages need them to be
  // isolated, and their workers and the service worker need them too to share that isolation.
  async fetch(request: Request, env: Env): Promise<Response> {
    return withCrossOriginIsolation(await route(request, env));
  },
} satisfies ExportedHandler<Env>;
