// Sign-in in the default browser (README.md, "Signing in"). Identity providers such as Google refuse embedded
// browsers, so the window hands the Accounts login to the default browser. Accounts sends the browser back to the app
// through its URL scheme with a single-use code bound to the challenge of a verifier only the app knows; the app
// redeems the code for an Accounts session of its own and runs the player's sign-in again in the window.
import { createHash, randomBytes } from 'node:crypto';
import { ISSUER_HOSTS, isSameOrigin } from './navigation.ts';

/** The URL scheme the app registers; Accounts returns to `be-music-play://sign-in?code=…&state=…`. */
export const DESKTOP_SCHEME = 'be-music-play';
/** How long the app waits for the browser to come back. */
export const PENDING_SIGN_IN_MS = 10 * 60_000;

/** A sign-in the app sent to the browser and waits for. */
export interface PendingSignIn {
  state: string;
  verifier: string;
  challenge: string;
  /** The Accounts origin whose login page the window was sent to. */
  issuerOrigin: string;
  /** The player page to show again after signing in. */
  returnTo: string;
  startedAt: number;
}

function base64URL(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** The S256 challenge of `verifier`, as in PKCE (RFC 7636). */
export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Starts a sign-in with a fresh state and verifier. */
export function createPendingSignIn(
  issuerOrigin: string,
  returnTo: string,
  now: number,
  random: (size: number) => Uint8Array = randomBytes,
): PendingSignIn {
  const verifier = base64URL(random(32));
  return {
    state: base64URL(random(16)),
    verifier,
    challenge: challengeOf(verifier),
    issuerOrigin,
    returnTo,
    startedAt: now,
  };
}

/** The Accounts origin when `url` is its login page, which the app opens in the browser instead; else `null`. */
export function accountsLoginOrigin(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === 'https:' && ISSUER_HOSTS.has(parsed.hostname) && parsed.pathname === '/login'
    ? parsed.origin
    : null;
}

/**
 * The login page's parameter that starts Google or Discord at once (`@be-music/service-auth-client`'s
 * `SOCIAL_SIGN_IN_PARAM`), set when the player's Google or Discord button started the sign-in.
 */
const SOCIAL_SIGN_IN_PARAM = 'sign_in_method';

/**
 * The page the browser opens to sign in for the app. The provider `loginURL` asks for, Google or Discord, goes along,
 * so the browser starts it as the window would have.
 */
export function browserSignInURL(pending: PendingSignIn, loginURL?: string): string {
  const url = new URL('/desktop/sign-in', pending.issuerOrigin);
  url.searchParams.set('state', pending.state);
  url.searchParams.set('challenge', pending.challenge);
  const method = loginURL === undefined ? null : new URL(loginURL).searchParams.get(SOCIAL_SIGN_IN_PARAM);
  if (method === 'google' || method === 'discord') {
    url.searchParams.set(SOCIAL_SIGN_IN_PARAM, method);
  }
  return url.href;
}

/** The endpoint that redeems a code for the app's Accounts session. */
export function redeemURL(pending: PendingSignIn): string {
  return new URL('/api/auth/desktop-sign-in/redeem', pending.issuerOrigin).href;
}

/**
 * The redemption request for `code`. It names Accounts as its `Origin`: the window's session can hold Accounts
 * cookies from the player's sign-in redirects, and Accounts refuses a POST with cookies but no trusted origin
 * (Better Auth's CSRF check). The main process sends no `Origin` of its own.
 */
export function redeemRequest(pending: PendingSignIn, code: string): { url: string; init: RequestInit } {
  return {
    url: redeemURL(pending),
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: pending.issuerOrigin },
      body: JSON.stringify({ code, verifier: pending.verifier }),
      credentials: 'include',
    },
  };
}

/** The Accounts session cookie (Better Auth's `session_token` under Accounts' cookie prefix, on HTTPS). */
export const ACCOUNTS_SESSION_COOKIE = '__Secure-be-music-accounts.session_token';

/** Whether a finished request is the player's successful sign-out (`POST /api/auth/sign-out`). */
export function isPlayerSignOut(
  request: { url: string; method: string; statusCode: number },
  playOrigin: string,
): boolean {
  if (request.method !== 'POST' || !isSameOrigin(request.url, playOrigin)) {
    return false;
  }
  // The player signs out with `fetch` (200); a native form returns to a page (303).
  return (
    new URL(request.url).pathname === '/api/auth/sign-out' && (request.statusCode === 200 || request.statusCode === 303)
  );
}

/** The request that ends the app's Accounts session at `issuerOrigin`, naming Accounts as its origin as redeeming does. */
export function accountsSignOutRequest(issuerOrigin: string): { url: string; init: RequestInit } {
  return {
    url: new URL('/api/auth/sign-out', issuerOrigin).href,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: issuerOrigin },
      body: '{}',
      credentials: 'include',
    },
  };
}

/** The code and state from a `be-music-play://sign-in` URL; `null` for anything else. */
export function parseReturnURL(url: string): { code: string; state: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');
  if (parsed.protocol !== `${DESKTOP_SCHEME}:` || parsed.hostname !== 'sign-in' || !code || !state) {
    return null;
  }
  return { code, state };
}

/** The scheme URL among a launch's arguments (Windows and Linux pass it to the second instance). */
export function findReturnURL(argv: readonly string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${DESKTOP_SCHEME}:`));
}

/** Whether a returned `state` answers `pending`, which has not timed out. */
export function answersPending(
  pending: PendingSignIn | undefined,
  state: string,
  now: number,
): pending is PendingSignIn {
  return pending !== undefined && pending.state === state && now - pending.startedAt <= PENDING_SIGN_IN_MS;
}

/** The player's sign-in, returning to `returnTo` when it is a player page, else to the player's start. */
export function playerSignInURL(playOrigin: string, returnTo: string): string {
  const url = new URL('/api/auth/sign-in', playOrigin);
  if (isSameOrigin(returnTo, playOrigin)) {
    const page = new URL(returnTo);
    url.searchParams.set('returnTo', page.pathname + page.search + page.hash);
  } else {
    url.searchParams.set('returnTo', '/');
  }
  return url.href;
}
