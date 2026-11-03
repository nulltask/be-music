// The player's service worker, served as `/sw.js` (docs/player-web.md, "Installing the player"). The build bundles this
// file on its own and writes the precache manifest into it (`scripts/service-worker-plugin.ts`); the rules it applies
// are `routes.ts`.
//
// Install precaches the shell of this deploy into a cache of its own, and alongside it the ffmpeg core and the UI fonts,
// so an installed player decodes legacy BGA video and shows its fonts offline from the start; those two are kept on a
// best-effort basis and never fail the install. The new worker then waits, as browsers do by
// default, until every tab of the player has closed, and takes over at the next start, when activation drops the
// caches of earlier deploys. Page loads go to the network first, so an online start always gets the latest deploy even
// before its worker takes over; only an offline (or very slow) start falls back to the cached shell.
//
// It imports nothing outside this directory: the bundle has to be a single classic script.

import {
  FFMPEG_CORE_URLS,
  FONT_CACHE_NAME,
  NAVIGATION_TIMEOUT_MS,
  SHELL_URL,
  extractFontFileURLs,
  ffmpegCoreCacheName,
  isCacheableResponse,
  routeRequest,
  shellCacheName,
  staleCacheNames,
  type PrecacheManifest,
  type RequestRoute,
} from './routes.ts';

/** Written by the build (`scripts/service-worker-plugin.ts`). */
declare const __BE_MUSIC_SW_MANIFEST__: PrecacheManifest;

// The worker scope's events, declared here: the player's TypeScript program uses the DOM library, not `webworker`.
interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}
interface ServiceWorkerScopeLike {
  readonly location: Location;
  readonly clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
}

const scope = self as unknown as ServiceWorkerScopeLike;
const manifest = __BE_MUSIC_SW_MANIFEST__;
const shellCache = shellCacheName(manifest.version);
const precached = new Set(manifest.urls);
const origin = scope.location.origin;

scope.addEventListener('install', (event) => {
  // `reload` skips the HTTP cache, so the shell is this deploy's bytes, not a copy the browser kept.
  const shell = caches
    .open(shellCache)
    .then((cache) => cache.addAll(manifest.urls.map((url) => new Request(url, { cache: 'reload' }))));
  event.waitUntil(
    Promise.all([shell, precacheFFmpegCore().catch(() => undefined), precacheFonts().catch(() => undefined)]),
  );
});

/** Caches the ffmpeg core of this build's version, unless an earlier install already did. */
async function precacheFFmpegCore(): Promise<void> {
  const cache = await caches.open(ffmpegCoreCacheName(manifest.ffmpegCoreVersion));
  const missing: string[] = [];
  for (const url of FFMPEG_CORE_URLS) {
    if ((await cache.match(url)) === undefined) missing.push(url);
  }
  if (missing.length > 0) await cache.addAll(missing);
}

/** Caches the shell's Google Fonts stylesheets and every font file they name, a few at a time. */
async function precacheFonts(): Promise<void> {
  const cache = await caches.open(FONT_CACHE_NAME);
  for (const stylesheet of manifest.fontStylesheets) {
    const response = await fetch(stylesheet, { mode: 'cors' });
    if (!isCacheableResponse(response, 'font-stylesheet')) continue;
    const css = await response.clone().text();
    await cache.put(stylesheet, response);
    const files = extractFontFileURLs(css);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < files.length) {
        const url = files[next++]!;
        if ((await cache.match(url, { ignoreVary: true })) !== undefined) continue;
        const file = await fetch(url, { mode: 'cors' }).catch(() => undefined);
        if (file !== undefined && isCacheableResponse(file, 'font-file')) await cache.put(url, file);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }
}

scope.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(staleCacheNames(names, manifest).map((name) => caches.delete(name))))
      // The first install takes over the page that registered it, so the rest of that visit fills the caches too.
      .then(() => scope.clients.claim()),
  );
});

scope.addEventListener('fetch', (event) => {
  const { request } = event;
  const route = routeRequest(
    {
      url: request.url,
      method: request.method,
      mode: request.mode,
      destination: request.destination,
      hasRange: request.headers.has('range'),
    },
    origin,
    precached,
  );
  switch (route) {
    case 'network':
      return;
    case 'shell-navigation':
      event.respondWith(loadPage(request));
      return;
    case 'font-stylesheet':
      event.respondWith(staleWhileRevalidate(request, FONT_CACHE_NAME, route, event));
      return;
    case 'font-file':
      event.respondWith(cacheFirst(request, FONT_CACHE_NAME, route));
      return;
    case 'ffmpeg-core':
      event.respondWith(cacheFirst(request, ffmpegCoreCacheName(manifest.ffmpegCoreVersion), route));
      return;
    case 'precached':
    case 'hashed-asset':
      event.respondWith(cacheFirst(request, shellCache, route));
      return;
  }
});

/** Network first; the cached shell when the network fails, or when it has not answered in time and a shell is cached. */
async function loadPage(request: Request): Promise<Response> {
  const network = fetch(request);
  const cached = await caches.open(shellCache).then((cache) => cache.match(SHELL_URL));
  if (cached === undefined) return network;
  // A network failure after the timeout already served the shell is expected, not an error to report.
  network.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((resolve) => {
    timer = setTimeout(() => resolve(cached), NAVIGATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([network, timeout]);
  } catch {
    return cached;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A font cached on install answers the page's own request for it: Google varies its responses on request headers that
 * differ between the two, so font matches ignore `Vary`.
 */
function matchOptions(route: RequestRoute): CacheQueryOptions | undefined {
  return route === 'font-stylesheet' || route === 'font-file' ? { ignoreVary: true } : undefined;
}

async function cacheFirst(request: Request, cacheName: string, route: RequestRoute): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, matchOptions(route));
  if (cached !== undefined) return cached;
  const response = await fetch(request);
  if (isCacheableResponse(response, route)) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(
  request: Request,
  cacheName: string,
  route: RequestRoute,
  event: ExtendableEventLike,
): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, matchOptions(route));
  const refresh = fetch(request).then(async (response) => {
    if (isCacheableResponse(response, route)) await cache.put(request, response.clone());
    return response;
  });
  if (cached === undefined) return refresh;
  event.waitUntil(refresh.catch(() => undefined));
  return cached;
}
