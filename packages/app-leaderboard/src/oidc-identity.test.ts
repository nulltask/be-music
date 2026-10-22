import { afterAll, beforeAll, describe, expect, test, vi } from 'vite-plus/test';
import { eq, count } from 'drizzle-orm';
import { startTestBindings } from './test-support/support.ts';
import { syncIdentity, loadSession, oidcEnv } from './auth.ts';
import { openDatabase } from './db/client.ts';
import { oidcIdentity, profile, user } from './db/schema.ts';
import type { Env } from './env.ts';
let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});
afterAll(async () => {
  await dispose();
});
describe('OIDC player identities', () => {
  test('requires complete explicit OIDC configuration', () => {
    expect(() => oidcEnv(env)).toThrow('Incomplete OIDC configuration');
    const values = {
      AUTH_ISSUER: 'https://accounts.example/api/auth',
      PUBLIC_ORIGIN: 'https://leaderboard.example',
      OIDC_CLIENT_ID: 'leaderboard',
      SESSION_SECRET: 'session-secret-with-at-least-32-characters',
      API_AUDIENCE: 'https://leaderboard.example',
    };
    expect(oidcEnv({ ...env, ...values })).toEqual(values);
  });
  test('uses issuer and subject, keeps the profile, and updates anonymous/passkey metadata', async () => {
    const identity = {
      issuer: 'https://accounts.example/api/auth',
      sub: 'same-subject',
      name: 'External Name',
      anonymous: true,
    };
    const id = await syncIdentity(env, identity);
    const db = openDatabase(env.DB);
    await db.update(profile).set({ displayName: 'Chosen Name' }).where(eq(profile.userId, id));
    expect(await syncIdentity(env, { ...identity, anonymous: false, passkeys: 2 })).toBe(id);
    expect((await db.query.profile.findFirst({ where: eq(profile.userId, id) }))?.displayName).toBe('Chosen Name');
    expect((await db.query.user.findFirst({ where: eq(user.id, id) }))?.isAnonymous).toBe(false);
    expect((await db.query.user.findFirst({ where: eq(user.id, id) }))?.passkeyCount).toBe(2);
    expect(await syncIdentity(env, { ...identity, issuer: 'https://other.example/api/auth' })).not.toBe(id);
  });
  test('concurrent first requests converge on one player and one profile', async () => {
    const identity = {
      issuer: 'https://accounts.example/api/auth',
      sub: 'concurrent-user',
      name: 'Player',
      anonymous: true,
    };
    const ids = await Promise.all(Array.from({ length: 4 }, () => syncIdentity(env, identity)));
    expect(new Set(ids).size).toBe(1);
    const rows = await openDatabase(env.DB).select({ n: count() }).from(profile).where(eq(profile.userId, ids[0]));
    expect(rows[0].n).toBe(1);
  });
  test('keeps a migrated local player ID', async () => {
    const db = openDatabase(env.DB);
    await db.insert(user).values({ id: 'legacy-player', name: 'Player', email: 'legacy@example.invalid' });
    await db
      .insert(oidcIdentity)
      .values({ issuer: 'https://accounts.example/api/auth', subject: 'legacy-player', userId: 'legacy-player' });
    expect(
      await syncIdentity(env, {
        issuer: 'https://accounts.example/api/auth',
        sub: 'legacy-player',
        name: 'New name',
        anonymous: false,
      }),
    ).toBe('legacy-player');
  });
  test('retargets linked guests idempotently and keeps their mapping as a tombstone', async () => {
    const db = openDatabase(env.DB);
    const issuer = 'https://accounts.example/api/auth';
    const guest = await syncIdentity(env, { issuer, sub: 'guest-to-link', name: 'Guest', anonymous: true });
    const identity = {
      issuer,
      sub: 'registered-target',
      name: 'Player',
      anonymous: false,
      linkedGuests: ['guest-to-link'],
    };
    const target = await syncIdentity(env, identity);
    expect(await syncIdentity(env, identity)).toBe(target);
    expect(await db.query.user.findFirst({ where: eq(user.id, guest) })).toBeUndefined();
    const mapping = await db.query.oidcIdentity.findFirst({ where: eq(oidcIdentity.subject, 'guest-to-link') });
    expect(mapping?.userId).toBe(target);
    expect((await db.select({ n: count() }).from(profile).where(eq(profile.userId, target)))[0].n).toBe(1);
  });
  test('does not accept legacy shared cookies on a public host without OIDC configured', async () => {
    expect(
      (
        await loadSession(
          env,
          new Request('https://leaderboard.example/api/v0/me', {
            headers: { cookie: 'better-auth.session_token=forged' },
          }),
        )
      ).session,
    ).toBeNull();
  });
});

test('refreshes the local public projection from Accounts', async () => {
  const issuer = 'https://accounts.example/api/auth';
  const settings = {
    ...env,
    AUTH_ISSUER: issuer,
    ACCOUNTS: {
      fetch: async () =>
        Response.json({
          handle: 'central_profile',
          displayName: 'Central Name',
          avatarURL: 'https://accounts.example/profiles/central_profile/avatar?v=g',
        }),
    },
  };
  const id = await syncIdentity(settings, { issuer, sub: 'central-profile', name: 'Ignored', anonymous: true });
  const row = await openDatabase(env.DB).query.profile.findFirst({ where: eq(profile.userId, id) });
  expect(row?.displayName).toBe('Central Name');
  expect(row?.handle).toBe('central_profile');
  expect(row?.avatarKey).toBe('https://accounts.example/profiles/central_profile/avatar?v=g');
  const bad = {
    ...settings,
    ACCOUNTS: {
      fetch: async () =>
        Response.json({ handle: 'central_profile', displayName: 'Forged', avatarURL: 'https://evil.example/avatar' }),
    },
  };
  await expect(syncIdentity(bad, { issuer, sub: 'central-profile', name: 'Ignored', anonymous: true })).rejects.toThrow(
    'Invalid Accounts avatar',
  );
});

test('pulls profiles over HTTPS when no Accounts binding is configured', async () => {
  const issuer = 'https://accounts.example/api/auth';
  const fetchProfile = vi.fn(async (request: Request) => {
    expect(request.url).toBe('https://accounts.example/api/profiles/https-profile');
    expect(request.headers.get('authorization')).toBeNull();
    return Response.json({
      handle: 'https_profile',
      displayName: 'HTTPS Profile',
      avatarURL: 'https://accounts.example/profiles/https_profile/avatar?v=g',
    });
  });
  vi.stubGlobal('fetch', fetchProfile);
  try {
    const id = await syncIdentity(
      { ...env, AUTH_ISSUER: issuer },
      {
        issuer,
        sub: 'https-profile',
        name: 'Old name',
        anonymous: false,
      },
    );
    const row = await openDatabase(env.DB).query.profile.findFirst({ where: eq(profile.userId, id) });
    expect(row?.displayName).toBe('HTTPS Profile');
    expect(fetchProfile).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});
