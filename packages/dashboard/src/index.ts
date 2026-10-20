/// <reference types="@cloudflare/workers-types" />
import { handleAuth, readSession, type OIDCEnv } from '@be-music/auth-client';
import { pickLocale, renderDashboard, type DashboardAccount } from './page.ts';

interface Env extends OIDCEnv {
  ACCOUNTS?: Pick<Fetcher, 'fetch'>;
  BUILD_TIMESTAMP?: string;
  BUILD_REVISION?: string;
  PLAY_ORIGIN: string;
  LEADERBOARD_ORIGIN: string;
  DONATE_ORIGIN: string;
  SHOW_DONATE_LINK?: string;
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
      try {
        const profileRequest = new Request(
          new URL(`/api/profiles/${encodeURIComponent(session.identity.sub)}`, env.AUTH_ISSUER),
        );
        const response = await (env.ACCOUNTS ? env.ACCOUNTS.fetch(profileRequest) : fetch(profileRequest));
        if (!response.ok) throw new Error('Profile unavailable');
        const profile = (await response.json()) as { handle?: unknown; displayName?: unknown };
        if (typeof profile.handle !== 'string' || typeof profile.displayName !== 'string')
          throw new Error('Invalid profile');
        account = {
          handle: profile.handle,
          displayName: profile.displayName,
          anonymous: session.identity.anonymous,
        };
      } catch {
        return new Response('Account profile temporarily unavailable', {
          status: 503,
          headers: { 'cache-control': 'no-store', 'retry-after': '30' },
        });
      }
    }
    return new Response(
      renderDashboard({
        buildInfo: env.BUILD_TIMESTAMP
          ? { builtAt: env.BUILD_TIMESTAMP, revision: env.BUILD_REVISION ?? 'unknown' }
          : undefined,
        account,
        hostname: url.hostname,
        showDonateLink: env.SHOW_DONATE_LINK === 'true',
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
