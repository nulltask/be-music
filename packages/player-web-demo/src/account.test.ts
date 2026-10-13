import { describe, expect, test } from 'vite-plus/test';
import {
  describeAccountChip,
  describeLeaderboardAccount,
  describeStartAccount,
  loadLeaderboardAccount,
} from './account.ts';

describe('describeLeaderboardAccount', () => {
  test('summarizes the session state', () => {
    expect(describeLeaderboardAccount(undefined)).toBe('Not signed in');
    expect(
      describeLeaderboardAccount({ handle: 'player-abc', displayName: 'Anonymous', anonymous: true, passkeys: 0 }),
    ).toBe('player-abc (anonymous)');
    expect(
      describeLeaderboardAccount({ handle: 'player-abc', displayName: 'Player', anonymous: false, passkeys: 1 }),
    ).toBe('Player @player-abc · 1 passkey');
    expect(describeLeaderboardAccount({ handle: 'p', displayName: 'Q', anonymous: false, passkeys: 2 })).toBe(
      'Q @p · 2 passkeys',
    );
  });
});

describe('loadLeaderboardAccount', () => {
  test('reads /api/v0/me, and reports no account without a session or a server', async () => {
    const account = { handle: 'h', displayName: 'D', anonymous: false, passkeys: 1 };
    const requested: string[] = [];
    const ok = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return String(input).endsWith('/get-session')
        ? new Response(JSON.stringify({ user: { id: 'u' } }))
        : new Response(JSON.stringify(account));
    }) as typeof fetch;
    const signedOut = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response('null');
    }) as typeof fetch;
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await loadLeaderboardAccount(ok)).toEqual(account);
    expect(requested.splice(0)).toEqual(['/api/auth/get-session', '/api/v0/me']);
    // Signed out: /me is never asked, so the browser logs no 401.
    expect(await loadLeaderboardAccount(signedOut)).toBeUndefined();
    expect(requested.splice(0)).toEqual(['/api/auth/get-session']);
    expect(await loadLeaderboardAccount(offline)).toBeUndefined();
  });
});

describe('describeAccountChip', () => {
  test('shows the sign-in state, linking to the player page when there is an account', () => {
    expect(describeAccountChip(undefined)).toMatchObject({
      state: 'signed-out',
      label: 'Not signed in',
      href: undefined,
    });
    expect(
      describeAccountChip({ handle: 'player-abc', displayName: 'Anonymous', anonymous: true, passkeys: 0 }),
    ).toMatchObject({
      state: 'anonymous',
      label: '@player-abc · anonymous',
      href: '/leaderboard/players/player-abc',
    });
    expect(describeAccountChip({ handle: 'a b', displayName: 'Player', anonymous: false, passkeys: 1 })).toMatchObject({
      state: 'signed-in',
      label: '@a b',
      href: '/leaderboard/players/a%20b',
    });
  });
});

describe('describeStartAccount', () => {
  test('offers sign-in and sign-up when signed out', () => {
    expect(describeStartAccount(undefined)).toEqual({
      state: 'signed-out',
      label: 'Not signed in',
      href: undefined,
      actions: ['sign-in', 'sign-up'],
    });
  });

  test('offers to keep an anonymous account, or to sign in to another', () => {
    expect(
      describeStartAccount({ handle: 'player-abc', displayName: 'Anonymous', anonymous: true, passkeys: 0 }),
    ).toEqual({
      state: 'anonymous',
      label: '@player-abc · anonymous',
      href: '/leaderboard/players/player-abc',
      actions: ['keep', 'sign-in'],
    });
  });

  test('names a signed-in player and links their page', () => {
    expect(describeStartAccount({ handle: 'taro dj', displayName: 'Taro', anonymous: false, passkeys: 1 })).toEqual({
      state: 'signed-in',
      label: 'Taro @taro dj',
      href: '/leaderboard/players/taro%20dj',
      actions: ['sign-out'],
    });
  });
});
