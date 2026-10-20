import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous } from 'better-auth/plugins/anonymous';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './db/schema.ts';
import type { Env } from './env.ts';
import { createProfile } from './profiles.ts';
import { reassignScores } from './scores/reassign.ts';

/**
 * Whether a request carries a Better Auth session cookie (`better-auth.session_token`, `__Secure-` prefixed over HTTPS).
 * Without one `getSession` can only answer null, so callers skip building the auth instance and asking it.
 */
export function hasSessionCookie(headers: Headers): boolean {
  return headers.get('cookie')?.includes('session_token=') ?? false;
}

/**
 * Better Auth for a request's bindings and origin (docs/leaderboard.md section 3), built once per bindings object and
 * origin and reused while the isolate lives: setting it up and its context per request cost every request. The
 * bindings come from the request (`c.env`), so the cache is keyed by that object and never outlives it. Discord and
 * Google sign-in are enabled only when their secrets are configured, so local runs and tests work with anonymous
 * sessions alone.
 */
export function createAuth(env: Env, origin: string): Auth {
  let byOrigin = AUTH_BY_ENV.get(env);
  if (byOrigin === undefined) {
    byOrigin = new Map();
    AUTH_BY_ENV.set(env, byOrigin);
  }
  let auth = byOrigin.get(origin);
  if (auth === undefined) {
    auth = buildAuth(env, origin);
    byOrigin.set(origin, auth);
  }
  return auth;
}

const AUTH_BY_ENV = new WeakMap<Env, Map<string, Auth>>();

/**
 * The signed-in session of a request (null without one), and the cookies Better Auth set while reading it: the
 * refreshed five-minute cookie cache, or a session whose expiry it extended. Passing those on with the response keeps
 * the cache warm, so later requests read the session from the cookie instead of D1.
 */
export async function loadSession(
  env: Env,
  request: Request,
): Promise<{ session: Awaited<ReturnType<Auth['api']['getSession']>>; setCookies: string[] }> {
  if (!hasSessionCookie(request.headers)) {
    return { session: null, setCookies: [] };
  }
  const result = await createAuth(env, new URL(request.url).origin).api.getSession({
    headers: request.headers,
    returnHeaders: true,
  });
  return { session: result.response, setCookies: result.headers?.getSetCookie() ?? [] };
}

/**
 * Adds the cookies {@link loadSession} collected to a response, unless it is publicly cacheable (a replay, a card):
 * a shared cache must not keep one player's cookie, and a response with one would not be cached at all.
 */
export function passOnSetCookies(response: Response, setCookies: readonly string[]): void {
  if (setCookies.length === 0 || /\bpublic\b/.test(response.headers.get('cache-control') ?? '')) {
    return;
  }
  for (const cookie of setCookies) {
    response.headers.append('set-cookie', cookie);
  }
}

/** How Better Auth is reached and where its cookies go, for a request's bindings and origin. */
export interface AuthSettings {
  baseURL: string;
  /** Origins allowed to call Better Auth and to run passkey ceremonies; the base URL's origin comes first. */
  trustedOrigins: string[];
  cookieDomain: string | undefined;
  cookiePrefix: string | undefined;
  rpID: string;
}

/**
 * Better Auth's settings from the bindings (docs/services.md section 3). With `AUTH_ORIGIN` set, every service reaches
 * one Better Auth at that origin and shares its cookies on `COOKIE_DOMAIN`; without it (local runs, tests), the
 * request's own origin serves as before.
 */
export function authSettings(env: Env, requestOrigin: string): AuthSettings {
  const baseURL = env.AUTH_ORIGIN?.trim() || requestOrigin;
  const extra = (env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const trustedOrigins = [...new Set([new URL(baseURL).origin, ...extra])];
  return {
    baseURL,
    trustedOrigins,
    cookieDomain: env.COOKIE_DOMAIN?.trim() || undefined,
    cookiePrefix: env.COOKIE_PREFIX?.trim() || undefined,
    rpID: env.PASSKEY_RP_ID?.trim() || new URL(baseURL).hostname,
  };
}

function buildAuth(env: Env, origin: string) {
  const settings = authSettings(env, origin);
  const db = drizzle(env.DB, { schema });
  const socialProviders: Parameters<typeof betterAuth>[0]['socialProviders'] = {};
  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
    socialProviders.discord = { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET };
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  return betterAuth({
    baseURL: settings.baseURL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: settings.trustedOrigins,
    advanced: {
      ...(settings.cookiePrefix ? { cookiePrefix: settings.cookiePrefix } : {}),
      ...(settings.cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: settings.cookieDomain } } : {}),
    },
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        passkey: schema.passkey,
      },
    }),
    socialProviders,
    // Keep the session in a signed cookie for 5 minutes, so pages and the API read it without a D1 round trip. A
    // signed-out or revoked session lingers that long at most; nothing here trusts more than its user id.
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    plugins: [
      anonymous({
        // Runs before the anonymous user is deleted, so its plays move instead of cascading away.
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await reassignScores(db, anonymousUser.user.id, newUser.user.id);
        },
      }),
      passkey({ rpID: settings.rpID, rpName: 'be-music', origin: settings.trustedOrigins }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (created) => {
            await createProfile(db, created.id, (created as { isAnonymous?: boolean | null }).isAnonymous === true);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof buildAuth>;
