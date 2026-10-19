/**
 * Speculation Rules for the Leaderboard pages: the browser fetches a page while the pointer rests on (or presses) its
 * link, so the navigation that follows starts from a warm response.
 *
 * `prefetch` only downloads the HTML; `prerender` also runs the page, scripts included, at the cost of more Worker and
 * D1 work per hover. Start with prefetch and switch SPECULATION_ACTION once the load is known to allow it; the client
 * script already holds back its side effects (the share-card upload) until a prerendered page is shown.
 */
export type SpeculationAction = 'prefetch' | 'prerender';

/** What the pages ask the browser to do with the links below. */
export const SPECULATION_ACTION: SpeculationAction = 'prefetch';

/**
 * Paths under / that must never be fetched ahead:
 * - `ruleset/*` and `lang/*` are GETs that rewrite a cookie and redirect (routes.tsx), so a hover alone would switch the
 *   viewer's rules or language;
 * - `settings` depends on the signed-in session and holds the account forms;
 * - `assets/*`, the API reference and the share-card images are not pages to navigate to.
 */
export const SPECULATION_EXCLUDED_PATHS: readonly string[] = [
  '/ruleset/*',
  '/lang/*',
  '/settings',
  '/settings/*',
  '/assets/*',
  '/api-reference',
  '/api/*',
  '/scores/*/card',
  '/players/*/avatar',
];

/**
 * The rules as the JSON of a `<script type="speculationrules">`: same-origin links to / and below, less the
 * excluded paths and any link marked `data-no-speculate`. Paths are URL-pattern dictionaries, so any query matches.
 * `<` is escaped so the JSON cannot close its script element.
 */
export function speculationRules(action: SpeculationAction = SPECULATION_ACTION): string {
  const rules = {
    [action]: [
      {
        source: 'document',
        where: {
          and: [
            { or: [{ href_matches: { pathname: '/' } }, { href_matches: { pathname: '/*' } }] },
            ...SPECULATION_EXCLUDED_PATHS.map((pathname) => ({ not: { href_matches: { pathname } } })),
            { not: { selector_matches: '[data-no-speculate]' } },
          ],
        },
        eagerness: 'moderate',
      },
    ],
  };
  return JSON.stringify(rules).replaceAll('<', '\\u003c');
}
