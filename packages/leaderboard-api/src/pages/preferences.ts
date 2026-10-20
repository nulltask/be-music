import { isRuleset, type RulesetId } from '../rulesets.ts';

/** Cookie holding the viewer's display ruleset; every page shows its figures under it. */
export const RULESET_COOKIE = 'lb-ruleset';
export const DEFAULT_RULESET: RulesetId = 'lr2';

/** The display ruleset from the cookie, or LR2 when it is missing or not a ruleset. */
export function resolveDisplayRuleset(cookieValue: string | undefined): RulesetId {
  return isRuleset(cookieValue) ? cookieValue : DEFAULT_RULESET;
}

/**
 * Where to go after switching the ruleset: back to the Leaderboard page the switch was made on. Anything that is not a
 * page on this site (another host, `//evil`, a backslash trick, the API) goes to the top page instead, so the switch
 * cannot be used as an open redirect.
 */
export function safeReturnPath(next: string | undefined): string {
  if (next === undefined || !next.startsWith('/') || next.includes('\\')) return '/';
  try {
    const url = new URL(next, 'https://leaderboard.invalid');
    if (url.origin !== 'https://leaderboard.invalid' || url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return '/';
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}
