// The player's service worker rules (docs/player-web.md, "Installing the player"): which request it answers and how,
// and the caches it keeps. Pure, so the rules are tested in Node; `service-worker.ts` applies them.
//
// The worker only touches what makes the app shell start offline. Everything dynamic goes straight to the network and
// is never cached: the Worker's own routes (`/api/*` with sign-in, accounts, player settings and the Leaderboard API,
// `/__url-load-proxy`), the embed page (`/embed/`), the archives a `?music=` / `?skin=` link loads (through the proxy or
// cross-origin), every request that is not a GET, range requests, and cross-origin requests other than the UI fonts.

/** What the build hands the service worker (`scripts/service-worker-plugin.ts`). */
export interface PrecacheManifest {
  /** Changes whenever a precached file's bytes change; names the shell cache, so each deploy gets its own. */
  version: string;
  /** Same-origin paths cached on install: the shell's HTML (`/`), its hashed assets, the icons and the manifest. */
  urls: readonly string[];
  /** The `@ffmpeg/core` version the build serves under `/ffmpeg-core/`; names the ffmpeg core's cache. */
  ffmpegCoreVersion: string;
}

/** How the service worker answers a request. */
export type RequestRoute =
  /** A page load: network first, the cached shell when the network fails or is too slow. */
  | 'shell-navigation'
  /** A precached file whose name has no hash (icons, the manifest): the cache, else the network. */
  | 'precached'
  /** A content-hashed build asset under `/assets/`: the cache, else the network, kept for later. */
  | 'hashed-asset'
  /** The ffmpeg.wasm core: cached on first use, by the core's version. */
  | 'ffmpeg-core'
  /** The Google Fonts stylesheet: the cache at once, refreshed from the network behind it. */
  | 'font-stylesheet'
  /** A Google Fonts file (its URL is versioned): the cache, else the network, kept for later. */
  | 'font-file'
  /** Not handled: the browser fetches it as if there were no service worker. */
  | 'network';

/** The parts of a request the rules read. */
export interface RequestFacts {
  url: string;
  method: string;
  /** `Request.mode` (`navigate` for a page load). */
  mode: string;
  /** `Request.destination` (`document` for a top-level page). */
  destination: string;
  /** Whether the request carries a `Range` header (media streaming), which the Cache API cannot answer. */
  hasRange: boolean;
}

/** Every cache this worker creates starts with this, so activation can drop the ones a deploy no longer uses. */
export const CACHE_PREFIX = 'be-music-play-';
/** The UI fonts' cache. Font URLs are versioned by Google, so it outlives deploys. */
export const FONT_CACHE_NAME = `${CACHE_PREFIX}fonts`;
/** The cache key of the app shell's HTML. */
export const SHELL_URL = '/';
/** How long a page load waits for the network before it serves the cached shell. */
export const NAVIGATION_TIMEOUT_MS = 5000;

const FONT_STYLESHEET_HOST = 'fonts.googleapis.com';
const FONT_FILE_HOST = 'fonts.gstatic.com';
/** Same-origin paths that are dynamic: the Worker's routes and the embed page, which stays outside the app. */
const NETWORK_ONLY_PREFIXES = ['/api/', '/__url-load-proxy', '/embed/'];
const NETWORK_ONLY_PATHS = new Set(['/api', '/embed', '/sw.js']);

/** The cache of one deploy's shell. */
export function shellCacheName(version: string): string {
  return `${CACHE_PREFIX}shell-${version}`;
}

/** The cache of one `@ffmpeg/core` version. */
export function ffmpegCoreCacheName(ffmpegCoreVersion: string): string {
  return `${CACHE_PREFIX}ffmpeg-${ffmpegCoreVersion}`;
}

/** The caches a worker built from `manifest` keeps; activation deletes every other cache of this worker. */
export function currentCacheNames(manifest: PrecacheManifest): string[] {
  return [shellCacheName(manifest.version), ffmpegCoreCacheName(manifest.ffmpegCoreVersion), FONT_CACHE_NAME];
}

/** The caches to delete on activation: this worker's caches from earlier deploys. Other caches on the origin stay. */
export function staleCacheNames(existing: readonly string[], manifest: PrecacheManifest): string[] {
  const keep = new Set(currentCacheNames(manifest));
  return existing.filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name));
}

function isNetworkOnlyPath(pathname: string): boolean {
  return NETWORK_ONLY_PATHS.has(pathname) || NETWORK_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** A path that names a file (`/favicon.svg`) rather than a page of the app (`/`, `/anything`). */
function looksLikeFile(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  return last.includes('.') && !last.endsWith('.html');
}

/**
 * How the service worker answers `request` on the page origin `origin`, given the paths it precached.
 *
 * A page load of the app (any path the Worker answers with the shell, query string and all, so `/?music=…` too) is
 * `shell-navigation`; build assets, precached files, the ffmpeg core and the UI fonts are cached; the rest is `network`.
 */
export function routeRequest(request: RequestFacts, origin: string, precached: ReadonlySet<string>): RequestRoute {
  if (request.method !== 'GET' || request.hasRange) return 'network';
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return 'network';
  }
  if (url.origin !== origin) {
    if (url.protocol !== 'https:') return 'network';
    if (url.hostname === FONT_STYLESHEET_HOST && url.pathname.startsWith('/css')) return 'font-stylesheet';
    if (url.hostname === FONT_FILE_HOST) return 'font-file';
    return 'network';
  }
  const { pathname } = url;
  if (isNetworkOnlyPath(pathname)) return 'network';
  if (request.mode === 'navigate') {
    return request.destination === 'document' && !looksLikeFile(pathname) ? 'shell-navigation' : 'network';
  }
  if (pathname.startsWith('/assets/')) return 'hashed-asset';
  if (pathname.startsWith('/ffmpeg-core/')) return url.search === '' ? 'ffmpeg-core' : 'network';
  if (url.search === '' && precached.has(pathname)) return 'precached';
  return 'network';
}

/** Whether a network response may be stored: a complete, successful answer (an opaque one only for the fonts). */
export function isCacheableResponse(response: { status: number; type: string }, route: RequestRoute): boolean {
  if (response.type === 'opaque') return route === 'font-stylesheet' || route === 'font-file';
  return (
    response.status === 200 && (response.type === 'basic' || response.type === 'cors' || response.type === 'default')
  );
}
