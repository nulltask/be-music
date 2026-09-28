/**
 * Default-family type stack. The poster look pairs three faces, each with LINE Seed JP as the offline fallback:
 *
 * - `DEFAULT_TEXT_FONT` — M PLUS 1p, a tight, sharp gothic for small UI text and Japanese body copy.
 * - `DEFAULT_HEADLINE_FONT` — Dela Gothic One, a heavy poster gothic for song titles (Latin and Japanese).
 * - `DEFAULT_DISPLAY_FONT` — Anton, a condensed Latin face for tags, judgements and numerals.
 *
 * Dela Gothic One and Anton each ship a single 400 weight, so callers draw them at `'400'` — a heavier request would
 * make the browser synthesize a smeared faux-bold.
 */
export const DEFAULT_TEXT_FONT = 'M PLUS 1p, LINE Seed JP, ui-sans-serif, system-ui, sans-serif';
export const DEFAULT_HEADLINE_FONT = 'Dela Gothic One, M PLUS 1p, LINE Seed JP, sans-serif';
export const DEFAULT_DISPLAY_FONT = 'Anton, M PLUS 1p, LINE Seed JP, Impact, Arial Narrow, sans-serif';
