/// <reference types="@cloudflare/workers-types" />

// The temporary Dashboard Worker on the site's apex (docs/services.md section 1): it shows who is signed in and links
// to the Player and the Leaderboard. The session cookies are shared on the site's domain, so it asks the Leaderboard
// (which holds Better Auth) for the account through the `LEADERBOARD` Service Binding.

import { pickLocale, renderDashboard, type DashboardAccount } from './page.ts';

interface Env {
  LEADERBOARD: Fetcher;
}

async function loadAccount(
  request: Request,
  env: Env,
): Promise<{ account: DashboardAccount | undefined; setCookies: string[] }> {
  const cookie = request.headers.get('cookie');
  if (cookie === null) return { account: undefined, setCookies: [] };
  const url = new URL('/api/v0/me', request.url);
  const response = await env.LEADERBOARD.fetch(url, { headers: { cookie } });
  const setCookies = response.headers.getSetCookie();
  if (!response.ok) return { account: undefined, setCookies };
  return { account: (await response.json()) as DashboardAccount, setCookies };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/') {
      return new Response('Not Found', { status: 404 });
    }
    const { account, setCookies } = await loadAccount(request, env);
    const html = renderDashboard({
      account,
      hostname: url.hostname,
      locale: pickLocale(request.headers.get('accept-language')),
    });
    const response = new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
        vary: 'cookie, accept-language',
      },
    });
    // Better Auth may refresh its cookie cache while reading the session; keep it warm.
    for (const cookieValue of setCookies) response.headers.append('set-cookie', cookieValue);
    return response;
  },
} satisfies ExportedHandler<Env>;
