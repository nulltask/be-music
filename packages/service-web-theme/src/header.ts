import { LOCALE_NAMES, LOCALES, withLocale, type Locale } from './locale.ts';

/** Who is signed in, when the page has a session. */
export interface ServiceHeaderAccount {
  handle: string;
  displayName: string;
  anonymous: boolean;
}

const TEXT = {
  en: {
    nav: 'Site',
    signIn: 'Sign in',
    play: 'Play',
    playTitle: 'Play in the browser',
    guest: 'guest',
    language: 'Language',
    accountOf: (handle: string) => `Account of @${handle}`,
  },
  ja: {
    nav: 'サイト',
    signIn: 'ログイン',
    play: 'プレイ',
    playTitle: 'ブラウザでプレイ',
    guest: 'ゲスト',
    language: '言語',
    accountOf: (handle: string) => `@${handle} のアカウント`,
  },
} as const;

function escapeHTML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * The header shared by every service page except Play. It follows the Leaderboard: the signed-in person, a link to
 * Play, and the language. `product` is the localized name after “be-music”.
 */
/** The skip link every service page puts before the shared header. */
export function serviceSkipLink(locale: Locale): string {
  return `<a class="skip-link" href="#main">${locale === 'ja' ? '本文へ移動' : 'Skip to content'}</a>`;
}

export function renderServiceHeader(input: {
  locale: Locale;
  product: string;
  homeHref: string;
  playHref?: string;
  accountHref: string;
  account?: ServiceHeaderAccount;
  requestURL: string;
}): string {
  const t = TEXT[input.locale];
  const play =
    input.playHref === undefined
      ? ''
      : `<a class="button" href="${escapeHTML(input.playHref)}" title="${escapeHTML(t.playTitle)}">${t.play}</a>`;
  const account =
    input.account === undefined
      ? `<a class="button secondary" href="${escapeHTML(input.accountHref)}">${t.signIn}</a>`
      : `<a class="account-chip" href="${escapeHTML(input.accountHref)}" title="${escapeHTML(input.account.displayName)}" aria-label="${escapeHTML(input.account.handle === '' ? input.account.displayName : t.accountOf(input.account.handle))}"><span class="name">${escapeHTML(input.account.displayName)}</span>${input.account.handle === '' ? '' : `<span class="handle">@${escapeHTML(input.account.handle)}</span>`}${input.account.anonymous ? `<span class="guest">(${t.guest})</span>` : ''}</a>`;
  const languages = LOCALES.map(
    (locale) =>
      `<a href="${escapeHTML(withLocale(input.requestURL, locale))}" lang="${locale}" hreflang="${locale}"${locale === input.locale ? ' aria-current="true"' : ''}>${LOCALE_NAMES[locale]}</a>`,
  ).join('');
  return `<header class="site-header"><div class="header-inner"><a class="brand" href="${escapeHTML(input.homeHref)}">be-music <span>${escapeHTML(input.product)}</span></a><nav class="header-nav" aria-label="${t.nav}">${play}${account}<span class="lang-switch" role="group" aria-label="${t.language}">${languages}</span></nav></div></header>`;
}
