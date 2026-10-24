import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous } from 'better-auth/plugins/anonymous';
import { jwt } from 'better-auth/plugins/jwt';
import { passkey } from '@better-auth/passkey';
import { oauthProvider } from '@better-auth/oauth-provider';
import { drizzle } from 'drizzle-orm/d1';
import { eq, count, notInArray } from 'drizzle-orm';
import { createProfile } from './profiles.ts';
import * as schema from './schema.ts';

export interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  AUTH_ORIGIN: string;
  BUILD_TIMESTAMP?: string;
  BUILD_REVISION?: string;
  SHOW_DONATE_LINK?: string;
  PASSKEY_RP_ID: string;
  /** JSON map of first-party client IDs to exact origins. */
  OIDC_CLIENTS: string;
  API_AUDIENCE: string;
  BETTER_AUTH_SECRET: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}
const instances = new WeakMap<Env, ReturnType<typeof buildAuth>>();
export function createAuth(env: Env) {
  let instance = instances.get(env);
  if (!instance) {
    instance = buildAuth(env);
    instances.set(env, instance);
  }
  return instance;
}
function buildAuth(env: Env) {
  const db = drizzle(env.DB, { schema });
  const clients = JSON.parse(env.OIDC_CLIENTS) as Record<string, string>;
  const socialProviders: Parameters<typeof betterAuth>[0]['socialProviders'] = {};
  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET)
    socialProviders.discord = {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      // The provider otherwise sends prompt=none, which Discord rejects until this app has been authorized.
      prompt: 'consent',
    };
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  const claims = async (user: { id: string; name?: string; isAnonymous?: unknown } | null | undefined) => {
    if (user) await createProfile(db, user.id, user.isAnonymous === true);
    const publicProfile = user
      ? await db.query.profile.findFirst({ where: eq(schema.profile.userId, user.id) })
      : undefined;
    return {
      'https://be-music.app/passkeys': user
        ? (await db.select({ n: count() }).from(schema.passkey).where(eq(schema.passkey.userId, user.id)))[0].n
        : 0,
      'https://be-music.app/anonymous': user?.isAnonymous === true,
      'https://be-music.app/linked-guests': user
        ? (await db.select().from(schema.identityLink).where(eq(schema.identityLink.toUserId, user.id))).map(
            (row) => row.fromUserId,
          )
        : [],
      ...(user ? { name: publicProfile?.displayName ?? user.name } : {}),
    };
  };
  return betterAuth({
    baseURL: env.AUTH_ORIGIN,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    // Every ceremony takes place at Accounts. Never trust arbitrary subdomains or branch previews.
    trustedOrigins: [env.AUTH_ORIGIN],
    advanced: {
      cookiePrefix: 'be-music-accounts',
    },
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    socialProviders,
    disabledPaths: ['/token', '/update-user'],
    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await db
            .insert(schema.identityLink)
            .values({ fromUserId: anonymousUser.user.id, toUserId: newUser.user.id })
            .onConflictDoNothing();
          // Carry previous guest merges through a later account link as well.
          await db
            .update(schema.identityLink)
            .set({ toUserId: newUser.user.id })
            .where(eq(schema.identityLink.toUserId, anonymousUser.user.id));
        },
      }),
      passkey({ rpID: env.PASSKEY_RP_ID, rpName: 'be-music', origin: env.AUTH_ORIGIN }),
      jwt({ jwt: { issuer: `${env.AUTH_ORIGIN}/api/auth` }, jwks: { keyPairConfig: { alg: 'RS256' } } }),
      oauthProvider({
        loginPage: '/login',
        consentPage: '/consent',
        scopes: ['openid', 'profile', 'be-music:api'],
        grantTypes: ['authorization_code'],
        allowDynamicClientRegistration: false,
        clientPrivileges: () => false,
        resourcePrivileges: () => false,
        // Only explicitly provisioned public PKCE clients exist; all use the single first-party API resource.
        enforcePerClientResources: true,
        cachedTrustedClients: new Set(Object.keys(clients)),
        customIdTokenClaims: ({ user }) => claims(user),
        customAccessTokenClaims: ({ user }) => claims(user),
      }),
    ],
  });
}

/** Provision exact first-party callback URIs. This runs once per isolate before serving requests. */
const provisioned = new WeakSet<Env>();
export async function provisionClients(env: Env): Promise<void> {
  if (provisioned.has(env)) return;
  const db = drizzle(env.DB, { schema });
  const clients = JSON.parse(env.OIDC_CLIENTS) as Record<string, string>;
  if (Object.keys(clients).length === 0) throw new Error('At least one OIDC client is required');
  await db
    .update(schema.oauthClient)
    .set({ disabled: true })
    .where(notInArray(schema.oauthClient.clientId, Object.keys(clients)));
  const resourceId = 'be-music-api';
  await db
    .insert(schema.oauthResource)
    .values({
      id: resourceId,
      identifier: env.API_AUDIENCE,
      name: 'be-music API',
      allowedScopes: ['openid', 'profile', 'be-music:api'],
      accessTokenTtl: 900,
    })
    .onConflictDoNothing();
  for (const [clientId, origin] of Object.entries(clients)) {
    if (new URL(origin).origin !== origin || !origin.startsWith('https://'))
      throw new Error('Invalid OIDC client origin');
    const value = {
      id: clientId,
      clientId,
      disabled: false,
      name: clientId,
      redirectUris: [`${origin}/api/auth/callback`],
      tokenEndpointAuthMethod: 'none',
      applicationType: 'web',
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      scopes: ['openid', 'profile', 'be-music:api'],
      requirePKCE: true,
      skipConsent: true,
      subjectType: 'public',
    };
    await db
      .insert(schema.oauthClient)
      .values(value)
      .onConflictDoUpdate({ target: schema.oauthClient.clientId, set: value });
    await db
      .insert(schema.oauthClientResource)
      .values({ id: `${clientId}-api`, clientId, resourceId: env.API_AUDIENCE })
      .onConflictDoNothing();
  }
  provisioned.add(env);
}
