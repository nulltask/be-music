import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { createAuth, provisionClients, type Env } from './auth.ts';
import { isLocale, localeFromCookie, localeSetCookie, resolveLocale } from '@be-music/service-web-theme';
import { accountNotice, renderAccountPage, renderWelcomePage } from './page.ts';
import { CLIENT_JS } from './client.generated.ts';
import { avatarURL } from './avatars.ts';
import { profileHTTP } from './profile-http.ts';
import { createProfile, needsOnboarding, onAccountKept, welcomeNextPath } from './profiles.ts';
import { openDatabase } from './db/client.ts';
import { account, profile, user } from './schema.ts';

/** A redirect that is never cached. */
function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}

/** Accounts routes on the Dashboard host: Better Auth, OIDC metadata, profiles, avatars and the account pages. */
export async function handleAccounts(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const profileResponse = await profileHTTP(request, env);
  if (profileResponse) return profileResponse;
  await provisionClients(env);
  const auth = createAuth(env);
  if (
    url.pathname === '/.well-known/openid-configuration' ||
    url.pathname === '/api/auth/.well-known/openid-configuration'
  )
    return oauthProviderOpenIdConfigMetadata(auth)(request);
  if (url.pathname === '/.well-known/oauth-authorization-server/api/auth')
    return oauthProviderAuthServerMetadata(auth)(request);
  if (url.pathname.startsWith('/api/auth/')) {
    const response = await auth.handler(request);
    if (url.pathname === '/api/auth/passkey/verify-registration' && response.ok) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (session) {
        await drizzle(env.DB).update(user).set({ isAnonymous: false }).where(eq(user.id, session.user.id));
        if (session.user.isAnonymous === true) await onAccountKept(openDatabase(env.DB), session.user.id);
      }
    }
    return response;
  }
  if (url.pathname === '/assets/client.js' && request.method === 'GET')
    return new Response(CLIENT_JS, { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-cache' } });
  if (['/login', '/account', '/welcome'].includes(url.pathname) && request.method === 'GET') {
    const session = await auth.api.getSession({ headers: request.headers });
    let current;
    let linkedDiscord = false;
    let linkedGoogle = false;
    if (session) {
      const db = openDatabase(env.DB);
      await createProfile(db, session.user.id, session.user.isAnonymous === true);
      current = await db.query.profile.findFirst({ where: eq(profile.userId, session.user.id) });
      const providers = await db
        .select({ providerId: account.providerId })
        .from(account)
        .where(eq(account.userId, session.user.id));
      linkedDiscord = providers.some((row) => row.providerId === 'discord');
      linkedGoogle = providers.some((row) => row.providerId === 'google');
      // A new account is welcomed before its account page (docs/services.md, "Welcome after sign-up").
      if (url.pathname === '/account' && (await needsOnboarding(db, session.user.id)))
        return redirect(`/welcome?next=${encodeURIComponent('/account')}`);
    } else if (url.pathname === '/welcome') return redirect('/login');
    const locale = resolveLocale({
      query: url.searchParams.get('lang') ?? undefined,
      cookie: localeFromCookie(request.headers.get('cookie')),
      acceptLanguage: request.headers.get('accept-language') ?? undefined,
    });
    const chosen = url.searchParams.get('lang');
    const common = {
      buildInfo: env.BUILD_TIMESTAMP
        ? { builtAt: env.BUILD_TIMESTAMP, revision: env.BUILD_REVISION ?? 'unknown' }
        : undefined,
      showDonateLink: env.SHOW_DONATE_LINK === 'true',
      anonymous: session?.user.isAnonymous === true,
      name: current?.displayName ?? session?.user.name ?? '',
      profile: current
        ? {
            handle: current.handle,
            displayName: current.displayName,
            avatarURL: avatarURL(current.handle, current.avatarKey),
          }
        : undefined,
      locale,
      requestURL: request.url,
      discord: !!env.DISCORD_CLIENT_ID && !!env.DISCORD_CLIENT_SECRET,
      google: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
      linkedDiscord,
      linkedGoogle,
      notice: accountNotice(url.searchParams.get('error'), locale),
      apps: { dashboard: '/', ...(JSON.parse(env.OIDC_CLIENTS) as Record<string, string>) },
    };
    const body =
      url.pathname === '/welcome'
        ? renderWelcomePage({
            ...common,
            next: welcomeNextPath(url.searchParams.get('next')),
            continuing: url.searchParams.has('oauth_query'),
            step: url.searchParams.get('step') === 'finish' ? 'finish' : 'profile',
          })
        : renderAccountPage({ ...common, signedIn: !!session, login: url.pathname === '/login' });
    return new Response(body, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
        vary: 'cookie, accept-language',
        ...(isLocale(chosen) ? { 'set-cookie': localeSetCookie(chosen, url.protocol === 'https:') } : {}),
        'content-security-policy':
          "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  return new Response('Not Found', { status: 404 });
}
