import { eq } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { profile } from './db/schema.ts';

const HANDLE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const HANDLE_ATTEMPTS = 5;

/** A random handle (`player-` and eight lowercase letters or digits) until the player picks one. */
export function generateHandle(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(8))): string {
  let suffix = '';
  for (const byte of bytes) suffix += HANDLE_ALPHABET[byte % HANDLE_ALPHABET.length];
  return `player-${suffix}`;
}

/**
 * Creates the public profile of a new account with a generated handle (retrying on the rare collision). OAuth profile
 * names are never copied in; the player names themselves later.
 */
export async function createProfile(db: Database, userId: string, isAnonymous: boolean): Promise<void> {
  const existing = await db.query.profile.findFirst({ where: eq(profile.userId, userId), columns: { userId: true } });
  if (existing !== undefined) return;
  for (let attempt = 0; attempt < HANDLE_ATTEMPTS; attempt += 1) {
    const inserted = await db
      .insert(profile)
      .values({ userId, handle: generateHandle(), displayName: isAnonymous ? 'Anonymous' : 'Player' })
      .onConflictDoNothing({ target: profile.handle })
      .returning({ userId: profile.userId });
    if (inserted.length > 0) return;
  }
  throw new Error('could not generate a unique handle');
}
