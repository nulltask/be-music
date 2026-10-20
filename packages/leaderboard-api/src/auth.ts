import { handleAuth, readSession, verifyAccess, type Identity, type OIDCEnv } from '@be-music/auth-client';
import { and, eq } from 'drizzle-orm';
import type { Env } from './env.ts';
import { loadSession as loadLegacySession } from './legacy-auth.ts';
import { openDatabase } from './db/client.ts';
import { oidcIdentity, user } from './db/schema.ts';
import { syncAccountProfile } from './profile-sync.ts';
import { claimAccount } from './accounts.ts';
import { createProfile } from './profiles.ts';
import { reassignScores } from './scores/reassign.ts';
export { createAuth, authSettings, hasSessionCookie, passOnSetCookies } from './legacy-auth.ts';

export function oidcEnv(env: Env): OIDCEnv {
  if (!env.AUTH_ISSUER || !env.PUBLIC_ORIGIN || !env.OIDC_CLIENT_ID || !env.SESSION_SECRET || !env.API_AUDIENCE)
    throw new Error('Incomplete OIDC configuration');
  return {
    AUTH_ISSUER: env.AUTH_ISSUER,
    PUBLIC_ORIGIN: env.PUBLIC_ORIGIN,
    OIDC_CLIENT_ID: env.OIDC_CLIENT_ID,
    SESSION_SECRET: env.SESSION_SECRET,
    API_AUDIENCE: env.API_AUDIENCE,
  };
}
export async function oidcAuth(request: Request, env: Env): Promise<Response | null> {
  return handleAuth(request, oidcEnv(env));
}

/** The identity mapping, not email, connects an issuer/subject to a local player. */
export async function syncIdentity(env: Env, identity: Identity): Promise<string> {
  const db = openDatabase(env.DB);
  let mapped = await db.query.oidcIdentity.findFirst({
    where: and(eq(oidcIdentity.issuer, identity.issuer), eq(oidcIdentity.subject, identity.sub)),
  });
  if (!mapped) {
    // Use one deterministic namespaced ID so concurrent first requests cannot create duplicate mirror accounts.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify([identity.issuer, identity.sub])),
    );
    const id = `oidc_${Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')}`;
    await db.batch([
      db
        .insert(user)
        .values({
          id,
          name: 'Player',
          email: `${id}@identity.invalid`,
          emailVerified: false,
          isAnonymous: identity.anonymous,
        })
        .onConflictDoNothing(),
      db
        .insert(oidcIdentity)
        .values({ issuer: identity.issuer, subject: identity.sub, userId: id })
        .onConflictDoNothing(),
    ]);
    mapped = await db.query.oidcIdentity.findFirst({
      where: and(eq(oidcIdentity.issuer, identity.issuer), eq(oidcIdentity.subject, identity.sub)),
    });
  }
  if (!mapped) throw new Error('Identity synchronization failed');
  const previous = await db.query.user.findFirst({ where: eq(user.id, mapped.userId) });
  if (previous?.isAnonymous && !identity.anonymous) await claimAccount(db, mapped.userId);
  await db
    .update(user)
    .set({ isAnonymous: identity.anonymous, passkeyCount: identity.passkeys ?? 0 })
    .where(eq(user.id, mapped.userId));
  await createProfile(db, mapped.userId, identity.anonymous);
  for (const subject of identity.linkedGuests ?? []) {
    const guest = await db.query.oidcIdentity.findFirst({
      where: and(eq(oidcIdentity.issuer, identity.issuer), eq(oidcIdentity.subject, subject)),
    });
    if (!guest || guest.userId === mapped.userId) continue;
    const account = await db.query.user.findFirst({ where: eq(user.id, guest.userId) });
    if (account?.isAnonymous !== true) continue;
    await reassignScores(db, guest.userId, mapped.userId);
    // Keep the mapping as a tombstone: an old guest token must never recreate the same account.
    await db
      .update(oidcIdentity)
      .set({ userId: mapped.userId })
      .where(and(eq(oidcIdentity.issuer, identity.issuer), eq(oidcIdentity.subject, subject)));
    await db.delete(user).where(eq(user.id, guest.userId));
  }
  await syncAccountProfile(env, identity.sub, mapped.userId);
  return mapped.userId;
}

export async function loadSession(env: Env, request: Request) {
  if (!env.AUTH_ISSUER) {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname))
      return { session: null, setCookies: [] };
    return loadLegacySession(env, request);
  }
  const settings = oidcEnv(env);
  const identity = request.headers.has('authorization')
    ? await verifyAccess(request, settings)
    : (await readSession(request, settings))?.identity;
  if (!identity) return { session: null, setCookies: [] };
  // A guest token that has been linked is no longer authorized, even while its JWT is otherwise valid.
  const db = openDatabase(env.DB);
  const old = await db.query.oidcIdentity.findFirst({
    where: and(eq(oidcIdentity.issuer, identity.issuer), eq(oidcIdentity.subject, identity.sub)),
  });
  if (old && identity.anonymous) {
    const account = await db.query.user.findFirst({ where: eq(user.id, old.userId) });
    if (account?.isAnonymous === false) return { session: null, setCookies: [] };
  }
  const userId = await syncIdentity(env, identity);
  return { session: { user: { id: userId, name: identity.name, isAnonymous: identity.anonymous } }, setCookies: [] };
}
