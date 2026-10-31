// `/__url-load-proxy?url=<https URL>`: fetches an archive from another origin for the player's `?music=` and the embed's
// `?track=`, whose hosts often send no CORS headers. The browser may keep the response but revalidates it on every use
// (`no-cache`): the upstream's ETag / Last-Modified pass through, and so do the browser's If-None-Match /
// If-Modified-Since, so an unchanged archive comes back as a 304 instead of downloading again.

/** The validators the proxy carries from the browser to the upstream. */
const CONDITIONAL_REQUEST_HEADERS = ['if-none-match', 'if-modified-since'] as const;
/** The validators the proxy carries from the upstream back to the browser. */
const VALIDATOR_RESPONSE_HEADERS = ['etag', 'last-modified'] as const;

export function resolveURLLoadProxyTarget(rawURL: string | null): URL {
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

export async function serveURLLoadProxy(
  request: Request,
  fetcher: (input: URL, init: RequestInit) => Promise<Response> = fetch,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  let target: URL;
  try {
    target = resolveURLLoadProxyTarget(new URL(request.url).searchParams.get('url'));
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'invalid proxy target', { status: 400 });
  }

  const conditional = new Headers();
  for (const name of CONDITIONAL_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) conditional.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetcher(target, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: conditional,
      redirect: 'follow',
    });
  } catch (error) {
    return new Response(`failed to fetch ${target.href}: ${error instanceof Error ? error.message : String(error)}`, {
      status: 502,
    });
  }

  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
  // Keep it, but ask again each time: the same URL may serve a new archive.
  headers.set('cache-control', 'no-cache');
  headers.set('cross-origin-resource-policy', 'same-origin');
  for (const name of VALIDATOR_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  const bodyless = request.method === 'HEAD' || upstream.status === 304;
  return new Response(bodyless ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
