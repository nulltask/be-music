/** Languages shared by the service pages, and how a request picks one. */

export const LOCALES = ['en', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Each language by its own name, for the language switch. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', ja: '日本語' };

/** Cookie holding the language the viewer picked on this host. */
export const LOCALE_COOKIE = 'be-music-lang';

export function isLocale(value: string | undefined | null): value is Locale {
  return value !== undefined && value !== null && (LOCALES as readonly string[]).includes(value);
}

/**
 * The language of a page: `?lang=` first, then the language the viewer picked, then `Accept-Language` in preference
 * order, then English. The same order as the Leaderboard.
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

/** The `be-music-lang` value from a Cookie header. */
export function localeFromCookie(header: string | null): string | undefined {
  if (header === null) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === LOCALE_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** Remembers a chosen language on this host. `Secure` only on https, so a local http server can store it too. */
export function localeSetCookie(locale: Locale, secure: boolean): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=34560000; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** `?lang=` on the same path, keeping every other query parameter. */
export function withLocale(requestURL: string, locale: Locale): string {
  const url = new URL(requestURL, 'https://be-music.local');
  url.searchParams.set('lang', locale);
  return `${url.pathname}${url.search}`;
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
