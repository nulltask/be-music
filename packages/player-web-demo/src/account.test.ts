import { describe, expect, test } from 'vite-plus/test';
import {
  describeAccountChip,
  describeLeaderboardAccount,
  describeProfileError,
  describeStartAccount,
  saveProfile,
  shouldTurnOnSubmitting,
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
      href: '/players/player-abc',
    });
    expect(describeAccountChip({ handle: 'a b', displayName: 'Player', anonymous: false, passkeys: 1 })).toMatchObject({
      state: 'signed-in',
      label: '@a b',
      href: '/players/a%20b',
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
      hint: 'Sign in through Accounts before submitting plays. You can start with a guest account.',
    });
  });

  test('offers to keep an anonymous account, or to sign in to another', () => {
    expect(
      describeStartAccount({ handle: 'player-abc', displayName: 'Anonymous', anonymous: true, passkeys: 0 }),
    ).toEqual({
      state: 'anonymous',
      label: '@player-abc · anonymous',
      href: '/players/player-abc',
      actions: ['keep', 'sign-in'],
      hint: 'This account lives only in this browser, and rankings leave it out. Keep it with a passkey to join them.',
    });
  });

  test('names a signed-in player and links their page', () => {
    expect(describeStartAccount({ handle: 'taro dj', displayName: 'Taro', anonymous: false, passkeys: 1 })).toEqual({
      state: 'signed-in',
      label: 'Taro @taro dj',
      href: '/players/taro%20dj',
      actions: ['sign-out'],
      hint: undefined,
    });
  });
});

describe('saveProfile', () => {
  test('patches the account and explains what the server refused', async () => {
    const sent: Array<{ url: string; init: RequestInit | undefined }> = [];
    const answer = (status: number, body: unknown) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({ url: String(input), init });
        return new Response(JSON.stringify(body), { status });
      }) as typeof fetch;
    expect(await saveProfile({ handle: 'taro_dj', displayName: 'Taro' }, answer(200, {}))).toEqual({ ok: true });
    expect(sent[0]).toMatchObject({ url: '/api/v0/me', init: { method: 'PATCH' } });
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ handle: 'taro_dj', displayName: 'Taro' });
    expect(await saveProfile({ handle: 'x', displayName: 'Taro' }, answer(409, { error: 'handle-taken' }))).toEqual({
      ok: false,
      error: 'That handle is taken.',
    });
  });
});

describe('describeProfileError', () => {
  test('names each refusal, and falls back to the code', () => {
    expect(describeProfileError('invalid-handle')).toBe('Handles are 3 to 15 letters, digits or _.');
    expect(describeProfileError('invalid-handle', 'reserved')).toBe('That handle is reserved. Pick another.');
    expect(describeProfileError('invalid-display-name', 'empty')).toBe('The name cannot be empty.');
    expect(describeProfileError('invalid-display-name', 'length')).toBe('Names are at most 32 characters.');
    expect(describeProfileError('invalid-display-name', 'control')).toBe(
      'Names cannot contain line breaks or control characters.',
    );
    expect(describeProfileError('http-500')).toBe('Something went wrong (http-500).');
  });
});

describe('shouldTurnOnSubmitting', () => {
  test('turns submitting on when the player arrives signed in or signs in', () => {
    expect(shouldTurnOnSubmitting(undefined, 'signed-in')).toBe(true);
    expect(shouldTurnOnSubmitting('signed-out', 'signed-in')).toBe(true);
    expect(shouldTurnOnSubmitting('anonymous', 'signed-in')).toBe(true);
  });

  test('leaves it alone on a re-read, and without a kept account', () => {
    expect(shouldTurnOnSubmitting('signed-in', 'signed-in')).toBe(false);
    expect(shouldTurnOnSubmitting(undefined, 'anonymous')).toBe(false);
    expect(shouldTurnOnSubmitting(undefined, 'signed-out')).toBe(false);
  });
});
