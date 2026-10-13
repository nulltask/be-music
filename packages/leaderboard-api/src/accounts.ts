import { and, count, eq } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { passkey, profile, user } from './db/schema.ts';

/** The signed-in player's own view of their account (`GET /api/v1/me`). */
export interface AccountSummary {
  handle: string;
  displayName: string;
  /** True until the account has a way back in (a passkey, or later a Discord / Google sign-in). */
  anonymous: boolean;
  passkeys: number;
}

export async function loadAccount(db: Database, userId: string): Promise<AccountSummary | undefined> {
  const [row] = await db
    .select({ handle: profile.handle, displayName: profile.displayName, anonymous: user.isAnonymous })
    .from(user)
    .innerJoin(profile, eq(profile.userId, user.id))
    .where(eq(user.id, userId));
  if (row === undefined) return undefined;
  const [{ passkeys }] = await db.select({ passkeys: count() }).from(passkey).where(eq(passkey.userId, userId));
  return { handle: row.handle, displayName: row.displayName, anonymous: row.anonymous === true, passkeys };
}

/**
 * Turns an anonymous account into a regular one once it has a passkey: the player can now sign back in on any device,
 * so its plays are listed under its handle like everyone else's instead of behind the "anonymous" filter. The display
 * name generated for anonymous accounts becomes the regular default; a name the player chose is kept.
 */
export async function claimAccount(db: Database, userId: string): Promise<void> {
  await db.batch([
    db.update(user).set({ isAnonymous: false }).where(eq(user.id, userId)),
    db
      .update(profile)
      .set({ displayName: 'Player' })
      .where(and(eq(profile.userId, userId), eq(profile.displayName, 'Anonymous'))),
  ]);
}
