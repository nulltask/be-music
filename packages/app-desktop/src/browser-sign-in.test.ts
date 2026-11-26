import { describe, expect, it } from 'vite-plus/test';
import {
  PENDING_SIGN_IN_MS,
  accountsLoginOrigin,
  accountsSignOutRequest,
  answersPending,
  browserSignInURL,
  challengeOf,
  createPendingSignIn,
  findReturnURL,
  isPlayerSignOut,
  parseReturnURL,
  playerSignInURL,
  redeemRequest,
  redeemURL,
} from './browser-sign-in.ts';

const ISSUER = 'https://be-music.app';
const PLAY = 'https://play.be-music.app';

describe('challengeOf', () => {
  it('computes the PKCE S256 challenge (RFC 7636, appendix B)', () => {
    expect(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('createPendingSignIn', () => {
  it('draws a base64url state and verifier and binds the challenge to the verifier', () => {
    const pending = createPendingSignIn(ISSUER, `${PLAY}/select`, 1000, (size) => new Uint8Array(size).fill(255));
    expect(pending.state).toBe(Buffer.alloc(16, 255).toString('base64url'));
    expect(pending.verifier).toMatch(/^[\w-]{43}$/u);
    expect(pending.challenge).toBe(challengeOf(pending.verifier));
    expect(pending).toMatchObject({ issuerOrigin: ISSUER, returnTo: `${PLAY}/select`, startedAt: 1000 });
  });

  it('draws different values each time', () => {
    const a = createPendingSignIn(ISSUER, PLAY, 0);
    const b = createPendingSignIn(ISSUER, PLAY, 0);
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe('accountsLoginOrigin', () => {
  it('finds the Accounts login page of production and preview', () => {
    expect(accountsLoginOrigin('https://be-music.app/login?client_id=play&sig=x')).toBe(ISSUER);
    expect(accountsLoginOrigin('https://preview.be-music.app/login')).toBe('https://preview.be-music.app');
  });

  it('leaves other pages in the window', () => {
    expect(accountsLoginOrigin('https://be-music.app/account')).toBeNull();
    expect(accountsLoginOrigin('https://be-music.app/api/auth/oauth2/authorize')).toBeNull();
    expect(accountsLoginOrigin('https://play.be-music.app/login')).toBeNull();
    expect(accountsLoginOrigin('http://be-music.app/login')).toBeNull();
    expect(accountsLoginOrigin('not a url')).toBeNull();
  });
});

describe('the browser round trip', () => {
  const pending = createPendingSignIn(ISSUER, `${PLAY}/select?x=1#top`, 0);

  it('opens the desktop sign-in page with the state and challenge', () => {
    const url = new URL(browserSignInURL(pending));
    expect(url.origin + url.pathname).toBe(`${ISSUER}/desktop/sign-in`);
    expect(url.searchParams.get('state')).toBe(pending.state);
    expect(url.searchParams.get('challenge')).toBe(pending.challenge);
    expect(url.searchParams.has('verifier')).toBe(false);
    expect(url.searchParams.has('sign_in_method')).toBe(false);
    expect(redeemURL(pending)).toBe(`${ISSUER}/api/auth/desktop-sign-in/redeem`);
  });

  it('carries the provider the player asked for, and only Google or Discord', () => {
    const method = (loginURL: string) =>
      new URL(browserSignInURL(pending, loginURL)).searchParams.get('sign_in_method');
    expect(method(`${ISSUER}/login?client_id=play&sign_in_method=google&sig=x`)).toBe('google');
    expect(method(`${ISSUER}/login?sign_in_method=discord`)).toBe('discord');
    expect(method(`${ISSUER}/login?sign_in_method=passkey`)).toBeNull();
    expect(method(`${ISSUER}/login?client_id=play`)).toBeNull();
  });

  it('redeems the code with the verifier, naming Accounts as the origin', () => {
    const request = redeemRequest(pending, 'the-code');
    expect(request.url).toBe(`${ISSUER}/api/auth/desktop-sign-in/redeem`);
    expect(request.init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ISSUER },
      credentials: 'include',
    });
    expect(JSON.parse(request.init.body as string)).toEqual({ code: 'the-code', verifier: pending.verifier });
  });

  it('reads the returned code and state', () => {
    expect(parseReturnURL('be-music-play://sign-in?code=c%2B1&state=s')).toEqual({ code: 'c+1', state: 's' });
    expect(parseReturnURL('be-music-play://other?code=c&state=s')).toBeNull();
    expect(parseReturnURL('be-music-play://sign-in?code=c')).toBeNull();
    expect(parseReturnURL('https://sign-in?code=c&state=s')).toBeNull();
    expect(parseReturnURL('::')).toBeNull();
  });

  it('finds the returned URL among launch arguments', () => {
    expect(findReturnURL(['app.exe', '--flag', 'be-music-play://sign-in?code=c&state=s'])).toBe(
      'be-music-play://sign-in?code=c&state=s',
    );
    expect(findReturnURL(['app.exe'])).toBeUndefined();
  });

  it('accepts only the waiting state, in time', () => {
    expect(answersPending(pending, pending.state, PENDING_SIGN_IN_MS)).toBe(true);
    expect(answersPending(pending, pending.state, PENDING_SIGN_IN_MS + 1)).toBe(false);
    expect(answersPending(pending, 'other', 0)).toBe(false);
    expect(answersPending(undefined, pending.state, 0)).toBe(false);
  });

  it('signs in to the player again, back on the same page', () => {
    const url = new URL(playerSignInURL(PLAY, pending.returnTo));
    expect(url.origin + url.pathname).toBe(`${PLAY}/api/auth/sign-in`);
    expect(url.searchParams.get('returnTo')).toBe('/select?x=1#top');
    expect(new URL(playerSignInURL(PLAY, 'https://be-music.app/account')).searchParams.get('returnTo')).toBe('/');
  });
});

describe('signing out', () => {
  it('follows only a successful sign-out of the player', () => {
    const signOut = { url: `${PLAY}/api/auth/sign-out`, method: 'POST', statusCode: 200 };
    expect(isPlayerSignOut(signOut, PLAY)).toBe(true);
    expect(isPlayerSignOut({ ...signOut, url: `${PLAY}/api/auth/sign-out?returnTo=%2F`, statusCode: 303 }, PLAY)).toBe(
      true,
    );
    expect(isPlayerSignOut({ ...signOut, statusCode: 403 }, PLAY)).toBe(false);
    expect(isPlayerSignOut({ ...signOut, method: 'GET' }, PLAY)).toBe(false);
    expect(isPlayerSignOut({ ...signOut, url: `${PLAY}/api/auth/sign-in` }, PLAY)).toBe(false);
    expect(isPlayerSignOut({ ...signOut, url: `${ISSUER}/api/auth/sign-out` }, PLAY)).toBe(false);
  });

  it('ends the Accounts session, naming Accounts as the origin', () => {
    const request = accountsSignOutRequest(ISSUER);
    expect(request.url).toBe(`${ISSUER}/api/auth/sign-out`);
    expect(request.init).toMatchObject({ method: 'POST', headers: { origin: ISSUER }, credentials: 'include' });
  });
});
