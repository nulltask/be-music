import { and, eq } from 'drizzle-orm';
import type { Env } from './auth.ts';
import { openDatabase } from './db/client.ts';
import { profileSync } from './schema.ts';

/** A durable outbox retries failed cross-service projection updates without rolling back an already saved profile. */
export async function publishProfile(env: Env, subject: string): Promise<void> {
  const db = openDatabase(env.DB);
  const revision = crypto.randomUUID();
  await db
    .insert(profileSync)
    .values({ userId: subject, revision })
    .onConflictDoUpdate({ target: profileSync.userId, set: { revision } });
  await retryProfiles(env);
}
export async function retryProfiles(env: Env): Promise<void> {
  if (!env.LEADERBOARD) return;
  const db = openDatabase(env.DB);
  const pending = await db.select().from(profileSync).limit(50);
  for (const row of pending) {
    try {
      await env.LEADERBOARD.syncProfile(row.userId);
      await db
        .delete(profileSync)
        .where(and(eq(profileSync.userId, row.userId), eq(profileSync.revision, row.revision)));
    } catch {
      // Keep this revision for the next scheduled retry. Do not log identities or request bodies.
    }
  }
}
