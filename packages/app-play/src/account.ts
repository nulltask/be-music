/** The player's Leaderboard account as `GET /api/v0/me` reports it. */
export interface LeaderboardAccount {
  handle: string;
  displayName: string;
  anonymous: boolean;
  passkeys: number;
}

export type AccountActionResult = { ok: true } | { ok: false; error: string };

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

/** Open Accounts to manage the shared account and enroll passkeys on the correct relying-party origin. */
export async function createLeaderboardPasskey(): Promise<AccountActionResult> {
  location.assign('/api/auth/manage');
  return { ok: true };
}

/** Google or Discord. A passkey stays a separate click because WebAuthn needs the Accounts origin. */
export type AccountProvider = 'google' | 'discord';

/**
 * Accounts sign-in for this page. `method` asks Accounts to start Google or Discord; omitted, the
 * login page offers a passkey, as {@link signInWithLeaderboardPasskey} does.
 */
export function accountSignInPath(returnTo: string, method?: AccountProvider): string {
  const params = new URLSearchParams();
  if (returnTo !== '') params.set('returnTo', returnTo);
  if (method !== undefined) params.set('method', method);
  const query = params.toString();
  return query === '' ? '/api/auth/sign-in' : `/api/auth/sign-in?${query}`;
}

/** The provider a sign-in or sign-up button names, if it is Google or Discord. */
export function accountProviderFromAction(action: string | undefined): AccountProvider | undefined {
  if (action === 'sign-in-google' || action === 'sign-up-google') return 'google';
  if (action === 'sign-in-discord' || action === 'sign-up-discord') return 'discord';
  return undefined;
}

/** Open Accounts to sign in; the OIDC callback returns to this player. */
export async function signInWithLeaderboardPasskey(): Promise<AccountActionResult> {
  location.assign(accountSignInPath(`${location.pathname}${location.search}`));
  return { ok: true };
}

/** Open Accounts and start Google or Discord. The session and return path match a passkey sign-in. */
export async function signInWithAccountProvider(method: AccountProvider): Promise<AccountActionResult> {
  location.assign(accountSignInPath(`${location.pathname}${location.search}`, method));
  return { ok: true };
}

/** The handle and name a new account is made with. */
export interface SignUpDetails {
  handle: string;
  displayName: string;
}

/** Save a signed-in player's profile when possible, then open the central Accounts sign-in. */
export async function signUpForLeaderboard(
  details: SignUpDetails,
  doFetch: typeof fetch = fetch,
): Promise<AccountActionResult> {
  const saved = await saveProfile(details, doFetch);
  if (!saved.ok && saved.error !== 'Sign in first.') return saved;
  location.assign('/api/auth/sign-in');
  return { ok: true };
}

/** Saves the handle and name of the signed-in account (`PATCH /api/v0/me`). */
export async function saveProfile(details: SignUpDetails, doFetch: typeof fetch = fetch): Promise<AccountActionResult> {
  const response = await doFetch('/api/v0/me', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(details),
  });
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
  return { ok: false, error: describeProfileError(body.error ?? `http-${response.status}`, body.detail) };
}

/** A message for an error the account API answered when saving a handle and name (`{ error, detail? }`). */
export function describeProfileError(error: string, detail?: string): string {
  switch (error) {
    case 'invalid-handle':
      return detail === 'reserved'
        ? 'That handle is reserved. Pick another.'
        : 'Handles are 3 to 15 letters, digits or _.';
    case 'invalid-display-name':
      if (detail === 'empty') return 'The name cannot be empty.';
      if (detail === 'length') return 'Names are at most 32 characters.';
      return 'Names cannot contain line breaks or control characters.';
    case 'handle-taken':
      return 'That handle is taken.';
    case 'sign-in-required':
      return 'Sign in first.';
    default:
      return `Something went wrong (${error}).`;
  }
}

export async function signOutOfLeaderboard(): Promise<AccountActionResult> {
  const response = await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' });
  return response.ok ? { ok: true } : { ok: false, error: 'Could not sign out.' };
}

/** One status-line summary of the account. */
export function describeLeaderboardAccount(account: LeaderboardAccount | undefined): string {
  if (account === undefined) return 'Not signed in';
  // Short enough for the Debug Menu row; the "Create passkey (keep this account)" button carries the hint.
  if (account.anonymous) return `${account.handle} (anonymous)`;
  return `${account.displayName} @${account.handle} · ${account.passkeys} passkey${account.passkeys === 1 ? '' : 's'}`;
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
  const href = `/players/${encodeURIComponent(account.handle)}`;
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
  /**
   * Where submitted plays go when that is not plain from the label: without an account, to an anonymous one this
   * browser makes on the first submission, which the rankings leave out. Undefined when signed in.
   */
  hint: string | undefined;
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
    return {
      state: 'signed-out',
      label: 'Not signed in',
      href: undefined,
      actions: ['sign-in', 'sign-up'],
      hint: 'Sign in through Accounts before submitting plays. You can start with a guest account.',
    };
  }
  const href = `/players/${encodeURIComponent(account.handle)}`;
  if (account.anonymous) {
    return {
      state: 'anonymous',
      label: `@${account.handle} · anonymous`,
      href,
      actions: ['keep', 'sign-in', 'sign-out'],
      hint: 'This account lives only in this browser, and rankings leave it out. Keep it with a passkey to join them.',
    };
  }
  return {
    state: 'signed-in',
    label: `${account.displayName} @${account.handle}`,
    href,
    actions: ['sign-out'],
    hint: undefined,
  };
}

/**
 * Whether submitting should turn on: when the player arrives signed in, or signs in, to a kept account — not on every
 * re-read of an account already shown as signed in, so unticking it during a session sticks.
 */
export function shouldTurnOnSubmitting(
  previous: AccountChip['state'] | undefined,
  next: AccountChip['state'],
): boolean {
  return next === 'signed-in' && previous !== 'signed-in';
}
