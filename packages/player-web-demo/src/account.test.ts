import { describe, expect, test } from 'vite-plus/test';
import { describeLeaderboardAccount, loadLeaderboardAccount } from './account.ts';

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
  test('reads /api/v1/me, and reports no account without a session or a server', async () => {
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
    expect(requested.splice(0)).toEqual(['/api/auth/get-session', '/api/v1/me']);
    // Signed out: /me is never asked, so the browser logs no 401.
    expect(await loadLeaderboardAccount(signedOut)).toBeUndefined();
    expect(requested.splice(0)).toEqual(['/api/auth/get-session']);
    expect(await loadLeaderboardAccount(offline)).toBeUndefined();
  });
});
