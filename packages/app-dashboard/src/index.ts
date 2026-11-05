/// <reference types="@cloudflare/workers-types" />
import { isLocale, localeFromCookie, localeSetCookie, resolveLocale } from '@be-music/service-web-theme';
import { createAuth, provisionClients, type Env as AccountsEnv } from './accounts/auth.ts';
import { handleAccounts } from './accounts/handler.ts';
import { publicProfile } from './accounts/profile-http.ts';
import { createProfile, needsOnboarding } from './accounts/profiles.ts';
import { openDatabase } from './accounts/db/client.ts';
import { renderDashboard, type DashboardAccount } from './page.ts';

/**
 * The Dashboard Worker (docs/services.md, ADR 0039). It is also the Accounts service: Better Auth and the OIDC provider
 * run on this host, so the Dashboard reads the Accounts session directly instead of signing in as an OIDC client.
 */
export interface Env extends AccountsEnv {
  PLAY_ORIGIN: string;
  LEADERBOARD_ORIGIN: string;
  DONATE_ORIGIN: string;
}

async function dashboard(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const session = await createAuth(env).api.getSession({ headers: request.headers });
  let account: DashboardAccount | undefined;
  if (session) {
    try {
      const db = openDatabase(env.DB);
      await createProfile(db, session.user.id, session.user.isAnonymous === true);
      // A new account is welcomed first, then comes back here.
      if (await needsOnboarding(db, session.user.id))
        return new Response(null, {
          status: 302,
          headers: { location: '/welcome?next=%2F', 'cache-control': 'no-store' },
        });
      const profile = await publicProfile(env, session.user.id);
      if (!profile) throw new Error('Profile unavailable');
      account = {
        handle: profile.handle,
        displayName: profile.displayName,
        anonymous: session.user.isAnonymous === true,
        avatarURL: profile.avatarURL,
      };
    } catch {
      return new Response('Account profile temporarily unavailable', {
        status: 503,
        headers: { 'cache-control': 'no-store', 'retry-after': '30' },
      });
    }
  }
  const chosen = url.searchParams.get('lang');
  return new Response(
    renderDashboard({
      buildInfo: env.BUILD_TIMESTAMP
        ? { builtAt: env.BUILD_TIMESTAMP, revision: env.BUILD_REVISION ?? 'unknown' }
        : undefined,
      account,
      hostname: url.hostname,
      showDonateLink: env.SHOW_DONATE_LINK === 'true',
      locale: resolveLocale({
        query: chosen ?? undefined,
        cookie: localeFromCookie(request.headers.get('cookie')),
        acceptLanguage: request.headers.get('accept-language') ?? undefined,
      }),
      requestURL: request.url,
      links: { play: env.PLAY_ORIGIN, leaderboard: env.LEADERBOARD_ORIGIN, donate: env.DONATE_ORIGIN },
    }),
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
        vary: 'cookie, accept-language',
        ...(isLocale(chosen) ? { 'set-cookie': localeSetCookie(chosen, url.protocol === 'https:') } : {}),
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      },
    },
  );
}

/** The Dashboard's sign-out form: ends the Accounts session through Better Auth and returns to the Dashboard. */
async function signOut(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('origin') !== env.AUTH_ORIGIN) return new Response('Invalid origin', { status: 403 });
  const response = await createAuth(env).handler(
    new Request(new URL('/api/auth/sign-out', env.AUTH_ORIGIN), {
      method: 'POST',
      headers: { cookie: request.headers.get('cookie') ?? '', origin: env.AUTH_ORIGIN },
    }),
  );
  const headers = new Headers({ location: '/', 'cache-control': 'no-store' });
  for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== env.AUTH_ORIGIN) return new Response('Unknown origin', { status: 400 });
    if (url.pathname === '/' && request.method === 'GET') {
      await provisionClients(env);
      return dashboard(request, env);
    }
    if (url.pathname === '/sign-out' && request.method === 'POST') return signOut(request, env);
    return handleAccounts(request, env);
  },
} satisfies ExportedHandler<Env>;
