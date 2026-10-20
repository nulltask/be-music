/** Local ranking projection. Accounts owns profile edits in OIDC deployments. */
import { and, eq, ne } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { handleHistory, profile } from './db/schema.ts';

const HANDLE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const HANDLE_ATTEMPTS = 5;

/** Handles: letters, digits and `_`, 3 to 15 characters, case-insensitive (stored in lower case). */
const HANDLE_PATTERN = /^[A-Za-z0-9_]{3,15}$/;
export const DISPLAY_NAME_MAX = 32;

/** Handles nobody can take: they name the site, its pages, or look official. */
const RESERVED_HANDLES = new Set([
  'admin',
  'administrator',
  'anonymous',
  'api',
  'be_music',
  'bemusic',
  'chart',
  'charts',
  'chartset',
  'chartsets',
  'help',
  'leaderboard',
  'me',
  'mod',
  'moderator',
  'null',
  'official',
  'player',
  'players',
  'root',
  'score',
  'scores',
  'settings',
  'staff',
  'support',
  'system',
  'undefined',
]);

/** A random handle (`player_` and eight lowercase letters or digits) until the player picks one. */
export function generateHandle(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(8))): string {
  let suffix = '';
  for (const byte of bytes) suffix += HANDLE_ALPHABET[byte % HANDLE_ALPHABET.length];
  return `player_${suffix}`;
}

export type HandleCheck = { ok: true; handle: string } | { ok: false; reason: 'format' | 'reserved' };

/** Checks a handle the player typed and gives its stored form (lower case). */
export function normalizeHandle(input: string): HandleCheck {
  const handle = input.trim();
  if (!HANDLE_PATTERN.test(handle)) return { ok: false, reason: 'format' };
  const lower = handle.toLowerCase();
  if (RESERVED_HANDLES.has(lower)) return { ok: false, reason: 'reserved' };
  return { ok: true, handle: lower };
}

export type DisplayNameCheck =
  | { ok: true; displayName: string }
  | { ok: false; reason: 'empty' | 'length' | 'characters' };

/**
 * Line breaks, other control characters and the bidirectional controls that can disguise a name (U+202A–U+202E,
 * U+2066–U+2069, U+200E, U+200F, U+061C).
 */
const FORBIDDEN_IN_NAME = /[\p{Cc}\p{Zl}\p{Zp}‪-‮⁦-⁩‎‏؜]/u;

/** Checks a display name: 1 to 32 characters (code points) after trimming, Japanese and other scripts welcome. */
export function normalizeDisplayName(input: string): DisplayNameCheck {
  const displayName = input.normalize('NFC').trim();
  if (displayName.length === 0) return { ok: false, reason: 'empty' };
  if (FORBIDDEN_IN_NAME.test(displayName)) return { ok: false, reason: 'characters' };
  if ([...displayName].length > DISPLAY_NAME_MAX) return { ok: false, reason: 'length' };
  return { ok: true, displayName };
}

/**
 * Creates the public profile of a new account with a generated handle (retrying on the rare collision). OAuth profile
 * names are never copied in; the player names themselves later.
 */
export async function createProfile(db: Database, userId: string, isAnonymous: boolean): Promise<void> {
  const existing = await db.query.profile.findFirst({ where: eq(profile.userId, userId), columns: { userId: true } });
  if (existing !== undefined) return;
  for (let attempt = 0; attempt < HANDLE_ATTEMPTS; attempt += 1) {
    const handle = generateHandle();
    if (await isHandleTaken(db, handle, userId)) continue;
    const inserted = await db
      .insert(profile)
      .values({ userId, handle, displayName: isAnonymous ? 'Anonymous' : 'Player' })
      .onConflictDoNothing()
      .returning({ userId: profile.userId });
    if (inserted.length > 0) return;
    // Concurrent first requests may have inserted this player's profile with another generated handle.
    if (await db.query.profile.findFirst({ where: eq(profile.userId, userId), columns: { userId: true } })) return;
  }
  throw new Error('could not generate a unique handle');
}

/** Whether another account holds `handle`, now or as one of its former handles. */
async function isHandleTaken(db: Database, handle: string, userId: string): Promise<boolean> {
  const current = await db.query.profile.findFirst({
    where: and(eq(profile.handle, handle), ne(profile.userId, userId)),
    columns: { userId: true },
  });
  if (current !== undefined) return true;
  const former = await db.query.handleHistory.findFirst({
    where: and(eq(handleHistory.handle, handle), ne(handleHistory.userId, userId)),
    columns: { userId: true },
  });
  return former !== undefined;
}

export type ProfileUpdate = { handle?: string; displayName?: string };
export type ProfileUpdateResult =
  | { ok: true }
  | { ok: false; status: 400; error: 'invalid-handle' | 'invalid-display-name'; detail: string }
  | { ok: false; status: 404; error: 'not-found' }
  | { ok: false; status: 409; error: 'handle-taken' };

/**
 * Changes a player's handle and display name. The old handle is kept in `handle_history`: still reserved for the
 * player, and its pages redirect to the new one. Taking back a former handle of one's own removes it from the history.
 */
export async function updateProfile(db: Database, userId: string, update: ProfileUpdate): Promise<ProfileUpdateResult> {
  const current = await db.query.profile.findFirst({ where: eq(profile.userId, userId) });
  if (current === undefined) return { ok: false, status: 404, error: 'not-found' };
  const changes: { handle?: string; displayName?: string } = {};
  if (update.handle !== undefined) {
    const checked = normalizeHandle(update.handle);
    if (!checked.ok) return { ok: false, status: 400, error: 'invalid-handle', detail: checked.reason };
    if (checked.handle !== current.handle) {
      if (await isHandleTaken(db, checked.handle, userId)) return { ok: false, status: 409, error: 'handle-taken' };
      changes.handle = checked.handle;
    }
  }
  if (update.displayName !== undefined) {
    const checked = normalizeDisplayName(update.displayName);
    if (!checked.ok) return { ok: false, status: 400, error: 'invalid-display-name', detail: checked.reason };
    changes.displayName = checked.displayName;
  }
  if (changes.handle === undefined && changes.displayName === undefined) return { ok: true };
  const newHandle = changes.handle;
  if (newHandle === undefined) {
    await db.update(profile).set(changes).where(eq(profile.userId, userId));
    return { ok: true };
  }
  try {
    await db.batch([
      db.insert(handleHistory).values({ handle: current.handle, userId }).onConflictDoNothing(),
      db.delete(handleHistory).where(and(eq(handleHistory.handle, newHandle), eq(handleHistory.userId, userId))),
      db.update(profile).set(changes).where(eq(profile.userId, userId)),
    ]);
  } catch (error) {
    // Another account took the handle between the check and the write (the unique index refused it).
    if (String(error).includes('UNIQUE')) return { ok: false, status: 409, error: 'handle-taken' };
    throw error;
  }
  return { ok: true };
}

/** The current handle of whoever used `handle` before, for redirecting old player URLs. */
export async function resolveFormerHandle(db: Database, handle: string): Promise<string | undefined> {
  const [row] = await db
    .select({ handle: profile.handle })
    .from(handleHistory)
    .innerJoin(profile, eq(profile.userId, handleHistory.userId))
    .where(eq(handleHistory.handle, handle.toLowerCase()));
  return row?.handle;
}
