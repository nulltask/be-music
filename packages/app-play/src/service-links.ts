/**
 * Turns a Leaderboard page path (`/players/...`) into a link to the Leaderboard of the environment the player runs in
 * (docs/services.md section 1): `leaderboard.<site>` next to `play.<site>`, the preview Leaderboard from a branch Preview
 * URL of the preview Player, and production anywhere else (a local dev server).
 */
export function leaderboardLink(path: string, hostname: string): string {
  return `https://leaderboard.${leaderboardSite(hostname)}${path}`;
}

/** `be-music.app` for `play.be-music.app`, `preview.be-music.app` for `play.preview.be-music.app`, else undefined. */
export function siteOfPlayHost(hostname: string): string | undefined {
  const match = /^play\.(.+)$/.exec(hostname.toLowerCase());
  return match?.[1];
}

function leaderboardSite(hostname: string): string {
  const site = siteOfPlayHost(hostname);
  if (site !== undefined) return site;
  return hostname.toLowerCase().endsWith('-play-preview.be-music.workers.dev')
    ? 'preview.be-music.app'
    : 'be-music.app';
}
