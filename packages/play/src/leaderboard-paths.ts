/**
 * Whether a path belongs to the Leaderboard Worker on this origin: its API (`/api/*`, Better Auth included) and its
 * pages, `/leaderboard` itself as well as everything under it.
 */
export function isLeaderboardPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname === '/leaderboard' || pathname.startsWith('/leaderboard/');
}
