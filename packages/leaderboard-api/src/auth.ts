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
 * Better Auth for one request (docs/leaderboard.md section 3). D1 and the secrets are only reachable per request on
 * Workers, so the instance is built per request; the cost is a few object allocations. Discord and Google sign-in are
 * enabled only when their secrets are configured, so local runs and tests work with anonymous sessions alone.
 */
export function createAuth(env: Env, origin: string) {
  const db = drizzle(env.DB, { schema });
  const socialProviders: Parameters<typeof betterAuth>[0]['socialProviders'] = {};
  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
    socialProviders.discord = { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET };
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  return betterAuth({
    baseURL: origin,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
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
    plugins: [
      anonymous({
        // Runs before the anonymous user is deleted, so its plays move instead of cascading away.
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await reassignScores(db, anonymousUser.user.id, newUser.user.id);
        },
      }),
      passkey({ rpID: new URL(origin).hostname, rpName: 'be-music', origin }),
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

export type Auth = ReturnType<typeof createAuth>;
