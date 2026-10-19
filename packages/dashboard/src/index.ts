/// <reference types="@cloudflare/workers-types" />
import { handleAuth, readSession, type OIDCEnv } from '@be-music/auth-client';
import { pickLocale, renderDashboard, type DashboardAccount } from './page.ts';

interface Env extends OIDCEnv {
  LEADERBOARD: Fetcher;
  PLAY_ORIGIN: string;
  LEADERBOARD_ORIGIN: string;
  DONATE_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const auth = await handleAuth(request, env);
    if (auth) return auth;
    const url = new URL(request.url);
    if (url.pathname !== '/' || url.origin !== env.PUBLIC_ORIGIN) return new Response('Not Found', { status: 404 });
    const session = await readSession(request, env);
    let account: DashboardAccount | undefined;
    if (session) {
      const response = await env.LEADERBOARD.fetch(
        new Request(`${env.API_AUDIENCE}/api/v0/me`, { headers: { authorization: `Bearer ${session.accessToken}` } }),
      );
      if (response.ok) account = (await response.json()) as DashboardAccount;
    }
    return new Response(
      renderDashboard({
        account,
        hostname: url.hostname,
        locale: pickLocale(request.headers.get('accept-language')),
        links: { play: env.PLAY_ORIGIN, leaderboard: env.LEADERBOARD_ORIGIN, donate: env.DONATE_ORIGIN },
      }),
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'private, no-store',
          vary: 'cookie, accept-language',
          'content-security-policy':
            "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        },
      },
    );
  },
} satisfies ExportedHandler<Env>;
