/**
 * In-place updates of a page with htmx (client/main.ts bundles it). A filter switch, a file choice or a ruleset choice
 * fetches the page it links to as usual and morphs only the page body (`<main>`) and the header into the page in view,
 * so the viewer keeps their scroll position and focus, and the switch slides over instead of the page flashing. The
 * links keep their `href`: without the script, or with a modifier key held, they are plain links.
 *
 * The server answers these requests with the whole page; the client picks the two parts out of it. The attributes are
 * written on each link rather than inherited from `<body>`: htmx restores history by swapping the whole body, and
 * inherited targets would apply to that request too.
 */

/** What a partial update replaces: the page body, morphed so unchanged elements (and their state) stay. */
export const PARTIAL_TARGET = 'main';
/** The header also follows the page: its breadcrumb, the ruleset on its button, the `next` of its menu links. */
export const PARTIAL_SELECT_OOB = '#site-header:outerMorph';
export const PARTIAL_SWAP = 'outerMorph';
/** The id of the header, which the out-of-band selection above finds in the response. */
export const SITE_HEADER_ID = 'site-header';

/**
 * The htmx attributes of a link that updates the page in place. `push` puts the link's URL in the address bar and the
 * history (a filter); without it the address stays (the ruleset switch, which redirects back to the same page).
 */
export function partialLinkAttributes(href: string, options: { push?: boolean } = {}): Record<string, string> {
  return {
    'hx-get': href,
    'hx-target': PARTIAL_TARGET,
    'hx-select': PARTIAL_TARGET,
    'hx-swap': PARTIAL_SWAP,
    'hx-select-oob': PARTIAL_SELECT_OOB,
    // A newer choice replaces one still loading, so quick clicks end on the last one.
    'hx-sync': `${PARTIAL_TARGET}:replace`,
    'hx-indicator': PARTIAL_TARGET,
    ...(options.push === false ? {} : { 'hx-push-url': 'true' }),
  };
}
