const ENGINE_MARKER = '(KHTML, like Gecko)';
const BROWSER_TOKEN = /^(?:Chrome|Mobile|Safari)\//u;

/**
 * Returns Chromium's user agent without the tokens Electron adds (the app's name and `Electron/<version>`), so it reads
 * as Chrome's. Google refuses to sign in from an embedded browser it recognizes, which breaks Google sign-in otherwise.
 */
export function chromeUserAgent(userAgent: string): string {
  const marker = userAgent.indexOf(ENGINE_MARKER);
  if (marker < 0) {
    return userAgent
      .split(' ')
      .filter((token) => !token.startsWith('Electron/'))
      .join(' ');
  }
  const head = userAgent.slice(0, marker + ENGINE_MARKER.length);
  const tail = userAgent
    .slice(marker + ENGINE_MARKER.length)
    .split(' ')
    .filter((token) => BROWSER_TOKEN.test(token));
  return [head, ...tail].join(' ');
}
