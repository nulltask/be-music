/** The languages the Leaderboard pages come in, and how a request picks one. */

export const LOCALES = ['en', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Each language by its own name, for the language menu. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', ja: '日本語' };

/** Cookie holding the language the viewer picked. */
export const LOCALE_COOKIE = 'lb-lang';

export function isLocale(value: string | undefined | null): value is Locale {
  return value !== undefined && value !== null && (LOCALES as readonly string[]).includes(value);
}

/**
 * The language of a page: `?lang=` first (a shared link can carry one, and link previews have no cookie), then the
 * language the viewer picked (the cookie), then the browser's `Accept-Language` in its order of preference, then
 * English.
 */
export function resolveLocale(request: {
  query?: string | undefined;
  cookie?: string | undefined;
  acceptLanguage?: string | undefined;
}): Locale {
  if (isLocale(request.query)) return request.query;
  if (isLocale(request.cookie)) return request.cookie;
  for (const tag of parseAcceptLanguage(request.acceptLanguage ?? '')) {
    const primary = tag.split('-')[0]!.toLowerCase();
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/** The language tags of an `Accept-Language` header, most wanted first (`q=0` ones dropped). */
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((param) => /^\s*q=([\d.]+)\s*$/.exec(param)?.[1]).find((value) => value !== undefined);
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), index };
    })
    .filter((entry) => entry.tag !== '' && entry.tag !== '*' && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.tag);
}
