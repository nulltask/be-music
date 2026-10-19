/** Better Auth's endpoints, OAuth callbacks included (`basePath: '/api/auth'` in the Leaderboard's `src/auth.ts`). */
export function isAuthPath(pathname: string): boolean {
  return pathname === '/api/auth' || pathname.startsWith('/api/auth/');
}

/**
 * The dashboard next to an Accounts host: `https://be-music.app` for `accounts.be-music.app`,
 * `https://preview.be-music.app` for `accounts.preview.be-music.app`. Undefined for any other host.
 */
export function dashboardFor(hostname: string): string | undefined {
  const match = /^accounts\.(.+)$/.exec(hostname.toLowerCase());
  return match === null ? undefined : `https://${match[1]}`;
}
