/**
 * The installable player's files among the static assets (docs/player-web.md, "Installing the player"): the service
 * worker and the web app manifest, served with the headers they need whatever the asset defaults are.
 *
 * - `/sw.js` is revalidated on every update check (`no-cache`), so a deploy reaches browsers at their next start. It
 *   sits at the origin's root, so its default scope already covers the player and it needs no
 *   `Service-Worker-Allowed` header.
 * - `/manifest.webmanifest` gets the manifest media type and a short cache, like the Leaderboard's.
 */
const PWA_ASSET_HEADERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '/sw.js': {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-cache',
  },
  '/manifest.webmanifest': {
    'content-type': 'application/manifest+json',
    'cache-control': 'public, max-age=3600',
  },
};

/** The headers a path of the installable player is served with, or `undefined` for any other path. */
export function pwaAssetHeaders(pathname: string): Readonly<Record<string, string>> | undefined {
  return Object.hasOwn(PWA_ASSET_HEADERS, pathname) ? PWA_ASSET_HEADERS[pathname] : undefined;
}

/** `response` with the headers of `pathname` applied, when it is one of the installable player's files and was found. */
export function withPWAAssetHeaders(pathname: string, response: Response): Response {
  const headers = pwaAssetHeaders(pathname);
  if (headers === undefined || (!response.ok && response.status !== 304)) return response;
  const served = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) served.headers.set(name, value);
  return served;
}
