import * as oauth from 'oauth4webapi';
import { EncryptJWT, jwtDecrypt, jwtVerify, createRemoteJWKSet } from 'jose';

/** One relying party. Cookies never leave PUBLIC_ORIGIN; the issuer may be on an unrelated domain. */
export interface OIDCEnv {
  AUTH_ISSUER: string;
  PUBLIC_ORIGIN: string;
  OIDC_CLIENT_ID: string;
  /** A distinct random secret (at least 32 characters) for each service and environment. */
  SESSION_SECRET: string;
  /** The resource this service calls on behalf of its user. */
  API_AUDIENCE: string;
}

export interface Identity {
  issuer: string;
  sub: string;
  name: string;
  anonymous: boolean;
  linkedGuests?: string[];
  passkeys?: number;
}
export interface LoginSession {
  identity: Identity;
  accessToken: string;
  expiresAt: number;
}
const SESSION_COOKIE = '__Host-be-music.session';
const TRANSACTION_COOKIE = '__Host-be-music.oidc';
const SSO_CHECK_COOKIE = '__Host-be-music.sso-check';
const CLAIM = 'https://be-music.app/anonymous';
const servers = new Map<string, oauth.AuthorizationServer>();
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function validateEnv(env: OIDCEnv): void {
  for (const value of [env.AUTH_ISSUER, env.PUBLIC_ORIGIN, env.API_AUDIENCE]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('OIDC endpoints must be configured HTTPS URLs');
    }
  }
  if (new URL(env.PUBLIC_ORIGIN).origin !== env.PUBLIC_ORIGIN || env.SESSION_SECRET.length < 32) {
    throw new Error('Invalid relying-party configuration');
  }
}
async function server(env: OIDCEnv): Promise<oauth.AuthorizationServer> {
  validateEnv(env);
  const cached = servers.get(env.AUTH_ISSUER);
  if (cached) return cached;
  const issuer = new URL(env.AUTH_ISSUER);
  const metadata = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer));
  servers.set(env.AUTH_ISSUER, metadata);
  return metadata;
}
function keys(url: string) {
  let result = keySets.get(url);
  if (!result) {
    result = createRemoteJWKSet(new URL(url));
    keySets.set(url, result);
  }
  return result;
}
async function encryptionKey(env: OIDCEnv): Promise<Uint8Array> {
  validateEnv(env);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SESSION_SECRET)));
}
function cookieValue(request: Request, name: string): string | undefined {
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
async function seal(env: OIDCEnv, payload: Record<string, unknown>, seconds: number): Promise<string> {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer(env.AUTH_ISSUER)
    .setAudience(`${env.PUBLIC_ORIGIN}:${env.OIDC_CLIENT_ID}`)
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .encrypt(await encryptionKey(env));
}
async function unseal(env: OIDCEnv, token: string) {
  return (
    await jwtDecrypt(token, await encryptionKey(env), {
      issuer: env.AUTH_ISSUER,
      audience: `${env.PUBLIC_ORIGIN}:${env.OIDC_CLIENT_ID}`,
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
    })
  ).payload;
}
/** Only local paths can be used as the post-login destination. */
export function returnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /\p{Cc}|\s/u.test(value))
    return '/';
  const target = new URL(value, 'https://return.invalid');
  if (target.origin !== 'https://return.invalid') return '/';
  return target.pathname + target.search + target.hash;
}
/** Read only the relying party's encrypted, host-only session. Invalid or expired cookies are signed out. */
export async function readSession(request: Request, env: OIDCEnv): Promise<LoginSession | null> {
  if (new URL(request.url).origin !== env.PUBLIC_ORIGIN) return null;
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  try {
    const data = await unseal(env, token);
    if (typeof data.subject !== 'string' || typeof data.accessToken !== 'string' || typeof data.exp !== 'number')
      return null;
    return {
      identity: {
        issuer: env.AUTH_ISSUER,
        sub: data.subject,
        name: typeof data.name === 'string' ? data.name : 'Player',
        anonymous: data.anonymous === true,
        passkeys: typeof data.passkeys === 'number' ? data.passkeys : 0,
        linkedGuests: Array.isArray(data.linkedGuests) ? (data.linkedGuests as string[]) : [],
      },
      accessToken: data.accessToken,
      expiresAt: data.exp * 1000,
    };
  } catch {
    return null;
  }
}
function identityFromClaims(
  claims: { iss?: string; sub?: string; name?: unknown; [key: string]: unknown },
  issuer: string,
): Identity {
  if (claims.iss !== issuer || !claims.sub) throw new Error('Invalid identity');
  return {
    issuer,
    sub: claims.sub,
    name: typeof claims.name === 'string' ? claims.name : 'Player',
    anonymous: claims[CLAIM] === true,
    passkeys:
      typeof claims['https://be-music.app/passkeys'] === 'number'
        ? (claims['https://be-music.app/passkeys'] as number)
        : 0,
    linkedGuests: Array.isArray(claims['https://be-music.app/linked-guests'])
      ? (claims['https://be-music.app/linked-guests'] as unknown[]).filter((v): v is string => typeof v === 'string')
      : [],
  };
}
/** Verify a resource-bound access token, never an ID token, before accepting cross-service API requests. */
export async function verifyAccess(request: Request, env: OIDCEnv): Promise<Identity | null> {
  if (!/^Bearer /i.test(request.headers.get('authorization') ?? '')) return null;
  try {
    const claims = await oauth.validateJwtAccessToken(await server(env), request, env.API_AUDIENCE);
    const scopes = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
    if (!scopes.includes('be-music:api')) return null;
    return identityFromClaims(claims, env.AUTH_ISSUER);
  } catch {
    return null;
  }
}
/** Handle local sign-in/callback/session/sign-out routes. No token is returned to browser JavaScript. */
export async function handleAuth(request: Request, env: OIDCEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/auth/')) {
    // Only top-level browser documents can start SSO; never redirect APIs, embeds, assets or prefetches.
    if (
      url.origin !== env.PUBLIC_ORIGIN ||
      request.method !== 'GET' ||
      url.pathname.startsWith('/api/') ||
      request.headers.get('sec-fetch-mode') !== 'navigate' ||
      request.headers.get('sec-fetch-dest') !== 'document' ||
      !request.headers.get('accept')?.includes('text/html') ||
      request.headers.has('purpose') ||
      request.headers.has('sec-purpose') ||
      cookieValue(request, SSO_CHECK_COOKIE) ||
      (await readSession(request, env))
    )
      return null;
    const start = new URL('/api/auth/sign-in', env.PUBLIC_ORIGIN);
    start.searchParams.set('automatic', '1');
    start.searchParams.set('returnTo', url.pathname + url.search);
    try {
      return await handleAuth(new Request(start), env);
    } catch {
      // An unavailable identity provider must not prevent browsing public pages.
      return null;
    }
  }
  validateEnv(env);
  if (url.origin !== env.PUBLIC_ORIGIN) return new Response('Unknown origin', { status: 400 });
  const headers = new Headers({ 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' });
  const reply = (body: unknown, status = 200) => {
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(body), { status, headers });
  };
  if (url.pathname === '/api/auth/get-session' && request.method === 'GET') {
    const session = await readSession(request, env);
    return reply(
      session
        ? {
            user: { id: session.identity.sub, name: session.identity.name, isAnonymous: session.identity.anonymous },
            session: { expiresAt: new Date(session.expiresAt).toISOString() },
          }
        : null,
    );
  }
  if (url.pathname === '/api/auth/sign-out' && request.method === 'POST') {
    if (request.headers.get('origin') !== env.PUBLIC_ORIGIN) return reply({ error: 'invalid-origin' }, 403);
    headers.append('set-cookie', cookie(SESSION_COOKIE, '', 0));
    headers.append('set-cookie', cookie(TRANSACTION_COOKIE, '', 0));
    // Respect an explicit app sign-out until the user starts sign-in again.
    headers.append('set-cookie', cookie(SSO_CHECK_COOKIE, 'signed-out', 86400));
    return reply({ success: true });
  }
  if (url.pathname === '/api/auth/manage' && request.method === 'GET') {
    headers.set('location', new URL('/account', env.AUTH_ISSUER).href);
    return new Response(null, { status: 302, headers });
  }
  if (url.pathname === '/api/auth/sign-in' && request.method === 'GET') {
    const automatic = url.searchParams.get('automatic') === '1';
    const as = await server(env);
    const state = oauth.generateRandomState();
    const nonce = oauth.generateRandomNonce();
    const verifier = oauth.generateRandomCodeVerifier();
    const target = new URL(as.authorization_endpoint!);
    target.search = new URLSearchParams({
      client_id: env.OIDC_CLIENT_ID,
      redirect_uri: `${env.PUBLIC_ORIGIN}/api/auth/callback`,
      response_type: 'code',
      scope: 'openid profile be-music:api',
      resource: env.API_AUDIENCE,
      state,
      nonce,
      code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
    }).toString();
    if (automatic) target.searchParams.set('prompt', 'none');
    // Back off after a failed silent attempt; also prevent a navigation loop if the provider is unavailable.
    headers.append('set-cookie', cookie(SSO_CHECK_COOKIE, 'checked', 60));
    headers.append(
      'set-cookie',
      cookie(
        TRANSACTION_COOKIE,
        await seal(
          env,
          { state, nonce, verifier, automatic, returnTo: returnPath(url.searchParams.get('returnTo')) },
          600,
        ),
        600,
      ),
    );
    headers.set('location', target.href);
    return new Response(null, { status: 302, headers });
  }
  if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
    headers.append('set-cookie', cookie(TRANSACTION_COOKIE, '', 0));
    try {
      const transaction = await unseal(env, cookieValue(request, TRANSACTION_COOKIE) ?? '');
      if (
        typeof transaction.state !== 'string' ||
        typeof transaction.nonce !== 'string' ||
        typeof transaction.verifier !== 'string'
      )
        throw new Error('Invalid transaction');
      const as = await server(env);
      const client = {
        client_id: env.OIDC_CLIENT_ID,
        token_endpoint_auth_method: 'none',
        id_token_signed_response_alg: 'RS256',
      };
      let params: URLSearchParams;
      try {
        params = oauth.validateAuthResponse(as, client, url, transaction.state);
      } catch (error) {
        if (
          transaction.automatic === true &&
          error instanceof oauth.AuthorizationResponseError &&
          ['login_required', 'interaction_required', 'consent_required', 'account_selection_required'].includes(
            error.error,
          )
        ) {
          headers.set('location', returnPath(typeof transaction.returnTo === 'string' ? transaction.returnTo : null));
          return new Response(null, { status: 302, headers });
        }
        throw error;
      }
      const tokenResponse = await oauth.authorizationCodeGrantRequest(
        as,
        client,
        oauth.None(),
        params,
        `${env.PUBLIC_ORIGIN}/api/auth/callback`,
        transaction.verifier,
        { additionalParameters: { resource: env.API_AUDIENCE } },
      );
      const tokens = await oauth.processAuthorizationCodeResponse(as, client, tokenResponse, {
        expectedNonce: transaction.nonce,
        requireIdToken: true,
      });
      if (!tokens.id_token || !as.jwks_uri) throw new Error('Missing identity token');
      const verified = await jwtVerify(tokens.id_token, keys(as.jwks_uri), {
        issuer: env.AUTH_ISSUER,
        audience: env.OIDC_CLIENT_ID,
        algorithms: ['RS256'],
      });
      const identity = identityFromClaims(verified.payload, env.AUTH_ISSUER);
      const lifetime = Math.min(
        600,
        typeof tokens.expires_in === 'number' ? tokens.expires_in : 600,
        (verified.payload.exp ?? 0) - Math.floor(Date.now() / 1000),
      );
      if (lifetime <= 0) throw new Error('Expired identity');
      const accessRequest = new Request(`${env.API_AUDIENCE}/`, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });
      const access = await verifyAccess(accessRequest, env);
      if (!access || access.sub !== identity.sub) throw new Error('Invalid resource token');
      headers.append(
        'set-cookie',
        cookie(
          SESSION_COOKIE,
          await seal(
            env,
            {
              subject: identity.sub,
              name: identity.name,
              anonymous: identity.anonymous,
              linkedGuests: identity.linkedGuests,
              passkeys: identity.passkeys,
              accessToken: tokens.access_token,
            },
            lifetime,
          ),
          lifetime,
        ),
      );
      headers.append('set-cookie', cookie(SSO_CHECK_COOKIE, '', 0));
      headers.set('location', returnPath(typeof transaction.returnTo === 'string' ? transaction.returnTo : null));
      return new Response(null, { status: 302, headers });
    } catch {
      return reply({ error: 'sign-in-failed', message: 'Sign-in could not be verified. Start again.' }, 400);
    }
  }
  return reply({ error: 'sign-in-required', signInURL: '/api/auth/sign-in' }, 401);
}
