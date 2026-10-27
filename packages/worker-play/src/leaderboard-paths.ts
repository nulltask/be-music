/**
 * Whether a path belongs to the Leaderboard Worker on this origin: its API (`/api/*`, Better Auth included). The
 * Leaderboard's pages live on its own host (docs/services.md section 1).
 */
export function isLeaderboardPath(pathname: string): boolean {
  return pathname.startsWith('/api/') && pathname !== '/api/player-settings';
}
