import { and, eq } from 'drizzle-orm';
import type { Env } from './env.ts';
import { openDatabase } from './db/client.ts';
import { oidcIdentity, profile } from './db/schema.ts';
import { updateProfile } from './profiles.ts';

/** Pull the authoritative public profile from Accounts; this never accepts caller-provided profile values. */
export async function syncAccountProfile(env: Env, subject: string, userId?: string): Promise<void> {
  if (!env.AUTH_ISSUER || !env.ACCOUNTS) return;
  const db = openDatabase(env.DB);
  if (!userId) {
    const mapping = await db.query.oidcIdentity.findFirst({
      where: and(eq(oidcIdentity.issuer, env.AUTH_ISSUER), eq(oidcIdentity.subject, subject)),
    });
    userId = mapping?.userId;
  }
  // A user who has never opened Leaderboard has no local projection to refresh yet.
  if (!userId) return;
  const url = new URL(`/api/profiles/${encodeURIComponent(subject)}`, env.AUTH_ISSUER);
  const response = await env.ACCOUNTS.fetch(new Request(url));
  if (!response.ok) throw new Error('Accounts profile unavailable');
  const value = (await response.json()) as { handle?: unknown; displayName?: unknown; avatarURL?: unknown };
  if (typeof value.handle !== 'string' || typeof value.displayName !== 'string' || typeof value.avatarURL !== 'string')
    throw new Error('Invalid Accounts profile');
  const avatar = new URL(value.avatarURL);
  if (avatar.origin !== url.origin || !avatar.pathname.startsWith('/profiles/'))
    throw new Error('Invalid Accounts avatar');
  const updated = await updateProfile(db, userId, { handle: value.handle, displayName: value.displayName });
  if (!updated.ok) throw new Error('Profile projection conflicts with Accounts');
  await db.update(profile).set({ avatarKey: avatar.href }).where(eq(profile.userId, userId));
}
