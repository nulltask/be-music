/**
 * Where the desktop window sends a URL. The player and its sign-in flow stay in the window, other web pages open in
 * the default browser, and anything else (a `file:` URL, a custom scheme) is refused.
 */
export type NavigationTarget = 'window' | 'browser' | 'refuse';

/**
 * Hosts the player's sign-in passes through: the Accounts issuer (`AUTH_ISSUER`, production and preview) and the
 * identity providers it offers. Google's sign-in can bounce through `accounts.youtube.com` to set its session.
 */
const SIGN_IN_HOSTS: ReadonlySet<string> = new Set([
  'be-music.app',
  'preview.be-music.app',
  'discord.com',
  'accounts.google.com',
  'accounts.youtube.com',
]);

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/** Whether `url` is on `origin`; `false` for anything that does not parse. */
export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/** Classifies `url` for a window showing the player at `playOrigin`. */
export function navigationTarget(url: string, playOrigin: string): NavigationTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'refuse';
  }
  if (isSameOrigin(url, playOrigin)) {
    return 'window';
  }
  if (parsed.protocol === 'https:' && SIGN_IN_HOSTS.has(parsed.hostname)) {
    return 'window';
  }
  if (WEB_PROTOCOLS.has(parsed.protocol) || parsed.protocol === 'mailto:') {
    return 'browser';
  }
  return 'refuse';
}

/** Whether a server redirect to `url` may proceed: the sign-in flow may redirect anywhere on the web. */
export function allowsRedirect(url: string): boolean {
  try {
    return WEB_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
