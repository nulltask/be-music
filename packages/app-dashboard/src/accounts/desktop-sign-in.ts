// Desktop sign-in (docs/services.md, "Desktop sign-in"). The desktop app signs in in the default browser, because
// identity providers refuse embedded browsers, and then needs an Accounts session of its own: the player's session
// lasts 10 minutes and renews through the Accounts session silently. The browser's signed-in Accounts session issues a
// single-use code bound to a challenge the app chose; the app redeems the code with the challenge's verifier for a new
// session in its own cookie store. Another app that registers the same URL scheme and intercepts the code cannot
// redeem it without the verifier.
import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint, sessionMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { constantTimeEqual, generateRandomString } from 'better-auth/crypto';

/** The URL scheme the desktop app registers to receive the code. */
export const DESKTOP_SCHEME = 'be-music-play';
/** How long a code can be redeemed. */
const CODE_MINUTES = 3;
const CODE_IDENTIFIER = 'desktop-sign-in:';

/** A desktop app's sign-in request: its `state` and the S256 `challenge` of its verifier, both base64url. */
export interface DesktopSignInRequest {
  state: string;
  challenge: string;
}

const STATE = /^[\w-]{16,128}$/u;
/** A base64url SHA-256 digest without padding. */
const CHALLENGE = /^[\w-]{43}$/u;
const VERIFIER = /^[\w-]{43,128}$/u;

/** Reads a request from `/desktop/sign-in`'s query; `null` when a value is missing or malformed. */
export function parseDesktopSignInRequest(params: URLSearchParams): DesktopSignInRequest | null {
  const state = params.get('state');
  const challenge = params.get('challenge');
  if (state === null || challenge === null || !STATE.test(state) || !CHALLENGE.test(challenge)) {
    return null;
  }
  return { state, challenge };
}

function base64URL(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

/** The S256 challenge of `verifier`, as in PKCE (RFC 7636). */
export async function desktopChallenge(verifier: string): Promise<string> {
  return base64URL(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

/** The URL that hands `code` back to the desktop app with the app's `state`. */
export function desktopReturnURL(code: string, state: string): string {
  const url = new URL(`${DESKTOP_SCHEME}://sign-in`);
  url.searchParams.set('code', code);
  url.searchParams.set('state', state);
  return url.href;
}

interface StoredCode {
  userId: string;
  challenge: string;
}

function parseStoredCode(value: string): StoredCode | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredCode>;
    return typeof parsed.userId === 'string' && typeof parsed.challenge === 'string'
      ? { userId: parsed.userId, challenge: parsed.challenge }
      : null;
  } catch {
    return null;
  }
}

/**
 * A Standard Schema for a JSON body of string fields, so Better Auth validates the body and types `auth.api` calls
 * without a schema library.
 */
function stringFields<const Key extends string>(...keys: Key[]) {
  type Body = Record<Key, string>;
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'be-music',
      validate(value: unknown): { value: Body } | { issues: { message: string }[] } {
        const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
        return keys.every((key) => typeof record[key] === 'string')
          ? { value: Object.fromEntries(keys.map((key) => [key, record[key]])) as Body }
          : { issues: [{ message: `Expected string fields: ${keys.join(', ')}` }] };
      },
      types: undefined as unknown as { input: Body; output: Body },
    },
  };
}

/**
 * Better Auth endpoints for desktop sign-in: `createDesktopSignInCode` (server only, called by `/desktop/sign-in` for
 * the signed-in browser) and `POST /api/auth/desktop-sign-in/redeem` (the desktop app).
 */
export function desktopSignIn() {
  return {
    id: 'desktop-sign-in',
    endpoints: {
      createDesktopSignInCode: createAuthEndpoint(
        '/desktop-sign-in/code',
        { method: 'POST', use: [sessionMiddleware], body: stringFields('challenge') },
        async (context) => {
          // Only the page handler issues codes, after checking the request; never a browser request.
          if (context.request) throw context.error('NOT_FOUND');
          const { challenge } = context.body;
          if (!CHALLENGE.test(challenge)) throw context.error('BAD_REQUEST');
          const code = generateRandomString(43);
          const stored: StoredCode = { userId: context.context.session.user.id, challenge };
          await context.context.internalAdapter.createVerificationValue({
            identifier: `${CODE_IDENTIFIER}${code}`,
            value: JSON.stringify(stored),
            expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
          });
          return context.json({ code });
        },
      ),
      redeemDesktopSignInCode: createAuthEndpoint(
        '/desktop-sign-in/redeem',
        { method: 'POST', body: stringFields('code', 'verifier') },
        async (context) => {
          const { code, verifier } = context.body;
          if (!VERIFIER.test(verifier)) {
            throw context.error('BAD_REQUEST', { message: 'Invalid desktop sign-in' });
          }
          // Consumed before anything is checked: a code is spent by its first redemption, right or wrong.
          const consumed = await context.context.internalAdapter.consumeVerificationValue(`${CODE_IDENTIFIER}${code}`);
          const stored = consumed === null ? null : parseStoredCode(consumed.value);
          if (stored === null || !constantTimeEqual(await desktopChallenge(verifier), stored.challenge)) {
            throw context.error('BAD_REQUEST', { message: 'Invalid desktop sign-in' });
          }
          const user = await context.context.internalAdapter.findUserById(stored.userId);
          if (user === null) throw context.error('BAD_REQUEST', { message: 'Invalid desktop sign-in' });
          const session = await context.context.internalAdapter.createSession(user.id);
          await setSessionCookie(context, { session, user });
          return context.json({ signedIn: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
