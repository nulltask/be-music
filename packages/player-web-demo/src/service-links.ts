/**
 * Turns a Leaderboard path (`/leaderboard/...`) into a link for where the player runs (docs/services.md section 1).
 * On `play.<site>` the Leaderboard has its own host, `leaderboard.<site>`; anywhere else (a local dev server, a branch
 * Preview URL) the player's own Worker still serves it, so the path stays relative.
 */
export function leaderboardLink(path: string, hostname: string): string {
  const site = siteOfPlayHost(hostname);
  return site === undefined ? path : `https://leaderboard.${site}${path}`;
}

/** `be-music.app` for `play.be-music.app`, `preview.be-music.app` for `play.preview.be-music.app`, else undefined. */
export function siteOfPlayHost(hostname: string): string | undefined {
  const match = /^play\.(.+)$/.exec(hostname.toLowerCase());
  return match?.[1];
}
