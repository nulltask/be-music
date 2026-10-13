import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';
import { anonymousClient } from 'better-auth/client/plugins';

/** The player's Leaderboard account as `GET /api/v0/me` reports it. */
export interface LeaderboardAccount {
  handle: string;
  displayName: string;
  anonymous: boolean;
  passkeys: number;
}

export type AccountActionResult = { ok: true } | { ok: false; error: string };

/**
 * Better Auth on the Leaderboard (same origin, `/api/auth`), with the anonymous and passkey plugins the server runs.
 * Created on first use so a player who never touches the Leaderboard never loads it.
 */
let client: ReturnType<typeof createClient> | undefined;

function createClient() {
  return createAuthClient({ plugins: [anonymousClient(), passkeyClient()] });
}

function authClient(): ReturnType<typeof createClient> {
  client ??= createClient();
  return client;
}

/**
 * The signed-in account, or `undefined` without a session (or when the Leaderboard cannot be reached). The session is
 * checked first (`null` when signed out), so a signed-out player never triggers a 401 the browser would log.
 */
export async function loadLeaderboardAccount(doFetch: typeof fetch = fetch): Promise<LeaderboardAccount | undefined> {
  try {
    const session = await doFetch('/api/auth/get-session', { credentials: 'same-origin' });
    if (!session.ok || (await session.json()) === null) return undefined;
    const response = await doFetch('/api/v0/me', { credentials: 'same-origin' });
    return response.ok ? ((await response.json()) as LeaderboardAccount) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Creates a passkey for this player's account, so it can be signed into again on any device. Without a session the
 * player gets an anonymous account first; the server makes the account non-anonymous once the passkey is registered.
 */
export async function createLeaderboardPasskey(): Promise<AccountActionResult> {
  const auth = authClient();
  const session = await auth.getSession();
  if (session.data === null) {
    const signIn = await auth.signIn.anonymous();
    if (signIn.error !== null) return { ok: false, error: describeError(signIn.error) };
  }
  const added = await auth.passkey.addPasskey({ name: 'be-music' });
  return added?.error ? { ok: false, error: describeError(added.error) } : { ok: true };
}

/**
 * Signs in with a passkey. An anonymous session on this device is linked into the passkey's account, so its plays move
 * there.
 */
export async function signInWithLeaderboardPasskey(): Promise<AccountActionResult> {
  const result = await authClient().signIn.passkey();
  return result?.error ? { ok: false, error: describeError(result.error) } : { ok: true };
}

export async function signOutOfLeaderboard(): Promise<AccountActionResult> {
  const result = await authClient().signOut();
  return result.error ? { ok: false, error: describeError(result.error) } : { ok: true };
}

/** One status-line summary of the account. */
export function describeLeaderboardAccount(account: LeaderboardAccount | undefined): string {
  if (account === undefined) return 'Not signed in';
  // Short enough for the Debug Menu row; the "Create passkey (keep this account)" button carries the hint.
  if (account.anonymous) return `${account.handle} (anonymous)`;
  return `${account.displayName} @${account.handle} · ${account.passkeys} passkey${account.passkeys === 1 ? '' : 's'}`;
}

function describeError(error: { message?: string; statusText?: string; status?: number }): string {
  return error.message || error.statusText || `HTTP ${error.status ?? '?'}`;
}

/** What the account chip on the select screens shows: the sign-in state at a glance. */
export interface AccountChip {
  state: 'signed-in' | 'anonymous' | 'signed-out';
  label: string;
  /** Longer explanation for the tooltip. */
  title: string;
  /** The player's Leaderboard page, when there is an account. */
  href: string | undefined;
}

export function describeAccountChip(account: LeaderboardAccount | undefined): AccountChip {
  if (account === undefined) {
    return {
      state: 'signed-out',
      label: 'Not signed in',
      title: 'Not signed in to the Leaderboard. Open the Debug Menu’s Leaderboard folder to sign in with a passkey.',
      href: undefined,
    };
  }
  const href = `/leaderboard/players/${encodeURIComponent(account.handle)}`;
  if (account.anonymous) {
    return {
      state: 'anonymous',
      label: `@${account.handle} · anonymous`,
      title: 'Signed in anonymously: create a passkey to keep this account and show its plays on the Leaderboard.',
      href,
    };
  }
  return {
    state: 'signed-in',
    label: `@${account.handle}`,
    title: `Signed in as ${account.displayName} (@${account.handle}). Opens your Leaderboard page.`,
    href,
  };
}

/** An action the start card offers for the account. */
export type StartAccountAction = 'sign-in' | 'sign-up' | 'keep' | 'sign-out';

/** What the start card's Leaderboard row shows: who the plays go to, and what the player can do about it. */
export interface StartAccountView {
  state: AccountChip['state'];
  label: string;
  /** The player's Leaderboard page, when there is an account. */
  href: string | undefined;
  actions: StartAccountAction[];
}

/** The button text of each start card action. */
export const START_ACCOUNT_ACTION_LABELS: Readonly<Record<StartAccountAction, string>> = {
  'sign-in': 'Sign in',
  'sign-up': 'Sign up',
  keep: 'Keep this account',
  'sign-out': 'Sign out',
};

/**
 * The start card's account row. Signed out: sign in with a passkey, or sign up (an account kept by a new passkey).
 * Anonymous (the first submitted play made the account): keep it with a passkey, or sign in to another one, which takes
 * this browser's plays along. Signed in: the player's page and signing out.
 */
export function describeStartAccount(account: LeaderboardAccount | undefined): StartAccountView {
  if (account === undefined) {
    return { state: 'signed-out', label: 'Not signed in', href: undefined, actions: ['sign-in', 'sign-up'] };
  }
  const href = `/leaderboard/players/${encodeURIComponent(account.handle)}`;
  if (account.anonymous) {
    return { state: 'anonymous', label: `@${account.handle} · anonymous`, href, actions: ['keep', 'sign-in'] };
  }
  return { state: 'signed-in', label: `${account.displayName} @${account.handle}`, href, actions: ['sign-out'] };
}
