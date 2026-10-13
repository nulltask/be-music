import type { PlaylogRulesetId } from '@be-music/player/playlog';

/** Cookie holding the viewer's display ruleset; every page shows its figures under it. */
export const RULESET_COOKIE = 'lb-ruleset';
export const RULESETS: readonly PlaylogRulesetId[] = ['lr2', 'beatoraja', 'iidx'];
export const DEFAULT_RULESET: PlaylogRulesetId = 'lr2';

export function isRuleset(value: string | undefined): value is PlaylogRulesetId {
  return value !== undefined && (RULESETS as readonly string[]).includes(value);
}

/** The display ruleset from the cookie, or LR2 when it is missing or not a ruleset. */
export function resolveDisplayRuleset(cookieValue: string | undefined): PlaylogRulesetId {
  return isRuleset(cookieValue) ? cookieValue : DEFAULT_RULESET;
}

/**
 * Where to go after switching the ruleset: back to the Leaderboard page the switch was made on. Anything that is not a
 * same-site path under `/leaderboard` (another host, `//evil`, a backslash trick) goes to the top page instead, so the
 * switch cannot be used as an open redirect.
 */
export function safeReturnPath(next: string | undefined): string {
  if (next === undefined || !next.startsWith('/leaderboard') || next.includes('\\')) return '/leaderboard';
  try {
    const url = new URL(next, 'https://leaderboard.invalid');
    if (url.origin !== 'https://leaderboard.invalid' || !url.pathname.startsWith('/leaderboard')) return '/leaderboard';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/leaderboard';
  }
}
