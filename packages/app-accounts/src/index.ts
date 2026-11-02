/// <reference types="@cloudflare/workers-types" />
import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { createAuth, provisionClients, type Env } from './auth.ts';
import { isLocale, localeFromCookie, localeSetCookie, resolveLocale } from '@be-music/service-web-theme';
import { accountNotice, renderAccountPage } from './page.ts';
import { CLIENT_JS } from './client.generated.ts';
import { avatarURL } from './avatars.ts';
import { profileHTTP } from './profile-http.ts';
import { createProfile } from './profiles.ts';
import { openDatabase } from './db/client.ts';
import { account, profile, user } from './schema.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== env.AUTH_ORIGIN) return new Response('Unknown origin', { status: 400 });
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
        if (session) await drizzle(env.DB).update(user).set({ isAnonymous: false }).where(eq(user.id, session.user.id));
      }
      return response;
    }
    if (url.pathname === '/assets/client.js' && request.method === 'GET')
      return new Response(CLIENT_JS, { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-cache' } });
    if (['/', '/login', '/account'].includes(url.pathname) && request.method === 'GET') {
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
      }
      const locale = resolveLocale({
        query: url.searchParams.get('lang') ?? undefined,
        cookie: localeFromCookie(request.headers.get('cookie')),
        acceptLanguage: request.headers.get('accept-language') ?? undefined,
      });
      const chosen = url.searchParams.get('lang');
      return new Response(
        renderAccountPage({
          buildInfo: env.BUILD_TIMESTAMP
            ? { builtAt: env.BUILD_TIMESTAMP, revision: env.BUILD_REVISION ?? 'unknown' }
            : undefined,
          showDonateLink: env.SHOW_DONATE_LINK === 'true',
          signedIn: !!session,
          anonymous: session?.user.isAnonymous === true,
          name: current?.displayName ?? session?.user.name ?? '',
          profile: current
            ? {
                handle: current.handle,
                displayName: current.displayName,
                avatarURL: avatarURL(current.handle, current.avatarKey),
              }
            : undefined,
          login: url.pathname === '/login',
          locale,
          requestURL: request.url,
          discord: !!env.DISCORD_CLIENT_ID && !!env.DISCORD_CLIENT_SECRET,
          google: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
          linkedDiscord,
          linkedGoogle,
          notice: accountNotice(url.searchParams.get('error'), locale),
          apps: JSON.parse(env.OIDC_CLIENTS) as Record<string, string>,
        }),
        {
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
        },
      );
    }
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
